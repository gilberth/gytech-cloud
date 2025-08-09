import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageFactoryService, StorageProviderType } from './storage-factory.service';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface DrStatusDto {
  lastSnapshotAt: string | null;
  rpoSeconds: number | null;
  divergenceRatio: number | null;
  walEnabled: boolean;
  snapshotsCount: number;
  nextPlannedSnapshotAt: string | null;
  circuitStates: Record<string, "CLOSED" | "OPEN" | "DEGRADED">;
}

export interface DrSnapshotDto {
  id: string;
  createdAt: string;
  sizeBytes: number;
  hash: string;
  sequence: number;
  protected: boolean;
  state: "READY" | "PARTIAL" | "VALIDATING";
}

export interface DrConfigDto {
  snapshotIntervalMinutes: number;
  retention: { hourly: number; daily: number; weekly: number };
  walDeltaEnabled: boolean;
  integritySamplePercent: number;
}

export interface ManifestData {
  version: number;
  latestDbSnapshot: string;
  dbHash: string;
  sequence: number;
  walDeltas: string[];
  filesManifests: string[];
}

@Injectable()
export class DrService {
  private readonly logger = new Logger(DrService.name);
  private readonly backupPath: string;
  private lastSnapshotTime: Date | null = null;
  private snapshotSequence = 0;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private storageFactory: StorageFactoryService,
  ) {
    this.backupPath = this.configService.get<string>('DR_BACKUP_PATH', './data/backups');
    this.ensureBackupDirectory();
  }

  private ensureBackupDirectory() {
    if (!fs.existsSync(this.backupPath)) {
      fs.mkdirSync(this.backupPath, { recursive: true });
      this.logger.log(`Created backup directory: ${this.backupPath}`);
    }
  }

  async getStatus(): Promise<DrStatusDto> {
    const config = await this.getConfig();
    const snapshots = await this.listSnapshots();
    const providerHealth = this.storageFactory.getAllProviderHealth();
    
    const circuitStates: Record<string, "CLOSED" | "OPEN" | "DEGRADED"> = {};
    providerHealth.forEach(health => {
      circuitStates[health.provider] = health.healthy ? "CLOSED" : "OPEN";
    });

    const nextSnapshot = this.lastSnapshotTime ? 
      new Date(this.lastSnapshotTime.getTime() + config.snapshotIntervalMinutes * 60 * 1000) :
      new Date();

    return {
      lastSnapshotAt: this.lastSnapshotTime?.toISOString() || null,
      rpoSeconds: this.lastSnapshotTime ? 
        Math.floor((Date.now() - this.lastSnapshotTime.getTime()) / 1000) : 
        null,
      divergenceRatio: await this.calculateDivergenceRatio(),
      walEnabled: config.walDeltaEnabled,
      snapshotsCount: snapshots.length,
      nextPlannedSnapshotAt: nextSnapshot.toISOString(),
      circuitStates,
    };
  }

  async createSnapshot(force = false): Promise<DrSnapshotDto> {
    const config = await this.getConfig();
    const now = new Date();
    
    if (!force && this.lastSnapshotTime) {
      const timeSinceLastSnapshot = now.getTime() - this.lastSnapshotTime.getTime();
      const intervalMs = config.snapshotIntervalMinutes * 60 * 1000;
      
      if (timeSinceLastSnapshot < intervalMs) {
        throw new Error(`Snapshot created too recently. Wait ${Math.ceil((intervalMs - timeSinceLastSnapshot) / 60000)} minutes.`);
      }
    }

    this.snapshotSequence++;
    const snapshotId = `db-${now.toISOString().replace(/[:.]/g, '-')}-${this.snapshotSequence}`;
    const snapshotPath = path.join(this.backupPath, `${snapshotId}.sqlite.gz`);

    try {
      this.logger.log(`Creating snapshot ${snapshotId}...`);
      
      // 1. Flush WAL and create compressed snapshot
      const dbPath = this.configService.get<string>('DATABASE_URL', '').replace('file:', '');
      const actualDbPath = path.resolve(dbPath);
      
      if (fs.existsSync(actualDbPath)) {
        // Simple file copy for now (in production, use proper SQLite backup)
        const buffer = fs.readFileSync(actualDbPath);
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        
        // Write to temporary file first, then rename atomically
        const tempPath = `${snapshotPath}.partial`;
        fs.writeFileSync(tempPath, buffer);
        fs.renameSync(tempPath, snapshotPath);
        
        // 2. Update manifest
        await this.updateManifest(snapshotId, hash);
        
        // 3. Upload to remote if configured
        await this.uploadSnapshotToRemote(snapshotPath, snapshotId);
        
        this.lastSnapshotTime = now;
        
        const snapshot: DrSnapshotDto = {
          id: snapshotId,
          createdAt: now.toISOString(),
          sizeBytes: buffer.length,
          hash,
          sequence: this.snapshotSequence,
          protected: false,
          state: "READY",
        };
        
        this.logger.log(`Snapshot ${snapshotId} created successfully`);
        
        // 4. Cleanup old snapshots based on retention policy
        await this.cleanupOldSnapshots(config.retention);
        
        return snapshot;
      } else {
        throw new Error(`Database file not found: ${actualDbPath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to create snapshot ${snapshotId}:`, error);
      
      // Cleanup partial files
      if (fs.existsSync(`${snapshotPath}.partial`)) {
        fs.unlinkSync(`${snapshotPath}.partial`);
      }
      
      throw error;
    }
  }

  async listSnapshots(): Promise<DrSnapshotDto[]> {
    const snapshots: DrSnapshotDto[] = [];
    
    if (!fs.existsSync(this.backupPath)) {
      return snapshots;
    }
    
    const files = fs.readdirSync(this.backupPath)
      .filter(file => file.endsWith('.sqlite.gz'))
      .sort((a, b) => b.localeCompare(a)); // Most recent first

    for (const file of files) {
      const filePath = path.join(this.backupPath, file);
      const stats = fs.statSync(filePath);
      const snapshotId = file.replace('.sqlite.gz', '');
      
      // Extract sequence from filename
      const sequenceMatch = snapshotId.match(/-(\d+)$/);
      const sequence = sequenceMatch ? parseInt(sequenceMatch[1]) : 0;
      
      snapshots.push({
        id: snapshotId,
        createdAt: stats.ctime.toISOString(),
        sizeBytes: stats.size,
        hash: await this.calculateFileHash(filePath),
        sequence,
        protected: false, // TODO: Implement protection logic
        state: "READY",
      });
    }
    
    return snapshots;
  }

  async getConfig(): Promise<DrConfigDto> {
    return {
      snapshotIntervalMinutes: this.configService.get<number>('DR_SNAPSHOT_INTERVAL_MINUTES', 60),
      retention: {
        hourly: this.configService.get<number>('DR_RETENTION_HOURLY', 24),
        daily: this.configService.get<number>('DR_RETENTION_DAILY', 7),
        weekly: this.configService.get<number>('DR_RETENTION_WEEKLY', 4),
      },
      walDeltaEnabled: this.configService.get<boolean>('DR_WAL_DELTA_ENABLED', false),
      integritySamplePercent: this.configService.get<number>('DR_INTEGRITY_SAMPLE_PERCENT', 5),
    };
  }

  async updateConfig(config: Partial<DrConfigDto>): Promise<DrConfigDto> {
    // In a real implementation, this would update the configuration
    // For now, just return the current config
    this.logger.log(`DR configuration update requested:`, config);
    return await this.getConfig();
  }

  async simulateRestore(snapshotId: string): Promise<{
    operationId: string;
    status: 'running' | 'completed' | 'failed';
    details?: any;
  }> {
    const operationId = `restore-sim-${Date.now()}`;
    
    this.logger.log(`Starting restore simulation for snapshot ${snapshotId} (operation ${operationId})`);
    
    // Simulate restore process
    setTimeout(async () => {
      try {
        const snapshot = (await this.listSnapshots()).find(s => s.id === snapshotId);
        if (!snapshot) {
          throw new Error(`Snapshot ${snapshotId} not found`);
        }
        
        this.logger.log(`Restore simulation ${operationId} completed successfully`);
      } catch (error) {
        this.logger.error(`Restore simulation ${operationId} failed:`, error);
      }
    }, 5000);
    
    return {
      operationId,
      status: 'running',
      details: {
        snapshotId,
        startedAt: new Date().toISOString(),
      },
    };
  }

  private async updateManifest(snapshotId: string, dbHash: string): Promise<void> {
    const manifestPath = path.join(this.backupPath, 'manifest.json');
    
    const manifest: ManifestData = {
      version: 1,
      latestDbSnapshot: `${snapshotId}.sqlite.gz`,
      dbHash,
      sequence: this.snapshotSequence,
      walDeltas: [], // TODO: Implement WAL delta tracking
      filesManifests: [], // TODO: Implement file manifest tracking
    };
    
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    this.logger.log(`Updated manifest for snapshot ${snapshotId}`);
  }

  private async uploadSnapshotToRemote(snapshotPath: string, snapshotId: string): Promise<void> {
    const provider = this.storageFactory.getPrimaryProvider();
    if (!provider) {
      this.logger.warn('No primary provider available for remote snapshot upload');
      return;
    }
    
    try {
      const readStream = fs.createReadStream(snapshotPath);
      
      await provider.upload({
        stream: readStream,
        path: `backups/db/${path.basename(snapshotPath)}`,
      });
      
      this.logger.log(`Uploaded snapshot ${snapshotId} to remote storage`);
    } catch (error) {
      this.logger.error(`Failed to upload snapshot ${snapshotId} to remote:`, error);
      // Don't fail the snapshot creation if remote upload fails
    }
  }

  private async cleanupOldSnapshots(retention: DrConfigDto['retention']): Promise<void> {
    const snapshots = await this.listSnapshots();
    const now = new Date();
    
    // Simple retention: keep last N snapshots
    const maxSnapshots = retention.hourly + retention.daily + retention.weekly;
    
    if (snapshots.length > maxSnapshots) {
      const toDelete = snapshots.slice(maxSnapshots);
      
      for (const snapshot of toDelete) {
        try {
          const snapshotPath = path.join(this.backupPath, `${snapshot.id}.sqlite.gz`);
          if (fs.existsSync(snapshotPath)) {
            fs.unlinkSync(snapshotPath);
            this.logger.log(`Deleted old snapshot ${snapshot.id}`);
          }
        } catch (error) {
          this.logger.error(`Failed to delete snapshot ${snapshot.id}:`, error);
        }
      }
    }
  }

  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private async calculateDivergenceRatio(): Promise<number | null> {
    // Simplified implementation
    // In a real system, this would compare checksums between local and remote files
    try {
      const totalFiles = await this.prisma.file.count();
      const syncedFiles = await this.prisma.fileStorageLocation.count({
        where: { state: 'SYNCED' },
      });
      
      if (totalFiles === 0) return null;
      
      return Math.max(0, 1 - (syncedFiles / totalFiles));
    } catch (error) {
      this.logger.error('Failed to calculate divergence ratio:', error);
      return null;
    }
  }
}