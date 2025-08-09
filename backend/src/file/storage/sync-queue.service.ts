import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageFactoryService, StorageProviderType } from './storage-factory.service';
import { StorageState } from './storage-orchestrator.service';
import { UploadParams } from './cloud-storage.interface';

export interface SyncRemoteJobData {
  fileId: string;
  targetProvider: StorageProviderType;
  localPath: string;
  uploadParams: UploadParams;
  shareId: string;
  retryCount?: number;
}

export interface ReconcileJobData {
  batchSize?: number;
  maxAge?: number; // hours
}

export interface MigrationJobData {
  fromProvider: StorageProviderType;
  toProvider: StorageProviderType;
  fileIds?: string[];
  batchSize?: number;
}

@Injectable()
export class SyncQueueService implements OnModuleInit {
  private readonly logger = new Logger(SyncQueueService.name);
  private syncQueue: Queue;
  private reconcileQueue: Queue;
  private migrationQueue: Queue;
  private syncWorker: Worker;
  private reconcileWorker: Worker;
  private migrationWorker: Worker;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private storageFactory: StorageFactoryService,
  ) {}

  async onModuleInit() {
    await this.initializeQueues();
    this.startWorkers();
  }

  private async initializeQueues() {
    const redisConfig = {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
    };

    this.syncQueue = new Queue('storage-sync', {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    this.reconcileQueue = new Queue('storage-reconcile', {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 10,
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    });

    this.migrationQueue = new Queue('storage-migration', {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 5,
        removeOnFail: 5,
        attempts: 1,
      },
    });

    this.logger.log('Storage queues initialized');
  }

  private startWorkers() {
    const concurrency = this.configService.get<number>('STORAGE_SYNC_CONCURRENCY', 5);

    this.syncWorker = new Worker('storage-sync', 
      async (job: Job<SyncRemoteJobData>) => {
        return await this.processSyncRemoteJob(job.data);
      },
      {
        connection: {
          host: this.configService.get<string>('REDIS_HOST', 'localhost'),
          port: this.configService.get<number>('REDIS_PORT', 6379),
          password: this.configService.get<string>('REDIS_PASSWORD'),
        },
        concurrency,
      }
    );

    this.reconcileWorker = new Worker('storage-reconcile',
      async (job: Job<ReconcileJobData>) => {
        return await this.processReconcileJob(job.data);
      },
      {
        connection: {
          host: this.configService.get<string>('REDIS_HOST', 'localhost'),
          port: this.configService.get<number>('REDIS_PORT', 6379),
          password: this.configService.get<string>('REDIS_PASSWORD'),
        },
        concurrency: 1,
      }
    );

    this.migrationWorker = new Worker('storage-migration',
      async (job: Job<MigrationJobData>) => {
        return await this.processMigrationJob(job.data);
      },
      {
        connection: {
          host: this.configService.get<string>('REDIS_HOST', 'localhost'),
          port: this.configService.get<number>('REDIS_PORT', 6379),
          password: this.configService.get<string>('REDIS_PASSWORD'),
        },
        concurrency: 2,
      }
    );

    this.syncWorker.on('completed', (job) => {
      this.logger.log(`Sync job ${job.id} completed`);
    });

    this.syncWorker.on('failed', (job, err) => {
      this.logger.error(`Sync job ${job?.id} failed:`, err);
    });

    this.reconcileWorker.on('completed', (job) => {
      this.logger.log(`Reconcile job ${job.id} completed`);
    });

    this.migrationWorker.on('completed', (job) => {
      this.logger.log(`Migration job ${job.id} completed`);
    });

    this.logger.log('Storage workers started');
  }

  async queueSyncRemote(data: SyncRemoteJobData, delay?: number): Promise<void> {
    try {
      await this.syncQueue.add('sync-remote', data, {
        delay,
        jobId: `sync-${data.fileId}-${data.targetProvider}`,
      });
      
      this.logger.log(`Queued sync job for file ${data.fileId} to ${data.targetProvider}`);
    } catch (error) {
      this.logger.error('Failed to queue sync job:', error);
      throw error;
    }
  }

  async queueReconcile(data: ReconcileJobData = {}): Promise<void> {
    try {
      await this.reconcileQueue.add('reconcile', data, {
        jobId: `reconcile-${Date.now()}`,
      });
      
      this.logger.log('Queued reconciliation job');
    } catch (error) {
      this.logger.error('Failed to queue reconcile job:', error);
      throw error;
    }
  }

  async queueMigration(data: MigrationJobData): Promise<void> {
    try {
      await this.migrationQueue.add('migration', data, {
        jobId: `migration-${data.fromProvider}-to-${data.toProvider}-${Date.now()}`,
      });
      
      this.logger.log(`Queued migration from ${data.fromProvider} to ${data.toProvider}`);
    } catch (error) {
      this.logger.error('Failed to queue migration job:', error);
      throw error;
    }
  }

  private async processSyncRemoteJob(data: SyncRemoteJobData): Promise<void> {
    const { fileId, targetProvider, localPath, uploadParams } = data;
    
    this.logger.log(`Processing sync job: ${fileId} -> ${targetProvider}`);

    try {
      const provider = this.storageFactory.getProvider(targetProvider);
      if (!provider) {
        throw new Error(`Provider ${targetProvider} not available`);
      }

      const health = await this.storageFactory.healthCheck(targetProvider);
      if (!health?.healthy) {
        throw new Error(`Provider ${targetProvider} is not healthy: ${health?.errorMessage}`);
      }

      await this.updateStorageLocation(fileId, targetProvider, StorageState.SYNCING);
      
      const result = await provider.upload(uploadParams);
      
      await this.recordStorageLocation(
        fileId,
        targetProvider,
        result.storedPath,
        StorageState.SYNCED,
        result.etag,
      );

      this.logger.log(`Successfully synced file ${fileId} to ${targetProvider}`);
    } catch (error) {
      this.logger.error(`Failed to sync file ${fileId} to ${targetProvider}:`, error);
      
      await this.recordStorageLocation(
        fileId,
        targetProvider,
        localPath,
        StorageState.FAILED,
        undefined,
        error.message,
      );

      throw error;
    }
  }

  private async processReconcileJob(data: ReconcileJobData): Promise<void> {
    const { batchSize = 100, maxAge = 24 } = data;
    
    this.logger.log(`Processing reconciliation job (batch: ${batchSize}, maxAge: ${maxAge}h)`);

    const cutoffTime = new Date(Date.now() - maxAge * 60 * 60 * 1000);
    
    const failedLocations = await this.prisma.fileStorageLocation.findMany({
      where: {
        state: StorageState.FAILED,
        lastAttemptAt: {
          lt: cutoffTime,
        },
        attempts: {
          lt: 3,
        },
      },
      include: {
        file: true,
      },
      take: batchSize,
    });

    for (const location of failedLocations) {
      try {
        await this.queueSyncRemote({
          fileId: location.fileId,
          targetProvider: location.provider as StorageProviderType,
          localPath: location.storedPath,
          uploadParams: {
            stream: null as any, 
            path: location.storedPath,
          },
          shareId: location.file.shareId,
          retryCount: location.attempts,
        }, 5000);
      } catch (error) {
        this.logger.error(`Failed to requeue sync for ${location.fileId}:`, error);
      }
    }

    const syncedCount = await this.prisma.fileStorageLocation.count({
      where: {
        state: StorageState.SYNCED,
      },
    });

    const failedCount = await this.prisma.fileStorageLocation.count({
      where: {
        state: StorageState.FAILED,
      },
    });

    this.logger.log(`Reconciliation complete: ${failedLocations.length} retried, ${syncedCount} synced, ${failedCount} failed`);
  }

  private async processMigrationJob(data: MigrationJobData): Promise<void> {
    const { fromProvider, toProvider, fileIds, batchSize = 50 } = data;
    
    this.logger.log(`Processing migration from ${fromProvider} to ${toProvider}`);

    let query: any = {
      provider: fromProvider,
      state: StorageState.SYNCED,
    };

    if (fileIds) {
      query.fileId = { in: fileIds };
    }

    const locations = await this.prisma.fileStorageLocation.findMany({
      where: query,
      include: {
        file: true,
      },
      take: batchSize,
    });

    let successCount = 0;
    let failureCount = 0;

    for (const location of locations) {
      try {
        const sourceProvider = this.storageFactory.getProvider(fromProvider);
        const targetProvider = this.storageFactory.getProvider(toProvider);

        if (!sourceProvider || !targetProvider) {
          throw new Error('Source or target provider not available');
        }

        const stream = await sourceProvider.download(location.storedPath);
        
        const result = await targetProvider.upload({
          stream,
          path: location.storedPath,
        });

        await this.recordStorageLocation(
          location.fileId,
          toProvider,
          result.storedPath,
          StorageState.SYNCED,
          result.etag,
        );

        await this.prisma.fileStorageLocation.update({
          where: { id: location.id },
          data: { state: StorageState.DEPRECATED },
        });

        successCount++;
        this.logger.log(`Migrated file ${location.fileId} from ${fromProvider} to ${toProvider}`);
      } catch (error) {
        failureCount++;
        this.logger.error(`Failed to migrate file ${location.fileId}:`, error);
      }
    }

    this.logger.log(`Migration batch complete: ${successCount} successful, ${failureCount} failed`);
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

  async getQueueStats() {
    const [syncWaiting, syncActive, syncCompleted, syncFailed] = await Promise.all([
      this.syncQueue.getWaiting(),
      this.syncQueue.getActive(),
      this.syncQueue.getCompleted(),
      this.syncQueue.getFailed(),
    ]);

    return {
      sync: {
        waiting: syncWaiting.length,
        active: syncActive.length,
        completed: syncCompleted.length,
        failed: syncFailed.length,
      },
      reconcile: {
        waiting: (await this.reconcileQueue.getWaiting()).length,
        active: (await this.reconcileQueue.getActive()).length,
      },
      migration: {
        waiting: (await this.migrationQueue.getWaiting()).length,
        active: (await this.migrationQueue.getActive()).length,
      },
    };
  }

  async scheduleRecurringJobs() {
    const reconcileInterval = this.configService.get<string>('STORAGE_RECONCILE_CRON', '0 2 * * *'); // 2 AM daily
    
    await this.reconcileQueue.add('scheduled-reconcile', {}, {
      repeat: { pattern: reconcileInterval },
      jobId: 'scheduled-reconcile',
    });

    this.logger.log('Scheduled recurring reconciliation job');
  }
}