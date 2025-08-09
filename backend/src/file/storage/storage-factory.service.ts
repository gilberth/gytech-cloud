import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudStorageProvider, HealthCheckResult } from './cloud-storage.interface';
import { OneDriveStorageService } from './onedrive-storage.service';
import { GoogleDriveStorageService } from './googledrive-storage.service';
import { AzureBlobCloudStorageService } from './azureblob-cloud-storage.service';

export enum StorageProviderType {
  LOCAL = 'LOCAL',
  S3 = 'S3',
  ONEDRIVE = 'ONEDRIVE',
  GOOGLE_DRIVE = 'GOOGLE_DRIVE',
  AZURE_BLOB = 'AZURE_BLOB',
}

export interface StorageProviderConfig {
  type: StorageProviderType;
  enabled: boolean;
  primary?: boolean;
  fallback?: boolean;
  priority?: number;
  config?: Record<string, any>;
}

export interface ProviderHealth {
  provider: StorageProviderType;
  healthy: boolean;
  lastChecked: Date;
  consecutiveFailures: number;
  details?: Record<string, any>;
  latencyMs?: number;
  errorMessage?: string;
}

@Injectable()
export class StorageFactoryService {
  private readonly logger = new Logger(StorageFactoryService.name);
  private readonly providers = new Map<StorageProviderType, CloudStorageProvider>();
  private readonly providerHealth = new Map<StorageProviderType, ProviderHealth>();
  private readonly enabledProviders = new Set<StorageProviderType>();
  private primaryProvider: StorageProviderType = StorageProviderType.LOCAL;
  private fallbackProviders: StorageProviderType[] = [];

  constructor(private configService: ConfigService) {
    this.initializeProviders();
  }

  private initializeProviders() {
    const configurations = this.getProviderConfigurations();
    
    for (const config of configurations) {
      if (config.enabled) {
        try {
          const provider = this.createProvider(config.type);
          if (provider) {
            this.providers.set(config.type, provider);
            this.enabledProviders.add(config.type);
            
            this.providerHealth.set(config.type, {
              provider: config.type,
              healthy: true,
              lastChecked: new Date(),
              consecutiveFailures: 0,
            });

            if (config.primary) {
              this.primaryProvider = config.type;
            }

            if (config.fallback) {
              this.fallbackProviders.push(config.type);
            }

            this.logger.log(`Initialized storage provider: ${config.type}`);
          }
        } catch (error) {
          this.logger.error(`Failed to initialize provider ${config.type}:`, error);
          this.providerHealth.set(config.type, {
            provider: config.type,
            healthy: false,
            lastChecked: new Date(),
            consecutiveFailures: 1,
            errorMessage: error.message,
          });
        }
      }
    }

    this.fallbackProviders.sort((a, b) => {
      const configA = configurations.find(c => c.type === a);
      const configB = configurations.find(c => c.type === b);
      return (configA?.priority || 0) - (configB?.priority || 0);
    });

    this.logger.log(`Primary provider: ${this.primaryProvider}`);
    this.logger.log(`Fallback providers: ${this.fallbackProviders.join(', ')}`);
  }

  private getProviderConfigurations(): StorageProviderConfig[] {
    return [
      {
        type: StorageProviderType.LOCAL,
        enabled: true,
        fallback: true,
        priority: 999,
      },
      {
        type: StorageProviderType.S3,
        enabled: this.configService.get<boolean>('S3_ENABLED', false),
        primary: this.configService.get<string>('PRIMARY_STORAGE') === 'S3',
        fallback: this.configService.get<boolean>('S3_FALLBACK', false),
        priority: this.configService.get<number>('S3_PRIORITY', 1),
      },
      {
        type: StorageProviderType.ONEDRIVE,
        enabled: this.configService.get<boolean>('ONEDRIVE_ENABLED', false),
        primary: this.configService.get<string>('PRIMARY_STORAGE') === 'ONEDRIVE',
        fallback: this.configService.get<boolean>('ONEDRIVE_FALLBACK', false),
        priority: this.configService.get<number>('ONEDRIVE_PRIORITY', 2),
      },
      {
        type: StorageProviderType.GOOGLE_DRIVE,
        enabled: this.configService.get<boolean>('GOOGLE_DRIVE_ENABLED', false),
        primary: this.configService.get<string>('PRIMARY_STORAGE') === 'GOOGLE_DRIVE',
        fallback: this.configService.get<boolean>('GOOGLE_DRIVE_FALLBACK', false),
        priority: this.configService.get<number>('GOOGLE_DRIVE_PRIORITY', 3),
      },
      {
        type: StorageProviderType.AZURE_BLOB,
        enabled: this.configService.get<boolean>('AZURE_BLOB_ENABLED', false),
        primary: this.configService.get<string>('PRIMARY_STORAGE') === 'AZURE_BLOB',
        fallback: this.configService.get<boolean>('AZURE_BLOB_FALLBACK', false),
        priority: this.configService.get<number>('AZURE_BLOB_PRIORITY', 4),
      },
    ];
  }

  private createProvider(type: StorageProviderType): CloudStorageProvider | null {
    switch (type) {
      case StorageProviderType.ONEDRIVE:
        return new OneDriveStorageService(this.configService);
      
      case StorageProviderType.GOOGLE_DRIVE:
        return new GoogleDriveStorageService(this.configService);
      
      case StorageProviderType.AZURE_BLOB:
        return new AzureBlobCloudStorageService(this.configService);
      
      case StorageProviderType.LOCAL:
      case StorageProviderType.S3:
        return null;
      
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }
  }

  getProvider(type?: StorageProviderType): CloudStorageProvider | null {
    const providerType = type || this.primaryProvider;
    return this.providers.get(providerType) || null;
  }

  getPrimaryProvider(): CloudStorageProvider | null {
    return this.getProvider(this.primaryProvider);
  }

  getFallbackProviders(): CloudStorageProvider[] {
    return this.fallbackProviders
      .map(type => this.providers.get(type))
      .filter(provider => provider !== undefined) as CloudStorageProvider[];
  }

  getHealthyProvider(): CloudStorageProvider | null {
    const primary = this.getPrimaryProvider();
    const primaryHealth = this.providerHealth.get(this.primaryProvider);
    
    if (primary && primaryHealth?.healthy) {
      return primary;
    }

    for (const fallbackType of this.fallbackProviders) {
      const fallbackHealth = this.providerHealth.get(fallbackType);
      const fallbackProvider = this.providers.get(fallbackType);
      
      if (fallbackProvider && fallbackHealth?.healthy) {
        this.logger.warn(`Using fallback provider: ${fallbackType}`);
        return fallbackProvider;
      }
    }

    this.logger.error('No healthy providers available');
    return null;
  }

  async healthCheck(type?: StorageProviderType): Promise<ProviderHealth | null> {
    const providerType = type || this.primaryProvider;
    const provider = this.providers.get(providerType);
    
    if (!provider) {
      return null;
    }

    const existingHealth = this.providerHealth.get(providerType);
    const now = new Date();

    try {
      const healthResult = await provider.healthCheck();
      
      const newHealth: ProviderHealth = {
        provider: providerType,
        healthy: healthResult.ok,
        lastChecked: now,
        consecutiveFailures: healthResult.ok ? 0 : (existingHealth?.consecutiveFailures || 0) + 1,
        details: healthResult.details,
        latencyMs: healthResult.latencyMs,
        errorMessage: healthResult.errorMessage,
      };

      this.providerHealth.set(providerType, newHealth);
      
      if (!healthResult.ok) {
        this.logger.warn(`Provider ${providerType} health check failed:`, healthResult.errorMessage);
      }

      return newHealth;
    } catch (error) {
      const newHealth: ProviderHealth = {
        provider: providerType,
        healthy: false,
        lastChecked: now,
        consecutiveFailures: (existingHealth?.consecutiveFailures || 0) + 1,
        errorMessage: error.message,
      };

      this.providerHealth.set(providerType, newHealth);
      this.logger.error(`Provider ${providerType} health check error:`, error);
      
      return newHealth;
    }
  }

  async healthCheckAll(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];
    
    for (const type of this.enabledProviders) {
      const health = await this.healthCheck(type);
      if (health) {
        results.push(health);
      }
    }

    return results;
  }

  getProviderHealth(type?: StorageProviderType): ProviderHealth | null {
    const providerType = type || this.primaryProvider;
    return this.providerHealth.get(providerType) || null;
  }

  getAllProviderHealth(): ProviderHealth[] {
    return Array.from(this.providerHealth.values());
  }

  isProviderHealthy(type: StorageProviderType): boolean {
    const health = this.providerHealth.get(type);
    if (!health) return false;

    const maxFailures = this.configService.get<number>('STORAGE_MAX_CONSECUTIVE_FAILURES', 3);
    const healthCheckInterval = this.configService.get<number>('STORAGE_HEALTH_CHECK_INTERVAL_MS', 300000); // 5 minutes
    
    if (health.consecutiveFailures >= maxFailures) {
      return false;
    }

    const timeSinceLastCheck = Date.now() - health.lastChecked.getTime();
    if (timeSinceLastCheck > healthCheckInterval * 2) {
      return false;
    }

    return health.healthy;
  }

  getProviderCapabilities(type?: StorageProviderType) {
    const providerType = type || this.primaryProvider;
    const provider = this.providers.get(providerType);
    return provider?.capabilities || null;
  }

  listProviders(): Array<{
    type: StorageProviderType;
    name: string;
    enabled: boolean;
    primary: boolean;
    healthy: boolean;
    capabilities: any;
  }> {
    return Array.from(this.enabledProviders).map(type => {
      const provider = this.providers.get(type);
      const health = this.providerHealth.get(type);
      
      return {
        type,
        name: provider?.name || type,
        enabled: true,
        primary: type === this.primaryProvider,
        healthy: health?.healthy || false,
        capabilities: provider?.capabilities,
      };
    });
  }

  async switchPrimaryProvider(newPrimary: StorageProviderType): Promise<boolean> {
    if (!this.enabledProviders.has(newPrimary)) {
      throw new Error(`Provider ${newPrimary} is not enabled`);
    }

    const health = await this.healthCheck(newPrimary);
    if (!health?.healthy) {
      throw new Error(`Provider ${newPrimary} is not healthy`);
    }

    const oldPrimary = this.primaryProvider;
    this.primaryProvider = newPrimary;
    
    this.logger.log(`Switched primary provider from ${oldPrimary} to ${newPrimary}`);
    return true;
  }
}