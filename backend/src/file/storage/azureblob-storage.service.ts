import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { ConfigService } from "src/config/config.service";
import { BaseStorageService } from "./base-storage.service";
import {
  StorageProvider,
  ChunkContext,
  FileContext,
  StorageFile,
  FileMetadata,
  StorageFeature,
} from "./cloud-storage.interface";
import { Readable } from "stream";
import { 
  BlobServiceClient, 
  StorageSharedKeyCredential,
  ContainerClient,
  BlockBlobClient,
  BlobDownloadResponseParsed 
} from '@azure/storage-blob';
import * as mime from "mime-types";
import * as archiver from "archiver";

/**
 * Azure Blob Storage service using Azure Storage SDK
 */
@Injectable()
export class AzureBlobStorageService extends BaseStorageService {
  readonly provider = StorageProvider.AZURE_BLOB;
  private blobServiceClient: BlobServiceClient | null = null;
  private containerClient: ContainerClient | null = null;
  private blockBlobUploads = new Map<string, { blockIds: string[]; blockBlobClient: BlockBlobClient }>(); // fileId -> upload context

  constructor(
    prisma: PrismaService,
    config: ConfigService,
  ) {
    super(prisma, config);
  }

  async initialize(config: Record<string, any>): Promise<void> {
    const { accountName, accountKey, containerName, sasToken } = config;
    
    if (!accountName || !containerName) {
      throw new BadRequestException("Missing Azure Blob Storage configuration");
    }

    if (!accountKey && !sasToken) {
      throw new BadRequestException("Either accountKey or sasToken must be provided");
    }

    try {
      // Initialize Azure Blob Service Client
      if (accountKey) {
        const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
        this.blobServiceClient = new BlobServiceClient(
          `https://${accountName}.blob.core.windows.net`,
          sharedKeyCredential
        );
      } else if (sasToken) {
        this.blobServiceClient = new BlobServiceClient(
          `https://${accountName}.blob.core.windows.net${sasToken}`
        );
      }

      // Initialize container client
      this.containerClient = this.blobServiceClient!.getContainerClient(containerName);

      // Ensure container exists
      await this.containerClient.createIfNotExists();
    } catch (error) {
      this.logger.error("Failed to initialize Azure Blob Storage:", error);
      throw new BadRequestException("Failed to initialize Azure Blob Storage");
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.containerClient) {
        return false;
      }

      // Test by getting container properties
      await this.containerClient.getProperties();
      return true;
    } catch (error) {
      this.logger.error("Azure Blob Storage connection test failed:", error);
      return false;
    }
  }

  protected async uploadChunk(
    data: string,
    chunk: ChunkContext,
    file: FileContext,
    shareId: string,
  ): Promise<void> {
    if (!this.containerClient) {
      throw new InternalServerErrorException("Azure Blob Storage client not initialized");
    }

    const buffer = Buffer.from(data, 'base64');
    const blobName = `GYTECH-Cloud/${shareId}/${file.name}`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    try {
      if (chunk.index === 0) {
        // Initialize block blob upload
        this.blockBlobUploads.set(file.id!, {
          blockIds: [],
          blockBlobClient,
        });
      }

      const uploadContext = this.blockBlobUploads.get(file.id!);
      if (!uploadContext) {
        throw new Error("Block blob upload context not found");
      }

      // Generate block ID (must be Base64 encoded)
      const blockId = Buffer.from(`block-${chunk.index.toString().padStart(6, '0')}`).toString('base64');
      
      // Upload block
      await uploadContext.blockBlobClient.stageBlock(blockId, buffer, buffer.length);
      uploadContext.blockIds.push(blockId);

      // If this is the last chunk, commit all blocks
      if (chunk.index === chunk.total - 1) {
        await this.commitBlocks(file.id!, uploadContext);
      }

    } catch (error) {
      this.logger.error(`Azure Blob chunk upload failed:`, error);
      await this.cleanupFailedUpload(shareId, file.id);
      throw error;
    }
  }

  private async commitBlocks(fileId: string, uploadContext: { blockIds: string[]; blockBlobClient: BlockBlobClient }): Promise<void> {
    try {
      const fileMetadata = await this.prisma.file.findUnique({
        where: { id: fileId },
      });

      if (!fileMetadata) {
        throw new Error("File metadata not found");
      }

      // Commit all blocks
      await uploadContext.blockBlobClient.commitBlockList(
        uploadContext.blockIds,
        {
          blobHTTPHeaders: {
            blobContentType: mime.lookup(fileMetadata.name) || 'application/octet-stream',
          },
          metadata: {
            originalName: fileMetadata.name,
            shareId: fileMetadata.shareId,
            uploadedAt: new Date().toISOString(),
          },
        }
      );

      // Clean up upload context
      this.blockBlobUploads.delete(fileId);

      this.logger.log(`File uploaded to Azure Blob Storage: ${uploadContext.blockBlobClient.name}`);
    } catch (error) {
      this.logger.error(`Failed to commit blocks for Azure Blob:`, error);
      throw error;
    }
  }

  async get(shareId: string, fileId: string): Promise<StorageFile> {
    if (!this.containerClient) {
      throw new InternalServerErrorException("Azure Blob Storage client not initialized");
    }

    const fileMetadata = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!fileMetadata) {
      throw new NotFoundException("File not found");
    }

    const blobName = `GYTECH-Cloud/${shareId}/${fileMetadata.name}`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    try {
      // Get blob properties first to verify existence
      const properties = await blockBlobClient.getProperties();
      
      // Download blob as stream
      const downloadResponse: BlobDownloadResponseParsed = await blockBlobClient.download();

      if (!downloadResponse.readableStreamBody) {
        throw new Error("Failed to get readable stream from blob");
      }

      return {
        metaData: {
          id: fileId,
          name: fileMetadata.name,
          size: fileMetadata.size,
          shareId: shareId,
          createdAt: properties.createdOn || new Date(),
          mimeType: properties.contentType || mime.contentType(fileMetadata.name.split(".").pop()) || "application/octet-stream",
        },
        file: downloadResponse.readableStreamBody as Readable,
      };
    } catch (error) {
      this.logger.error(`Failed to get file from Azure Blob Storage:`, error);
      throw new NotFoundException("File not found in Azure Blob Storage");
    }
  }

  async remove(shareId: string, fileId: string): Promise<void> {
    if (!this.containerClient) {
      throw new InternalServerErrorException("Azure Blob Storage client not initialized");
    }

    const fileMetadata = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!fileMetadata) {
      throw new NotFoundException("File not found");
    }

    const blobName = `GYTECH-Cloud/${shareId}/${fileMetadata.name}`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    try {
      // Delete blob from Azure Blob Storage
      await blockBlobClient.delete();
      
      // Delete database record
      await this.prisma.file.delete({ where: { id: fileId } });
    } catch (error) {
      this.logger.error(`Failed to delete file from Azure Blob Storage:`, error);
      throw new InternalServerErrorException("Could not delete file from Azure Blob Storage");
    }
  }

  async deleteAllFiles(shareId: string): Promise<void> {
    if (!this.containerClient) {
      throw new InternalServerErrorException("Azure Blob Storage client not initialized");
    }

    const prefix = `GYTECH-Cloud/${shareId}/`;

    try {
      // List all blobs with the share prefix
      const blobsToDelete = [];
      for await (const blob of this.containerClient.listBlobsFlat({ prefix })) {
        blobsToDelete.push(blob.name);
      }

      // Delete all blobs
      for (const blobName of blobsToDelete) {
        const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.delete();
      }
    } catch (error) {
      this.logger.error(`Failed to delete share files from Azure Blob Storage:`, error);
      throw new InternalServerErrorException("Could not delete share files from Azure Blob Storage");
    }
  }

  async getZip(shareId: string): Promise<Readable> {
    if (!this.containerClient) {
      throw new InternalServerErrorException("Azure Blob Storage client not initialized");
    }

    return new Promise<Readable>(async (resolve, reject) => {
      try {
        const prefix = `GYTECH-Cloud/${shareId}/`;
        
        // List all blobs in the share
        const blobs = [];
        for await (const blob of this.containerClient!.listBlobsFlat({ prefix })) {
          blobs.push(blob);
        }

        const compressionLevel = this.config.get("share.zipCompressionLevel");
        const archive = archiver("zip", {
          zlib: { level: parseInt(compressionLevel) },
        });

        archive.on("error", (err) => {
          this.logger.error("Archive error", err);
          reject(new InternalServerErrorException("Error creating ZIP file"));
        });

        if (blobs.length === 0) {
          throw new NotFoundException(`No files found for share ${shareId}`);
        }

        let filesProcessed = 0;
        const totalFiles = blobs.length;

        // Process each blob
        for (const blob of blobs) {
          try {
            const blockBlobClient = this.containerClient!.getBlockBlobClient(blob.name);
            const downloadResponse = await blockBlobClient.download();

            if (downloadResponse.readableStreamBody) {
              // Extract filename from blob path
              const fileName = blob.name.replace(prefix, '');
              const fileStream = downloadResponse.readableStreamBody as Readable;
              archive.append(fileStream, { name: fileName });
            }

          } catch (error) {
            this.logger.error(`Error processing blob ${blob.name}:`, error);
          }

          filesProcessed++;
          if (filesProcessed === totalFiles) {
            archive.finalize();
          }
        }

        resolve(archive);
      } catch (error) {
        this.logger.error("Error creating ZIP from Azure Blob Storage:", error);
        reject(new InternalServerErrorException("Error creating ZIP file"));
      }
    });
  }

  async getFileSize(shareId: string, fileName: string): Promise<number> {
    if (!this.containerClient) {
      throw new InternalServerErrorException("Azure Blob Storage client not initialized");
    }

    const blobName = `GYTECH-Cloud/${shareId}/${fileName}`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

    try {
      const properties = await blockBlobClient.getProperties();
      return properties.contentLength || 0;
    } catch (error) {
      this.logger.error(`Failed to get file size from Azure Blob Storage:`, error);
      throw new Error("Could not retrieve file size");
    }
  }

  async getAvailableSpace(): Promise<number | null> {
    // Azure Blob Storage doesn't have traditional storage limits
    // Return null to indicate unlimited storage
    return null;
  }

  async listFiles(shareId: string): Promise<FileMetadata[]> {
    const files = await this.prisma.file.findMany({
      where: { shareId },
      select: { id: true, name: true, size: true, createdAt: true },
    });

    return files.map(file => ({
      id: file.id,
      name: file.name,
      size: file.size,
      shareId,
      createdAt: file.createdAt,
      mimeType: mime.contentType(file.name.split(".").pop()) || "application/octet-stream",
    }));
  }

  supportsFeature(feature: StorageFeature): boolean {
    switch (feature) {
      case StorageFeature.CHUNKED_UPLOAD:
        return true;
      case StorageFeature.DIRECT_DOWNLOAD:
        return true;
      case StorageFeature.SPACE_QUOTA:
        return false; // Azure Blob has usage-based billing
      case StorageFeature.FILE_VERSIONING:
        return false; // Could be implemented with blob versioning
      case StorageFeature.BATCH_OPERATIONS:
        return true;
      case StorageFeature.STREAMING_UPLOAD:
        return true;
      default:
        return false;
    }
  }

  protected async cleanupFailedUpload(shareId: string, fileId?: string): Promise<void> {
    if (fileId) {
      // Remove upload context
      const uploadContext = this.blockBlobUploads.get(fileId);
      if (uploadContext) {
        try {
          // Try to delete any staged blocks (Azure will clean them up automatically after 7 days)
          await uploadContext.blockBlobClient.delete();
        } catch (error) {
          this.logger.warn(`Failed to cleanup staged blocks:`, error);
        }
        
        this.blockBlobUploads.delete(fileId);
      }
    }
  }

  /**
   * Get blob service client for advanced operations
   */
  getBlobServiceClient(): BlobServiceClient | null {
    return this.blobServiceClient;
  }

  /**
   * Get container client for direct container operations
   */
  getContainerClient(): ContainerClient | null {
    return this.containerClient;
  }

  /**
   * Create a SAS token for direct blob access (if supported by configuration)
   */
  async generateSasToken(blobName: string, permissions: string = 'r', expiryHours: number = 1): Promise<string | null> {
    try {
      if (!this.containerClient) {
        return null;
      }

      // Generate SAS token for blob
      const startsOn = new Date();
      const expiresOn = new Date(startsOn.getTime() + (expiryHours * 60 * 60 * 1000));

      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      
      // Note: This would require additional SAS generation logic
      // For now, return null to indicate SAS not supported
      return null;
    } catch (error) {
      this.logger.error(`Failed to generate SAS token:`, error);
      return null;
    }
  }
}