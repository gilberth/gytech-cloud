import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { constants as fsConstants, createReadStream } from "fs";
import * as fs from "fs/promises";
import * as mime from "mime-types";
import { ConfigService } from "src/config/config.service";
import { PrismaService } from "src/prisma/prisma.service";
import { validate as isValidUUID } from "uuid";
import { SHARE_DIRECTORY } from "../constants";
import { Readable } from "stream";

@Injectable()
export class LocalFileService {
  private readonly logger = new Logger(LocalFileService.name);

  // Track received chunks per file for parallel upload support
  private chunkTracker: Record<
    string,
    { received: Set<number>; total: number }
  > = {};

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async create(
    data: string,
    chunk: { index: number; total: number },
    file: { id?: string; name: string },
    shareId: string,
  ) {
    if (!file.id) {
      file.id = crypto.randomUUID();
    } else if (!isValidUUID(file.id)) {
      throw new BadRequestException("Invalid file ID format");
    }

    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      include: { files: true, reverseShare: true },
    });

    if (share.uploadLocked)
      throw new BadRequestException("Share is already completed");

    // Validate chunk index is not a duplicate
    const trackerKey = `${shareId}/${file.id}`;
    if (!this.chunkTracker[trackerKey]) {
      this.chunkTracker[trackerKey] = {
        received: new Set(),
        total: chunk.total,
      };
    }
    const tracker = this.chunkTracker[trackerKey];

    if (tracker.received.has(chunk.index)) {
      throw new BadRequestException({
        message: "Duplicate chunk received",
        error: "duplicate_chunk",
        chunkIndex: chunk.index,
      });
    }

    const buffer = Buffer.from(data, "base64");

    // Check if there is enough space on the server
    const space = await fs.statfs(SHARE_DIRECTORY);
    const availableSpace = space.bavail * space.bsize;
    if (availableSpace < buffer.byteLength) {
      throw new InternalServerErrorException("Not enough space on the server");
    }

    // Check if share size limit is exceeded
    const fileSizeSum = share.files.reduce(
      (n, { size }) => n + parseInt(size),
      0,
    );

    let diskFileSize: number;
    try {
      diskFileSize = (
        await fs.stat(`${SHARE_DIRECTORY}/${shareId}/${file.id}.tmp-chunk`)
      ).size;
    } catch {
      diskFileSize = 0;
    }

    const shareSizeSum = fileSizeSum + diskFileSize + buffer.byteLength;

    if (
      shareSizeSum > this.config.get("share.maxSize") ||
      (share.reverseShare?.maxShareSize &&
        shareSizeSum > parseInt(share.reverseShare.maxShareSize))
    ) {
      throw new HttpException(
        "Max share size exceeded",
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // Write chunk at the correct offset (supports out-of-order/parallel uploads)
    const chunkSize = this.config.get("share.chunkSize");
    const offset = chunk.index * chunkSize;
    const tmpPath = `${SHARE_DIRECTORY}/${shareId}/${file.id}.tmp-chunk`;

    await fs.mkdir(`${SHARE_DIRECTORY}/${shareId}`, { recursive: true });

    // Open for read/write, create if not exists, no truncation
    // O_RDWR | O_CREAT is safe for concurrent access (no race condition)
    const fd = await fs.open(
      tmpPath,
      fsConstants.O_RDWR | fsConstants.O_CREAT,
    );
    try {
      await fd.write(buffer, 0, buffer.byteLength, offset);
    } finally {
      await fd.close();
    }

    // Mark chunk as received
    tracker.received.add(chunk.index);

    // Check if all chunks have been received
    const allChunksReceived = tracker.received.size === chunk.total;

    if (allChunksReceived) {
      await fs.rename(tmpPath, `${SHARE_DIRECTORY}/${shareId}/${file.id}`);
      const fileSize = (
        await fs.stat(`${SHARE_DIRECTORY}/${shareId}/${file.id}`)
      ).size;
      await this.prisma.file.create({
        data: {
          id: file.id,
          name: file.name,
          size: fileSize.toString(),
          share: { connect: { id: shareId } },
        },
      });

      // Clean up tracker
      delete this.chunkTracker[trackerKey];
    }

    return file;
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
