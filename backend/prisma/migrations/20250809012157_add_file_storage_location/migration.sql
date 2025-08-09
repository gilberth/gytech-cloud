-- CreateTable
CREATE TABLE "FileStorageLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "fileId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "checksum" TEXT,
    "sizeBytes" BIGINT,
    "lastAttemptAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" DATETIME,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    CONSTRAINT "FileStorageLocation_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FileStorageLocation_fileId_provider_idx" ON "FileStorageLocation"("fileId", "provider");

-- CreateIndex
CREATE INDEX "FileStorageLocation_state_idx" ON "FileStorageLocation"("state");

-- CreateIndex
CREATE INDEX "FileStorageLocation_provider_state_idx" ON "FileStorageLocation"("provider", "state");
