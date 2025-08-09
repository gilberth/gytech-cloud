import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { AdministratorGuard } from "src/auth/guard/isAdmin.guard";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { ConfigService } from "./config.service";
import { FileService } from "src/file/file.service";
import { StorageProvider } from "src/file/storage/cloud-storage.interface";

interface StorageProviderConfig {
  provider: StorageProvider;
  enabled: boolean;
  displayName: string;
  config: Record<string, any>;
  capabilities?: {
    features: string[];
    availableSpace: number | null;
    connected: boolean;
  };
}

@Controller("admin/storage")
@UseGuards(JwtGuard, AdministratorGuard)
export class StorageConfigController {
  constructor(
    private configService: ConfigService,
    private fileService: FileService,
  ) {}

  /**
   * Get all available storage providers and their configurations
   */
  @Get("providers")
  async getStorageProviders(): Promise<StorageProviderConfig[]> {
    const availableProviders = await this.fileService.getAvailableProviders();
    const providers: StorageProviderConfig[] = [];

    for (const provider of availableProviders) {
      const config = this.getProviderConfig(provider);
      let capabilities;

      try {
        capabilities = await this.fileService.getProviderCapabilities(provider);
      } catch (error) {
        capabilities = {
          features: [],
          availableSpace: null,
          connected: false,
        };
      }

      providers.push({
        provider,
        enabled: config.enabled,
        displayName: this.getProviderDisplayName(provider),
        config: this.sanitizeConfig(config.config),
        capabilities,
      });
    }

    return providers;
  }

  /**
   * Test connection to a storage provider
   */
  @Post("test-connection")
  async testConnection(@Body() body: { provider: StorageProvider; config: Record<string, any> }): Promise<{ success: boolean; error?: string }> {
    try {
      const success = await this.fileService.testStorageProvider(body.provider, body.config);
      return { success };
    } catch (error) {
      return { 
        success: false, 
        error: error.message || 'Connection test failed' 
      };
    }
  }

  /**
   * Update storage provider configuration
   */
  @Put("providers/:provider")
  async updateProviderConfig(
    @Body() body: { enabled: boolean; config: Record<string, any> },
    @Body('provider') provider: StorageProvider,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      // Validate configuration
      if (body.enabled && !this.validateProviderConfig(provider, body.config)) {
        throw new BadRequestException("Invalid configuration for storage provider");
      }

      // Update configuration
      await this.updateProviderConfiguration(provider, body.enabled, body.config);

      return { 
        success: true, 
        message: `${this.getProviderDisplayName(provider)} configuration updated successfully` 
      };
    } catch (error) {
      throw new BadRequestException(error.message || 'Failed to update configuration');
    }
  }

  /**
   * Get default storage provider
   */
  @Get("default")
  async getDefaultProvider(): Promise<{ provider: StorageProvider }> {
    const defaultProvider = this.configService.get("storage.defaultProvider") || 
                           (this.configService.get("s3.enabled") ? "S3" : "LOCAL");
    
    return { provider: defaultProvider as StorageProvider };
  }

  /**
   * Set default storage provider
   */
  @Put("default")
  async setDefaultProvider(@Body() body: { provider: StorageProvider }): Promise<{ success: boolean }> {
    try {
      await this.configService.update("storage.defaultProvider", body.provider);
      return { success: true };
    } catch (error) {
      throw new BadRequestException("Failed to set default storage provider");
    }
  }

  /**
   * Get storage provider configuration (internal)
   */
  private getProviderConfig(provider: StorageProvider): { enabled: boolean; config: Record<string, any> } {
    switch (provider) {
      case StorageProvider.LOCAL:
        return {
          enabled: true, // Local storage is always enabled
          config: {},
        };
      
      case StorageProvider.S3:
        return {
          enabled: this.configService.get("s3.enabled") || false,
          config: {
            endpoint: this.configService.get("s3.endpoint") || "",
            region: this.configService.get("s3.region") || "",
            key: this.configService.get("s3.key") || "",
            secret: this.configService.get("s3.secret") || "",
            bucketName: this.configService.get("s3.bucketName") || "",
            bucketPath: this.configService.get("s3.bucketPath") || "",
            useChecksum: this.configService.get("s3.useChecksum") || false,
          },
        };

      case StorageProvider.ONEDRIVE:
        return {
          enabled: this.configService.get("onedrive.enabled") || false,
          config: {
            clientId: this.configService.get("onedrive.clientId") || "",
            clientSecret: this.configService.get("onedrive.clientSecret") || "",
            tenantId: this.configService.get("onedrive.tenantId") || "",
            driveId: this.configService.get("onedrive.driveId") || "",
          },
        };

      case StorageProvider.GOOGLE_DRIVE:
        return {
          enabled: this.configService.get("googledrive.enabled") || false,
          config: {
            clientId: this.configService.get("googledrive.clientId") || "",
            clientSecret: this.configService.get("googledrive.clientSecret") || "",
            refreshToken: this.configService.get("googledrive.refreshToken") || "",
            parentFolderId: this.configService.get("googledrive.parentFolderId") || "",
          },
        };

      case StorageProvider.AZURE_BLOB:
        return {
          enabled: this.configService.get("azureblob.enabled") || false,
          config: {
            accountName: this.configService.get("azureblob.accountName") || "",
            accountKey: this.configService.get("azureblob.accountKey") || "",
            sasToken: this.configService.get("azureblob.sasToken") || "",
            containerName: this.configService.get("azureblob.containerName") || "",
          },
        };

      default:
        return { enabled: false, config: {} };
    }
  }

  /**
   * Get provider display name
   */
  private getProviderDisplayName(provider: StorageProvider): string {
    switch (provider) {
      case StorageProvider.LOCAL:
        return "Local Storage";
      case StorageProvider.S3:
        return "Amazon S3";
      case StorageProvider.ONEDRIVE:
        return "Microsoft OneDrive";
      case StorageProvider.GOOGLE_DRIVE:
        return "Google Drive";
      case StorageProvider.AZURE_BLOB:
        return "Azure Blob Storage";
      default:
        return provider;
    }
  }

  /**
   * Sanitize configuration (remove sensitive fields for client)
   */
  private sanitizeConfig(config: Record<string, any>): Record<string, any> {
    const sanitized = { ...config };
    
    // Remove sensitive fields
    const sensitiveFields = [
      'secret', 'clientSecret', 'accountKey', 'refreshToken', 'sasToken', 'key'
    ];
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '***HIDDEN***';
      }
    });

    return sanitized;
  }

  /**
   * Validate provider configuration
   */
  private validateProviderConfig(provider: StorageProvider, config: Record<string, any>): boolean {
    switch (provider) {
      case StorageProvider.LOCAL:
        return true; // Local storage doesn't need configuration
      
      case StorageProvider.S3:
        const s3Required = ['endpoint', 'region', 'key', 'secret', 'bucketName'];
        return s3Required.every(field => config[field] && config[field].trim().length > 0);

      case StorageProvider.ONEDRIVE:
        const onedriveRequired = ['clientId', 'clientSecret', 'tenantId'];
        return onedriveRequired.every(field => config[field] && config[field].trim().length > 0);

      case StorageProvider.GOOGLE_DRIVE:
        const googledriveRequired = ['clientId', 'clientSecret', 'refreshToken'];
        return googledriveRequired.every(field => config[field] && config[field].trim().length > 0);

      case StorageProvider.AZURE_BLOB:
        const azureblobRequired = ['accountName', 'containerName'];
        const hasAccountKey = config.accountKey && config.accountKey.trim().length > 0;
        const hasSasToken = config.sasToken && config.sasToken.trim().length > 0;
        return azureblobRequired.every(field => config[field] && config[field].trim().length > 0) &&
               (hasAccountKey || hasSasToken);

      default:
        return false;
    }
  }

  /**
   * Update provider configuration in config service
   */
  private async updateProviderConfiguration(
    provider: StorageProvider,
    enabled: boolean,
    config: Record<string, any>
  ): Promise<void> {
    const providerKey = provider.toLowerCase().replace('_', '');
    
    // Update enabled status
    await this.configService.update(`${providerKey}.enabled`, enabled);
    
    // Update configuration fields
    for (const [key, value] of Object.entries(config)) {
      if (value !== '***HIDDEN***') { // Don't update hidden fields
        await this.configService.update(`${providerKey}.${key}`, value);
      }
    }
  }
}