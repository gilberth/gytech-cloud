import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ReverseShareModule } from "src/reverseShare/reverseShare.module";
import { ShareModule } from "src/share/share.module";
import { FileController } from "./file.controller";
import { MigrationController } from "./migration.controller";
import { FileService } from "./file.service";
import { LocalFileService } from "./local.service";
import { S3FileService } from "./s3.service";
import { StorageProviderFactory } from "./storage/storage-factory.service";
import { OneDriveStorageService } from "./storage/onedrive-storage.service";
import { GoogleDriveStorageService } from "./storage/googledrive-storage.service";
import { AzureBlobStorageService } from "./storage/azureblob-storage.service";

@Module({
  imports: [JwtModule.register({}), ReverseShareModule, ShareModule],
  controllers: [FileController, MigrationController],
  providers: [
    FileService,
    LocalFileService,
    S3FileService,
    StorageProviderFactory,
    OneDriveStorageService,
    GoogleDriveStorageService,
    AzureBlobStorageService,
  ],
  exports: [FileService, StorageProviderFactory],
})
export class FileModule {}
