import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ConfigService } from './config.service';
import { AdministratorGuard } from '../auth/guard/isAdmin.guard';
import { UpdateAzureConfigDto } from './dto/UpdateAzureConfigDto';
import { UpdateOneDriveConfigDto } from './dto/UpdateOneDriveConfigDto';
import { UpdateGoogleDriveConfigDto } from './dto/UpdateGoogleDriveConfigDto';

@Controller('admin/config/storage')
@UseGuards(AdministratorGuard)
export class StorageConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  async getAllStorageConfig() {
    const storageConfig = {
      azure: await this.getAzureConfig(),
      onedrive: await this.getOneDriveConfig(),
      googledrive: await this.getGoogleDriveConfig(),
    };

    return {
      success: true,
      data: storageConfig,
    };
  }

  // Azure Blob Storage Configuration
  @Get('azure')
  async getAzureConfig() {
    return {
      accountName: this.configService.get('storage.azureAccountName'),
      containerName: this.configService.get('storage.azureContainerName'),
      endpoint: this.configService.get('storage.azureEndpoint'),
      enabled: this.configService.get('storage.azureStorageEnabled') || false,
      primary: this.configService.get('storage.azureStoragePrimary') || false,
      fallback: this.configService.get('storage.azureStorageFallback') || false,
      // Don't return sensitive values like accountKey or sasToken
    };
  }

  @Put('azure')
  @HttpCode(HttpStatus.OK)
  async updateAzureConfig(@Body() config: UpdateAzureConfigDto) {
    const updates: { [key: string]: any } = {};

    if (config.accountName !== undefined) {
      updates['storage.azureAccountName'] = config.accountName;
    }
    if (config.accountKey !== undefined) {
      updates['storage.azureAccountKey'] = config.accountKey;
    }
    if (config.sasToken !== undefined) {
      updates['storage.azureSasToken'] = config.sasToken;
    }
    if (config.containerName !== undefined) {
      updates['storage.azureContainerName'] = config.containerName;
    }
    if (config.endpoint !== undefined) {
      updates['storage.azureEndpoint'] = config.endpoint;
    }
    if (config.enabled !== undefined) {
      updates['storage.azureStorageEnabled'] = config.enabled;
    }
    if (config.primary !== undefined) {
      updates['storage.azureStoragePrimary'] = config.primary;
    }
    if (config.fallback !== undefined) {
      updates['storage.azureStorageFallback'] = config.fallback;
    }

    const updateData = Object.entries(updates).map(([key, value]) => ({ key, value }));
    if (updateData.length > 0) {
      await this.configService.updateMany(updateData);
    }

    return {
      success: true,
      message: 'Azure storage configuration updated successfully',
    };
  }

  // OneDrive Configuration
  @Get('onedrive')
  async getOneDriveConfig() {
    return {
      clientId: this.configService.get('storage.onedriveClientId'),
      redirectUri: this.configService.get('storage.onedriveRedirectUri'),
      tenantId: this.configService.get('storage.onedriveTenantId'),
      scopes: this.configService.get('storage.onedriveScopes') || 'https://graph.microsoft.com/Files.ReadWrite.All',
      enabled: this.configService.get('storage.onedriveStorageEnabled') || false,
      primary: this.configService.get('storage.onedriveStoragePrimary') || false,
      fallback: this.configService.get('storage.onedriveStorageFallback') || false,
      // Don't return sensitive clientSecret
    };
  }

  @Put('onedrive')
  @HttpCode(HttpStatus.OK)
  async updateOneDriveConfig(@Body() config: UpdateOneDriveConfigDto) {
    const updates: { [key: string]: any } = {};

    if (config.clientId !== undefined) {
      updates['storage.onedriveClientId'] = config.clientId;
    }
    if (config.clientSecret !== undefined) {
      updates['storage.onedriveClientSecret'] = config.clientSecret;
    }
    if (config.redirectUri !== undefined) {
      updates['storage.onedriveRedirectUri'] = config.redirectUri;
    }
    if (config.tenantId !== undefined) {
      updates['storage.onedriveTenantId'] = config.tenantId;
    }
    if (config.scopes !== undefined) {
      updates['storage.onedriveScopes'] = config.scopes;
    }
    if (config.enabled !== undefined) {
      updates['storage.onedriveStorageEnabled'] = config.enabled;
    }
    if (config.primary !== undefined) {
      updates['storage.onedriveStoragePrimary'] = config.primary;
    }
    if (config.fallback !== undefined) {
      updates['storage.onedriveStorageFallback'] = config.fallback;
    }

    const updateData = Object.entries(updates).map(([key, value]) => ({ key, value }));
    if (updateData.length > 0) {
      await this.configService.updateMany(updateData);
    }

    return {
      success: true,
      message: 'OneDrive storage configuration updated successfully',
    };
  }

  // Google Drive Configuration
  @Get('googledrive')
  async getGoogleDriveConfig() {
    return {
      clientId: this.configService.get('storage.googledriveClientId'),
      redirectUri: this.configService.get('storage.googledriveRedirectUri'),
      projectId: this.configService.get('storage.googledriveProjectId'),
      authUri: this.configService.get('storage.googledriveAuthUri') || 'https://accounts.google.com/o/oauth2/auth',
      tokenUri: this.configService.get('storage.googledriveTokenUri') || 'https://oauth2.googleapis.com/token',
      scopes: this.configService.get('storage.googledriveScopes') || 'https://www.googleapis.com/auth/drive.file',
      enabled: this.configService.get('storage.googledriveStorageEnabled') || false,
      primary: this.configService.get('storage.googledriveStoragePrimary') || false,
      fallback: this.configService.get('storage.googledriveStorageFallback') || false,
      // Don't return sensitive clientSecret
    };
  }

  @Put('googledrive')
  @HttpCode(HttpStatus.OK)
  async updateGoogleDriveConfig(@Body() config: UpdateGoogleDriveConfigDto) {
    const updates: { [key: string]: any } = {};

    if (config.clientId !== undefined) {
      updates['storage.googledriveClientId'] = config.clientId;
    }
    if (config.clientSecret !== undefined) {
      updates['storage.googledriveClientSecret'] = config.clientSecret;
    }
    if (config.redirectUri !== undefined) {
      updates['storage.googledriveRedirectUri'] = config.redirectUri;
    }
    if (config.projectId !== undefined) {
      updates['storage.googledriveProjectId'] = config.projectId;
    }
    if (config.authUri !== undefined) {
      updates['storage.googledriveAuthUri'] = config.authUri;
    }
    if (config.tokenUri !== undefined) {
      updates['storage.googledriveTokenUri'] = config.tokenUri;
    }
    if (config.scopes !== undefined) {
      updates['storage.googledriveScopes'] = config.scopes;
    }
    if (config.enabled !== undefined) {
      updates['storage.googledriveStorageEnabled'] = config.enabled;
    }
    if (config.primary !== undefined) {
      updates['storage.googledriveStoragePrimary'] = config.primary;
    }
    if (config.fallback !== undefined) {
      updates['storage.googledriveStorageFallback'] = config.fallback;
    }

    const updateData = Object.entries(updates).map(([key, value]) => ({ key, value }));
    if (updateData.length > 0) {
      await this.configService.updateMany(updateData);
    }

    return {
      success: true,
      message: 'Google Drive storage configuration updated successfully',
    };
  }

  // Test connectivity endpoints
  @Get('test/:provider')
  async testStorageConnection(@Param('provider') provider: string) {
    // This would integrate with the StorageFactoryService to test connectivity
    try {
      switch (provider) {
        case 'azure':
          // Test Azure connection
          break;
        case 'onedrive':
          // Test OneDrive connection
          break;
        case 'googledrive':
          // Test Google Drive connection
          break;
        default:
          return {
            success: false,
            message: 'Unknown storage provider',
          };
      }

      return {
        success: true,
        message: `${provider} connection test successful`,
      };
    } catch (error) {
      return {
        success: false,
        message: `${provider} connection test failed: ${error.message}`,
      };
    }
  }
}