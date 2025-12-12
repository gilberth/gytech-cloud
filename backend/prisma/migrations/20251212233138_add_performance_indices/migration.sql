-- CreateIndex
CREATE INDEX "Share_creatorId_idx" ON "Share"("creatorId");

-- CreateIndex
CREATE INDEX "Share_expiration_idx" ON "Share"("expiration");

-- CreateIndex
CREATE INDEX "Share_uploadLocked_idx" ON "Share"("uploadLocked");

-- CreateIndex
CREATE INDEX "Share_reverseShareId_idx" ON "Share"("reverseShareId");
