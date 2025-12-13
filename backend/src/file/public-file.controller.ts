
import {
    Controller,
    Get,
    Param,
    Res,
    StreamableFile,
    NotFoundException,
    Query,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import * as contentDisposition from "content-disposition";
import { Response } from "express";
import * as mime from "mime-types";
import { FileService } from "./file.service";

@Controller("f")
export class PublicFileController {
    constructor(private fileService: FileService) { }

    @Get(":token")
    @SkipThrottle()
    async getFile(
        @Res({ passthrough: true }) res: Response,
        @Param("token") token: string,
        @Query("download") download = "true",
    ) {
        try {
            const file = await this.fileService.getByPublicToken(token);
            const mimeType = mime.lookup(file.metaData.name) || "application/octet-stream";

            const headers = {
                "Content-Type": mimeType,
                "Content-Length": file.metaData.size,
                "Accept-Ranges": "bytes",
            };

            if (download === "false") {
                // Preview mode headers
                if (mimeType === "application/pdf") {
                    headers["Content-Security-Policy"] = "frame-ancestors 'self'; object-src 'none'";
                    headers["X-Frame-Options"] = "SAMEORIGIN";
                } else if (mimeType.startsWith("video/") || mimeType.startsWith("audio/")) {
                    headers["Content-Security-Policy"] = "media-src 'self'; object-src 'none'";
                } else if (mimeType.startsWith("image/")) {
                    headers["Content-Security-Policy"] = "img-src 'self'; object-src 'none'";
                } else {
                    headers["Content-Security-Policy"] = "sandbox allow-same-origin";
                }

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
        } catch (e) {
            throw new NotFoundException("File not found or expired");
        }
    }
}
