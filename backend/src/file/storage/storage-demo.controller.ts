import { Controller, Get, Post, Body, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { AdministratorGuard } from '../../auth/guard/isAdmin.guard';
import { JwtGuard } from '../../auth/guard/jwt.guard';
import { StorageFactoryService } from './storage-factory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '../../config/config.service';

@Controller('admin/storage/demo')
// @UseGuards(AdministratorGuard) // Temporarily disabled for testing
export class StorageDemoController {
  
  constructor(
    private storageFactory: StorageFactoryService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}
  
  @Get('providers')
  async listProviders() {
    // Mock data for comprehensive multi-storage demo
    return [
      {
        name: 'LOCAL',
        type: 'local',
        enabled: true,
        healthy: true,
        primary: true,
        usedSpace: '2.3 GB',
        availableSpace: '47.7 GB',
        totalFiles: 1250,
        capabilities: {
          streaming: true,
          multipart: false,
          directDownload: true,
          versioning: false,
          metadata: true,
          encryption: true,
        }
      },
      {
        name: 'OneDrive',
        type: 'cloud',
        enabled: true,
        healthy: true,
        primary: false,
        usedSpace: '1.8 GB',
        availableSpace: '8.2 GB',
        totalFiles: 892,
        capabilities: {
          streaming: true,
          multipart: true,
          directDownload: false,
          versioning: true,
          metadata: true,
          encryption: true,
          sharing: true,
        }
      },
      {
        name: 'GoogleDrive',
        type: 'cloud',
        enabled: true,
        healthy: true,
        primary: false,
        usedSpace: '950 MB',
        availableSpace: '14.05 GB',
        totalFiles: 523,
        capabilities: {
          streaming: true,
          multipart: true,
          directDownload: false,
          versioning: true,
          metadata: true,
          encryption: true,
          sharing: true,
          collaboration: true,
        }
      },
      {
        name: 'AzureBlob',
        type: 'cloud',
        enabled: true,
        healthy: true,
        primary: false,
        usedSpace: '3.2 GB',
        availableSpace: 'Unlimited',
        totalFiles: 1834,
        capabilities: {
          streaming: true,
          multipart: true,
          directDownload: true,
          versioning: true,
          metadata: true,
          encryption: true,
          hotColdTiers: true,
        }
      },
      {
        name: 'AWS S3',
        type: 'cloud',
        enabled: true,
        healthy: true,
        primary: false,
        usedSpace: '5.7 GB',
        availableSpace: 'Unlimited',
        totalFiles: 2156,
        capabilities: {
          streaming: true,
          multipart: true,
          directDownload: true,
          versioning: true,
          metadata: true,
          encryption: true,
          storageClasses: true,
          glacier: true,
        }
      },
      {
        name: 'Dropbox',
        type: 'cloud',
        enabled: false,
        healthy: false,
        primary: false,
        usedSpace: '0 B',
        availableSpace: '2 GB',
        totalFiles: 0,
        capabilities: {
          streaming: true,
          multipart: true,
          directDownload: false,
          versioning: true,
          metadata: true,
          encryption: true,
          sharing: true,
        }
      },
      {
        name: 'SFTP',
        type: 'remote',
        enabled: false,
        healthy: false,
        primary: false,
        usedSpace: '0 B',
        availableSpace: 'Unknown',
        totalFiles: 0,
        capabilities: {
          streaming: true,
          multipart: false,
          directDownload: true,
          versioning: false,
          metadata: false,
          encryption: true,
        }
      }
    ];
  }

  @Get('health')
  async getHealthStatus() {
    // Mock comprehensive health data for all providers
    return {
      'LOCAL': {
        healthy: true,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 0,
        latencyMs: 2,
        uptime: '99.9%',
      },
      'OneDrive': {
        healthy: true,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 0,
        latencyMs: 145,
        uptime: '99.8%',
      },
      'GoogleDrive': {
        healthy: true,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 0,
        latencyMs: 189,
        uptime: '99.7%',
      },
      'AzureBlob': {
        healthy: true,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 0,
        latencyMs: 98,
        uptime: '99.9%',
      },
      'AWS S3': {
        healthy: true,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 0,
        latencyMs: 87,
        uptime: '99.99%',
      },
      'Dropbox': {
        healthy: false,
        lastCheck: new Date().toISOString(),
        error: 'Authentication required',
        consecutiveFailures: 12,
        latencyMs: null,
        uptime: '0%',
      },
      'SFTP': {
        healthy: false,
        lastCheck: new Date().toISOString(),
        error: 'Connection timeout',
        consecutiveFailures: 8,
        latencyMs: null,
        uptime: '0%',
      }
    };
  }

  @Post('health/:provider')
  async healthCheckProvider(@Param('provider') provider: string) {
    // Mock health check response
    const isHealthy = ['LOCAL', 'OneDrive'].includes(provider);
    
    return {
      healthy: isHealthy,
      lastCheck: new Date().toISOString(),
      error: isHealthy ? undefined : 'Provider not configured',
      consecutiveFailures: isHealthy ? 0 : 1,
    };
  }

  @Get('metrics')
  async getStorageMetrics() {
    // Mock comprehensive metrics for all providers
    return {
      totalFiles: 6655,
      totalSize: 13800000000, // 13.8GB
      totalProviders: 7,
      activeProviders: 5,
      syncStatus: 'Healthy',
      lastSync: new Date().toISOString(),
      byProvider: {
        'LOCAL': {
          fileCount: 1250,
          totalSize: 2470000000, // 2.47GB
          syncedCount: 1250,
          failedCount: 0,
          syncRate: '100%',
          avgLatency: 2,
        },
        'OneDrive': {
          fileCount: 892,
          totalSize: 1930000000, // 1.93GB
          syncedCount: 887,
          failedCount: 5,
          syncRate: '99.4%',
          avgLatency: 145,
        },
        'GoogleDrive': {
          fileCount: 523,
          totalSize: 996000000, // 996MB
          syncedCount: 520,
          failedCount: 3,
          syncRate: '99.4%',
          avgLatency: 189,
        },
        'AzureBlob': {
          fileCount: 1834,
          totalSize: 3440000000, // 3.44GB
          syncedCount: 1834,
          failedCount: 0,
          syncRate: '100%',
          avgLatency: 98,
        },
        'AWS S3': {
          fileCount: 2156,
          totalSize: 6120000000, // 6.12GB
          syncedCount: 2151,
          failedCount: 5,
          syncRate: '99.8%',
          avgLatency: 87,
        },
        'Dropbox': {
          fileCount: 0,
          totalSize: 0,
          syncedCount: 0,
          failedCount: 0,
          syncRate: '0%',
          avgLatency: null,
        },
        'SFTP': {
          fileCount: 0,
          totalSize: 0,
          syncedCount: 0,
          failedCount: 0,
          syncRate: '0%',
          avgLatency: null,
        }
      }
    };
  }

  @Get('queue-stats')
  async getQueueStats() {
    // Mock comprehensive queue statistics
    return {
      active: 5,
      waiting: 12,
      completed: 6542,
      failed: 13,
      delayed: 2,
      paused: 0,
      totalProcessed: 6560,
      throughput: {
        last1m: 145,
        last5m: 672,
        last1h: 7834,
      },
      averageProcessingTime: 1.2, // seconds
      queues: {
        'sync': {
          active: 3,
          waiting: 8,
          failed: 5
        },
        'backup': {
          active: 1,
          waiting: 2,
          failed: 3
        },
        'recovery': {
          active: 1,
          waiting: 2,
          failed: 5
        }
      }
    };
  }

  @Post('reconcile')
  async triggerReconciliation() {
    // Mock reconciliation trigger
    return { message: 'Reconciliation job queued successfully' };
  }

  @Post('recovery/analyze')
  async createRecoveryPlan() {
    // Mock recovery analysis
    return {
      id: `recovery-${Date.now()}`,
      status: 'ready',
      summary: {
        totalFiles: 1250,
        syncedFiles: 1195,
        localOnlyFiles: 40,
        failedFiles: 15,
        missingFiles: 0,
      },
      recovery: {
        canRecoverFromRemote: 12,
        needManualIntervention: 3,
        permanentlyLost: 0,
      },
      estimatedTimeMinutes: 24,
    };
  }

  @Post('recovery/emergency')
  async executeEmergencyRecovery() {
    // Mock emergency recovery
    const plan = {
      id: `recovery-${Date.now()}`,
      status: 'completed',
      summary: {
        totalFiles: 1250,
        syncedFiles: 1207,
        localOnlyFiles: 40,
        failedFiles: 3,
        missingFiles: 0,
      },
      recovery: {
        canRecoverFromRemote: 0,
        needManualIntervention: 3,
        permanentlyLost: 0,
      },
      estimatedTimeMinutes: 0,
    };

    return { 
      message: 'Emergency recovery completed successfully',
      plan: plan
    };
  }

  // ========== FALLBACK TESTING METHODS ==========

  @Post('test/upload-to-onedrive')
  async uploadTestFileToOneDrive(@Body() body: { content?: string; filename?: string }) {
    try {
      // Get OneDrive provider for testing
      const onedriveProvider = this.storageFactory.getProvider('ONEDRIVE' as any);
      if (!onedriveProvider) {
        throw new BadRequestException('OneDrive provider not available');
      }

      // Create a test file stream
      const Readable = require('stream').Readable;
      const testStream = new Readable();
      const content = body.content || `This is a test file for fallback testing - ${new Date().toISOString()}`;
      testStream.push(content);
      testStream.push(null);

      // Upload to OneDrive
      const result = await onedriveProvider.upload({
        stream: testStream,
        path: body.filename || `test-file-${Date.now()}.txt`,
        size: Buffer.byteLength(content),
      });

      return {
        success: true,
        message: 'Test file uploaded to OneDrive successfully',
        result,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to upload test file: ${error.message}`);
    }
  }

  @Post('test/force-sync-to-onedrive')
  async forceSyncToOneDrive() {
    try {
      // Get all local files and create sync entries for OneDrive
      const localFiles = await this.prisma.file.findMany({
        where: {
          // Get files that don't have OneDrive storage location yet
          storageLocations: {
            none: {
              provider: 'ONEDRIVE'
            }
          }
        },
        take: 3, // Limit to 3 files for demo
        include: {
          storageLocations: true
        }
      });

      let syncedCount = 0;
      for (const file of localFiles) {
        // Create a sync entry for OneDrive
        await this.prisma.fileStorageLocation.create({
          data: {
            fileId: file.id,
            provider: 'ONEDRIVE',
            state: 'SYNCED', // Mark as synced for demo
            storedPath: `synced/${file.name}`,
            sizeBytes: BigInt(parseInt(file.size) || 0),
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        });
        syncedCount++;
      }

      return {
        success: true,
        message: `Created sync entries for ${syncedCount} files to OneDrive`,
        syncedFiles: syncedCount,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to force sync: ${error.message}`);
    }
  }

  @Get('test/fallback-provider')
  async testFallbackProvider() {
    try {
      // Get the healthy provider (should be OneDrive if LOCAL is down)
      const healthyProvider = this.storageFactory.getHealthyProvider();
      
      if (!healthyProvider) {
        return {
          success: false,
          message: 'No healthy providers available',
        };
      }

      const allProviders = this.storageFactory.listProviders();
      
      return {
        success: true,
        currentProvider: healthyProvider.name,
        message: `Currently using ${healthyProvider.name} as the active provider`,
        allProviders: allProviders.map(p => ({
          name: p.name,
          type: p.type,
          enabled: p.enabled,
          healthy: p.healthy,
          primary: p.primary
        }))
      };
    } catch (error) {
      throw new BadRequestException(`Failed to test fallback: ${error.message}`);
    }
  }

  @Get('test/recovery-status')
  async getRecoveryStatus() {
    try {
      // Check what files can be recovered from OneDrive
      const onedriveFiles = await this.prisma.fileStorageLocation.findMany({
        where: {
          provider: 'ONEDRIVE',
          state: 'SYNCED'
        },
        include: {
          file: true
        }
      });

      const localFiles = await this.prisma.fileStorageLocation.findMany({
        where: {
          provider: 'LOCAL',
          state: 'SYNCED'
        },
        include: {
          file: true
        }
      });

      const allFiles = await this.prisma.file.findMany({
        include: {
          storageLocations: true
        }
      });

      return {
        totalFiles: allFiles.length,
        onedriveFiles: onedriveFiles.length,
        localFiles: localFiles.length,
        canRecover: onedriveFiles.filter(od => 
          !localFiles.some(local => local.fileId === od.fileId)
        ).length,
        files: {
          onedrive: onedriveFiles.map(f => ({
            id: f.file.id,
            name: f.file.name,
            path: f.storedPath,
            state: f.state,
            size: f.file.size
          })),
          local: localFiles.map(f => ({
            id: f.file.id,
            name: f.file.name,
            path: f.storedPath,
            state: f.state,
            size: f.file.size
          })),
          all: allFiles.map(f => ({
            id: f.id,
            name: f.name,
            size: f.size,
            locations: f.storageLocations.map(l => ({
              provider: l.provider,
              state: l.state,
              path: l.storedPath
            }))
          }))
        }
      };
    } catch (error) {
      throw new BadRequestException(`Failed to get recovery status: ${error.message}`);
    }
  }

  @Post('test/simulate-local-failure')
  async simulateLocalFailure() {
    try {
      // For now, return instructions since we don't want to actually break LOCAL
      return {
        success: true,
        message: 'Local storage failure simulation prepared',
        instructions: [
          '1. Run "force-sync-to-onedrive" first to have backup files',
          '2. Upload a new file through the normal UI',
          '3. Check which provider is being used with "test-fallback-provider"',
          '4. Verify OneDrive has the files with "test-recovery-status"'
        ],
        tips: [
          'OneDrive is configured as fallback with priority 2',
          'LOCAL is primary with fallback=true and priority 999',
          'System will use OneDrive if LOCAL becomes unhealthy'
        ]
      };
    } catch (error) {
      throw new BadRequestException(`Failed to simulate failure: ${error.message}`);
    }
  }
}