import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { ConfigService } from "src/config/config.service";
import * as crypto from "crypto";
import { validate as isValidUUID } from "uuid";
import {
  CloudStorageService,
  StorageProvider,
  ChunkContext,
  FileContext,
  StorageFile,
  FileMetadata,
  StorageFeature,
  MigrationResult,
} from "./cloud-storage.interface";
import { Readable } from "stream";

/**
 * Abstract base class for storage providers
 * Implements common functionality and validation logic
 */
@Injectable()
export abstract class BaseStorageService implements CloudStorageService {
  protected readonly logger = new Logger(this.constructor.name);

  abstract readonly provider: StorageProvider;

  constructor(
    protected prisma: PrismaService,
    protected config: ConfigService,
  ) {}

  abstract initialize(config: Record<string, any>): Promise<void>;
  abstract testConnection(): Promise<boolean>;
  abstract get(shareId: string, fileId: string): Promise<StorageFile>;
  abstract remove(shareId: string, fileId: string): Promise<void>;
  abstract deleteAllFiles(shareId: string): Promise<void>;
  abstract getZip(shareId: string): Promise<Readable>;
  abstract getFileSize(shareId: string, fileName: string): Promise<number>;
  abstract getAvailableSpace(): Promise<number | null>;
  abstract listFiles(shareId: string): Promise<FileMetadata[]>;

  /**
   * Common file creation logic with validation
   * Subclasses should override uploadChunk() method
   */
  async create(
    data: string,
    chunk: ChunkContext,
    file: FileContext,
    shareId: string,
  ): Promise<FileContext> {
    // Generate file ID if not provided
    if (!file.id) {
      file.id = crypto.randomUUID();
    } else if (!isValidUUID(file.id)) {
      throw new BadRequestException("Invalid file ID format");
    }

    // Validate share exists and is not locked
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      include: { files: true, reverseShare: true },
    });

    if (!share) {
      throw new NotFoundException("Share not found");
    }

    if (share.uploadLocked) {
      throw new BadRequestException("Share is already completed");
    }

    // Validate chunk data
    const buffer = Buffer.from(data, "base64");
    if (buffer.length === 0 && chunk.index !== chunk.total - 1) {
      throw new BadRequestException("Empty chunk data received");
    }

    // Check share size limits
    await this.validateShareSize(share, buffer.byteLength);

    try {
      // Provider-specific upload logic
      await this.uploadChunk(data, chunk, file, shareId);

      // If last chunk, create database record
      if (chunk.index === chunk.total - 1) {
        await this.finalizeFile(shareId, file);
      }

      return file;
    } catch (error) {
      this.logger.error(`Upload failed for file ${file.id}:`, error);
      await this.cleanupFailedUpload(shareId, file.id);
      throw new InternalServerErrorException("File upload failed");
    }
  }

  /**
   * Abstract method for provider-specific chunk upload
   */
  protected abstract uploadChunk(
    data: string,
    chunk: ChunkContext,
    file: FileContext,
    shareId: string,
  ): Promise<void>;

  /**
   * Finalize file upload by creating database record
   */
  protected async finalizeFile(shareId: string, file: FileContext): Promise<void> {
    try {
      const fileSize = await this.getFileSize(shareId, file.name);
      
      await this.prisma.file.create({
        data: {
          id: file.id!,
          name: file.name,
          size: fileSize.toString(),
          share: { connect: { id: shareId } },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to finalize file ${file.id}:`, error);
      throw error;
    }
  }

  /**
   * Validate share size limits
   */
  protected async validateShareSize(share: any, additionalSize: number): Promise<void> {
    const fileSizeSum = share.files.reduce(
      (n: number, { size }: { size: string }) => n + parseInt(size),
      0,
    );

    const totalSize = fileSizeSum + additionalSize;
    const maxSize = this.config.get("share.maxSize");
    const reverseMaxSize = share.reverseShare?.maxShareSize
      ? parseInt(share.reverseShare.maxShareSize)
      : null;

    if (totalSize > maxSize || (reverseMaxSize && totalSize > reverseMaxSize)) {
      throw new BadRequestException("Max share size exceeded");
    }
  }

  /**
   * Clean up failed upload (provider should implement if needed)
   */
  protected async cleanupFailedUpload(shareId: string, fileId?: string): Promise<void> {
    // Default implementation - providers can override
    this.logger.warn(`Cleanup needed for failed upload: ${shareId}/${fileId}`);
  }

  /**
   * Default feature support (providers should override)
   */
  supportsFeature(feature: StorageFeature): boolean {
    switch (feature) {
      case StorageFeature.CHUNKED_UPLOAD:
        return true;
      case StorageFeature.DIRECT_DOWNLOAD:
        return false;
      case StorageFeature.SPACE_QUOTA:
        return false;
      case StorageFeature.FILE_VERSIONING:
        return false;
      case StorageFeature.BATCH_OPERATIONS:
        return false;
      case StorageFeature.STREAMING_UPLOAD:
        return false;
      default:
        return false;
    }
  }

  /**
   * Default migration implementation
   */
  async migrateFiles(
    sourceProvider: CloudStorageService,
    shareId: string,
    fileIds: string[]
  ): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: true,
      migratedFiles: [],
      failedFiles: [],
      totalSize: 0,
    };

    for (const fileId of fileIds) {
      try {
        // Get file from source provider
        const sourceFile = await sourceProvider.get(shareId, fileId);
        
        // Convert stream to buffer for re-upload
        const chunks = await this.streamToChunks(sourceFile.file);
        
        // Upload to current provider
        const fileContext: FileContext = {
          id: fileId,
          name: sourceFile.metaData.name,
        };

        for (let i = 0; i < chunks.length; i++) {
          await this.uploadChunk(
            chunks[i].toString('base64'),
            { index: i, total: chunks.length },
            fileContext,
            shareId
          );
        }

        result.migratedFiles.push(fileId);
        result.totalSize += parseInt(sourceFile.metaData.size);
      } catch (error) {
        this.logger.error(`Migration failed for file ${fileId}:`, error);
        result.failedFiles.push({
          fileId,
          error: error.message || 'Unknown error'
        });
        result.success = false;
      }
    }

    return result;
  }

  /**
   * Helper method to convert stream to chunks
   */
  protected async streamToChunks(stream: Readable): Promise<Buffer[]> {
    const chunkSize = this.config.get("share.chunkSize");
    const chunks: Buffer[] = [];
    let buffer = Buffer.alloc(0);

    return new Promise((resolve, reject) => {
      stream.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        
        while (buffer.length >= chunkSize) {
          chunks.push(buffer.slice(0, chunkSize));
          buffer = buffer.slice(chunkSize);
        }
      });

      stream.on('end', () => {
        if (buffer.length > 0) {
          chunks.push(buffer);
        }
        resolve(chunks);
      });

      stream.on('error', reject);
    });
  }
}