import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { LocalFileService } from "./local.service";
import { S3FileService } from "./s3.service";
import { ConfigService } from "src/config/config.service";
import { Readable } from "stream";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    private prisma: PrismaService,
    private localFileService: LocalFileService,
    private s3FileService: S3FileService,
    private configService: ConfigService,
  ) {}

  async create(
    data: string,
    chunk: { index: number; total: number },
    file: {
      id?: string;
      name: string;
    },
    shareId: string,
  ) {
    return this.localFileService.create(data, chunk, file, shareId);
  }

  async get(shareId: string, fileId: string) {
    return this.localFileService.get(shareId, fileId);
  }

  async remove(shareId: string, fileId: string) {
    return this.localFileService.remove(shareId, fileId);
  }

  async deleteAllFiles(shareId: string) {
    return this.localFileService.deleteAllFiles(shareId);
  }

  async getZip(shareId: string): Promise<Readable> {
    return this.localFileService.getZip(shareId);
  }

  async createZip(shareId: string): Promise<void> {
    return this.localFileService.createZip(shareId);
  }

  async deleteZip(shareId: string): Promise<void> {
    return this.localFileService.deleteZip(shareId);
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
  };
  file: Readable;
}