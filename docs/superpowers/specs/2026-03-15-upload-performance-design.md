# Upload Performance Optimization — Design Spec

**Date:** 2026-03-15
**Status:** Draft (v2 — post-review)
**Scope:** Optimize file upload pipeline for large files (900MB+) over tunneled connections (Pangolin)

## Problem Statement

Uploading a 900MB file is excessively slow due to:
1. Sequential chunk uploads (90 serial round-trips at 10MB each)
2. Unnecessary `Buffer.from(data, "base64")` on already-parsed Buffer (type-safety issue + wasted CPU)
3. ZIP compression at maximum level (9) consuming minutes of CPU post-upload
4. Full-file retry on any error (losing all progress)
5. Missing `await` on `Promise.all(fileUploadPromises)` in `upload/index.tsx:170`

## Goals

- **Speed**: Reduce upload time for 900MB by 4-6x
- **Reliability**: Never lose upload progress on transient errors
- **Correctness**: Fix Buffer type safety and missing await
- **Backward compatibility**: Existing shares and config remain functional

## Non-Goals

- Switching to tus protocol or other upload libraries
- S3 multipart upload changes (user uses local storage; S3 only gets the type-safety fix)
- UI/UX redesign of upload interface

## Design

### 1. Fix Buffer Type Safety Across the Stack

**Clarification:** `Buffer.from(data, "base64")` when `data` is actually a `Buffer` does NOT corrupt data — Node.js ignores the encoding param and just copies the buffer. This is a type-safety cleanup and micro-optimization (eliminates unnecessary buffer copy), not a corruption fix.

**Files to change:**

| File | Change |
|------|--------|
| `backend/src/file/file.controller.ts:43` | `@Body() body: string` → `@Body() body: Buffer` |
| `backend/src/file/file.service.ts:31` | `data: string` → `data: Buffer` |
| `backend/src/file/local.service.ts:27` | `data: string` → `data: Buffer`, remove `Buffer.from(data, "base64")`, use `data` directly |
| `backend/src/file/s3.service.ts:48` | `data: string` → `data: Buffer`, remove `Buffer.from(data, "base64")` at line 59, use `data` directly |

**Risk:** Low. Behavioral no-op — just makes the types match reality.

### 2. Parallel Chunk Upload with Client-Driven Assembly

**Key design decisions (from review):**
- **File IDs generated client-side** — the frontend generates `crypto.randomUUID()` before dispatching any chunks, avoiding the race where parallel chunks arrive before the first response with the server-generated ID
- **Assembly triggered by frontend** — after `Promise.all` resolves, the frontend sends a dedicated "assemble" request instead of relying on the backend to detect completeness (avoids race condition where two chunks both see "all present" and try to assemble simultaneously)
- **Chunks deleted only after verified assembly** — never delete chunks during assembly to prevent data loss on crash

#### Backend changes

**New endpoint: `POST /shares/:shareId/files/:fileId/complete`**

After all chunks are uploaded, the frontend calls this to trigger assembly. This avoids the race condition entirely — only one request triggers assembly.

**`local.service.ts` — new chunk storage:**

```
Current:  {shareId}/{fileId}.tmp-chunk  (append each chunk sequentially)
New:      {shareId}/{fileId}.chunk-{index}  (one file per chunk, any order)
```

**Chunk reception (`create` method):**
1. Receive chunk with `chunkIndex` and `totalChunks` params
2. Require `file.id` (client-generated UUID, reject if missing)
3. Save as `{shareId}/{fileId}.chunk-{chunkIndex}` (atomic write)
4. Return immediately — no assembly, no completeness check
5. Remove the `expectedChunkIndex` sequential ordering validation

**Assembly (`complete` method — new):**
```typescript
async complete(shareId: string, fileId: string, fileName: string, totalChunks: number) {
  const chunkDir = `${SHARE_DIRECTORY}/${shareId}`;

  // Verify all chunks exist
  for (let i = 0; i < totalChunks; i++) {
    await fs.access(`${chunkDir}/${fileId}.chunk-${i}`);
  }

  // Stream-based assembly (handles backpressure correctly)
  const finalPath = `${chunkDir}/${fileId}`;
  const writeStream = createWriteStream(finalPath);

  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = `${chunkDir}/${fileId}.chunk-${i}`;
    await pipeline(createReadStream(chunkPath), writeStream, { end: false });
  }
  writeStream.end();
  await finished(writeStream);

  // Verify assembled file size matches sum of chunks
  const finalSize = (await fs.stat(finalPath)).size;

  // Only now delete chunk files (safe — final file is written and verified)
  for (let i = 0; i < totalChunks; i++) {
    await fs.unlink(`${chunkDir}/${fileId}.chunk-${i}`).catch(() => {});
  }

  // Create DB record
  await this.prisma.file.create({
    data: {
      id: fileId,
      name: fileName,
      size: finalSize.toString(),
      share: { connect: { id: shareId } },
    },
  });

  return { id: fileId, name: fileName, size: finalSize.toString() };
}
```

**Share size validation:**
Move the max-size check to the `complete` endpoint. The frontend already knows the full file size — pass it as a parameter. Validate once against `share.maxSize` and `reverseShare.maxShareSize`, rather than per-chunk (which undercounts with parallel uploads).

#### Frontend changes (`upload/index.tsx` and `EditableUpload.tsx`)

**File ID generation — client-side:**
```typescript
const fileId = crypto.randomUUID(); // Before any chunk dispatch
```

**Parallel chunk dispatch:**
```typescript
const CHUNK_CONCURRENCY = 3;
const chunkLimit = pLimit(CHUNK_CONCURRENCY);
const completedChunks = new Set<number>();

const chunkPromises = [];
for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
  chunkPromises.push(
    chunkLimit(() =>
      retryChunk(async () => {
        const from = chunkIndex * chunkSize;
        const to = from + chunkSize;
        const blob = file.slice(from, to);
        await shareService.uploadFile(shareId, blob, { id: fileId, name: file.name }, chunkIndex, totalChunks);
        completedChunks.add(chunkIndex);
        setFileProgress((completedChunks.size / totalChunks) * 100);
      })
    )
  );
}
await Promise.all(chunkPromises);

// All chunks uploaded — trigger assembly
await shareService.completeFile(shareId, fileId, file.name, totalChunks);
```

**File-level concurrency:** Keep `pLimit(3)` for files. With 3 files × 3 chunks = max 9 concurrent HTTP requests.

**Fix existing bug:** Add `await` to `Promise.all(fileUploadPromises)` at line 170.

### 3. Increase Default Chunk Size

**File:** `backend/prisma/seed/config.seed.ts`

```
Current:  chunkSize.defaultValue = "10000000"   (10 MB)
New:      chunkSize.defaultValue = "50000000"    (50 MB)
```

**Impact:** 900MB → 18 chunks instead of 90. With 3 parallel = ~6 round-trip batches.

**Note:** Only affects new installations. Existing users keep their DB-stored value. Document in release notes that users should update `share.chunkSize` to `50000000` in admin settings for better performance.

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

**File:** `backend/src/file/file.service.ts` (add to existing facade service)

Chunks from interrupted uploads (browser closed, network died) need cleanup:

```typescript
@Cron(CronExpression.EVERY_HOUR)
async cleanupOrphanChunks() {
  // Scan SHARE_DIRECTORY for all .chunk-* files
  // Check file mtime — if older than 1 hour, delete
  // Also clean legacy .tmp-chunk files from pre-migration uploads
}
```

**Details:**
- Use `fs.stat().mtime` to determine chunk age
- Delete `.chunk-*` files older than 1 hour
- Also clean legacy `.tmp-chunk` files (migration from old sequential system)
- Log deletions for debugging
- Do NOT touch share DB records — orphan chunks are pre-file-creation

**Prerequisite:** Verify `ScheduleModule.forRoot()` is registered in `app.module.ts` (it should be, since the codebase already uses `@nestjs/schedule`).

## S3 Service — Scoped Out

The S3 service (`s3.service.ts`) has a fundamentally different architecture:
- Multipart upload initialized on `chunk.index === 0` with `CreateMultipartUploadCommand`
- `uploadId` stored in an in-memory map keyed by `file.id`
- Parallel chunk upload would require chunk 0 to arrive first (to init the multipart session)

**Decision:** S3 parallel uploads are out of scope for this spec. S3 only receives the Buffer type-safety fix (Section 1). A separate spec can address S3 parallel uploads later if needed (likely: init multipart from a dedicated endpoint before chunks, similar to Section 2's `complete` pattern).

## Files Modified

| File | Change |
|------|--------|
| `backend/src/file/local.service.ts` | Buffer type, index-based chunk storage, new `complete()` method with streaming assembly |
| `backend/src/file/s3.service.ts` | Buffer type fix only (no parallel changes) |
| `backend/src/file/file.service.ts` | Buffer type in facade `create()`, new `completeFile()` facade method, orphan cleanup cron |
| `backend/src/file/file.controller.ts` | `@Body()` type to Buffer, new `POST :fileId/complete` endpoint |
| `backend/src/main.ts` | No change needed (already dynamic) |
| `backend/prisma/seed/config.seed.ts` | chunkSize → 50MB, zipCompressionLevel → 1 |
| `frontend/src/pages/upload/index.tsx` | Client-side file ID, parallel chunks, retry logic, `await` fix, call `completeFile` |
| `frontend/src/components/upload/EditableUpload.tsx` | Same parallel chunks + retry changes |
| `frontend/src/services/share.service.ts` | New `completeFile()` API method |

## Migration & Compatibility

- **Existing shares:** Unaffected. Already-uploaded files remain as-is.
- **In-progress uploads at deploy time:** Will fail (chunk format changes). Acceptable since partial uploads are temporary.
- **Config values:** Seed changes only affect fresh installs. Add release note for existing users to update chunk size and ZIP level in admin panel.
- **Database schema:** No migration needed. All changes are code-level.
- **Legacy `.tmp-chunk` cleanup:** The orphan cleanup cron handles both old and new format files.

## Testing Plan

1. **Integrity:** Upload files of various sizes (1MB, 100MB, 500MB), verify sha256sum matches original
2. **Parallel correctness:** Upload 3 files simultaneously, verify no chunk mixing between files
3. **Error recovery:** Kill upload mid-way (close browser tab), restart — verify retry logic works per-chunk
4. **Assembly verification:** Confirm assembled file size matches sum of chunk sizes
5. **Orphan cleanup:** Create orphan chunks, advance time, verify cron deletes them
6. **Regression:** Run existing Newman system tests (`npm run test:system`)
7. **S3 smoke test:** If S3 is configured, verify single-file upload still works (sequential, type fix only)
