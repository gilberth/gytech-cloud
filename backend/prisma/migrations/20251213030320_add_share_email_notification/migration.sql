-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Share" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT,
    "uploadLocked" BOOLEAN NOT NULL DEFAULT false,
    "isZipReady" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "expiration" DATETIME NOT NULL,
    "description" TEXT,
    "removedReason" TEXT,
    "creatorId" TEXT,
    "reverseShareId" TEXT,
    "storageProvider" TEXT NOT NULL DEFAULT 'LOCAL',
    "emailNotification" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Share_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Share_reverseShareId_fkey" FOREIGN KEY ("reverseShareId") REFERENCES "ReverseShare" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Share" ("createdAt", "creatorId", "description", "expiration", "id", "isZipReady", "name", "removedReason", "reverseShareId", "storageProvider", "uploadLocked", "views") SELECT "createdAt", "creatorId", "description", "expiration", "id", "isZipReady", "name", "removedReason", "reverseShareId", "storageProvider", "uploadLocked", "views" FROM "Share";
DROP TABLE "Share";
ALTER TABLE "new_Share" RENAME TO "Share";
CREATE INDEX "Share_creatorId_idx" ON "Share"("creatorId");
CREATE INDEX "Share_expiration_idx" ON "Share"("expiration");
CREATE INDEX "Share_uploadLocked_idx" ON "Share"("uploadLocked");
CREATE INDEX "Share_reverseShareId_idx" ON "Share"("reverseShareId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
