import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { AdministratorGuard } from "src/auth/guard/isAdmin.guard";
import { JwtGuard } from "src/auth/guard/jwt.guard";
import { PrismaService } from "src/prisma/prisma.service";
import { FileService } from "./file.service";
import { StorageProvider, MigrationResult } from "./storage/cloud-storage.interface";
import { EventEmitter } from "events";

interface MigrationRequest {
  shareIds: string[];
  targetProvider: StorageProvider;
  targetConfig?: Record<string, any>;
}

interface MigrationStatus {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  totalFiles: number;
  migratedFiles: number;
  failedFiles: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  result?: MigrationResult;
}

/**
 * Controller for managing file migrations between storage providers
 */
@Controller("admin/migration")
@UseGuards(JwtGuard, AdministratorGuard)
export class MigrationController extends EventEmitter {
  private migrations = new Map<string, MigrationStatus>();

  constructor(
    private prisma: PrismaService,
    private fileService: FileService,
  ) {
    super();
  }

  /**
   * Get all shares and their storage providers for migration planning
   */
  @Get("shares")
  async getMigrationCandidates() {
    const shares = await this.prisma.share.findMany({
      select: {
        id: true,
        name: true,
        storageProvider: true,
        createdAt: true,
        _count: {
          select: {
            files: true,
          },
        },
        files: {
          select: {
            size: true,
          },
        },
      },
    });

    return shares.map(share => ({
      id: share.id,
      name: share.name || `Share ${share.id}`,
      storageProvider: share.storageProvider,
      createdAt: share.createdAt,
      fileCount: share._count.files,
      totalSize: share.files.reduce((sum, file) => sum + parseInt(file.size), 0),
    }));
  }

  /**
   * Start migration of shares to a different storage provider
   */
  @Post("start")
  async startMigration(@Body() request: MigrationRequest) {
    const migrationId = this.generateMigrationId();
    
    // Validate shares exist
    const shares = await this.prisma.share.findMany({
      where: {
        id: { in: request.shareIds },
      },
      include: {
        files: true,
      },
    });

    if (shares.length !== request.shareIds.length) {
      throw new NotFoundException("Some shares not found");
    }

    const totalFiles = shares.reduce((sum, share) => sum + share.files.length, 0);
    
    const migrationStatus: MigrationStatus = {
      id: migrationId,
      status: 'pending',
      progress: 0,
      totalFiles,
      migratedFiles: 0,
      failedFiles: 0,
      startedAt: new Date(),
    };

    this.migrations.set(migrationId, migrationStatus);

    // Start migration asynchronously
    setImmediate(() => this.performMigration(migrationId, request));

    return {
      migrationId,
      status: migrationStatus,
    };
  }

  /**
   * Get migration status
   */
  @Get("status")
  async getMigrationStatus(@Query("id") migrationId: string) {
    const status = this.migrations.get(migrationId);
    if (!status) {
      throw new NotFoundException("Migration not found");
    }
    return status;
  }

  /**
   * Get all migration statuses
   */
  @Get("status/all")
  async getAllMigrationStatuses() {
    return Array.from(this.migrations.values());
  }

  /**
   * Cancel a running migration
   */
  @Post("cancel")
  async cancelMigration(@Body() body: { migrationId: string }) {
    const status = this.migrations.get(body.migrationId);
    if (!status) {
      throw new NotFoundException("Migration not found");
    }

    if (status.status === 'running') {
      status.status = 'failed';
      status.error = 'Migration cancelled by user';
      status.completedAt = new Date();
      
      this.emit('migrationCancelled', body.migrationId);
      
      return { message: 'Migration cancelled' };
    }
    
    throw new BadRequestException('Migration cannot be cancelled in current state');
  }

  /**
   * Perform the actual migration
   */
  private async performMigration(migrationId: string, request: MigrationRequest) {
    const status = this.migrations.get(migrationId)!
    
    try {
      status.status = 'running';
      
      const results: MigrationResult[] = [];
      let totalMigrated = 0;
      let totalFailed = 0;

      for (const shareId of request.shareIds) {
        try {
          const result = await this.fileService.migrateShare(
            shareId,
            request.targetProvider,
            request.targetConfig
          );
          
          results.push(result);
          totalMigrated += result.migratedFiles.length;
          totalFailed += result.failedFiles.length;
          
          // Update progress
          status.migratedFiles = totalMigrated;
          status.failedFiles = totalFailed;
          status.progress = Math.round(
            ((totalMigrated + totalFailed) / status.totalFiles) * 100
          );
          
          this.emit('migrationProgress', {
            migrationId,
            progress: status.progress,
            migratedFiles: totalMigrated,
            failedFiles: totalFailed,
          });
          
        } catch (error) {
          totalFailed += 1;
          results.push({
            success: false,
            migratedFiles: [],
            failedFiles: [{ fileId: shareId, error: error.message }],
            totalSize: 0,
          });
        }
      }
      
      // Combine results
      const combinedResult: MigrationResult = {
        success: totalFailed === 0,
        migratedFiles: results.flatMap(r => r.migratedFiles),
        failedFiles: results.flatMap(r => r.failedFiles),
        totalSize: results.reduce((sum, r) => sum + r.totalSize, 0),
      };
      
      status.status = 'completed';
      status.completedAt = new Date();
      status.result = combinedResult;
      status.progress = 100;
      
      this.emit('migrationCompleted', {
        migrationId,
        result: combinedResult,
      });
      
    } catch (error) {
      status.status = 'failed';
      status.error = error.message || 'Unknown error occurred';
      status.completedAt = new Date();
      
      this.emit('migrationFailed', {
        migrationId,
        error: status.error,
      });
    }
  }

  /**
   * Generate unique migration ID
   */
  private generateMigrationId(): string {
    return `migration_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get shares by storage provider for bulk operations
   */
  @Get("shares/by-provider")
  async getSharesByProvider(@Query("provider") provider: string) {
    if (!provider) {
      throw new BadRequestException("Provider parameter is required");
    }

    const shares = await this.prisma.share.findMany({
      where: {
        storageProvider: provider,
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: {
          select: {
            files: true,
          },
        },
        files: {
          select: {
            size: true,
          },
        },
      },
    });

    return shares.map(share => ({
      id: share.id,
      name: share.name || `Share ${share.id}`,
      createdAt: share.createdAt,
      fileCount: share._count.files,
      totalSize: share.files.reduce((sum, file) => sum + parseInt(file.size), 0),
    }));
  }

  /**
   * Cleanup completed migrations older than 24 hours
   */
  @Post("cleanup")
  async cleanupOldMigrations() {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    let cleaned = 0;

    for (const [id, status] of this.migrations.entries()) {
      if (
        status.status === 'completed' && 
        status.completedAt && 
        status.completedAt < cutoffTime
      ) {
        this.migrations.delete(id);
        cleaned++;
      }
    }

    return { cleaned };
  }

  /**
   * Get migration statistics
   */
  @Get("stats")
  async getMigrationStats() {
    const allMigrations = Array.from(this.migrations.values());
    
    return {
      total: allMigrations.length,
      pending: allMigrations.filter(m => m.status === 'pending').length,
      running: allMigrations.filter(m => m.status === 'running').length,
      completed: allMigrations.filter(m => m.status === 'completed').length,
      failed: allMigrations.filter(m => m.status === 'failed').length,
      totalFilesMigrated: allMigrations.reduce((sum, m) => sum + m.migratedFiles, 0),
      totalFilesFailed: allMigrations.reduce((sum, m) => sum + m.failedFiles, 0),
    };
  }
}