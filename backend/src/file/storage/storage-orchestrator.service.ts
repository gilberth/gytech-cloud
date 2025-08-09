import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { 
  StorageFactoryService, 
  StorageProviderType, 
  ProviderHealth 
} from './storage-factory.service';
import {
  CloudStorageProvider,
  UploadParams,
  UploadResult,
  DownloadOptions,
  FileMetadata,
} from './cloud-storage.interface';

export enum StorageState {
  LOCAL_ONLY = 'LOCAL_ONLY',
  SYNCING = 'SYNCING', 
  SYNCED = 'SYNCED',
  FAILED = 'FAILED',
  DEPRECATED = 'DEPRECATED',
}

export enum SyncPolicy {
  SYNC_BLOCKING = 'SYNC_BLOCKING',
  SYNC_ASYNC = 'SYNC_ASYNC',
  PASS_THROUGH = 'PASS_THROUGH', 
  FALLBACK_ONLY = 'FALLBACK_ONLY',
}

interface CircuitBreakerState {
  provider: StorageProviderType;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  lastFailureTime: Date;
  nextRetryTime: Date;
}

@Injectable()
export class StorageOrchestratorService {
  private readonly logger = new Logger(StorageOrchestratorService.name);
  private circuitBreakers = new Map<StorageProviderType, CircuitBreakerState>();

  constructor(
    private storageFactory: StorageFactoryService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.initializeCircuitBreakers();
  }

  private initializeCircuitBreakers() {
    const providers = this.storageFactory.listProviders();
    
    for (const provider of providers) {
      this.circuitBreakers.set(provider.type, {
        provider: provider.type,
        state: 'CLOSED',
        failures: 0,
        lastFailureTime: new Date(0),
        nextRetryTime: new Date(0),
      });
    }
  }

  async uploadFile(params: UploadParams, shareId: string): Promise<UploadResult> {
    const syncPolicy = this.getSyncPolicy();
    const primaryProvider = this.storageFactory.getPrimaryProvider();
    
    if (!primaryProvider) {
      throw new Error('No primary storage provider available');
    }

    try {
      switch (syncPolicy) {
        case SyncPolicy.SYNC_BLOCKING:
          return await this.uploadWithBlockingSync(params, shareId);
        
        case SyncPolicy.SYNC_ASYNC:
          return await this.uploadWithAsyncSync(params, shareId);
        
        case SyncPolicy.PASS_THROUGH:
          return await this.uploadPassThrough(params, shareId);
        
        case SyncPolicy.FALLBACK_ONLY:
          return await this.uploadFallbackOnly(params, shareId);
        
        default:
          return await this.uploadWithAsyncSync(params, shareId);
      }
    } catch (error) {
      this.logger.error(`Upload failed for share ${shareId}:`, error);
      throw error;
    }
  }

  async downloadFile(fileId: string, options?: DownloadOptions): Promise<NodeJS.ReadableStream> {
    const fileRecord = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: { storageLocations: true },
    });

    if (!fileRecord) {
      throw new Error('File not found');
    }

    const remoteLocation = fileRecord.storageLocations.find(
      loc => loc.provider !== 'LOCAL' && loc.state === StorageState.SYNCED
    );

    const localLocation = fileRecord.storageLocations.find(
      loc => loc.provider === 'LOCAL'
    );

    if (remoteLocation && this.isProviderHealthy(remoteLocation.provider as StorageProviderType)) {
      try {
        const provider = this.storageFactory.getProvider(remoteLocation.provider as StorageProviderType);
        if (provider) {
          this.logger.log(`Serving file ${fileId} from remote provider ${remoteLocation.provider}`);
          return await provider.download(remoteLocation.storedPath, options);
        }
      } catch (error) {
        this.logger.warn(`Failed to download from remote provider ${remoteLocation.provider}, falling back to local`);
        this.recordProviderFailure(remoteLocation.provider as StorageProviderType);
      }
    }

    if (localLocation) {
      this.logger.log(`Serving file ${fileId} from local storage (fallback)`);
      return await this.downloadFromLocal(localLocation.storedPath, options);
    }

    throw new Error('File not available from any storage location');
  }

  private async uploadWithBlockingSync(params: UploadParams, shareId: string): Promise<UploadResult> {
    const primaryProvider = this.storageFactory.getPrimaryProvider();
    if (!primaryProvider) {
      throw new Error('No primary provider available');
    }

    const localResult = await this.storeLocally(params, shareId);
    
    try {
      const remoteResult = await primaryProvider.upload(params);
      
      await this.recordStorageLocation(
        localResult.fileId,
        primaryProvider.name,
        remoteResult.storedPath,
        StorageState.SYNCED,
        localResult.checksum,
      );

      return {
        storedPath: remoteResult.storedPath,
        etag: remoteResult.etag,
      };
    } catch (error) {
      this.logger.warn('Remote upload failed in blocking sync, keeping local only');
      throw error;
    }
  }

  private async uploadWithAsyncSync(params: UploadParams, shareId: string): Promise<UploadResult> {
    const localResult = await this.storeLocally(params, shareId);
    
    setImmediate(() => {
      this.syncToRemote(localResult.fileId, localResult.storedPath, params);
    });

    return {
      storedPath: localResult.storedPath,
      etag: localResult.checksum,
    };
  }

  private async uploadPassThrough(params: UploadParams, shareId: string): Promise<UploadResult> {
    const primaryProvider = this.storageFactory.getPrimaryProvider();
    if (!primaryProvider) {
      throw new Error('No primary provider available');
    }

    return await primaryProvider.upload(params);
  }

  private async uploadFallbackOnly(params: UploadParams, shareId: string): Promise<UploadResult> {
    return await this.storeLocally(params, shareId);
  }

  private async syncToRemote(fileId: string, localPath: string, params: UploadParams) {
    const primaryProvider = this.storageFactory.getPrimaryProvider();
    if (!primaryProvider || !this.isProviderHealthy(StorageProviderType[primaryProvider.name as keyof typeof StorageProviderType])) {
      this.logger.warn(`Primary provider ${primaryProvider?.name || 'unknown'} is not healthy, skipping sync`);
      return;
    }

    try {
      await this.updateStorageLocation(fileId, primaryProvider.name, StorageState.SYNCING);
      
      const remoteResult = await primaryProvider.upload(params);
      
      await this.recordStorageLocation(
        fileId,
        primaryProvider.name,
        remoteResult.storedPath,
        StorageState.SYNCED,
        remoteResult.etag,
      );

      this.logger.log(`Successfully synced file ${fileId} to ${primaryProvider.name}`);
    } catch (error) {
      this.logger.error(`Failed to sync file ${fileId} to remote:`, error);
      
      await this.recordStorageLocation(
        fileId,
        primaryProvider.name,
        localPath,
        StorageState.FAILED,
        undefined,
        error.message,
      );
      
      this.recordProviderFailure(StorageProviderType[primaryProvider.name as keyof typeof StorageProviderType]);
    }
  }

  private async storeLocally(params: UploadParams, shareId: string): Promise<{
    fileId: string;
    storedPath: string;
    checksum: string;
  }> {
    return {
      fileId: `temp-${Date.now()}`,
      storedPath: `local/${shareId}/${Date.now()}`,
      checksum: `checksum-${Date.now()}`,
    };
  }

  private async downloadFromLocal(path: string, options?: DownloadOptions): Promise<NodeJS.ReadableStream> {
    const { Readable } = require('stream');
    const readable = new Readable();
    readable.push(`Mock file content from ${path}`);
    readable.push(null);
    return readable;
  }

  private async recordStorageLocation(
    fileId: string,
    provider: string,
    storedPath: string,
    state: StorageState,
    checksum?: string,
    errorMessage?: string,
  ) {
    await this.prisma.fileStorageLocation.upsert({
      where: {
        fileId_provider: {
          fileId,
          provider,
        },
      },
      update: {
        storedPath,
        state,
        checksum,
        lastSyncAt: state === StorageState.SYNCED ? new Date() : undefined,
        lastAttemptAt: new Date(),
        attempts: { increment: 1 },
        errorMessage,
      },
      create: {
        fileId,
        provider,
        storedPath,
        state,
        checksum,
        lastSyncAt: state === StorageState.SYNCED ? new Date() : undefined,
        lastAttemptAt: new Date(),
        attempts: 1,
        errorMessage,
      },
    });
  }

  private async updateStorageLocation(fileId: string, provider: string, state: StorageState) {
    await this.prisma.fileStorageLocation.updateMany({
      where: { fileId, provider },
      data: { 
        state,
        lastAttemptAt: new Date(),
        attempts: { increment: 1 },
      },
    });
  }

  private isProviderHealthy(provider: StorageProviderType): boolean {
    const circuitBreaker = this.circuitBreakers.get(provider);
    if (!circuitBreaker) return false;

    const now = new Date();
    
    switch (circuitBreaker.state) {
      case 'CLOSED':
        return true;
      
      case 'OPEN':
        if (now >= circuitBreaker.nextRetryTime) {
          circuitBreaker.state = 'HALF_OPEN';
          this.logger.log(`Circuit breaker for ${provider} moved to HALF_OPEN`);
          return true;
        }
        return false;
      
      case 'HALF_OPEN':
        return true;
      
      default:
        return false;
    }
  }

  private recordProviderFailure(provider: StorageProviderType) {
    const circuitBreaker = this.circuitBreakers.get(provider);
    if (!circuitBreaker) return;

    const failureThreshold = this.configService.get<number>('STORAGE_CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5);
    const retryIntervalMs = this.configService.get<number>('STORAGE_CIRCUIT_BREAKER_RETRY_INTERVAL_MS', 60000);

    circuitBreaker.failures++;
    circuitBreaker.lastFailureTime = new Date();

    if (circuitBreaker.state === 'HALF_OPEN') {
      circuitBreaker.state = 'OPEN';
      circuitBreaker.nextRetryTime = new Date(Date.now() + retryIntervalMs);
      this.logger.warn(`Circuit breaker for ${provider} opened after failure in HALF_OPEN state`);
    } else if (circuitBreaker.failures >= failureThreshold) {
      circuitBreaker.state = 'OPEN';
      circuitBreaker.nextRetryTime = new Date(Date.now() + retryIntervalMs);
      this.logger.warn(`Circuit breaker for ${provider} opened after ${circuitBreaker.failures} failures`);
    }
  }

  private recordProviderSuccess(provider: StorageProviderType) {
    const circuitBreaker = this.circuitBreakers.get(provider);
    if (!circuitBreaker) return;

    if (circuitBreaker.state === 'HALF_OPEN') {
      circuitBreaker.state = 'CLOSED';
      circuitBreaker.failures = 0;
      this.logger.log(`Circuit breaker for ${provider} closed after successful operation`);
    } else if (circuitBreaker.state === 'CLOSED') {
      circuitBreaker.failures = Math.max(0, circuitBreaker.failures - 1);
    }
  }

  private getSyncPolicy(): SyncPolicy {
    const policy = this.configService.get<string>('STORAGE_SYNC_POLICY', 'SYNC_ASYNC');
    return SyncPolicy[policy as keyof typeof SyncPolicy] || SyncPolicy.SYNC_ASYNC;
  }

  async healthCheckAll(): Promise<ProviderHealth[]> {
    const results = await this.storageFactory.healthCheckAll();
    
    for (const result of results) {
      if (result.healthy) {
        this.recordProviderSuccess(result.provider);
      } else {
        this.recordProviderFailure(result.provider);
      }
    }
    
    return results;
  }

  async getStorageMetrics() {
    const locations = await this.prisma.fileStorageLocation.groupBy({
      by: ['provider', 'state'],
      _count: true,
    });

    const metrics = {
      providers: this.storageFactory.listProviders(),
      circuitBreakers: Array.from(this.circuitBreakers.values()),
      storageDistribution: locations.map(loc => ({
        provider: loc.provider,
        state: loc.state,
        count: loc._count,
      })),
    };

    return metrics;
  }
}