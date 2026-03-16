# Upload Performance Optimization — Design Spec

**Date:** 2026-03-15
**Status:** Draft
**Scope:** Optimize file upload pipeline for large files (900MB+) over tunneled connections (Pangolin)

## Problem Statement

Uploading a 900MB file is excessively slow due to:
1. Sequential chunk uploads (90 serial round-trips at 10MB each)
2. Potential data corruption from incorrect Base64 decoding of binary data
3. ZIP compression at maximum level (9) consuming minutes of CPU post-upload
4. Full-file retry on any error (losing all progress)

## Goals

- **Speed**: Reduce upload time for 900MB by 4-6x
- **Reliability**: Never lose upload progress on transient errors
- **Correctness**: Fix Base64 bug that may corrupt stored files
- **Backward compatibility**: Existing shares and config remain functional

## Non-Goals

- Switching to tus protocol or other upload libraries
- S3 multipart upload changes (user uses local storage)
- UI/UX redesign of upload interface

## Design

### 1. Fix Base64 Decoding Bug

**Files:** `backend/src/file/local.service.ts`, `backend/src/file/s3.service.ts`

**Current (broken):**
```typescript
// local.service.ts:66
const buffer = Buffer.from(data, "base64");
```

The frontend sends raw binary via `Content-Type: application/octet-stream`. The `bodyParser.raw()` middleware in `main.ts` already parses this into a `Buffer`. Calling `Buffer.from(data, "base64")` on a Buffer that was cast to string is incorrect and may produce corrupted output.

**New:**
```typescript
// Change method signature: data: string → data: Buffer
async create(
  data: Buffer,
  chunk: { index: number; total: number },
  file: { id?: string; name: string },
  shareId: string,
) {
  // Use data directly — it's already a Buffer from bodyParser.raw()
  // Remove: const buffer = Buffer.from(data, "base64");
  // Replace all references to `buffer` with `data`
}
```

Apply the same fix to `s3.service.ts` if it has the same pattern.

**Risk:** Low. The bodyParser.raw() already returns Buffer. This removes an unnecessary and harmful transformation.

### 2. Parallel Chunk Upload with Index-Based Storage

**Backend changes (`local.service.ts`):**

Replace the current append-to-single-file approach with individual chunk files:

```
Current:  {shareId}/{fileId}.tmp-chunk  (append each chunk sequentially)
New:      {shareId}/{fileId}.chunk-{index}  (one file per chunk, any order)
```

**Chunk reception (replace current `create` method logic):**
1. Receive chunk with `chunkIndex` and `totalChunks` params (already sent by frontend)
2. Save as `{shareId}/{fileId}.chunk-{chunkIndex}`
3. If this is not the last chunk, return immediately
4. If `chunkIndex === totalChunks - 1` OR all chunk files (0 to totalChunks-1) exist:
   - Assemble: read chunks in order, write to final file `{shareId}/{fileId}`
   - Delete all `.chunk-*` temporary files
   - Create DB record with final file size

**Chunk completeness check:**
```typescript
async assembleIfComplete(shareId: string, fileId: string, totalChunks: number): Promise<boolean> {
  const chunkDir = `${SHARE_DIRECTORY}/${shareId}`;
  const existingChunks = [];
  for (let i = 0; i < totalChunks; i++) {
    try {
      await fs.access(`${chunkDir}/${fileId}.chunk-${i}`);
      existingChunks.push(i);
    } catch {
      return false; // Not all chunks present yet
    }
  }

  // All chunks present — assemble
  const writeStream = createWriteStream(`${chunkDir}/${fileId}`);
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = `${chunkDir}/${fileId}.chunk-${i}`;
    const chunkData = await fs.readFile(chunkPath);
    writeStream.write(chunkData);
    await fs.unlink(chunkPath); // Clean up immediately
  }
  writeStream.end();

  return true;
}
```

**Sequential ordering validation removal:**
Remove the `expectedChunkIndex` check based on `fs.stat` file size. Chunks can now arrive in any order.

**Frontend changes (`upload/index.tsx` and `EditableUpload.tsx`):**

Replace sequential for-loop with parallel chunk dispatch:

```typescript
// Current: pLimit(3) for files, sequential chunks within each file
// New: pLimit(3) for chunks across all files

const CHUNK_CONCURRENCY = 3;
const chunkLimit = pLimit(CHUNK_CONCURRENCY);

// For each file, create all chunk promises
const chunkPromises = [];
for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
  chunkPromises.push(
    chunkLimit(async () => {
      const from = chunkIndex * chunkSize;
      const to = from + chunkSize;
      const blob = file.slice(from, to);
      await shareService.uploadFile(shareId, blob, { id: fileId, name: file.name }, chunkIndex, totalChunks);
      completedChunks.add(chunkIndex);
      setFileProgress((completedChunks.size / totalChunks) * 100);
    })
  );
}
await Promise.all(chunkPromises);
```

**File-level concurrency:** Keep `pLimit(3)` at file level too. With 3 files x 3 chunks = max 9 concurrent HTTP requests. Adjust if needed based on Pangolin tunnel behavior.

### 3. Increase Default Chunk Size

**File:** `backend/prisma/seed/config.seed.ts`

```
Current:  chunkSize.defaultValue = "10000000"   (10 MB)
New:      chunkSize.defaultValue = "50000000"    (50 MB)
```

**Impact:** 900MB → 18 chunks instead of 90. With 3 parallel = ~6 round-trip batches.

**Note:** This only affects new installations. Existing users keep their DB-stored value. Document in release notes that users should update `share.chunkSize` to `50000000` in admin settings for better performance.

**bodyParser.raw limit:** Already reads chunkSize dynamically in `main.ts:50-56`, so this propagates automatically.

### 4. Reduce ZIP Compression Level

**File:** `backend/prisma/seed/config.seed.ts`

```
Current:  zipCompressionLevel.defaultValue = "9"   (maximum)
New:      zipCompressionLevel.defaultValue = "1"    (fast)
```

**Rationale:** Level 9 vs level 1 for mixed files (PDFs, Office docs, ZIPs):
- PDFs/ZIPs: Already compressed, ~0% size reduction at any level
- Office docs (docx/xlsx): ~2-5% difference between level 1 and 9
- CPU time: Level 1 is ~10x faster than level 9

For a 900MB share, this reduces post-upload ZIP creation from minutes to seconds.

**Same caveat:** Only affects new installations. Existing users should adjust via admin settings.

### 5. Partial Retry with Exponential Backoff

**Files:** `frontend/src/pages/upload/index.tsx`, `frontend/src/components/upload/EditableUpload.tsx`

**Current (broken):**
```typescript
// On error: wait 5 seconds, restart entire file from chunk 0
chunkIndex = -1;
await new Promise((resolve) => setTimeout(resolve, 5000));
```

**New:**
```typescript
const MAX_RETRIES = 3;
const retryChunk = async (fn: () => Promise<void>, retries = MAX_RETRIES): Promise<void> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fn();
      return;
    } catch (e) {
      if (attempt === retries - 1) throw e;
      // Exponential backoff: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
};
```

Each chunk upload is wrapped in `retryChunk()`. On failure:
- Retry only the failed chunk (not the entire file)
- Exponential backoff: 1s → 2s → 4s
- After 3 failures on the same chunk, mark file as upload error
- Remove the `unexpected_chunk_index` error handling (no longer needed with index-based storage)

### 6. Orphan Chunk Cleanup

**File:** New scheduled task in `backend/src/file/file.service.ts` or a new cleanup service.

Chunks that never complete (browser closed, network died) need cleanup:

```typescript
@Cron(CronExpression.EVERY_HOUR)
async cleanupOrphanChunks() {
  // Find all .chunk-* files older than 1 hour
  // Delete them
}
```

This prevents disk space leaks from interrupted uploads.

## Files Modified

| File | Change |
|------|--------|
| `backend/src/file/local.service.ts` | Fix Buffer type, index-based chunk storage, assembly logic |
| `backend/src/file/s3.service.ts` | Fix Buffer type (same Base64 bug) |
| `backend/src/file/file.controller.ts` | Ensure Buffer passthrough from bodyParser |
| `backend/src/main.ts` | No change needed (already dynamic) |
| `backend/prisma/seed/config.seed.ts` | chunkSize → 50MB, zipCompressionLevel → 1 |
| `frontend/src/pages/upload/index.tsx` | Parallel chunks, retry logic, progress tracking |
| `frontend/src/components/upload/EditableUpload.tsx` | Same parallel chunks + retry changes |
| `frontend/src/services/share.service.ts` | No change needed |
| `backend/src/share/share.service.ts` | Add orphan cleanup cron job |

## Migration & Compatibility

- **Existing shares:** Unaffected. Already-uploaded files remain as-is.
- **In-progress uploads at deploy time:** Will fail (chunk format changes). Acceptable since partial uploads are temporary.
- **Config values:** Seed changes only affect fresh installs. Add release note for existing users to update chunk size and ZIP level in admin panel.
- **Database schema:** No migration needed. All changes are code-level.

## Testing Plan

1. **Unit:** Verify chunk assembly produces identical file to original (checksum comparison)
2. **Integration:** Upload 10MB, 100MB, 500MB files; verify integrity with sha256sum
3. **Error simulation:** Kill upload mid-way, verify retry resumes correctly
4. **Concurrency:** Upload 3 files simultaneously, verify no chunk mixing
5. **Cleanup:** Verify orphan chunks are deleted after 1 hour
6. **Regression:** Run existing Newman system tests (`npm run test:system`)
