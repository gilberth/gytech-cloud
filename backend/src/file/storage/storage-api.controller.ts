import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../../auth/guard/isAdmin.guard';
import { StorageFactoryService, StorageProviderType } from './storage-factory.service';
import { StorageOrchestratorService } from './storage-orchestrator.service';
import { SyncQueueService } from './sync-queue.service';
import { DrService } from './dr-service';
import { RecoveryService, AutoRecoveryConfig } from './recovery.service';

@Controller('api/admin/storage')
@UseGuards(AdminGuard)
export class StorageApiController {
  constructor(
    private storageFactory: StorageFactoryService,
    private orchestrator: StorageOrchestratorService,
    private syncQueue: SyncQueueService,
    private drService: DrService,
    private recoveryService: RecoveryService,
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

  // Recovery Endpoints - Nivel 2 Automatizado
  @Post('recovery/analyze')
  async createRecoveryPlan() {
    return await this.recoveryService.createRecoveryPlan();
  }

  @Get('recovery/plans')
  async listRecoveryPlans() {
    return this.recoveryService.listRecoveryPlans();
  }

  @Get('recovery/plans/:planId')
  async getRecoveryPlan(@Param('planId') planId: string) {
    const plan = this.recoveryService.getRecoveryPlan(planId);
    if (!plan) {
      throw new Error(`Recovery plan ${planId} not found`);
    }
    return plan;
  }

  @Post('recovery/plans/:planId/execute')
  async executeRecoveryPlan(
    @Param('planId') planId: string,
    @Body() config?: Partial<AutoRecoveryConfig>
  ) {
    await this.recoveryService.executeRecoveryPlan(planId, config);
    return { message: `Recovery plan ${planId} execution started` };
  }

  @Post('recovery/emergency')
  async executeEmergencyRecovery() {
    const plan = await this.recoveryService.executeEmergencyRecovery();
    return { 
      message: 'Emergency recovery completed',
      plan: plan
    };
  }
}