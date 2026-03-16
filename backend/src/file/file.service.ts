import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { LocalFileService } from "./local.service";
import { S3FileService } from "./s3.service";
import { ConfigService } from "src/config/config.service";
import { Readable } from "stream";
import { PrismaService } from "../prisma/prisma.service";
import * as fs from "fs/promises";
import * as path from "path";
import { SHARE_DIRECTORY } from "../constants";

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private prisma: PrismaService,
    private localFileService: LocalFileService,
    private s3FileService: S3FileService,
    private configService: ConfigService,
  ) {}

  // Determine which service to use based on the current config value
  // shareId is optional -> can be used to overwrite a storage provider
  private getStorageService(
    storageProvider?: string,
  ): S3FileService | LocalFileService {
    if (storageProvider != undefined)
      return storageProvider == "S3"
        ? this.s3FileService
        : this.localFileService;
    return this.configService.get("s3.enabled")
      ? this.s3FileService
      : this.localFileService;
  }

  async create(
    data: Buffer,
    chunk: { index: number; total: number },
    file: {
      id?: string;
      name: string;
    },
    shareId: string,
  ) {
    const storageService = this.getStorageService();
    return storageService.create(data, chunk, file, shareId);
  }

  async completeFile(
    shareId: string,
    fileId: string,
    fileName: string,
    totalChunks: number,
  ) {
    const storageService = this.getStorageService();
    // Only LocalFileService supports the complete method for now
    // TODO: Add S3 parallel upload support in a future spec
    if ("complete" in storageService) {
      return (storageService as LocalFileService).complete(
        shareId,
        fileId,
        fileName,
        totalChunks,
      );
    }
    throw new Error("Complete not supported for this storage provider");
  }

  async get(shareId: string, fileId: string): Promise<File> {
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
    });
    const storageService = this.getStorageService(share.storageProvider);
    return storageService.get(shareId, fileId);
  }

  async remove(shareId: string, fileId: string) {
    const storageService = this.getStorageService();
    return storageService.remove(shareId, fileId);
  }

  async deleteAllFiles(shareId: string) {
    const storageService = this.getStorageService();
    return storageService.deleteAllFiles(shareId);
  }

  async getZip(shareId: string): Promise<Readable> {
    const storageService = this.getStorageService();
    return await storageService.getZip(shareId);
  }

  async getByPublicToken(token: string): Promise<File> {
    const file = await this.prisma.file.findUnique({
      where: { publicToken: token },
      include: {
        share: {
          include: {
            creator: true,
          },
        },
      },
    });

    if (!file) {
      throw new Error("File not found");
    }

    const share = await this.prisma.share.findFirst({
      where: { id: file.shareId },
    });

    const storageService = this.getStorageService(share.storageProvider);
    const fileStream = await storageService.get(file.shareId, file.id);

    return {
      metaData: {
        id: file.id,
        size: file.size,
        createdAt: file.createdAt,
        mimeType: fileStream.metaData.mimeType,
        name: file.name,
        shareId: file.shareId,
        share: file.share,
      },
      file: fileStream.file,
    };
  }

  private async streamToUint8Array(stream: Readable): Promise<Uint8Array> {
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      stream.on("error", reject);
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupOrphanChunks() {
    try {
      const shareDirs = await fs.readdir(SHARE_DIRECTORY).catch(() => []);
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      let cleaned = 0;

      for (const shareDir of shareDirs) {
        const sharePath = path.join(SHARE_DIRECTORY, shareDir);
        const stat = await fs.stat(sharePath).catch(() => null);
        if (!stat?.isDirectory()) continue;

        const files = await fs.readdir(sharePath).catch(() => []);
        for (const file of files) {
          if (!file.includes(".chunk-") && !file.endsWith(".tmp-chunk"))
            continue;

          const filePath = path.join(sharePath, file);
          const fileStat = await fs.stat(filePath).catch(() => null);
          if (!fileStat) continue;

          if (fileStat.mtimeMs < oneHourAgo) {
            await fs.unlink(filePath).catch(() => {});
            cleaned++;
            this.logger.log(`Cleaned orphan chunk: ${shareDir}/${file}`);
          }
        }
      }

      if (cleaned > 0) {
        this.logger.log(`Cleaned ${cleaned} orphan chunk(s)`);
      }
    } catch (error) {
      this.logger.error("Error cleaning orphan chunks", error);
    }
  }
}

export interface File {
  metaData: {
    id: string;
    size: string;
    createdAt: Date;
    mimeType: string | false;
    name: string;
    shareId: string;
    share?: {
      emailNotification: boolean;
      creator?: {
        email: string;
      };
    };
  };
  file: Readable;
}
