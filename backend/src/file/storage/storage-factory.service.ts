import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { ConfigService } from "src/config/config.service";
import {
  CloudStorageService,
  StorageProvider,
  StorageProviderFactory as IStorageProviderFactory,
} from "./cloud-storage.interface";

// Import existing services
import { LocalFileService } from "../local.service";
import { S3FileService } from "../s3.service";

// Import new cloud services
import { OneDriveStorageService } from "./onedrive-storage.service";
import { GoogleDriveStorageService } from "./googledrive-storage.service";
import { AzureBlobStorageService } from "./azureblob-storage.service";

/**
 * Factory service for creating storage provider instances
 * Manages configuration and provider instantiation
 */
@Injectable()
export class StorageProviderFactory implements IStorageProviderFactory {
  private readonly logger = new Logger(StorageProviderFactory.name);
  private readonly providerInstances = new Map<StorageProvider, CloudStorageService>();

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private localFileService: LocalFileService,
    private s3FileService: S3FileService,
    private oneDriveService: OneDriveStorageService,
    private googleDriveService: GoogleDriveStorageService,
    private azureBlobService: AzureBlobStorageService,
  ) {}

  /**
   * Create or get cached storage provider instance
   */
  createProvider(provider: StorageProvider): CloudStorageService {
    if (this.providerInstances.has(provider)) {
      return this.providerInstances.get(provider)!;
    }

    let instance: CloudStorageService;

    switch (provider) {
      case StorageProvider.LOCAL:
        instance = this.createLocalAdapter();
        break;
      case StorageProvider.S3:
        instance = this.createS3Adapter();
        break;
      case StorageProvider.ONEDRIVE:
        instance = this.oneDriveService;
        break;
      case StorageProvider.GOOGLE_DRIVE:
        instance = this.googleDriveService;
        break;
      case StorageProvider.AZURE_BLOB:
        instance = this.azureBlobService;
        break;
      default:
        throw new BadRequestException(`Unknown storage provider: ${provider}`);
    }

    this.providerInstances.set(provider, instance);
    return instance;
  }

  /**
   * Get list of available storage providers
   */
  getAvailableProviders(): StorageProvider[] {
    return [
      StorageProvider.LOCAL,
      StorageProvider.S3,
      StorageProvider.ONEDRIVE,
      StorageProvider.GOOGLE_DRIVE,
      StorageProvider.AZURE_BLOB,
    ];
  }

  /**
   * Validate provider configuration
   */
  validateProviderConfig(provider: StorageProvider, config: Record<string, any>): boolean {
    switch (provider) {
      case StorageProvider.LOCAL:
        return this.validateLocalConfig(config);
      case StorageProvider.S3:
        return this.validateS3Config(config);
      case StorageProvider.ONEDRIVE:
        return this.validateOneDriveConfig(config);
      case StorageProvider.GOOGLE_DRIVE:
        return this.validateGoogleDriveConfig(config);
      case StorageProvider.AZURE_BLOB:
        return this.validateAzureBlobConfig(config);
      default:
        return false;
    }
  }

  /**
   * Get enabled providers from configuration
   */
  getEnabledProviders(): StorageProvider[] {
    const enabled: StorageProvider[] = [];

    // Local is always available
    enabled.push(StorageProvider.LOCAL);

    // Check S3 configuration
    if (this.config.get("s3.enabled")) {
      enabled.push(StorageProvider.S3);
    }

    // Check other providers
    if (this.config.get("onedrive.enabled")) {
      enabled.push(StorageProvider.ONEDRIVE);
    }

    if (this.config.get("googledrive.enabled")) {
      enabled.push(StorageProvider.GOOGLE_DRIVE);
    }

    if (this.config.get("azureblob.enabled")) {
      enabled.push(StorageProvider.AZURE_BLOB);
    }

    return enabled;
  }

  /**
   * Create adapter for LocalFileService to match CloudStorageService interface
   */
  private createLocalAdapter(): CloudStorageService {
    return {
      provider: StorageProvider.LOCAL,
      
      async initialize(config: Record<string, any>): Promise<void> {
        // Local storage doesn't need initialization
      },

      async testConnection(): Promise<boolean> {
        // Local storage is always available
        return true;
      },

      create: this.localFileService.create.bind(this.localFileService),
      get: this.localFileService.get.bind(this.localFileService),
      remove: this.localFileService.remove.bind(this.localFileService),
      deleteAllFiles: this.localFileService.deleteAllFiles.bind(this.localFileService),
      getZip: this.localFileService.getZip.bind(this.localFileService),

      async getFileSize(shareId: string, fileName: string): Promise<number> {
        // Implement file size retrieval for local storage
        const { stat } = await import('fs/promises');
        const { SHARE_DIRECTORY } = await import('../../constants');
        const filePath = `${SHARE_DIRECTORY}/${shareId}/${fileName}`;
        const stats = await stat(filePath);
        return stats.size;
      },

      async getAvailableSpace(): Promise<number | null> {
        // Return available disk space if possible
        const { statfs } = await import('fs/promises');
        const { SHARE_DIRECTORY } = await import('../../constants');
        const stats = await statfs(SHARE_DIRECTORY);
        return stats.bavail * stats.bsize;
      },

      async listFiles(shareId: string): Promise<any[]> {
        const files = await this.prisma.file.findMany({
          where: { shareId },
          select: { id: true, name: true, size: true, createdAt: true },
        });
        return files.map(file => ({
          ...file,
          shareId,
          mimeType: false,
        }));
      },

      supportsFeature(feature: any): boolean {
        return feature === 'chunked_upload' || feature === 'space_quota';
      },

      async migrateFiles(): Promise<any> {
        throw new Error("Migration not implemented for local storage");
      },
    };
  }

  /**
   * Create adapter for S3FileService to match CloudStorageService interface
   */
  private createS3Adapter(): CloudStorageService {
    return {
      provider: StorageProvider.S3,
      
      async initialize(config: Record<string, any>): Promise<void> {
        // S3 service is initialized through existing configuration
      },

      async testConnection(): Promise<boolean> {
        try {
          const s3Instance = this.s3FileService.getS3Instance();
          // Try to list bucket to test connection
          const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
          await s3Instance.send(
            new ListObjectsV2Command({
              Bucket: this.config.get("s3.bucketName"),
              MaxKeys: 1,
            })
          );
          return true;
        } catch (error) {
          this.logger.error("S3 connection test failed:", error);
          return false;
        }
      },

      create: this.s3FileService.create.bind(this.s3FileService),
      get: this.s3FileService.get.bind(this.s3FileService),
      remove: this.s3FileService.remove.bind(this.s3FileService),
      deleteAllFiles: this.s3FileService.deleteAllFiles.bind(this.s3FileService),
      getZip: this.s3FileService.getZip.bind(this.s3FileService),
      getFileSize: this.s3FileService.getFileSize.bind(this.s3FileService),

      async getAvailableSpace(): Promise<number | null> {
        // S3 doesn't have traditional space limitations
        return null;
      },

      async listFiles(shareId: string): Promise<any[]> {
        const files = await this.prisma.file.findMany({
          where: { shareId },
          select: { id: true, name: true, size: true, createdAt: true },
        });
        return files.map(file => ({
          ...file,
          shareId,
          mimeType: false,
        }));
      },

      supportsFeature(feature: any): boolean {
        return ['chunked_upload', 'direct_download', 'streaming_upload'].includes(feature);
      },

      async migrateFiles(): Promise<any> {
        throw new Error("Migration not implemented for S3 storage");
      },
    };
  }

  // Validation methods
  private validateLocalConfig(config: Record<string, any>): boolean {
    // Local storage always valid
    return true;
  }

  private validateS3Config(config: Record<string, any>): boolean {
    const required = ['endpoint', 'region', 'key', 'secret', 'bucketName'];
    return required.every(key => config[key] && config[key].trim().length > 0);
  }

  private validateOneDriveConfig(config: Record<string, any>): boolean {
    const required = ['clientId', 'clientSecret', 'tenantId'];
    return required.every(key => config[key] && config[key].trim().length > 0);
  }

  private validateGoogleDriveConfig(config: Record<string, any>): boolean {
    const required = ['clientId', 'clientSecret', 'refreshToken'];
    return required.every(key => config[key] && config[key].trim().length > 0);
  }

  private validateAzureBlobConfig(config: Record<string, any>): boolean {
    const required = ['accountName', 'accountKey', 'containerName'];
    return required.every(key => config[key] && config[key].trim().length > 0);
  }
}