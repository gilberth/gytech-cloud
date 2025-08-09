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
import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as mime from "mime-types";
import * as archiver from "archiver";

/**
 * Google Drive storage service using Google Drive API
 */
@Injectable()
export class GoogleDriveStorageService extends BaseStorageService {
  readonly provider = StorageProvider.GOOGLE_DRIVE;
  private drive: drive_v3.Drive | null = null;
  private oauth2Client: OAuth2Client | null = null;
  private parentFolderId: string | null = null;
  private sharesFolderCache = new Map<string, string>(); // shareId -> folderId

  constructor(
    prisma: PrismaService,
    config: ConfigService,
  ) {
    super(prisma, config);
  }

  async initialize(config: Record<string, any>): Promise<void> {
    const { clientId, clientSecret, refreshToken, parentFolderId } = config;
    
    if (!clientId || !clientSecret || !refreshToken) {
      throw new BadRequestException("Missing Google Drive configuration");
    }

    // Initialize OAuth2 client
    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'urn:ietf:wg:oauth:2.0:oob' // For server-side apps
    );

    this.oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    // Initialize Drive API
    this.drive = google.drive({ version: 'v3', auth: this.oauth2Client });
    this.parentFolderId = parentFolderId || null;
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.drive) {
        return false;
      }

      // Test by getting user's drive information
      await this.drive.about.get({ fields: 'storageQuota' });
      return true;
    } catch (error) {
      this.logger.error("Google Drive connection test failed:", error);
      return false;
    }
  }

  protected async uploadChunk(
    data: string,
    chunk: ChunkContext,
    file: FileContext,
    shareId: string,
  ): Promise<void> {
    if (!this.drive) {
      throw new InternalServerErrorException("Google Drive client not initialized");
    }

    const buffer = Buffer.from(data, 'base64');

    try {
      if (chunk.index === 0) {
        // Initialize resumable upload for the first chunk
        await this.initializeResumableUpload(file, shareId, buffer, chunk.total);
      } else {
        // Continue resumable upload
        await this.continueResumableUpload(file.id!, buffer, chunk);
      }
    } catch (error) {
      this.logger.error(`Google Drive chunk upload failed:`, error);
      await this.cleanupFailedUpload(shareId, file.id);
      throw error;
    }
  }

  private async initializeResumableUpload(
    file: FileContext,
    shareId: string,
    buffer: Buffer,
    totalChunks: number,
  ): Promise<void> {
    try {
      const shareFolderId = await this.getOrCreateShareFolder(shareId);
      const mimeType = mime.lookup(file.name) || 'application/octet-stream';

      // For Google Drive API, we'll use simple upload for now
      // For production, implement resumable upload with proper session management
      const fileMetadata = {
        name: file.name,
        parents: [shareFolderId],
      };

      // Since Google Drive API doesn't support true chunked upload like S3,
      // we'll accumulate chunks and upload when complete
      const chunkKey = `${shareId}:${file.id}`;
      let accumulatedBuffer = this.getAccumulatedBuffer(chunkKey);
      
      if (!accumulatedBuffer) {
        accumulatedBuffer = Buffer.alloc(0);
      }

      accumulatedBuffer = Buffer.concat([accumulatedBuffer, buffer]);
      this.setAccumulatedBuffer(chunkKey, accumulatedBuffer);

    } catch (error) {
      this.logger.error(`Failed to initialize Google Drive upload:`, error);
      throw error;
    }
  }

  private async continueResumableUpload(
    fileId: string,
    buffer: Buffer,
    chunk: ChunkContext,
  ): Promise<void> {
    const chunkKey = `${chunk.index}:${fileId}`;
    let accumulatedBuffer = this.getAccumulatedBuffer(chunkKey);
    
    if (!accumulatedBuffer) {
      accumulatedBuffer = Buffer.alloc(0);
    }

    accumulatedBuffer = Buffer.concat([accumulatedBuffer, buffer]);
    this.setAccumulatedBuffer(chunkKey, accumulatedBuffer);

    // If this is the last chunk, upload the complete file
    if (chunk.index === chunk.total - 1) {
      await this.completeFileUpload(fileId, accumulatedBuffer);
      this.clearAccumulatedBuffer(chunkKey);
    }
  }

  private async completeFileUpload(fileId: string, buffer: Buffer): Promise<void> {
    try {
      const fileMetadata = await this.prisma.file.findUnique({
        where: { id: fileId },
        include: { share: true },
      });

      if (!fileMetadata) {
        throw new Error("File metadata not found");
      }

      const shareFolderId = await this.getOrCreateShareFolder(fileMetadata.shareId);
      const mimeType = mime.lookup(fileMetadata.name) || 'application/octet-stream';

      const driveFileMetadata = {
        name: fileMetadata.name,
        parents: [shareFolderId],
      };

      // Upload complete file to Google Drive
      const response = await this.drive!.files.create({
        requestBody: driveFileMetadata,
        media: {
          mimeType: mimeType,
          body: Readable.from(buffer),
        },
        fields: 'id',
      });

      // Store Google Drive file ID for future reference
      await this.prisma.file.update({
        where: { id: fileId },
        data: {
          // Store Google Drive file ID in a metadata field (you might need to add this to schema)
          // For now, we'll track it internally
        },
      });

      this.logger.log(`File uploaded to Google Drive: ${response.data.id}`);
    } catch (error) {
      this.logger.error(`Failed to complete Google Drive upload:`, error);
      throw error;
    }
  }

  private async getOrCreateShareFolder(shareId: string): Promise<string> {
    if (this.sharesFolderCache.has(shareId)) {
      return this.sharesFolderCache.get(shareId)!;
    }

    try {
      const folderName = `GYTECH-Cloud-${shareId}`;
      
      // Search for existing folder
      const searchResponse = await this.drive!.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder'`,
        fields: 'files(id, name)',
      });

      if (searchResponse.data.files && searchResponse.data.files.length > 0) {
        const folderId = searchResponse.data.files[0].id!;
        this.sharesFolderCache.set(shareId, folderId);
        return folderId;
      }

      // Create new folder
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: this.parentFolderId ? [this.parentFolderId] : undefined,
      };

      const createResponse = await this.drive!.files.create({
        requestBody: folderMetadata,
        fields: 'id',
      });

      const folderId = createResponse.data.id!;
      this.sharesFolderCache.set(shareId, folderId);
      return folderId;
    } catch (error) {
      this.logger.error(`Failed to create Google Drive folder:`, error);
      throw error;
    }
  }

  async get(shareId: string, fileId: string): Promise<StorageFile> {
    if (!this.drive) {
      throw new InternalServerErrorException("Google Drive client not initialized");
    }

    const fileMetadata = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!fileMetadata) {
      throw new NotFoundException("File not found");
    }

    try {
      // Find file in Google Drive by name and parent folder
      const shareFolderId = await this.getOrCreateShareFolder(shareId);
      const searchResponse = await this.drive.files.list({
        q: `name='${fileMetadata.name}' and parents in '${shareFolderId}'`,
        fields: 'files(id, name, size, createdTime, mimeType)',
      });

      if (!searchResponse.data.files || searchResponse.data.files.length === 0) {
        throw new NotFoundException("File not found in Google Drive");
      }

      const driveFile = searchResponse.data.files[0];
      
      // Get file content
      const response = await this.drive.files.get({
        fileId: driveFile.id!,
        alt: 'media',
      }, { responseType: 'stream' });

      return {
        metaData: {
          id: fileId,
          name: fileMetadata.name,
          size: fileMetadata.size,
          shareId: shareId,
          createdAt: new Date(driveFile.createdTime || Date.now()),
          mimeType: driveFile.mimeType || mime.contentType(fileMetadata.name.split(".").pop()) || "application/octet-stream",
        },
        file: response.data as Readable,
      };
    } catch (error) {
      this.logger.error(`Failed to get file from Google Drive:`, error);
      throw new NotFoundException("File not found in Google Drive");
    }
  }

  async remove(shareId: string, fileId: string): Promise<void> {
    if (!this.drive) {
      throw new InternalServerErrorException("Google Drive client not initialized");
    }

    const fileMetadata = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!fileMetadata) {
      throw new NotFoundException("File not found");
    }

    try {
      // Find and delete file from Google Drive
      const shareFolderId = await this.getOrCreateShareFolder(shareId);
      const searchResponse = await this.drive.files.list({
        q: `name='${fileMetadata.name}' and parents in '${shareFolderId}'`,
        fields: 'files(id)',
      });

      if (searchResponse.data.files && searchResponse.data.files.length > 0) {
        const driveFileId = searchResponse.data.files[0].id!;
        await this.drive.files.delete({ fileId: driveFileId });
      }

      // Delete database record
      await this.prisma.file.delete({ where: { id: fileId } });
    } catch (error) {
      this.logger.error(`Failed to delete file from Google Drive:`, error);
      throw new InternalServerErrorException("Could not delete file from Google Drive");
    }
  }

  async deleteAllFiles(shareId: string): Promise<void> {
    if (!this.drive) {
      throw new InternalServerErrorException("Google Drive client not initialized");
    }

    try {
      const shareFolderId = this.sharesFolderCache.get(shareId);
      if (shareFolderId) {
        // Delete the entire share folder
        await this.drive.files.delete({ fileId: shareFolderId });
        this.sharesFolderCache.delete(shareId);
      }
    } catch (error) {
      this.logger.error(`Failed to delete share folder from Google Drive:`, error);
      throw new InternalServerErrorException("Could not delete share folder from Google Drive");
    }
  }

  async getZip(shareId: string): Promise<Readable> {
    if (!this.drive) {
      throw new InternalServerErrorException("Google Drive client not initialized");
    }

    return new Promise<Readable>(async (resolve, reject) => {
      try {
        const shareFolderId = await this.getOrCreateShareFolder(shareId);
        
        // Get all files in the share folder
        const filesResponse = await this.drive!.files.list({
          q: `parents in '${shareFolderId}' and mimeType != 'application/vnd.google-apps.folder'`,
          fields: 'files(id, name)',
        });

        const compressionLevel = this.config.get("share.zipCompressionLevel");
        const archive = archiver("zip", {
          zlib: { level: parseInt(compressionLevel) },
        });

        archive.on("error", (err) => {
          this.logger.error("Archive error", err);
          reject(new InternalServerErrorException("Error creating ZIP file"));
        });

        if (!filesResponse.data.files || filesResponse.data.files.length === 0) {
          throw new NotFoundException(`No files found for share ${shareId}`);
        }

        let filesProcessed = 0;
        const totalFiles = filesResponse.data.files.length;

        // Process each file
        for (const file of filesResponse.data.files) {
          try {
            const response = await this.drive!.files.get({
              fileId: file.id!,
              alt: 'media',
            }, { responseType: 'stream' });

            const fileStream = response.data as Readable;
            archive.append(fileStream, { name: file.name! });

          } catch (error) {
            this.logger.error(`Error processing file ${file.name}:`, error);
          }

          filesProcessed++;
          if (filesProcessed === totalFiles) {
            archive.finalize();
          }
        }

        resolve(archive);
      } catch (error) {
        this.logger.error("Error creating ZIP from Google Drive:", error);
        reject(new InternalServerErrorException("Error creating ZIP file"));
      }
    });
  }

  async getFileSize(shareId: string, fileName: string): Promise<number> {
    if (!this.drive) {
      throw new InternalServerErrorException("Google Drive client not initialized");
    }

    try {
      const shareFolderId = await this.getOrCreateShareFolder(shareId);
      const searchResponse = await this.drive.files.list({
        q: `name='${fileName}' and parents in '${shareFolderId}'`,
        fields: 'files(size)',
      });

      if (searchResponse.data.files && searchResponse.data.files.length > 0) {
        return parseInt(searchResponse.data.files[0].size || '0');
      }

      return 0;
    } catch (error) {
      this.logger.error(`Failed to get file size from Google Drive:`, error);
      throw new Error("Could not retrieve file size");
    }
  }

  async getAvailableSpace(): Promise<number | null> {
    if (!this.drive) {
      throw new InternalServerErrorException("Google Drive client not initialized");
    }

    try {
      const response = await this.drive.about.get({ fields: 'storageQuota' });
      const quota = response.data.storageQuota;
      
      if (quota && quota.limit && quota.usage) {
        const limit = parseInt(quota.limit);
        const usage = parseInt(quota.usage);
        return limit - usage;
      }

      return null;
    } catch (error) {
      this.logger.error("Failed to get Google Drive quota:", error);
      return null;
    }
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
        return true; // Simulated chunking
      case StorageFeature.DIRECT_DOWNLOAD:
        return true;
      case StorageFeature.SPACE_QUOTA:
        return true;
      case StorageFeature.FILE_VERSIONING:
        return false; // Could be implemented
      case StorageFeature.BATCH_OPERATIONS:
        return false;
      case StorageFeature.STREAMING_UPLOAD:
        return true;
      default:
        return false;
    }
  }

  protected async cleanupFailedUpload(shareId: string, fileId?: string): Promise<void> {
    if (fileId) {
      // Clear accumulated buffer
      const chunkKey = `${shareId}:${fileId}`;
      this.clearAccumulatedBuffer(chunkKey);

      // Try to delete partial file from Google Drive (if exists)
      try {
        const fileMetadata = await this.prisma.file.findUnique({
          where: { id: fileId },
        });
        
        if (fileMetadata && this.drive) {
          const shareFolderId = await this.getOrCreateShareFolder(shareId);
          const searchResponse = await this.drive.files.list({
            q: `name='${fileMetadata.name}' and parents in '${shareFolderId}'`,
            fields: 'files(id)',
          });

          if (searchResponse.data.files && searchResponse.data.files.length > 0) {
            await this.drive.files.delete({ fileId: searchResponse.data.files[0].id! });
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to cleanup partial file:`, error);
      }
    }
  }

  // Simple in-memory buffer management for chunked uploads
  private bufferCache = new Map<string, Buffer>();

  private getAccumulatedBuffer(key: string): Buffer | undefined {
    return this.bufferCache.get(key);
  }

  private setAccumulatedBuffer(key: string, buffer: Buffer): void {
    this.bufferCache.set(key, buffer);
  }

  private clearAccumulatedBuffer(key: string): void {
    this.bufferCache.delete(key);
  }
}