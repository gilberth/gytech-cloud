import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { PrismaModule } from '../../prisma/prisma.module';

import { StorageAPIController } from './storage-api.controller';
import { StorageDemoController } from './storage-demo.controller';
import { StorageFactoryService } from './storage-factory.service';
// import { SyncQueueService } from './sync-queue.service'; // Temporarily disabled
// import { StorageOrchestratorService } from './storage-orchestrator.service'; // Temporarily disabled

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
  ],
  providers: [
    StorageFactoryService,
    // SyncQueueService, // Temporarily disabled due to config service issues
    // StorageOrchestratorService, // Temporarily disabled due to circular dependency
  ],
  controllers: [
    StorageAPIController,
    StorageDemoController,
  ],
  exports: [
    StorageFactoryService,
    // SyncQueueService, // Temporarily disabled due to config service issues
    // StorageOrchestratorService, // Temporarily disabled due to circular dependency
  ],
})
export class MultiStorageModule {}