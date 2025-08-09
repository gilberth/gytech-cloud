import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';

import { StorageFactoryService } from './storage-factory.service';
import { StorageOrchestratorService } from './storage-orchestrator.service';
import { SyncQueueService } from './sync-queue.service';
import { DrService } from './dr-service';
import { RecoveryService } from './recovery.service';
import { StorageApiController } from './storage-api.controller';

import { OneDriveStorageService } from './onedrive-storage.service';
import { GoogleDriveStorageService } from './googledrive-storage.service';
import { AzureBlobCloudStorageService } from './azureblob-cloud-storage.service';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
  ],
  providers: [
    StorageFactoryService,
    StorageOrchestratorService,
    SyncQueueService,
    DrService,
    RecoveryService,
    OneDriveStorageService,
    GoogleDriveStorageService,
    AzureBlobCloudStorageService,
  ],
  controllers: [
    StorageApiController,
  ],
  exports: [
    StorageFactoryService,
    StorageOrchestratorService,
    SyncQueueService,
    DrService,
    RecoveryService,
  ],
})
export class MultiStorageModule {}