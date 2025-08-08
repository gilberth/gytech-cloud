import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
  NotFoundException,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import * as contentDisposition from "content-disposition";
import { Response } from "express";
import { CreateShareGuard } from "src/share/guard/createShare.guard";
import { ShareOwnerGuard } from "src/share/guard/shareOwner.guard";
import { FileService } from "./file.service";
import { FileSecurityGuard } from "./guard/fileSecurity.guard";
import * as mime from "mime-types";
import * as moment from "moment";
import { PrismaService } from "src/prisma/prisma.service";

@Controller("shares/:shareId/files")
export class FileController {
  constructor(
    private fileService: FileService,
    private prisma: PrismaService,
  ) {}

  @Post()
  @SkipThrottle()
  @UseGuards(CreateShareGuard, ShareOwnerGuard)
  async create(
    @Query()
    query: {
      id: string;
      name: string;
      chunkIndex: string;
      totalChunks: string;
    },
    @Body() body: string,
    @Param("shareId") shareId: string,
  ) {
    const { id, name, chunkIndex, totalChunks } = query;

    // Data can be empty if the file is empty
    return await this.fileService.create(
      body,
      { index: parseInt(chunkIndex), total: parseInt(totalChunks) },
      { id, name },
      shareId,
    );
  }

  @Get("zip")
  @UseGuards(FileSecurityGuard)
  async getZip(
    @Res({ passthrough: true }) res: Response,
    @Param("shareId") shareId: string,
  ) {
    const zipStream = await this.fileService.getZip(shareId);

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(`${shareId}.zip`),
    });

    return new StreamableFile(zipStream);
  }

  @Get(":fileId/metadata")
  async getFileMetadata(
    @Param("shareId") shareId: string,
    @Param("fileId") fileId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    console.log(`[DEBUG] Metadata request for share: ${shareId}, file: ${fileId}`);
    
    // Custom lightweight security check for metadata endpoint
    // This allows public shares to get metadata without JWT requirement
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
      include: { security: true },
    });

    if (!share) {
      console.log(`[DEBUG] Share not found: ${shareId}`);
      throw new NotFoundException("Share not found");
    }

    console.log(`[DEBUG] Share found: ${share.id}, expired: ${moment().isAfter(share.expiration)}`);

    // Check if share is expired
    if (moment().isAfter(share.expiration) && !moment(share.expiration).isSame(0)) {
      console.log(`[DEBUG] Share expired: ${shareId}`);
      throw new NotFoundException("Share expired");
    }

    // For password protected shares, we still allow metadata access
    // The actual file access will be protected by FileSecurityGuard
    
    const file = await this.fileService.get(shareId, fileId);
    const mimeType = mime?.lookup?.(file.metaData.name) || "application/octet-stream";
    
    const result = {
      id: fileId,
      name: file.metaData.name,
      size: file.metaData.size,
      mimeType,
      supportsPreview: this.supportsPreview(mimeType, file.metaData.name),
      previewType: this.getPreviewType(mimeType, file.metaData.name),
    };
    
    console.log(`[DEBUG] Returning metadata:`, result);
    return result;
  }

  @Get(":fileId/:filename")
  @UseGuards(FileSecurityGuard)
  async getFileWithName(
    @Res({ passthrough: true }) res: Response,
    @Param("shareId") shareId: string,
    @Param("fileId") fileId: string,
    @Param("filename") filename: string,
    @Query("download") download = "true",
    @Query("preview") preview?: string,
  ) {
    // Same implementation as getFile, filename is just for SEO/UX
    return this.getFileImplementation(res, shareId, fileId, download, preview);
  }

  @Get(":fileId")
  @UseGuards(FileSecurityGuard)
  async getFile(
    @Res({ passthrough: true }) res: Response,
    @Param("shareId") shareId: string,
    @Param("fileId") fileId: string,
    @Query("download") download = "true",
    @Query("preview") preview?: string,
  ) {
    return this.getFileImplementation(res, shareId, fileId, download, preview);
  }

  private async getFileImplementation(
    res: Response,
    shareId: string,
    fileId: string,
    download: string = "true",
    preview?: string,
  ) {
    const file = await this.fileService.get(shareId, fileId);
    const mimeType = mime?.lookup?.(file.metaData.name) || "application/octet-stream";

    const headers = {
      "Content-Type": mimeType,
      "Content-Length": file.metaData.size,
      "Accept-Ranges": "bytes",
    };

    // Enhanced security headers for preview mode
    if (preview === "true" || download === "false") {
      // Allow iframe embedding for PDFs and enable media controls
      if (mimeType === "application/pdf") {
        headers["Content-Security-Policy"] = "frame-ancestors 'self'; object-src 'none'";
        headers["X-Frame-Options"] = "SAMEORIGIN";
      } else if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
        headers["Content-Security-Policy"] = "media-src 'self'; object-src 'none'";
      } else if (mimeType.startsWith("image/")) {
        headers["Content-Security-Policy"] = "img-src 'self'; object-src 'none'";
      } else {
        headers["Content-Security-Policy"] = "default-src 'none'; script-src 'none'";
      }
      
      headers["Content-Disposition"] = contentDisposition(file.metaData.name, {
        type: "inline",
      });
    } else if (download === "false") {
      // Standard inline viewing
      headers["Content-Security-Policy"] = "sandbox allow-same-origin";
      headers["Content-Disposition"] = contentDisposition(file.metaData.name, {
        type: "inline",
      });
    } else {
      // Download mode
      headers["Content-Disposition"] = contentDisposition(file.metaData.name);
      headers["Content-Security-Policy"] = "sandbox";
    }

    res.set(headers);

    return new StreamableFile(file.file);
  }

  @Delete(":fileId")
  @SkipThrottle()
  @UseGuards(ShareOwnerGuard)
  async remove(
    @Param("fileId") fileId: string,
    @Param("shareId") shareId: string,
  ) {
    await this.fileService.remove(shareId, fileId);
  }

  private supportsPreview(mimeType: string, fileName: string): boolean {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    
    return (
      mimeType.startsWith("image/") ||
      mimeType.startsWith("video/") ||
      mimeType.startsWith("audio/") ||
      mimeType.startsWith("text/") ||
      mimeType === "application/pdf" ||
      // Office documents
      ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext) ||
      // Code files
      ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'css', 'html', 'xml', 'json', 'yaml', 'yml'].includes(ext)
    );
  }

  private getPreviewType(mimeType: string, fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType === "application/pdf") return "pdf";
    if (mimeType.startsWith("text/")) return "text";
    if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return "office";
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'css', 'html', 'xml', 'json', 'yaml', 'yml'].includes(ext)) return "code";
    
    return "unsupported";
  }
}
