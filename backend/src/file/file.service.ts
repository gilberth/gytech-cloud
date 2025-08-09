import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { LocalFileService } from "./local.service";
import { S3FileService } from "./s3.service";
import { ConfigService } from "src/config/config.service";
import { Readable } from "stream";
import { PrismaService } from "../prisma/prisma.service";
import { StorageProviderFactory } from "./storage/storage-factory.service";
import { 
  CloudStorageService, 
  StorageProvider,
  StorageFile,
  MigrationResult 
} from "./storage/cloud-storage.interface";
import { OneDriveStorageService } from "./storage/onedrive-storage.service";
import { GoogleDriveStorageService } from "./storage/googledrive-storage.service";
import { AzureBlobStorageService } from "./storage/azureblob-storage.service";

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private prisma: PrismaService,
    private localFileService: LocalFileService,
    private s3FileService: S3FileService,
    private configService: ConfigService,
    private storageFactory: StorageProviderFactory,
    private oneDriveService: OneDriveStorageService,
    private googleDriveService: GoogleDriveStorageService,
    private azureBlobService: AzureBlobStorageService,
  ) {}

  /**
   * Get storage service based on provider type
   * @param storageProvider Storage provider string or enum
   * @returns CloudStorageService instance
   */
  private getStorageService(storageProvider?: string): CloudStorageService {
    let provider: StorageProvider;

    if (storageProvider) {
      // Convert string to StorageProvider enum
      switch (storageProvider.toUpperCase()) {
        case "LOCAL":
          provider = StorageProvider.LOCAL;
          break;
        case "S3":
          provider = StorageProvider.S3;
          break;
        case "ONEDRIVE":
          provider = StorageProvider.ONEDRIVE;
          break;
        case "GOOGLE_DRIVE":
          provider = StorageProvider.GOOGLE_DRIVE;
          break;
        case "AZURE_BLOB":
          provider = StorageProvider.AZURE_BLOB;
          break;
        default:
          this.logger.warn(`Unknown storage provider: ${storageProvider}, falling back to LOCAL`);
          provider = StorageProvider.LOCAL;
      }
    } else {
      // Default provider logic
      if (this.configService.get("s3.enabled")) {
        provider = StorageProvider.S3;
      } else {
        provider = StorageProvider.LOCAL;
      }
    }

    return this.storageFactory.createProvider(provider);
  }

  async create(
    data: string,
    chunk: { index: number; total: number },
    file: {
      id?: string;
      name: string;
    },
    shareId: string,
  ) {
    // Get share to determine storage provider
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
    });

    const storageProvider = share?.storageProvider || this.getDefaultStorageProvider();
    const storageService = this.getStorageService(storageProvider);
    
    return storageService.create(data, chunk, file, shareId);
  }

  async get(shareId: string, fileId: string): Promise<File> {
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
    });
    
    if (!share) {
      throw new BadRequestException("Share not found");
    }

    const storageService = this.getStorageService(share.storageProvider);
    const result = await storageService.get(shareId, fileId);
    
    // Convert StorageFile to File interface for backward compatibility
    return {
      metaData: {
        id: result.metaData.id,
        size: result.metaData.size,
        createdAt: result.metaData.createdAt,
        mimeType: result.metaData.mimeType,
        name: result.metaData.name,
        shareId: result.metaData.shareId,
      },
      file: result.file,
    };
  }

  async remove(shareId: string, fileId: string) {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
    });

    const storageProvider = share?.storageProvider || this.getDefaultStorageProvider();
    const storageService = this.getStorageService(storageProvider);
    
    return storageService.remove(shareId, fileId);
  }

  async deleteAllFiles(shareId: string) {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
    });

    const storageProvider = share?.storageProvider || this.getDefaultStorageProvider();
    const storageService = this.getStorageService(storageProvider);
    
    return storageService.deleteAllFiles(shareId);
  }

  async getZip(shareId: string): Promise<Readable> {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
    });

    const storageProvider = share?.storageProvider || this.getDefaultStorageProvider();
    const storageService = this.getStorageService(storageProvider);
    
    return await storageService.getZip(shareId);
  }

  /**
   * Get default storage provider from configuration
   */
  private getDefaultStorageProvider(): string {
    if (this.configService.get("s3.enabled")) {
      return "S3";
    }
    return "LOCAL";
  }

  /**
   * Get available storage providers
   */
  async getAvailableProviders(): Promise<StorageProvider[]> {
    return this.storageFactory.getAvailableProviders();
  }

  /**
   * Test connection to a storage provider
   */
  async testStorageProvider(provider: StorageProvider, config?: Record<string, any>): Promise<boolean> {
    try {
      const storageService = this.storageFactory.createProvider(provider);
      
      if (config) {
        await storageService.initialize(config);
      }
      
      return await storageService.testConnection();
    } catch (error) {
      this.logger.error(`Failed to test storage provider ${provider}:`, error);
      return false;
    }
  }

  /**
   * Migrate files between storage providers
   */
  async migrateShare(
    shareId: string,
    targetProvider: StorageProvider,
    targetConfig?: Record<string, any>
  ): Promise<MigrationResult> {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      include: { files: true },
    });

    if (!share) {
      throw new BadRequestException("Share not found");
    }

    const sourceProvider = this.getStorageService(share.storageProvider);
    const targetService = this.storageFactory.createProvider(targetProvider);

    if (targetConfig) {
      await targetService.initialize(targetConfig);
    }

    const fileIds = share.files.map(file => file.id);
    
    try {
      const result = await targetService.migrateFiles(sourceProvider, shareId, fileIds);
      
      // Update share's storage provider if migration successful
      if (result.success) {
        await this.prisma.share.update({
          where: { id: shareId },
          data: { storageProvider: targetProvider },
        });
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Migration failed for share ${shareId}:`, error);
      throw error;
    }
  }

  /**
   * Get storage provider capabilities
   */
  async getProviderCapabilities(provider: StorageProvider): Promise<{ 
    features: string[];
    availableSpace: number | null;
    connected: boolean;
  }> {
    const storageService = this.storageFactory.createProvider(provider);
    
    const features = Object.values(['chunked_upload', 'direct_download', 'space_quota', 'file_versioning', 'batch_operations', 'streaming_upload'])
      .filter(feature => storageService.supportsFeature(feature as any));
    
    const connected = await storageService.testConnection();
    const availableSpace = connected ? await storageService.getAvailableSpace() : null;
    
    return {
      features,
      availableSpace,
      connected,
    };
  }

  private async streamToUint8Array(stream: Readable): Promise<Uint8Array> {
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      stream.on("error", reject);
    });
  }
}

export interface File {
  metaData: {
    id: string;
    size: string;
    createdAt: Date;
    mimeType: string | false;
    name: string;
    shareId: string;
  };
  file: Readable;
}
