import { Injectable } from "@nestjs/common";
import { LocalFileService } from "./local.service";
import { S3FileService } from "./s3.service";
import { ConfigService } from "src/config/config.service";
import { Readable } from "stream";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class FileService {
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
    data: string,
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
