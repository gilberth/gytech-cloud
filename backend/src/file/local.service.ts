import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { finished } from "stream/promises";
import * as fs from "fs/promises";
import * as mime from "mime-types";
import { ConfigService } from "src/config/config.service";
import { PrismaService } from "src/prisma/prisma.service";
import { validate as isValidUUID } from "uuid";
import { SHARE_DIRECTORY } from "../constants";
import { Readable } from "stream";

@Injectable()
export class LocalFileService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async create(
    data: Buffer,
    chunk: { index: number; total: number },
    file: { id?: string; name: string },
    shareId: string,
  ) {
    if (!file.id) {
      throw new BadRequestException("File ID is required (generate client-side)");
    } else if (!isValidUUID(file.id)) {
      throw new BadRequestException("Invalid file ID format");
    }

    // Validate chunk index
    if (chunk.index < 0 || chunk.index >= chunk.total) {
      throw new BadRequestException("Invalid chunk index");
    }

    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
    });

    if (!share) throw new NotFoundException("Share not found");
    if (share.uploadLocked)
      throw new BadRequestException("Share is already completed");

    // Check disk space
    const space = await fs.statfs(SHARE_DIRECTORY);
    const availableSpace = space.bavail * space.bsize;
    if (availableSpace < data.byteLength) {
      throw new InternalServerErrorException("Not enough space on the server");
    }

    // Ensure share directory exists
    await fs.mkdir(`${SHARE_DIRECTORY}/${shareId}`, { recursive: true });

    // Write chunk as individual file
    const chunkPath = `${SHARE_DIRECTORY}/${shareId}/${file.id}.chunk-${chunk.index}`;
    await fs.writeFile(chunkPath, data);

    return { id: file.id, name: file.name };
  }

  async complete(
    shareId: string,
    fileId: string,
    fileName: string,
    totalChunks: number,
  ) {
    // Idempotency: if file record already exists, return it
    const existing = await this.prisma.file.findUnique({
      where: { id: fileId },
    });
    if (existing) {
      return { id: existing.id, name: existing.name, size: existing.size };
    }

    const chunkDir = `${SHARE_DIRECTORY}/${shareId}`;

    // Verify all chunks exist
    for (let i = 0; i < totalChunks; i++) {
      try {
        await fs.access(`${chunkDir}/${fileId}.chunk-${i}`);
      } catch {
        throw new BadRequestException(
          `Missing chunk ${i} of ${totalChunks}`,
        );
      }
    }

    // Stream-based assembly using pipe with { end: false }
    const finalPath = `${chunkDir}/${fileId}`;
    const writeStream = createWriteStream(finalPath);

    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = `${chunkDir}/${fileId}.chunk-${i}`;
      const readStream = createReadStream(chunkPath);
      readStream.pipe(writeStream, { end: false });
      await new Promise<void>((resolve, reject) => {
        readStream.on("end", resolve);
        readStream.on("error", reject);
      });
    }
    writeStream.end();
    await finished(writeStream);

    // Verify assembled file size
    const finalSize = (await fs.stat(finalPath)).size;

    // Share size validation
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      include: { files: true, reverseShare: true },
    });

    const existingFilesSize = share.files.reduce(
      (sum, f) => sum + parseInt(f.size),
      0,
    );
    const totalShareSize = existingFilesSize + finalSize;

    if (totalShareSize > this.config.get("share.maxSize")) {
      await fs.unlink(finalPath).catch(() => {});
      throw new HttpException(
        "Max share size exceeded",
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    if (
      share.reverseShare?.maxShareSize &&
      totalShareSize > parseInt(share.reverseShare.maxShareSize)
    ) {
      await fs.unlink(finalPath).catch(() => {});
      throw new HttpException(
        "Max share size exceeded",
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // Delete chunk files (safe — final file is verified)
    for (let i = 0; i < totalChunks; i++) {
      await fs
        .unlink(`${chunkDir}/${fileId}.chunk-${i}`)
        .catch(() => {});
    }

    // Create DB record
    await this.prisma.file.create({
      data: {
        id: fileId,
        name: fileName,
        size: finalSize.toString(),
        share: { connect: { id: shareId } },
      },
    });

    return { id: fileId, name: fileName, size: finalSize.toString() };
  }

  async get(shareId: string, fileId: string) {
    const fileMetaData = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!fileMetaData) throw new NotFoundException("File not found");

    const file = createReadStream(`${SHARE_DIRECTORY}/${shareId}/${fileId}`);

    return {
      metaData: {
        mimeType: mime.contentType(fileMetaData.name.split(".").pop()),
        ...fileMetaData,
        size: fileMetaData.size,
      },
      file,
    };
  }

  async remove(shareId: string, fileId: string) {
    const fileMetaData = await this.prisma.file.findUnique({
      where: { id: fileId },
    });

    if (!fileMetaData) throw new NotFoundException("File not found");

    await fs.unlink(`${SHARE_DIRECTORY}/${shareId}/${fileId}`);

    await this.prisma.file.delete({ where: { id: fileId } });
  }

  async deleteAllFiles(shareId: string) {
    await fs.rm(`${SHARE_DIRECTORY}/${shareId}`, {
      recursive: true,
      force: true,
    });
  }

  async getZip(shareId: string): Promise<Readable> {
    return new Promise((resolve, reject) => {
      const zipStream = createReadStream(
        `${SHARE_DIRECTORY}/${shareId}/archive.zip`,
      );

      zipStream.on("error", (err) => {
        reject(new InternalServerErrorException(err));
      });

      zipStream.on("open", () => {
        resolve(zipStream);
      });
    });
  }
}
