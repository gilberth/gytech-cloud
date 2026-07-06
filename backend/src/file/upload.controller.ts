import {
  Controller,
  Put,
  Param,
  Req,
  Res,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Request, Response } from "express";
import * as crypto from "crypto";
import { ConfigService } from "src/config/config.service";
import { PrismaService } from "src/prisma/prisma.service";
import { ReverseShareService } from "src/reverseShare/reverseShare.service";
import { ShareService } from "src/share/share.service";
import { sanitizeFilename } from "src/utils/filename.util";
import { FileService } from "./file.service";

@Controller("upload")
export class UploadController {
  constructor(
    private reverseShareService: ReverseShareService,
    private shareService: ShareService,
    private fileService: FileService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  @Put(":token/:filename")
  @SkipThrottle()
  async upload(
    @Param("token") token: string,
    @Param("filename") rawFilename: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const isValid = await this.reverseShareService.isValid(token);
    if (!isValid) {
      res
        .status(HttpStatus.FORBIDDEN)
        .type("text/plain")
        .send("Reverse share token not found, expired, or exhausted\n");
      return;
    }

    let filename: string;
    try {
      filename = sanitizeFilename(rawFilename);
    } catch {
      res
        .status(HttpStatus.BAD_REQUEST)
        .type("text/plain")
        .send("Invalid filename\n");
      return;
    }

    const reverseShare = await this.reverseShareService.getByToken(token);
    const maxBytes = Math.min(
      parseInt(reverseShare.maxShareSize),
      this.config.get("share.maxSize"),
    );

    const shareId = crypto.randomUUID();
    const fileId = crypto.randomUUID();

    await this.shareService.create(
      {
        id: shareId,
        expiration: "0-days",
        recipients: [],
        security: undefined,
      } as any,
      undefined,
      token,
    );

    try {
      await this.fileService.createFromStream(
        req,
        { id: fileId, name: filename },
        shareId,
        maxBytes,
      );
      await this.shareService.complete(shareId, token);
    } catch (e) {
      await this.fileService.deleteAllFiles(shareId).catch(() => {});
      await this.prisma.share.delete({ where: { id: shareId } }).catch(() => {});

      const status =
        e instanceof HttpException ? e.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
      const message = e instanceof HttpException ? e.message : "Upload failed";
      res.status(status).type("text/plain").send(`${message}\n`);
      return;
    }

    const appUrl = this.config.get("general.appUrl");
    res
      .status(HttpStatus.CREATED)
      .type("text/plain")
      .send(`${appUrl}/s/${shareId}\n`);
  }
}
