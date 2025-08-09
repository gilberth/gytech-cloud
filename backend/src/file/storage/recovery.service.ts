import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageFactoryService } from './storage-factory.service';
import { DrService } from './dr-service';
import { SyncQueueService } from './sync-queue.service';
import * as fs from 'fs';
import * as path from 'path';

export interface RecoveryPlan {
  id: string;
  createdAt: string;
  status: 'analyzing' | 'ready' | 'executing' | 'completed' | 'failed';
  summary: {
    totalFiles: number;
    syncedFiles: number;
    localOnlyFiles: number;
    failedFiles: number;
    missingFiles: number;
  };
  recovery: {
    canRecoverFromRemote: number;
    needManualIntervention: number;
    permanentlyLost: number;
  };
  actions: RecoveryAction[];
  estimatedTimeMinutes: number;
}

export interface RecoveryAction {
  id: string;
  type: 'download_from_remote' | 'restore_from_backup' | 'mark_as_lost' | 'recreate_metadata';
  fileId: string;
  fileName: string;
  provider?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  errorMessage?: string;
}

export interface AutoRecoveryConfig {
  enabled: boolean;
  maxConcurrentDownloads: number;
  timeoutMinutes: number;
  retryAttempts: number;
  prioritizeRecentFiles: boolean;
  skipLargeFiles: boolean;
  maxFileSizeMB: number;
}

@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);
  private activeRecoveryPlans = new Map<string, RecoveryPlan>();

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private storageFactory: StorageFactoryService,
    private drService: DrService,
    private syncQueue: SyncQueueService,
  ) {}

  /**
   * Analiza el estado actual y crea un plan de recuperación automatizado
   */
  async createRecoveryPlan(): Promise<RecoveryPlan> {
    const planId = `recovery-${Date.now()}`;
    
    this.logger.log(`Creating recovery plan: ${planId}`);

    const plan: RecoveryPlan = {
      id: planId,
      createdAt: new Date().toISOString(),
      status: 'analyzing',
      summary: {
        totalFiles: 0,
        syncedFiles: 0,
        localOnlyFiles: 0,
        failedFiles: 0,
        missingFiles: 0,
      },
      recovery: {
        canRecoverFromRemote: 0,
        needManualIntervention: 0,
        permanentlyLost: 0,
      },
      actions: [],
      estimatedTimeMinutes: 0,
    };

    try {
      // 1. Analizar todos los archivos en el sistema
      const files = await this.prisma.file.findMany({
        include: {
          storageLocations: true,
          share: true,
        },
      });

      plan.summary.totalFiles = files.length;

      for (const file of files) {
        const syncedLocation = file.storageLocations.find(loc => 
          loc.state === 'SYNCED' && loc.provider !== 'LOCAL'
        );
        
        const localLocation = file.storageLocations.find(loc => 
          loc.provider === 'LOCAL'
        );

        if (syncedLocation) {
          plan.summary.syncedFiles++;
          
          // Verificar si el archivo local existe físicamente
          const localExists = localLocation ? await this.checkLocalFileExists(localLocation.storedPath) : false;
          
          if (!localExists) {
            // Puede recuperarse desde remoto
            plan.recovery.canRecoverFromRemote++;
            plan.actions.push({
              id: `action-${file.id}`,
              type: 'download_from_remote',
              fileId: file.id,
              fileName: file.name,
              provider: syncedLocation.provider,
              status: 'pending',
            });
          }
        } else if (localLocation && localLocation.state === 'LOCAL_ONLY') {
          plan.summary.localOnlyFiles++;
          
          const localExists = await this.checkLocalFileExists(localLocation.storedPath);
          if (!localExists) {
            // Archivo perdido permanentemente
            plan.recovery.permanentlyLost++;
            plan.actions.push({
              id: `action-${file.id}`,
              type: 'mark_as_lost',
              fileId: file.id,
              fileName: file.name,
              status: 'pending',
            });
          }
        } else {
          // Archivo sin ubicaciones conocidas
          plan.summary.missingFiles++;
          plan.recovery.needManualIntervention++;
          plan.actions.push({
            id: `action-${file.id}`,
            type: 'recreate_metadata',
            fileId: file.id,
            fileName: file.name,
            status: 'pending',
          });
        }
      }

      // Calcular tiempo estimado (2 minutos por archivo a recuperar)
      plan.estimatedTimeMinutes = plan.recovery.canRecoverFromRemote * 2;
      plan.status = 'ready';
      
      this.activeRecoveryPlans.set(planId, plan);
      
      this.logger.log(`Recovery plan created: ${plan.recovery.canRecoverFromRemote} files can be recovered automatically`);
      
      return plan;
    } catch (error) {
      this.logger.error(`Failed to create recovery plan:`, error);
      plan.status = 'failed';
      throw error;
    }
  }

  /**
   * Ejecuta un plan de recuperación de forma completamente automatizada
   */
  async executeRecoveryPlan(planId: string, config?: Partial<AutoRecoveryConfig>): Promise<void> {
    const plan = this.activeRecoveryPlans.get(planId);
    if (!plan) {
      throw new Error(`Recovery plan ${planId} not found`);
    }

    if (plan.status !== 'ready') {
      throw new Error(`Recovery plan ${planId} is not ready for execution`);
    }

    const recoveryConfig: AutoRecoveryConfig = {
      enabled: true,
      maxConcurrentDownloads: 5,
      timeoutMinutes: 30,
      retryAttempts: 3,
      prioritizeRecentFiles: true,
      skipLargeFiles: false,
      maxFileSizeMB: 1000,
      ...config,
    };

    plan.status = 'executing';
    
    this.logger.log(`Executing recovery plan ${planId} with config:`, recoveryConfig);

    try {
      // Ordenar acciones por prioridad
      const sortedActions = this.prioritizeRecoveryActions(plan.actions, recoveryConfig);
      
      // Procesar acciones en lotes
      const batchSize = recoveryConfig.maxConcurrentDownloads;
      for (let i = 0; i < sortedActions.length; i += batchSize) {
        const batch = sortedActions.slice(i, i + batchSize);
        
        await Promise.allSettled(
          batch.map(action => this.executeRecoveryAction(action, recoveryConfig))
        );
        
        // Actualizar progreso cada lote
        this.logger.log(`Recovery progress: ${i + batch.length}/${sortedActions.length} actions processed`);
      }

      plan.status = 'completed';
      this.logger.log(`Recovery plan ${planId} completed successfully`);
      
    } catch (error) {
      plan.status = 'failed';
      this.logger.error(`Recovery plan ${planId} execution failed:`, error);
      throw error;
    }
  }

  /**
   * Ejecuta recuperación automática inmediata (sin plan previo)
   */
  async executeEmergencyRecovery(): Promise<RecoveryPlan> {
    this.logger.log('🚨 Executing emergency recovery...');
    
    const plan = await this.createRecoveryPlan();
    
    if (plan.recovery.canRecoverFromRemote > 0) {
      await this.executeRecoveryPlan(plan.id, {
        maxConcurrentDownloads: 10, // Más agresivo en emergencia
        timeoutMinutes: 60,
        prioritizeRecentFiles: true,
      });
    }
    
    return plan;
  }

  /**
   * Obtiene el estado de un plan de recuperación
   */
  getRecoveryPlan(planId: string): RecoveryPlan | null {
    return this.activeRecoveryPlans.get(planId) || null;
  }

  /**
   * Lista todos los planes de recuperación activos
   */
  listRecoveryPlans(): RecoveryPlan[] {
    return Array.from(this.activeRecoveryPlans.values());
  }

  private async executeRecoveryAction(action: RecoveryAction, config: AutoRecoveryConfig): Promise<void> {
    action.status = 'in_progress';
    
    try {
      switch (action.type) {
        case 'download_from_remote':
          await this.downloadFileFromRemote(action);
          break;
        
        case 'mark_as_lost':
          await this.markFileAsLost(action);
          break;
        
        case 'recreate_metadata':
          await this.recreateFileMetadata(action);
          break;
        
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }
      
      action.status = 'completed';
      
    } catch (error) {
      action.status = 'failed';
      action.errorMessage = error.message;
      this.logger.error(`Recovery action ${action.id} failed:`, error);
    }
  }

  private async downloadFileFromRemote(action: RecoveryAction): Promise<void> {
    const file = await this.prisma.file.findUnique({
      where: { id: action.fileId },
      include: { storageLocations: true },
    });

    if (!file) {
      throw new Error(`File ${action.fileId} not found in database`);
    }

    const remoteLocation = file.storageLocations.find(loc => 
      loc.provider === action.provider && loc.state === 'SYNCED'
    );

    if (!remoteLocation) {
      throw new Error(`No synced remote location found for file ${action.fileId}`);
    }

    const provider = this.storageFactory.getProvider(remoteLocation.provider as any);
    if (!provider) {
      throw new Error(`Provider ${remoteLocation.provider} not available`);
    }

    // Descargar desde remoto
    const stream = await provider.download(remoteLocation.storedPath);
    
    // Recrear archivo local
    const localPath = this.buildLocalPath(file.shareId, file.name);
    const localDir = path.dirname(localPath);
    
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    await this.streamToFile(stream, localPath);
    
    // Actualizar o crear ubicación local
    await this.prisma.fileStorageLocation.upsert({
      where: {
        fileId_provider: {
          fileId: action.fileId,
          provider: 'LOCAL',
        },
      },
      update: {
        storedPath: localPath,
        state: 'SYNCED',
        lastSyncAt: new Date(),
      },
      create: {
        fileId: action.fileId,
        provider: 'LOCAL',
        storedPath: localPath,
        state: 'SYNCED',
        lastSyncAt: new Date(),
        attempts: 1,
      },
    });

    this.logger.log(`✅ Recovered file ${file.name} from ${remoteLocation.provider}`);
  }

  private async markFileAsLost(action: RecoveryAction): Promise<void> {
    // Marcar archivo como perdido pero mantener metadata para referencia
    await this.prisma.fileStorageLocation.updateMany({
      where: { fileId: action.fileId, provider: 'LOCAL' },
      data: { 
        state: 'FAILED',
        errorMessage: 'File permanently lost - no remote backup available',
      },
    });

    this.logger.warn(`⚠️ File ${action.fileName} marked as permanently lost`);
  }

  private async recreateFileMetadata(action: RecoveryAction): Promise<void> {
    // Intentar recrear metadata escaneando ubicaciones remotas
    this.logger.log(`🔄 Attempting to recreate metadata for ${action.fileName}`);
    
    // Esta sería una implementación más compleja que escanearía
    // todos los proveedores remotos buscando el archivo
  }

  private prioritizeRecoveryActions(actions: RecoveryAction[], config: AutoRecoveryConfig): RecoveryAction[] {
    if (!config.prioritizeRecentFiles) {
      return actions;
    }

    // Ordenar dando prioridad a archivos de recuperación desde remoto
    return actions.sort((a, b) => {
      const priority = { 'download_from_remote': 1, 'recreate_metadata': 2, 'mark_as_lost': 3 };
      return priority[a.type] - priority[b.type];
    });
  }

  private async checkLocalFileExists(filePath: string): Promise<boolean> {
    try {
      const fullPath = path.resolve(filePath);
      return fs.existsSync(fullPath);
    } catch {
      return false;
    }
  }

  private buildLocalPath(shareId: string, fileName: string): string {
    const uploadsDir = this.configService.get<string>('UPLOADS_DIR', './data/uploads');
    return path.join(uploadsDir, 'shares', shareId, fileName);
  }

  private async streamToFile(stream: NodeJS.ReadableStream, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(filePath);
      stream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
  }
}