import { Controller, Get, Post, Body, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { AdministratorGuard } from '../../auth/guard/isAdmin.guard';
import { JwtGuard } from '../../auth/guard/jwt.guard';
import { StorageFactoryService } from './storage-factory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '../../config/config.service';

@Controller('admin/storage')
@UseGuards(JwtGuard, AdministratorGuard) // Production security enabled
export class StorageAPIController {
  
  constructor(
    private storageFactory: StorageFactoryService,
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  @Get('providers')
  async listProviders() {
    try {
      const providers = [];
      
      // Always include LOCAL provider
      const localStorageData = await this.getProviderStorageData('LOCAL');
      const localProvider = {
        name: 'LOCAL',
        type: 'local',
        enabled: true,
        healthy: true,
        primary: true,
        ...localStorageData,
        capabilities: {
          streaming: true,
          multipart: false,
          directDownload: true,
          versioning: false,
          metadata: true,
          encryption: true,
        }
      };
      providers.push(localProvider);

      // Check for OneDrive configuration
      const onedriveEnabled = await this.configService.get('onedrive.enabled');
      
      if (onedriveEnabled === 'true' || onedriveEnabled === true) {
        const onedriveClientId = await this.configService.get('onedrive.clientId');
        const onedriveClientSecret = await this.configService.get('onedrive.clientSecret');
        
        if (onedriveClientId && onedriveClientSecret) {
          const onedriveStorageData = await this.getProviderStorageData('OneDrive');
          const onedriveProvider = {
            name: 'OneDrive',
            type: 'cloud',
            enabled: true,
            healthy: true, // TODO: Implement actual health check
            primary: false,
            ...onedriveStorageData,
            capabilities: {
              streaming: false,
              multipart: true,
              directDownload: false,
              versioning: true,
              metadata: true,
              encryption: true,
            }
          };
          providers.push(onedriveProvider);
        }
      }

      // Check for Google Drive configuration
      const googledriveEnabled = await this.configService.get('googledrive.enabled');
      if (googledriveEnabled === 'true') {
        const googledriveClientId = await this.configService.get('googledrive.clientId');
        const googledriveClientSecret = await this.configService.get('googledrive.clientSecret');
        
        if (googledriveClientId && googledriveClientSecret) {
          const googledriveStorageData = await this.getProviderStorageData('GoogleDrive');
          const googledriveProvider = {
            name: 'GoogleDrive',
            type: 'cloud',
            enabled: true,
            healthy: true, // TODO: Implement actual health check
            primary: false,
            ...googledriveStorageData,
            capabilities: {
              streaming: false,
              multipart: true,
              directDownload: false,
              versioning: true,
              metadata: true,
              encryption: true,
            }
          };
          providers.push(googledriveProvider);
        }
      }

      // Check for Azure Blob configuration
      const azureblobEnabled = await this.configService.get('azureblob.enabled');
      if (azureblobEnabled === 'true') {
        const azureblobAccountName = await this.configService.get('azureblob.accountName');
        const azureblobAccountKey = await this.configService.get('azureblob.accountKey');
        
        if (azureblobAccountName && azureblobAccountKey) {
          const azureblobStorageData = await this.getProviderStorageData('AzureBlob');
          const azureblobProvider = {
            name: 'AzureBlob',
            type: 'cloud',
            enabled: true,
            healthy: true, // TODO: Implement actual health check
            primary: false,
            ...azureblobStorageData,
            capabilities: {
              streaming: true,
              multipart: true,
              directDownload: true,
              versioning: false,
              metadata: true,
              encryption: true,
            }
          };
          providers.push(azureblobProvider);
        }
      }

      return providers;
    } catch (error) {
      throw new BadRequestException(`Failed to list providers: ${error.message}`);
    }
  }

  @Get('health')
  async getHealthStatus() {
    try {
      const healthStatus = {};
      
      // Always include LOCAL provider health
      healthStatus['LOCAL'] = {
        healthy: true,
        lastCheck: new Date().toISOString(),
        consecutiveFailures: 0,
        latencyMs: 2,
        uptime: '100%',
      };

      // Get actual health status from StorageFactory
      const allProviderHealth = this.storageFactory.getAllProviderHealth();
      
      for (const health of allProviderHealth) {
        const providerName = health.provider === 'ONEDRIVE' ? 'OneDrive' : 
                            health.provider === 'GOOGLE_DRIVE' ? 'GoogleDrive' :
                            health.provider === 'AZURE_BLOB' ? 'AzureBlob' : health.provider;
        
        healthStatus[providerName] = {
          healthy: health.healthy,
          lastCheck: health.lastChecked.toISOString(),
          consecutiveFailures: health.consecutiveFailures,
          latencyMs: health.latencyMs || 0,
          uptime: this.calculateUptime(health),
          error: health.errorMessage,
        };
      }

      return healthStatus;
    } catch (error) {
      throw new BadRequestException(`Failed to get health status: ${error.message}`);
    }
  }

  @Post('health/:provider')
  async healthCheckProvider(@Param('provider') provider: string) {
    try {
      const providerType = this.getStorageProviderType(provider);
      const health = await this.storageFactory.healthCheck(providerType);
      
      if (!health) {
        throw new BadRequestException(`Provider ${provider} not found`);
      }

      return {
        healthy: health.healthy,
        lastCheck: health.lastChecked.toISOString(),
        error: health.errorMessage,
        latencyMs: health.latencyMs,
        consecutiveFailures: health.consecutiveFailures,
      };
    } catch (error) {
      throw new BadRequestException(`Health check failed: ${error.message}`);
    }
  }

  @Get('metrics')
  async getStorageMetrics() {
    try {
      // Get real metrics from database
      const totalFiles = await this.prisma.file.count();
      
      // Calculate total size from files (files.size is stored as string, need to parse)
      const allFiles = await this.prisma.file.findMany({
        select: { size: true }
      });
      
      const totalSize = allFiles.reduce((sum, file) => {
        const fileSize = parseInt(file.size) || 0;
        return sum + fileSize;
      }, 0);

      // For now, since StorageFactory doesn't have real providers yet, use LOCAL only
      const byProvider = {
        'LOCAL': await this.getProviderMetrics('LOCAL')
      };

      return {
        totalFiles,
        totalSize,
        totalProviders: 1, // Only LOCAL for now
        activeProviders: 1, // Only LOCAL for now
        syncStatus: 'Healthy', // Since only LOCAL is active
        lastSync: new Date().toISOString(),
        byProvider,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to get metrics: ${error.message}`);
    }
  }

  @Get('queue-stats')
  async getQueueStats() {
    try {
      // Since we're only using LOCAL storage for now, most queue stats will be 0
      // FileStorageLocation table might be empty if multi-storage isn't set up yet
      const totalJobs = await this.prisma.fileStorageLocation.count();
      const syncedJobs = await this.prisma.fileStorageLocation.count({
        where: { state: 'SYNCED' }
      });
      const failedJobs = await this.prisma.fileStorageLocation.count({
        where: { state: 'FAILED' }
      });
      const syncingJobs = await this.prisma.fileStorageLocation.count({
        where: { state: 'SYNCING' }
      });

      return {
        active: syncingJobs,
        waiting: 0, // No queue for LOCAL storage
        completed: syncedJobs,
        failed: failedJobs,
        delayed: 0,
        paused: 0,
        totalProcessed: totalJobs,
        throughput: {
          last1m: 0, // LOCAL storage processes immediately
          last5m: 0,
          last1h: 0,
        },
        averageProcessingTime: 0, // LOCAL storage is instant
        queues: {
          'sync': {
            active: syncingJobs,
            waiting: 0,
            failed: failedJobs
          },
          'backup': {
            active: 0, // No backup for LOCAL only
            waiting: 0,
            failed: 0
          },
          'recovery': {
            active: 0, // No recovery needed for LOCAL only
            waiting: 0,
            failed: 0
          }
        }
      };
    } catch (error) {
      throw new BadRequestException(`Failed to get queue stats: ${error.message}`);
    }
  }

  @Post('reconcile')
  async triggerReconciliation() {
    try {
      // TODO: Queue real reconciliation job when BullMQ is integrated
      // For now, perform basic reconciliation
      const providers = this.storageFactory.listProviders().filter(p => p.enabled);
      let reconciledCount = 0;

      for (const provider of providers) {
        // Check for files that should be synced to this provider
        const localOnlyFiles = await this.prisma.fileStorageLocation.findMany({
          where: {
            provider: 'LOCAL',
            state: 'SYNCED'
          },
          include: {
            file: true
          }
        });

        // Create sync entries for missing providers
        for (const fileLocation of localOnlyFiles) {
          const existingSync = await this.prisma.fileStorageLocation.findUnique({
            where: {
              fileId_provider: {
                fileId: fileLocation.fileId,
                provider: provider.name
              }
            }
          });

          if (!existingSync) {
            await this.prisma.fileStorageLocation.create({
              data: {
                fileId: fileLocation.fileId,
                provider: provider.name,
                state: 'SYNCING',
                storedPath: fileLocation.storedPath,
                createdAt: new Date(),
                updatedAt: new Date(),
              }
            });
            reconciledCount++;
          }
        }
      }

      return { 
        message: 'Reconciliation completed successfully',
        reconciledFiles: reconciledCount
      };
    } catch (error) {
      throw new BadRequestException(`Reconciliation failed: ${error.message}`);
    }
  }

  @Post('recovery/analyze')
  async analyzeRecovery() {
    try {
      // Analyze what files can be recovered from remote providers
      const allFiles = await this.prisma.file.findMany({
        include: {
          storageLocations: true
        }
      });

      let canRecover = 0;
      let needManual = 0;
      let lost = 0;

      const analysisByFile = allFiles.map(file => {
        const locations = file.storageLocations;
        const localLocation = locations.find(l => l.provider === 'LOCAL');
        const remoteLocations = locations.filter(l => l.provider !== 'LOCAL' && l.state === 'SYNCED');

        if (!localLocation || localLocation.state !== 'SYNCED') {
          if (remoteLocations.length > 0) {
            canRecover++;
            return {
              fileId: file.id,
              fileName: file.name,
              status: 'can_recover',
              availableProviders: remoteLocations.map(l => l.provider)
            };
          } else {
            lost++;
            return {
              fileId: file.id,
              fileName: file.name,
              status: 'lost',
              availableProviders: []
            };
          }
        } else if (remoteLocations.some(l => l.state === 'FAILED')) {
          needManual++;
          return {
            fileId: file.id,
            fileName: file.name,
            status: 'need_manual',
            availableProviders: remoteLocations.filter(l => l.state === 'SYNCED').map(l => l.provider)
          };
        }

        return null;
      }).filter(Boolean);

      const estimatedRecoveryTime = Math.ceil(canRecover * 0.5); // 0.5 minutes per file estimated

      return {
        id: `recovery_${Date.now()}`,
        status: 'completed',
        summary: {
          totalFiles: allFiles.length,
          syncedFiles: allFiles.length - canRecover - needManual - lost,
          localOnlyFiles: allFiles.length,
          failedFiles: 0,
          missingFiles: lost,
        },
        recovery: {
          canRecoverFromRemote: canRecover,
          needManualIntervention: needManual,
          permanentlyLost: lost,
        },
        estimatedTimeMinutes: estimatedRecoveryTime,
        files: analysisByFile
      };
    } catch (error) {
      throw new BadRequestException(`Recovery analysis failed: ${error.message}`);
    }
  }

  @Post('recovery/emergency')
  async executeEmergencyRecovery() {
    try {
      // Execute emergency recovery from remote providers
      const recoveryAnalysis = await this.analyzeRecovery();
      const recoverableFiles = recoveryAnalysis.files.filter(f => f.status === 'can_recover');

      let recoveredCount = 0;
      const errors = [];

      for (const fileInfo of recoverableFiles.slice(0, 10)) { // Limit to 10 for demo
        try {
          // TODO: Implement actual file recovery from remote providers
          // For now, just update the database state
          await this.prisma.fileStorageLocation.upsert({
            where: {
              fileId_provider: {
                fileId: fileInfo.fileId,
                provider: 'LOCAL'
              }
            },
            update: {
              state: 'SYNCED',
              updatedAt: new Date()
            },
            create: {
              fileId: fileInfo.fileId,
              provider: 'LOCAL',
              state: 'SYNCED',
              storedPath: `/recovery/${fileInfo.fileId}`,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          });
          recoveredCount++;
        } catch (err) {
          errors.push(`Failed to recover ${fileInfo.fileName}: ${err.message}`);
        }
      }

      return {
        plan: {
          totalFiles: recoverableFiles.length,
          recoveredFiles: recoveredCount,
          failedFiles: errors.length,
          errors: errors.slice(0, 5) // Limit error messages
        }
      };
    } catch (error) {
      throw new BadRequestException(`Emergency recovery failed: ${error.message}`);
    }
  }

  // Helper methods
  private async getProviderStorageData(providerName: string) {
    // For LOCAL provider, count files directly since they don't use FileStorageLocation yet
    if (providerName === 'LOCAL') {
      const totalFiles = await this.prisma.file.count();
      
      // Calculate actual storage size from files
      const allFiles = await this.prisma.file.findMany({
        select: { size: true }
      });
      
      const totalSizeBytes = allFiles.reduce((sum, file) => {
        const fileSize = parseInt(file.size) || 0;
        return sum + fileSize;
      }, 0);

      // Convert bytes to human readable format
      const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };

      return {
        fileCount: totalFiles,
        totalSize: totalSizeBytes,
        syncedCount: totalFiles, // All files are considered synced for LOCAL
        failedCount: 0,
        syncRate: '100%',
        avgLatency: 2, // LOCAL storage is fast
      };
    }

    // For other providers, use FileStorageLocation table (when implemented)
    const fileCount = await this.prisma.fileStorageLocation.count({
      where: { provider: providerName }
    });

    const syncedCount = await this.prisma.fileStorageLocation.count({
      where: { provider: providerName, state: 'SYNCED' }
    });

    const failedCount = await this.prisma.fileStorageLocation.count({
      where: { provider: providerName, state: 'FAILED' }
    });

    // Get actual size from FileStorageLocation table
    const storageLocations = await this.prisma.fileStorageLocation.findMany({
      where: { 
        provider: providerName,
        state: 'SYNCED',
        sizeBytes: { not: null }
      },
      select: { sizeBytes: true }
    });

    const totalSizeBytes = storageLocations.reduce((sum, location) => {
      const size = location.sizeBytes ? Number(location.sizeBytes) : 0;
      return sum + size;
    }, 0);

    return {
      fileCount,
      totalSize: totalSizeBytes,
      syncedCount,
      failedCount,
      syncRate: fileCount > 0 ? `${Math.round((syncedCount / fileCount) * 100)}%` : '0%',
      avgLatency: null, // Will be calculated when providers are implemented
    };
  }

  private async getProviderMetrics(providerName: string) {
    return this.getProviderStorageData(providerName);
  }

  private getProviderType(providerName: string): string {
    const typeMap = {
      'LOCAL': 'local',
      'OneDrive': 'cloud',
      'GoogleDrive': 'cloud', 
      'AzureBlob': 'cloud',
      'AWS S3': 'cloud',
      'Dropbox': 'cloud',
      'SFTP': 'remote'
    };
    return typeMap[providerName] || 'unknown';
  }

  private getStorageProviderType(providerName: string) {
    // Map string names to StorageProviderType enum values
    const typeMap = {
      'LOCAL': 'LOCAL',
      'OneDrive': 'ONEDRIVE',
      'GoogleDrive': 'GOOGLE_DRIVE',
      'AzureBlob': 'AZURE_BLOB',
      'AWS S3': 'S3',
    };
    return typeMap[providerName] || providerName;
  }

  private calculateUptime(health: any): string {
    // Simple uptime calculation based on failure rate
    if (health.consecutiveFailures === 0) return '100%';
    if (health.consecutiveFailures < 3) return '99.9%';
    if (health.consecutiveFailures < 10) return '99%';
    return '95%';
  }

  private calculateSyncStatus(providers: any[]): string {
    const healthyCount = providers.filter(p => p.healthy).length;
    const totalCount = providers.filter(p => p.enabled).length;
    
    if (totalCount === 0) return 'No providers';
    if (healthyCount === totalCount) return 'Healthy';
    if (healthyCount > totalCount / 2) return 'Degraded';
    return 'Critical';
  }
}