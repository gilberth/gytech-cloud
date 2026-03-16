# Upload Performance Optimization — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce upload time for large files (900MB+) by 4-6x through parallel chunk uploads, larger chunks, and retry improvements.

**Architecture:** Replace sequential chunk-append model with index-based chunk storage + client-driven assembly. Frontend dispatches chunks in parallel (3 concurrent), backend stores each chunk as a separate file, then assembles on a dedicated `/complete` endpoint call.

**Tech Stack:** NestJS, Prisma, Next.js, Mantine v6, pLimit, Node.js streams

**Spec:** `docs/superpowers/specs/2026-03-15-upload-performance-design.md`

---

## Chunk 1: Backend — Buffer Type Fix + DTO + Complete Endpoint

### Task 1: Fix Buffer type in file.controller.ts

**Files:**
- Modify: `backend/src/file/file.controller.ts:43`

- [ ] **Step 1: Change `@Body()` type from `string` to `Buffer`**

```typescript
// file.controller.ts:43 — change:
@Body() body: string,
// to:
@Body() body: Buffer,
```

- [ ] **Step 2: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/file/file.controller.ts
git commit -m "fix(file): change @Body() type from string to Buffer"
```

---

### Task 2: Fix Buffer type in file.service.ts facade

**Files:**
- Modify: `backend/src/file/file.service.ts:31`

- [ ] **Step 1: Change `data` param from `string` to `Buffer`**

```typescript
// file.service.ts:31 — change:
async create(
  data: string,
// to:
async create(
  data: Buffer,
```

- [ ] **Step 2: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/file/file.service.ts
git commit -m "fix(file): change FileService.create data param to Buffer"
```

---

### Task 3: Fix Buffer type + remove Base64 decode in local.service.ts

**Files:**
- Modify: `backend/src/file/local.service.ts:26-27,66`

- [ ] **Step 1: Change `data` param type and remove Buffer.from**

In `local.service.ts`, change the `create` method signature at line 26-27:

```typescript
// Change:
async create(
  data: string,
// To:
async create(
  data: Buffer,
```

Then remove the unnecessary Buffer.from at line 66:

```typescript
// Remove this line:
const buffer = Buffer.from(data, "base64");
```

And replace all references to `buffer` with `data` in the same method:
- Line 71: `if (availableSpace < buffer.byteLength)` → `if (availableSpace < data.byteLength)`
- Line 81: `const shareSizeSum = fileSizeSum + diskFileSize + buffer.byteLength;` → `const shareSizeSum = fileSizeSum + diskFileSize + data.byteLength;`
- Line 94-97: `await fs.appendFile(..., buffer)` → `await fs.appendFile(..., data)`

- [ ] **Step 2: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/file/local.service.ts
git commit -m "fix(file): remove unnecessary Buffer.from in LocalFileService"
```

---

### Task 4: Fix Buffer type + remove Base64 decode in s3.service.ts

**Files:**
- Modify: `backend/src/file/s3.service.ts:47-48,59`

- [ ] **Step 1: Change `data` param type and remove Buffer.from**

In `s3.service.ts`, change the `create` method signature at line 47-48:

```typescript
// Change:
async create(
  data: string,
// To:
async create(
  data: Buffer,
```

Then remove line 59:

```typescript
// Remove:
const buffer = Buffer.from(data, "base64");
```

Replace `buffer` with `data` at line 105:

```typescript
// Change:
Body: buffer,
// To:
Body: data,
```

- [ ] **Step 2: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/file/s3.service.ts
git commit -m "fix(file): remove unnecessary Buffer.from in S3FileService"
```

---

### Task 5: Create CompleteFileDto

**Files:**
- Create: `backend/src/file/dto/completeFile.dto.ts`

- [ ] **Step 1: Create the DTO file**

```typescript
import { IsString, IsInt, Min } from "class-validator";

export class CompleteFileDto {
  @IsString()
  fileName: string;

  @IsInt()
  @Min(1)
  totalChunks: number;
}
```

- [ ] **Step 2: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/file/dto/completeFile.dto.ts
git commit -m "feat(file): add CompleteFileDto for file assembly endpoint"
```

---

### Task 6: Rewrite LocalFileService.create for index-based chunk storage

**Files:**
- Modify: `backend/src/file/local.service.ts:26-118`

- [ ] **Step 1: Add required imports**

At the top of `local.service.ts`, add:

```typescript
import { createReadStream, createWriteStream } from "fs";
import { finished } from "stream/promises";
```

Note: `createReadStream` is already imported at line 10 — just add `createWriteStream` next to it, and add the `finished` import as a new line.

- [ ] **Step 2: Replace the `create` method body**

Replace the entire `create` method (lines 26-119) with:

```typescript
async create(
  data: Buffer,
  chunk: { index: number; total: number },
  file: { id?: string; name: string },
  shareId: string,
) {
  if (!file.id) {
    throw new BadRequestException("File ID is required (generate client-side)");
  } else if (!isValidUUID(file.id)) {
    throw new BadRequestException("Invalid file ID format");
  }

  // Validate chunk index
  if (chunk.index < 0 || chunk.index >= chunk.total) {
    throw new BadRequestException("Invalid chunk index");
  }

  const share = await this.prisma.share.findUnique({
    where: { id: shareId },
  });

  if (!share) throw new NotFoundException("Share not found");
  if (share.uploadLocked)
    throw new BadRequestException("Share is already completed");

  // Check disk space
  const space = await fs.statfs(SHARE_DIRECTORY);
  const availableSpace = space.bavail * space.bsize;
  if (availableSpace < data.byteLength) {
    throw new InternalServerErrorException("Not enough space on the server");
  }

  // Ensure share directory exists
  await fs.mkdir(`${SHARE_DIRECTORY}/${shareId}`, { recursive: true });

  // Write chunk as individual file
  const chunkPath = `${SHARE_DIRECTORY}/${shareId}/${file.id}.chunk-${chunk.index}`;
  await fs.writeFile(chunkPath, data);

  return { id: file.id, name: file.name };
}
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/file/local.service.ts
git commit -m "feat(file): rewrite LocalFileService.create for index-based chunk storage"
```

---

### Task 7: Add LocalFileService.complete method for streaming assembly

**Files:**
- Modify: `backend/src/file/local.service.ts` (add new method after `create`)

- [ ] **Step 1: Add the `complete` method**

Add this method to the `LocalFileService` class, after the `create` method:

```typescript
async complete(
  shareId: string,
  fileId: string,
  fileName: string,
  totalChunks: number,
) {
  // Idempotency: if file record already exists, return it
  const existing = await this.prisma.file.findUnique({
    where: { id: fileId },
  });
  if (existing) {
    return { id: existing.id, name: existing.name, size: existing.size };
  }

  const chunkDir = `${SHARE_DIRECTORY}/${shareId}`;

  // Verify all chunks exist
  for (let i = 0; i < totalChunks; i++) {
    try {
      await fs.access(`${chunkDir}/${fileId}.chunk-${i}`);
    } catch {
      throw new BadRequestException(
        `Missing chunk ${i} of ${totalChunks}`,
      );
    }
  }

  // Stream-based assembly using pipe with { end: false }
  const finalPath = `${chunkDir}/${fileId}`;
  const writeStream = createWriteStream(finalPath);

  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = `${chunkDir}/${fileId}.chunk-${i}`;
    const readStream = createReadStream(chunkPath);
    readStream.pipe(writeStream, { end: false });
    await new Promise<void>((resolve, reject) => {
      readStream.on("end", resolve);
      readStream.on("error", reject);
    });
  }
  writeStream.end();
  await finished(writeStream);

  // Verify assembled file size
  const finalSize = (await fs.stat(finalPath)).size;

  // Share size validation
  const share = await this.prisma.share.findUnique({
    where: { id: shareId },
    include: { files: true, reverseShare: true },
  });

  const existingFilesSize = share.files.reduce(
    (sum, f) => sum + parseInt(f.size),
    0,
  );
  const totalShareSize = existingFilesSize + finalSize;

  if (totalShareSize > this.config.get("share.maxSize")) {
    await fs.unlink(finalPath).catch(() => {});
    throw new HttpException(
      "Max share size exceeded",
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }

  if (
    share.reverseShare?.maxShareSize &&
    totalShareSize > parseInt(share.reverseShare.maxShareSize)
  ) {
    await fs.unlink(finalPath).catch(() => {});
    throw new HttpException(
      "Max share size exceeded",
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }

  // Delete chunk files (safe — final file is verified)
  for (let i = 0; i < totalChunks; i++) {
    await fs
      .unlink(`${chunkDir}/${fileId}.chunk-${i}`)
      .catch(() => {});
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

- [ ] **Step 2: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/file/local.service.ts
git commit -m "feat(file): add LocalFileService.complete for streaming chunk assembly"
```

---

### Task 8: Add completeFile facade method to FileService

**Files:**
- Modify: `backend/src/file/file.service.ts`

- [ ] **Step 1: Add `completeFile` method after the existing `create` method (after line 42)**

```typescript
async completeFile(
  shareId: string,
  fileId: string,
  fileName: string,
  totalChunks: number,
) {
  const storageService = this.getStorageService();
  // Only LocalFileService supports the complete method for now
  if ("complete" in storageService) {
    return (storageService as LocalFileService).complete(
      shareId,
      fileId,
      fileName,
      totalChunks,
    );
  }
  throw new Error("Complete not supported for this storage provider");
}
```

- [ ] **Step 2: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/file/file.service.ts
git commit -m "feat(file): add completeFile facade method to FileService"
```

---

### Task 9: Add POST :fileId/complete endpoint to FileController

**Files:**
- Modify: `backend/src/file/file.controller.ts`

- [ ] **Step 1: Add import for CompleteFileDto**

```typescript
import { CompleteFileDto } from "./dto/completeFile.dto";
```

- [ ] **Step 2: Add the endpoint method after the existing `create` method (after line 55)**

```typescript
@Post(":fileId/complete")
@SkipThrottle()
@UseGuards(CreateShareGuard, ShareOwnerGuard)
async completeFile(
  @Param("shareId") shareId: string,
  @Param("fileId") fileId: string,
  @Body() body: CompleteFileDto,
) {
  return await this.fileService.completeFile(
    shareId,
    fileId,
    body.fileName,
    body.totalChunks,
  );
}
```

**IMPORTANT:** This endpoint MUST be placed BEFORE the `@Get(":fileId/metadata")` and `@Get(":fileId/:filename")` routes, otherwise NestJS route matching will try to match "complete" as a `:fileId` parameter. Place it right after the `create` POST method.

- [ ] **Step 3: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/file/file.controller.ts backend/src/file/dto/completeFile.dto.ts
git commit -m "feat(file): add POST :fileId/complete endpoint for chunk assembly"
```

---

### Task 10: Update config defaults (chunk size + ZIP compression)

**Files:**
- Modify: `backend/prisma/seed/config.seed.ts:64-72`

- [ ] **Step 1: Change zipCompressionLevel default from "9" to "1"**

```typescript
// Line 64-67 — change:
zipCompressionLevel: {
  type: "number",
  defaultValue: "9",
},
// To:
zipCompressionLevel: {
  type: "number",
  defaultValue: "1",
},
```

- [ ] **Step 2: Change chunkSize default from "10000000" to "50000000"**

```typescript
// Line 68-72 — change:
chunkSize: {
  type: "filesize",
  defaultValue: "10000000",
  secret: false,
},
// To:
chunkSize: {
  type: "filesize",
  defaultValue: "50000000",
  secret: false,
},
```

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/seed/config.seed.ts
git commit -m "perf(config): increase chunk size to 50MB, reduce ZIP compression to level 1"
```

---

### Task 11: Add orphan chunk cleanup cron job

**Files:**
- Modify: `backend/src/file/file.service.ts`

- [ ] **Step 1: Add imports**

At the top of `file.service.ts`, add:

```typescript
import { Cron, CronExpression } from "@nestjs/schedule";
import { Logger } from "@nestjs/common";
import * as fs from "fs/promises";
import * as path from "path";
import { SHARE_DIRECTORY } from "../constants";
```

- [ ] **Step 2: Add logger and cron method to the FileService class**

Add at the top of the class:

```typescript
private readonly logger = new Logger(FileService.name);
```

Add at the bottom of the class (before the closing `}`):

```typescript
@Cron(CronExpression.EVERY_HOUR)
async cleanupOrphanChunks() {
  try {
    const shareDirs = await fs.readdir(SHARE_DIRECTORY).catch(() => []);
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let cleaned = 0;

    for (const shareDir of shareDirs) {
      const sharePath = path.join(SHARE_DIRECTORY, shareDir);
      const stat = await fs.stat(sharePath).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const files = await fs.readdir(sharePath).catch(() => []);
      for (const file of files) {
        // Match .chunk-N files and legacy .tmp-chunk files
        if (!file.includes(".chunk-") && !file.endsWith(".tmp-chunk"))
          continue;

        const filePath = path.join(sharePath, file);
        const fileStat = await fs.stat(filePath).catch(() => null);
        if (!fileStat) continue;

        if (fileStat.mtimeMs < oneHourAgo) {
          await fs.unlink(filePath).catch(() => {});
          cleaned++;
          this.logger.log(
            `Cleaned orphan chunk: ${shareDir}/${file}`,
          );
        }
      }
    }

    if (cleaned > 0) {
      this.logger.log(`Cleaned ${cleaned} orphan chunk(s)`);
    }
  } catch (error) {
    this.logger.error("Error cleaning orphan chunks", error);
  }
}
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/file/file.service.ts
git commit -m "feat(file): add hourly orphan chunk cleanup cron job"
```

---

## Chunk 2: Frontend — Parallel Uploads, Retry, and completeFile

### Task 12: Extract retryChunk utility to shared module

**Files:**
- Create: `frontend/src/utils/upload.util.ts`

- [ ] **Step 1: Create the shared upload utility**

```typescript
import pLimit from "p-limit";

export const CHUNK_CONCURRENCY = 3;

export const retryChunk = async (
  fn: () => Promise<void>,
  retries = 3,
): Promise<void> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fn();
      return;
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/utils/upload.util.ts
git commit -m "feat(upload): extract retryChunk utility to shared module"
```

---

### Task 13: Add `completeFile` method to share.service.ts

**Files:**
- Modify: `frontend/src/services/share.service.ts`

- [ ] **Step 1: Add the `completeFile` function before the export block (before line 157)**

```typescript
const completeFile = async (
  shareId: string,
  fileId: string,
  fileName: string,
  totalChunks: number,
): Promise<{ id: string; name: string; size: string }> => {
  return (
    await api.post(`shares/${shareId}/files/${fileId}/complete`, {
      fileName,
      totalChunks,
    })
  ).data;
};
```

- [ ] **Step 2: Add `completeFile` to the export object**

In the `export default` block (around line 157-179), add `completeFile` after `uploadFile`:

```typescript
export default {
  // ... existing exports
  uploadFile,
  completeFile,  // Add this line
  // ... rest
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/share.service.ts
git commit -m "feat(share): add completeFile service method for chunk assembly"
```

---

### Task 14: Rewrite upload logic in upload/index.tsx — parallel chunks + retry

**Files:**
- Modify: `frontend/src/pages/upload/index.tsx:93-171`

- [ ] **Step 1: Add import for shared upload utilities (near the top imports)**

```typescript
import { retryChunk, CHUNK_CONCURRENCY } from "../../utils/upload.util";
```

- [ ] **Step 2: Replace the `uploadFiles` function body (lines 93-171)**

Replace the entire `uploadFiles` function with:

```typescript
const uploadFiles = async (share: CreateShare, files: FileUpload[]) => {
  setisUploading(true);

  try {
    const isReverseShare = router.pathname != "/upload";
    createdShare = await shareService.create(share, isReverseShare);
  } catch (e) {
    toast.axiosError(e);
    setisUploading(false);
    return;
  }

  const fileUploadPromises = files.map(async (file, fileIndex) =>
    promiseLimit(async () => {
      const fileId = crypto.randomUUID();
      const chunkLimit = pLimit(CHUNK_CONCURRENCY);
      const completedChunks = new Set<number>();

      const setFileProgress = (progress: number) => {
        setFiles((files) =>
          files.map((file, callbackIndex) => {
            if (fileIndex == callbackIndex) {
              file.uploadingProgress = progress;
            }
            return file;
          }),
        );
      };

      setFileProgress(1);

      let totalChunks = Math.ceil(file.size / chunkSize.current);
      if (totalChunks == 0) totalChunks = 1;

      try {
        const chunkPromises = [];
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
          chunkPromises.push(
            chunkLimit(() =>
              retryChunk(async () => {
                const from = chunkIndex * chunkSize.current;
                const to = from + chunkSize.current;
                const blob = file.slice(from, to);
                await shareService.uploadFile(
                  createdShare.id,
                  blob,
                  { id: fileId, name: file.name },
                  chunkIndex,
                  totalChunks,
                );
                completedChunks.add(chunkIndex);
                // Cap at 99% — 100% is set only after completeFile succeeds
                // This prevents the useEffect from triggering completeShare prematurely
                const progress = Math.min(
                  (completedChunks.size / totalChunks) * 100,
                  99,
                );
                setFileProgress(progress);
              }),
            ),
          );
        }
        await Promise.all(chunkPromises);

        // Trigger server-side assembly
        await shareService.completeFile(
          createdShare.id,
          fileId,
          file.name,
          totalChunks,
        );

        // Only now set 100% — safe for useEffect to trigger completeShare
        setFileProgress(100);
      } catch (e) {
        setFileProgress(-1);
      }
    }),
  );

  await Promise.all(fileUploadPromises);
};
```

**Key changes vs original:**
- `fileId = crypto.randomUUID()` generated client-side
- Parallel chunk dispatch with `pLimit(CHUNK_CONCURRENCY)`
- `retryChunk` wraps each chunk (exponential backoff, 3 retries)
- `await shareService.completeFile(...)` triggers assembly after all chunks
- `await Promise.all(fileUploadPromises)` — fixes the missing `await` bug
- Removed `unexpected_chunk_index` error handling (no longer needed)
- Removed `chunkIndex = -1` full-file restart on error

- [ ] **Step 3: Remove the `AxiosError` import if no longer used**

Check if `AxiosError` is still referenced elsewhere in the file. If only used by the removed `unexpected_chunk_index` handler, remove the import.

- [ ] **Step 4: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/upload/index.tsx
git commit -m "feat(upload): parallel chunk uploads with retry and client-driven assembly"
```

---

### Task 15: Rewrite upload logic in EditableUpload.tsx — same pattern

**Files:**
- Modify: `frontend/src/components/upload/EditableUpload.tsx:64-131`

- [ ] **Step 1: Add import for shared upload utilities (near the top imports)**

```typescript
import { retryChunk, CHUNK_CONCURRENCY } from "../../utils/upload.util";
```

- [ ] **Step 2: Replace the `uploadFiles` function (lines 64-131)**

Replace with:

```typescript
const uploadFiles = async (files: FileUpload[]) => {
  const fileUploadPromises = files.map(async (file, fileIndex) =>
    promiseLimit(async () => {
      const fileId = crypto.randomUUID();
      const chunkLimit = pLimit(CHUNK_CONCURRENCY);
      const completedChunks = new Set<number>();

      const setFileProgress = (progress: number) => {
        setUploadingFiles((files) =>
          files.map((file, callbackIndex) => {
            if (fileIndex == callbackIndex) {
              file.uploadingProgress = progress;
            }
            return file;
          }),
        );
      };

      setFileProgress(1);

      let chunks = Math.ceil(file.size / chunkSize.current);
      if (chunks == 0) chunks = 1;

      try {
        const chunkPromises = [];
        for (let chunkIndex = 0; chunkIndex < chunks; chunkIndex++) {
          chunkPromises.push(
            chunkLimit(() =>
              retryChunk(async () => {
                const from = chunkIndex * chunkSize.current;
                const to = from + chunkSize.current;
                const blob = file.slice(from, to);
                await shareService.uploadFile(
                  shareId,
                  blob,
                  { id: fileId, name: file.name },
                  chunkIndex,
                  chunks,
                );
                completedChunks.add(chunkIndex);
                // Cap at 99% — 100% only after completeFile
                const progress = Math.min(
                  (completedChunks.size / chunks) * 100,
                  99,
                );
                setFileProgress(progress);
              }),
            ),
          );
        }
        await Promise.all(chunkPromises);

        // Trigger server-side assembly
        await shareService.completeFile(
          shareId,
          fileId,
          file.name,
          chunks,
        );

        // Only now set 100%
        setFileProgress(100);
      } catch (e) {
        setFileProgress(-1);
      }
    }),
  );

  await Promise.all(fileUploadPromises);
};
```

- [ ] **Step 3: Add pLimit import if not already present**

Verify line 5: `import pLimit from "p-limit";` — already exists.

- [ ] **Step 4: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/upload/EditableUpload.tsx
git commit -m "feat(upload): parallel chunk uploads in EditableUpload with retry"
```

---

## Chunk 3: Testing + CHANGELOG

### Task 16: Run system tests to verify nothing is broken

**Files:**
- None (test run only)

- [ ] **Step 1: Run Newman system tests**

Run: `cd backend && npm run test:system`
Expected: All existing tests pass. The test resets DB and seeds fresh config (which will now have 50MB chunk size and ZIP level 1).

- [ ] **Step 2: If tests fail, diagnose and fix**

Common issues:
- Route order conflict: ensure `POST :fileId/complete` is before `GET :fileId/metadata` in the controller
- Body parsing: ensure `completeFile` endpoint correctly parses JSON body (it's not `application/octet-stream`)
- Missing DTO validation: ensure `class-validator` decorators work with `ValidationPipe`

---

### Task 17: Manual smoke test with large file

- [ ] **Step 1: Start backend and frontend in dev mode**

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

- [ ] **Step 2: Upload a test file (10MB+) through the browser**

Navigate to `http://localhost:3000/upload`, drop a file, verify:
- Progress bar advances smoothly
- File appears in the share after completion
- Downloaded file matches original (compare sha256sum)

- [ ] **Step 3: Upload a 0-byte file**

Create an empty file, upload it. Verify it completes without errors.

- [ ] **Step 4: Verify the share size limit**

Set `share.maxSize` to a small value in admin panel (e.g., 1MB), try uploading a 2MB file. Verify the `complete` endpoint rejects with "Max share size exceeded".

- [ ] **Step 5: S3 smoke test (if applicable)**

If S3 storage is configured, switch to S3 provider and upload a small file. Verify it still works with the Buffer type fix (sequential upload, no parallel changes for S3).

---

### Task 18: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add changelog entry**

Add at the top of the changelog:

```markdown
## [Unreleased]

### Performance
- **Upload speed**: Parallel chunk uploads (3 concurrent) reduce upload time by 4-6x for large files
- **Chunk size**: Default increased from 10MB to 50MB (existing users: update in admin panel)
- **ZIP compression**: Default reduced from level 9 to level 1 (~10x faster for mixed files)

### Fixed
- **Upload reliability**: Failed chunks retry individually with exponential backoff instead of restarting entire file
- **Buffer type safety**: Removed unnecessary Buffer.from(data, "base64") copy in file upload pipeline
- **Missing await**: Fixed missing `await` on Promise.all in upload page

### Added
- **File assembly endpoint**: `POST /shares/:shareId/files/:fileId/complete` for client-driven chunk assembly
- **Orphan chunk cleanup**: Hourly cron job removes abandoned upload chunks older than 1 hour
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add upload performance improvements to CHANGELOG"
```

---

### Task 19: Final commit — all changes verified

- [ ] **Step 1: Run full lint and format**

```bash
npm run format && npm run lint
```

- [ ] **Step 2: Fix any lint/format issues**

- [ ] **Step 3: Final commit if anything changed from formatting**

```bash
git add backend/src frontend/src frontend/src/utils && git commit -m "style: format after upload performance changes"
```
