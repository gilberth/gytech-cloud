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
import { Client } from '@microsoft/microsoft-graph-client';
import { AuthenticationProvider } from '@microsoft/microsoft-graph-client';
import { ConfidentialClientApplication } from '@azure/msal-node';
import * as mime from "mime-types";
import * as archiver from "archiver";

/**
 * Custom authentication provider for Microsoft Graph API
 */
class OneDriveAuthProvider implements AuthenticationProvider {
  private msalClient: ConfidentialClientApplication;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(
    private clientId: string,
    private clientSecret: string,
    private tenantId: string,
  ) {
    this.msalClient = new ConfidentialClientApplication({
      auth: {
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        authority: `https://login.microsoftonline.com/${this.tenantId}`,
      },
    });
  }

  async getAccessToken(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      // Get new token using client credentials flow
      const response = await this.msalClient.acquireTokenByClientCredential({
        scopes: ['https://graph.microsoft.com/.default'],
      });

      if (response && response.accessToken) {
        this.accessToken = response.accessToken;
        this.tokenExpiry = new Date(Date.now() + (response.expiresOn?.getTime() || 3600000));
        return this.accessToken;
      }

      throw new Error('Failed to acquire access token');
    } catch (error) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }
}

/**
 * OneDrive/SharePoint storage service using Microsoft Graph API
 */
@Injectable()
export class OneDriveStorageService extends BaseStorageService {
  readonly provider = StorageProvider.ONEDRIVE;
  private graphClient: Client | null = null;
  private authProvider: OneDriveAuthProvider | null = null;
  private driveId: string | null = null;
  private uploadSessions = new Map<string, string>(); // fileId -> uploadUrl

  constructor(
    prisma: PrismaService,
    config: ConfigService,
  ) {
    super(prisma, config);
  }

  async initialize(config: Record<string, any>): Promise<void> {
    const { clientId, clientSecret, tenantId, driveId } = config;
    
    if (!clientId || !clientSecret || !tenantId) {
      throw new BadRequestException("Missing OneDrive configuration");
    }

    this.authProvider = new OneDriveAuthProvider(clientId, clientSecret, tenantId);
    this.driveId = driveId || 'me/drive'; // Default to user's personal drive
    
    // Initialize Graph client
    this.graphClient = Client.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => {
          return await this.authProvider!.getAccessToken();
        },
      },
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.graphClient) {
        return false;
      }

      // Test by getting drive information
      await this.graphClient.api(`/${this.driveId}`).get();
      return true;
    } catch (error) {
      this.logger.error("OneDrive connection test failed:", error);
      return false;
    }
  }

  protected async uploadChunk(
    data: string,
    chunk: ChunkContext,
    file: FileContext,
    shareId: string,
  ): Promise<void> {
    if (!this.graphClient) {
      throw new InternalServerErrorException("OneDrive client not initialized");
    }

    const buffer = Buffer.from(data, 'base64');
    const folderPath = `GYTECH-Cloud/${shareId}`;
    const filePath = `${folderPath}/${file.name}`;

    try {
      if (chunk.index === 0) {
        // Initialize upload session for the first chunk
        await this.initializeUploadSession(filePath, file.id!);
      }

      const uploadUrl = this.uploadSessions.get(file.id!);
      if (!uploadUrl) {
        throw new Error("Upload session not found");
      }

      // Calculate byte range for this chunk
      const chunkSize = this.config.get("share.chunkSize");
      const startByte = chunk.index * chunkSize;
      const endByte = startByte + buffer.length - 1;

      // Upload chunk using resumable upload session
      await this.uploadChunkToSession(uploadUrl, buffer, startByte, endByte);

      // Clean up session if this is the last chunk
      if (chunk.index === chunk.total - 1) {
        this.uploadSessions.delete(file.id!);
      }
    } catch (error) {
      this.logger.error(`OneDrive chunk upload failed:`, error);
      await this.cleanupFailedUpload(shareId, file.id);
      throw error;
    }
  }

  private async initializeUploadSession(filePath: string, fileId: string): Promise<void> {
    try {
      // Create folder if it doesn't exist
      const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
      await this.ensureFolderExists(folderPath);

      // Create upload session
      const uploadSession = await this.graphClient!
        .api(`/${this.driveId}/root:/${filePath}:/createUploadSession`)
        .post({
          item: {
            "@microsoft.graph.conflictBehavior": "replace",
          },
        });

      this.uploadSessions.set(fileId, uploadSession.uploadUrl);
    } catch (error) {
      this.logger.error(`Failed to initialize upload session:`, error);
      throw error;
    }
  }

  private async uploadChunkToSession(
    uploadUrl: string,
    buffer: Buffer,
    startByte: number,
    endByte: number,
  ): Promise<void> {
    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Range': `bytes ${startByte}-${endByte}/*`,
          'Content-Length': buffer.length.toString(),
        },
        body: buffer,
      });

      if (!response.ok && response.status !== 202) {
        throw new Error(`Chunk upload failed: ${response.statusText}`);
      }
    } catch (error) {
      this.logger.error(`Failed to upload chunk:`, error);
      throw error;
    }
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    try {
      // Check if folder exists
      await this.graphClient!.api(`/${this.driveId}/root:/${folderPath}`).get();
    } catch (error) {
      // Folder doesn't exist, create it
      const pathParts = folderPath.split('/');
      let currentPath = '';

      for (const part of pathParts) {
        if (!part) continue;
        
        const parentPath = currentPath || 'root';
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        try {
          await this.graphClient!.api(`/${this.driveId}/${parentPath}:/children`).post({
            name: part,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'ignore',
          });
        } catch (createError) {
          // Ignore if folder already exists
          if (!createError.message?.includes('already exists')) {
            throw createError;
          }
        }
      }
    }
  }

  async get(shareId: string, fileId: string): Promise<StorageFile> {
    if (!this.graphClient) {
      throw new InternalServerErrorException("OneDrive client not initialized");
    }

    const fileMetadata = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!fileMetadata) {
      throw new NotFoundException("File not found");
    }

    const filePath = `GYTECH-Cloud/${shareId}/${fileMetadata.name}`;

    try {
      // Get file metadata from OneDrive
      const driveItem = await this.graphClient
        .api(`/${this.driveId}/root:/${filePath}`)
        .get();

      // Get download URL
      const downloadUrl = driveItem['@microsoft.graph.downloadUrl'];
      
      // Create readable stream from download URL
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      return {
        metaData: {
          id: fileId,
          name: fileMetadata.name,
          size: fileMetadata.size,
          shareId: shareId,
          createdAt: new Date(driveItem.createdDateTime),
          mimeType: mime.contentType(fileMetadata.name.split(".").pop()) || "application/octet-stream",
        },
        file: response.body as unknown as Readable,
      };
    } catch (error) {
      this.logger.error(`Failed to get file from OneDrive:`, error);
      throw new NotFoundException("File not found in OneDrive");
    }
  }

  async remove(shareId: string, fileId: string): Promise<void> {
    if (!this.graphClient) {
      throw new InternalServerErrorException("OneDrive client not initialized");
    }

    const fileMetadata = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!fileMetadata) {
      throw new NotFoundException("File not found");
    }

    const filePath = `GYTECH-Cloud/${shareId}/${fileMetadata.name}`;

    try {
      // Delete file from OneDrive
      await this.graphClient.api(`/${this.driveId}/root:/${filePath}`).delete();
      
      // Delete database record
      await this.prisma.file.delete({ where: { id: fileId } });
    } catch (error) {
      this.logger.error(`Failed to delete file from OneDrive:`, error);
      throw new InternalServerErrorException("Could not delete file from OneDrive");
    }
  }

  async deleteAllFiles(shareId: string): Promise<void> {
    if (!this.graphClient) {
      throw new InternalServerErrorException("OneDrive client not initialized");
    }

    const folderPath = `GYTECH-Cloud/${shareId}`;

    try {
      // Delete entire share folder
      await this.graphClient.api(`/${this.driveId}/root:/${folderPath}`).delete();
    } catch (error) {
      this.logger.error(`Failed to delete share folder from OneDrive:`, error);
      throw new InternalServerErrorException("Could not delete share folder from OneDrive");
    }
  }

  async getZip(shareId: string): Promise<Readable> {
    if (!this.graphClient) {
      throw new InternalServerErrorException("OneDrive client not initialized");
    }

    const folderPath = `GYTECH-Cloud/${shareId}`;

    return new Promise<Readable>(async (resolve, reject) => {
      try {
        // Get all files in the share folder
        const folderContents = await this.graphClient!
          .api(`/${this.driveId}/root:/${folderPath}:/children`)
          .get();

        const compressionLevel = this.config.get("share.zipCompressionLevel");
        const archive = archiver("zip", {
          zlib: { level: parseInt(compressionLevel) },
        });

        archive.on("error", (err) => {
          this.logger.error("Archive error", err);
          reject(new InternalServerErrorException("Error creating ZIP file"));
        });

        if (!folderContents.value || folderContents.value.length === 0) {
          throw new NotFoundException(`No files found for share ${shareId}`);
        }

        let filesProcessed = 0;
        const totalFiles = folderContents.value.length;

        // Process each file
        for (const item of folderContents.value) {
          if (item.file) { // Only process files, not folders
            try {
              const downloadUrl = item['@microsoft.graph.downloadUrl'];
              const response = await fetch(downloadUrl);
              
              if (response.ok) {
                const fileStream = response.body as unknown as Readable;
                archive.append(fileStream, { name: item.name });
              }
            } catch (error) {
              this.logger.error(`Error processing file ${item.name}:`, error);
            }

            filesProcessed++;
            if (filesProcessed === totalFiles) {
              archive.finalize();
            }
          }
        }

        resolve(archive);
      } catch (error) {
        this.logger.error("Error creating ZIP from OneDrive:", error);
        reject(new InternalServerErrorException("Error creating ZIP file"));
      }
    });
  }

  async getFileSize(shareId: string, fileName: string): Promise<number> {
    if (!this.graphClient) {
      throw new InternalServerErrorException("OneDrive client not initialized");
    }

    const filePath = `GYTECH-Cloud/${shareId}/${fileName}`;

    try {
      const driveItem = await this.graphClient
        .api(`/${this.driveId}/root:/${filePath}`)
        .get();

      return driveItem.size || 0;
    } catch (error) {
      this.logger.error(`Failed to get file size from OneDrive:`, error);
      throw new Error("Could not retrieve file size");
    }
  }

  async getAvailableSpace(): Promise<number | null> {
    if (!this.graphClient) {
      throw new InternalServerErrorException("OneDrive client not initialized");
    }

    try {
      const drive = await this.graphClient.api(`/${this.driveId}`).get();
      return drive.quota?.remaining || null;
    } catch (error) {
      this.logger.error("Failed to get OneDrive quota:", error);
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
        return true;
      case StorageFeature.DIRECT_DOWNLOAD:
        return true;
      case StorageFeature.SPACE_QUOTA:
        return true;
      case StorageFeature.FILE_VERSIONING:
        return false;
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
      // Remove upload session
      this.uploadSessions.delete(fileId);
      
      // Try to delete partial file from OneDrive
      try {
        const fileMetadata = await this.prisma.file.findUnique({
          where: { id: fileId },
        });
        
        if (fileMetadata && this.graphClient) {
          const filePath = `GYTECH-Cloud/${shareId}/${fileMetadata.name}`;
          await this.graphClient.api(`/${this.driveId}/root:/${filePath}`).delete();
        }
      } catch (error) {
        this.logger.warn(`Failed to cleanup partial file:`, error);
      }
    }
  }
}