import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ReverseShareModule } from "src/reverseShare/reverseShare.module";
import { ShareModule } from "src/share/share.module";
import { FileController } from "./file.controller";
import { FileService } from "./file.service";
import { LocalFileService } from "./local.service";
import { S3FileService } from "./s3.service";
// import { MigrationController } from "./migration.controller"; // Temporarily disabled
import { MultiStorageModule } from "./storage/multi-storage.module";

@Module({
  imports: [JwtModule.register({}), ReverseShareModule, ShareModule, MultiStorageModule],
  controllers: [FileController], // MigrationController temporarily disabled
  providers: [
    FileService,
    LocalFileService,
    S3FileService,
  ],
  exports: [FileService],
})
export class FileModule {}
