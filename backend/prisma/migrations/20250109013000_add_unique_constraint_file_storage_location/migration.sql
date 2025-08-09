-- CreateIndex
CREATE UNIQUE INDEX "FileStorageLocation_fileId_provider_key" ON "FileStorageLocation"("fileId", "provider");