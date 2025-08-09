import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../auth/guard/isAdmin.guard';
import { StorageFactoryService, StorageProviderType } from './storage-factory.service';
import { StorageOrchestratorService } from './storage-orchestrator.service';
import { SyncQueueService } from './sync-queue.service';
import { DrService } from './dr-service';

@Controller('api/admin/storage')
@UseGuards(AdminGuard)
export class StorageApiController {
  constructor(
    private storageFactory: StorageFactoryService,
    private orchestrator: StorageOrchestratorService,
    private syncQueue: SyncQueueService,
    private drService: DrService,
  ) {}

  @Get('providers')
  async listProviders() {
    return this.storageFactory.listProviders();
  }

  @Get('health')
  async getHealthStatus() {
    return await this.storageFactory.healthCheckAll();
  }

  @Post('health/:provider')
  async healthCheckProvider(@Param('provider') provider: string) {
    return await this.storageFactory.healthCheck(provider as StorageProviderType);
  }

  @Get('metrics')
  async getStorageMetrics() {
    return await this.orchestrator.getStorageMetrics();
  }

  @Get('queue-stats')
  async getQueueStats() {
    return await this.syncQueue.getQueueStats();
  }

  @Post('reconcile')
  async triggerReconciliation() {
    await this.syncQueue.queueReconcile();
    return { message: 'Reconciliation job queued successfully' };
  }

  @Post('migration')
  async triggerMigration(
    @Body() body: {
      fromProvider: StorageProviderType;
      toProvider: StorageProviderType;
      fileIds?: string[];
      batchSize?: number;
    }
  ) {
    await this.syncQueue.queueMigration(body);
    return { message: 'Migration job queued successfully' };
  }

  @Post('providers/:provider/switch-primary')
  async switchPrimaryProvider(@Param('provider') provider: string) {
    const success = await this.storageFactory.switchPrimaryProvider(provider as StorageProviderType);
    return { success, message: `Switched primary provider to ${provider}` };
  }

  // DR Endpoints
  @Get('dr/status')
  async getDrStatus() {
    return await this.drService.getStatus();
  }

  @Get('dr/snapshots')
  async listSnapshots() {
    return await this.drService.listSnapshots();
  }

  @Post('dr/snapshots')
  async createSnapshot(@Body() body: { force?: boolean } = {}) {
    return await this.drService.createSnapshot(body.force);
  }

  @Get('dr/config')
  async getDrConfig() {
    return await this.drService.getConfig();
  }

  @Post('dr/restore/simulate')
  async simulateRestore(@Body() body: { snapshotId: string }) {
    return await this.drService.simulateRestore(body.snapshotId);
  }
}