# Curl Upload via Reverse Share Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a file from any machine with a single `curl -T file "https://<appUrl>/api/upload/<token>/"` command, reusing the existing Reverse Share token instead of a login/cookie flow.

**Architecture:** A new unauthenticated `PUT /api/upload/:token/:filename` endpoint validates the Reverse Share token, then streams the request body directly to storage (disk or S3) without buffering the whole file in memory, orchestrating the same `ShareService`/`ReverseShareService` calls the existing multi-step API already uses (create → write → complete). The Reverse Share creation response and its UI gain a ready-to-copy curl command alongside the existing web link.

**Tech Stack:** NestJS (Express platform), Prisma/SQLite, `@aws-sdk/client-s3`, Next.js + Mantine frontend, Newman/Postman system tests.

## Global Constraints

- No JWT/cookie auth on the new endpoint — auth is the Reverse Share token itself, validated via `ReverseShareService.isValid()`.
- Never buffer the whole uploaded file in memory — stream to disk/S3 incrementally (source: design spec, files can be several GB).
- Never hardcode a domain — all links are built from `this.config.get("general.appUrl")`.
- Endpoint responses are `text/plain` (link on success, error message on failure), not JSON.
- This repo has **no jest/unit test infrastructure** — the only test tooling is Newman system tests (`backend/test/newman-system-tests.json`, run via `npm run test:system`). Each backend task below is verified by running the dev server and hitting it with `curl`/`node`, not by writing unit tests. A dedicated task at the end adds Newman coverage for the full flow.
- All user-facing frontend text must go through the i18n system (`t()` / `FormattedMessage`) — add new keys only to `frontend/src/i18n/translations/en-US.ts` (the reference locale); other locales are translated separately, out of scope for this plan.
- Every change must get an entry in `CHANGELOG.md` under `## [Unreleased]` (per `CLAUDE.md`).

---

### Task 1: Filename sanitizer utility

**Files:**
- Create: `backend/src/utils/filename.util.ts`

**Interfaces:**
- Produces: `sanitizeFilename(rawFilename: string): string` — throws a plain `Error` if the filename is empty, `.`, `..`, or contains `/`, `\`, or a null byte. Returns the decoded, validated filename otherwise. Later tasks (Task 4) import this.

- [ ] **Step 1: Write the utility**

```ts
// backend/src/utils/filename.util.ts
export function sanitizeFilename(rawFilename: string): string {
  const filename = decodeURIComponent(rawFilename);

  if (
    !filename ||
    filename === "." ||
    filename === ".." ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0")
  ) {
    throw new Error("Invalid filename");
  }

  return filename;
}
```

- [ ] **Step 2: Verify manually**

Run: `cd backend && npx ts-node -e "import { sanitizeFilename } from './src/utils/filename.util'; console.log(sanitizeFilename('archivo.zip')); try { sanitizeFilename('../etc/passwd'); console.log('FAIL: should have thrown'); } catch { console.log('OK: rejected traversal'); }"`

Expected output:
```
archivo.zip
OK: rejected traversal
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/utils/filename.util.ts
git commit -m "feat(upload): add filename sanitizer for curl upload endpoint"
```

---

### Task 2: Streaming write support in LocalFileService

**Files:**
- Modify: `backend/src/file/local.service.ts`
- Modify: `backend/src/file/file.service.ts`

**Interfaces:**
- Consumes: nothing new (uses existing `this.prisma`, `SHARE_DIRECTORY`, `fs/promises`, `fs.createWriteStream`).
- Produces: `LocalFileService.createFromStream(stream: Readable, file: { id: string; name: string }, shareId: string, maxBytes: number): Promise<{ id: string; name: string; size: string }>`. `FileService.createFromStream(stream, file, shareId, maxBytes)` delegates to the current storage service (mirrors the existing `FileService.create` pattern). Task 4 calls `FileService.createFromStream`.

- [ ] **Step 1: Add `createFromStream` to `LocalFileService`**

Add this method to `backend/src/file/local.service.ts` (same class as the existing `create`/`complete` methods):

```ts
  async createFromStream(
    stream: Readable,
    file: { id: string; name: string },
    shareId: string,
    maxBytes: number,
  ) {
    await fs.mkdir(`${SHARE_DIRECTORY}/${shareId}`, { recursive: true });

    const finalPath = `${SHARE_DIRECTORY}/${shareId}/${file.id}`;
    const writeStream = createWriteStream(finalPath);

    let bytesWritten = 0;
    let limitExceeded = false;

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (buf: Buffer) => {
        bytesWritten += buf.byteLength;
        if (bytesWritten > maxBytes && !limitExceeded) {
          limitExceeded = true;
          stream.destroy();
          writeStream.destroy();
        }
      });
      stream.on("error", (err) => {
        if (!limitExceeded) reject(err);
      });
      writeStream.on("error", (err) => {
        if (!limitExceeded) reject(err);
      });
      writeStream.on("close", () => resolve());
      stream.pipe(writeStream);
    });

    if (limitExceeded) {
      await fs.unlink(finalPath).catch(() => {});
      throw new HttpException(
        "Max share size exceeded",
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    await this.prisma.file.create({
      data: {
        id: file.id,
        name: file.name,
        size: bytesWritten.toString(),
        share: { connect: { id: shareId } },
      },
    });

    return { id: file.id, name: file.name, size: bytesWritten.toString() };
  }
```

`Readable` and `HttpException`/`HttpStatus` are already imported at the top of `local.service.ts` (`HttpException`, `HttpStatus` come from `@nestjs/common`, already imported; `Readable` is already imported from `"stream"`).

- [ ] **Step 2: Add the facade method to `FileService`**

In `backend/src/file/file.service.ts`, add next to the existing `create` method:

```ts
  async createFromStream(
    stream: Readable,
    file: { id: string; name: string },
    shareId: string,
    maxBytes: number,
  ) {
    const storageService = this.getStorageService();
    return storageService.createFromStream(stream, file, shareId, maxBytes);
  }
```

- [ ] **Step 3: Verify manually with a throwaway script**

Run:
```bash
cd backend && npx ts-node -e "
import { createReadStream, writeFileSync } from 'fs';
writeFileSync('/tmp/plan-test.txt', 'hello world');
const s = createReadStream('/tmp/plan-test.txt');
console.log('stream created, byteLength check happens inside LocalFileService — verified via Task 4 end-to-end test instead');
"
```
Expected: no error (this step just confirms the file compiles; the real behavioral check happens once the controller exists in Task 4 — TypeScript will fail to compile Task 2 in isolation if there's a type error, which is the useful signal here).

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: no new type errors introduced by this task.

- [ ] **Step 4: Commit**

```bash
git add backend/src/file/local.service.ts backend/src/file/file.service.ts
git commit -m "feat(upload): add streaming write path to LocalFileService"
```

---

### Task 3: Streaming write support in S3FileService

**Files:**
- Modify: `backend/src/file/s3.service.ts`

**Interfaces:**
- Consumes: existing `this.getS3Instance()`, `this.getS3Path()`, `this.config`, `this.prisma`, and the S3 SDK commands already imported in this file (`CreateMultipartUploadCommand`, `UploadPartCommand`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand`).
- Produces: `S3FileService.createFromStream(stream: Readable, file: { id: string; name: string }, shareId: string, maxBytes: number): Promise<{ id: string; name: string; size: string }>` — same signature as `LocalFileService.createFromStream` (Task 2), so `FileService.createFromStream` (already written in Task 2) works for either storage provider without changes.

- [ ] **Step 1: Add `createFromStream` to `S3FileService`**

Add this method to `backend/src/file/s3.service.ts`:

```ts
  async createFromStream(
    stream: Readable,
    file: { id: string; name: string },
    shareId: string,
    maxBytes: number,
  ) {
    const key = `${this.getS3Path()}${shareId}/${file.name}`;
    const bucketName = this.config.get("s3.bucketName");
    const s3Instance = this.getS3Instance();
    const partSize = 10 * 1024 * 1024; // 10MB per part, bounds peak memory use

    const multipartInitResponse = await s3Instance.send(
      new CreateMultipartUploadCommand({ Bucket: bucketName, Key: key }),
    );
    const uploadId = multipartInitResponse.UploadId;
    if (!uploadId) {
      throw new Error("Failed to initialize multipart upload.");
    }

    const parts: Array<{ ETag: string | undefined; PartNumber: number }> = [];
    let partNumber = 1;
    let totalBytes = 0;
    let buffered: Buffer[] = [];
    let bufferedBytes = 0;

    const uploadPart = async (data: Buffer) => {
      const uploadPartResponse: UploadPartCommandOutput = await s3Instance.send(
        new UploadPartCommand({
          Bucket: bucketName,
          Key: key,
          PartNumber: partNumber,
          UploadId: uploadId,
          Body: data,
        }),
      );
      parts.push({ ETag: uploadPartResponse.ETag, PartNumber: partNumber });
      partNumber++;
    };

    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          throw new HttpException(
            "Max share size exceeded",
            HttpStatus.PAYLOAD_TOO_LARGE,
          );
        }
        buffered.push(chunk);
        bufferedBytes += chunk.byteLength;
        if (bufferedBytes >= partSize) {
          await uploadPart(Buffer.concat(buffered));
          buffered = [];
          bufferedBytes = 0;
        }
      }
      if (bufferedBytes > 0) {
        await uploadPart(Buffer.concat(buffered));
      }

      await s3Instance.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucketName,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
    } catch (error) {
      await s3Instance
        .send(
          new AbortMultipartUploadCommand({
            Bucket: bucketName,
            Key: key,
            UploadId: uploadId,
          }),
        )
        .catch(() => {});
      throw error;
    }

    await this.prisma.file.create({
      data: {
        id: file.id,
        name: file.name,
        size: totalBytes.toString(),
        share: { connect: { id: shareId } },
      },
    });

    return { id: file.id, name: file.name, size: totalBytes.toString() };
  }
```

This needs `HttpException`, `HttpStatus` imported — they already are (`s3.service.ts` imports `BadRequestException, Injectable, InternalServerErrorException, NotFoundException, Logger` from `@nestjs/common`; add `HttpException, HttpStatus` to that import list).

- [ ] **Step 2: Add the two missing imports**

In `backend/src/file/s3.service.ts`, change:
```ts
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
```
to:
```ts
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
```

- [ ] **Step 3: Verify it compiles**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/file/s3.service.ts
git commit -m "feat(upload): add streaming multipart write path to S3FileService"
```

---

### Task 4: UploadController — the actual `PUT /api/upload/:token/:filename` endpoint

**Files:**
- Create: `backend/src/file/upload.controller.ts`
- Modify: `backend/src/file/file.module.ts`
- Modify: `backend/src/main.ts`

**Interfaces:**
- Consumes: `ReverseShareService.isValid(token)`, `ReverseShareService.getByToken(token)` (both existing), `ShareService.create(dto, user, reverseShareToken)` and `ShareService.complete(shareId, reverseShareToken)` (both existing), `FileService.createFromStream` and `FileService.deleteAllFiles` (existing/Task 2), `sanitizeFilename` (Task 1).
- Produces: the live endpoint. Nothing downstream depends on new exports from this task.

- [ ] **Step 1: Bypass the global raw-body parser for this path**

In `backend/src/main.ts`, the existing middleware is:
```ts
  app.use((req: Request, res: Response, next: NextFunction) => {
    const chunkSize = config.get("share.chunkSize");
    bodyParser.raw({
      type: "application/octet-stream",
      limit: `${chunkSize}B`,
    })(req, res, next);
  });
```
Change it to skip the new upload path entirely, so the request body is never buffered before reaching the controller:
```ts
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api/upload/")) return next();
    const chunkSize = config.get("share.chunkSize");
    bodyParser.raw({
      type: "application/octet-stream",
      limit: `${chunkSize}B`,
    })(req, res, next);
  });
```

- [ ] **Step 2: Write the controller**

```ts
// backend/src/file/upload.controller.ts
import {
  Controller,
  Put,
  Param,
  Req,
  Res,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Request, Response } from "express";
import * as crypto from "crypto";
import { ConfigService } from "src/config/config.service";
import { PrismaService } from "src/prisma/prisma.service";
import { ReverseShareService } from "src/reverseShare/reverseShare.service";
import { ShareService } from "src/share/share.service";
import { sanitizeFilename } from "src/utils/filename.util";
import { FileService } from "./file.service";

@Controller("upload")
export class UploadController {
  constructor(
    private reverseShareService: ReverseShareService,
    private shareService: ShareService,
    private fileService: FileService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  @Put(":token/:filename")
  @SkipThrottle()
  async upload(
    @Param("token") token: string,
    @Param("filename") rawFilename: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const isValid = await this.reverseShareService.isValid(token);
    if (!isValid) {
      res
        .status(HttpStatus.FORBIDDEN)
        .type("text/plain")
        .send("Reverse share token not found, expired, or exhausted\n");
      return;
    }

    let filename: string;
    try {
      filename = sanitizeFilename(rawFilename);
    } catch {
      res
        .status(HttpStatus.BAD_REQUEST)
        .type("text/plain")
        .send("Invalid filename\n");
      return;
    }

    const reverseShare = await this.reverseShareService.getByToken(token);
    const maxBytes = Math.min(
      parseInt(reverseShare.maxShareSize),
      this.config.get("share.maxSize"),
    );

    const shareId = crypto.randomUUID();
    const fileId = crypto.randomUUID();

    await this.shareService.create(
      {
        id: shareId,
        expiration: "0-days",
        recipients: [],
        security: undefined,
      } as any,
      undefined,
      token,
    );

    try {
      await this.fileService.createFromStream(
        req,
        { id: fileId, name: filename },
        shareId,
        maxBytes,
      );
    } catch (e) {
      await this.fileService.deleteAllFiles(shareId).catch(() => {});
      await this.prisma.share.delete({ where: { id: shareId } }).catch(() => {});

      const status =
        e instanceof HttpException ? e.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
      const message = e instanceof HttpException ? e.message : "Upload failed";
      res.status(status).type("text/plain").send(`${message}\n`);
      return;
    }

    await this.shareService.complete(shareId, token);

    const appUrl = this.config.get("general.appUrl");
    res
      .status(HttpStatus.CREATED)
      .type("text/plain")
      .send(`${appUrl}/s/${shareId}\n`);
  }
}
```

- [ ] **Step 3: Register the controller in `FileModule`**

`backend/src/file/file.module.ts` already imports `ShareModule` (which exports `ShareService`) and `ReverseShareModule`. `PrismaService` needs no explicit import — `PrismaModule` (`backend/src/prisma/prisma.module.ts`) is decorated `@Global()`, so `PrismaService` is already injectable anywhere, exactly like `FileController` already does.

Update `backend/src/file/file.module.ts`:
```ts
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { EmailModule } from "src/email/email.module";
import { ReverseShareModule } from "src/reverseShare/reverseShare.module";
import { ShareModule } from "src/share/share.module";
import { FileController } from "./file.controller";
import { FileService } from "./file.service";
import { LocalFileService } from "./local.service";
import { PublicFileController } from "./public-file.controller";
import { S3FileService } from "./s3.service";
import { UploadController } from "./upload.controller";

@Module({
  imports: [
    JwtModule.register({}),
    ReverseShareModule,
    ShareModule,
    EmailModule,
  ],
  controllers: [FileController, PublicFileController, UploadController],
  providers: [FileService, LocalFileService, S3FileService],
  exports: [FileService],
})
export class FileModule {}
```

- [ ] **Step 4: Start the dev server and verify manually**

Run: `cd backend && npm run dev` (leave running)

In another terminal, create a reverse share token directly against a running local instance (replace credentials with a real local test user, and adjust `API_URL` if different):
```bash
API_URL=http://localhost:8080/api
curl -c /tmp/cookies.txt -s -X POST $API_URL/auth/signIn \
  -H "Content-Type: application/json" \
  -d '{"email":"<test-user-email>","password":"<test-user-password>"}' > /dev/null

TOKEN=$(curl -b /tmp/cookies.txt -s -X POST $API_URL/reverseShares \
  -H "Content-Type: application/json" \
  -d '{"shareExpiration":"1-days","maxShareSize":"1000000000","maxUseCount":5,"sendEmailNotification":false,"simplified":true,"publicAccess":true}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

echo "hello world" > /tmp/plan-test.txt
curl -T /tmp/plan-test.txt "http://localhost:8080/api/upload/$TOKEN/"
```

Expected: the last command prints a `201`-backed plain-text link like `http://localhost:3000/s/<uuid>` (verify status with `-w '\n%{http_code}\n'` appended to the curl command if you want to see the code explicitly).

Then verify token exhaustion and size limits:
```bash
# Repeat the same upload 5 more times to exceed maxUseCount:5, expect 403 on the 6th
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code}\n" -T /tmp/plan-test.txt "http://localhost:8080/api/upload/$TOKEN/"
done
```
Expected: five `201`s (this token already has 1 use from the earlier upload, so uses 2-6 here) then `403` on the last one, since `maxUseCount` was 5.

- [ ] **Step 5: Confirm no type errors**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/file/upload.controller.ts backend/src/file/file.module.ts backend/src/main.ts
git commit -m "feat(upload): add PUT /api/upload/:token/:filename endpoint for curl-based uploads"
```

---

### Task 5: Return `apiUploadUrl` from Reverse Share creation

**Files:**
- Modify: `backend/src/reverseShare/reverseShare.controller.ts`

**Interfaces:**
- Produces: `POST /reverseShares` response gains `apiUploadUrl: string` alongside the existing `token` and `link`. Task 6 (frontend) consumes this field.

- [ ] **Step 1: Update the response**

In `backend/src/reverseShare/reverseShare.controller.ts`, change:
```ts
  @Post()
  @UseGuards(JwtGuard)
  async create(@Body() body: CreateReverseShareDTO, @GetUser() user: User) {
    const token = await this.reverseShareService.create(body, user.id);

    const link = `${this.config.get("general.appUrl")}/upload/${token}`;

    return { token, link };
  }
```
to:
```ts
  @Post()
  @UseGuards(JwtGuard)
  async create(@Body() body: CreateReverseShareDTO, @GetUser() user: User) {
    const token = await this.reverseShareService.create(body, user.id);

    const appUrl = this.config.get("general.appUrl");
    const link = `${appUrl}/upload/${token}`;
    const apiUploadUrl = `${appUrl}/api/upload/${token}/`;

    return { token, link, apiUploadUrl };
  }
```

- [ ] **Step 2: Verify manually**

With the dev server running (Task 4, Step 4), re-run the reverse share creation curl call and confirm the JSON now has three keys:
```bash
curl -b /tmp/cookies.txt -s -X POST http://localhost:8080/api/reverseShares \
  -H "Content-Type: application/json" \
  -d '{"shareExpiration":"1-days","maxShareSize":"1000000000","maxUseCount":5,"sendEmailNotification":false,"simplified":true,"publicAccess":true}'
```
Expected: JSON object with `token`, `link`, and `apiUploadUrl` (the last ending in `/api/upload/<token>/`).

- [ ] **Step 3: Commit**

```bash
git add backend/src/reverseShare/reverseShare.controller.ts
git commit -m "feat(upload): include apiUploadUrl in reverse share creation response"
```

---

### Task 6: Frontend — show the curl command after creating a Reverse Share

**Files:**
- Modify: `frontend/src/components/upload/CopyTextField.tsx`
- Modify: `frontend/src/components/share/modals/showCompletedReverseShareModal.tsx`
- Modify: `frontend/src/components/share/modals/showCreateReverseShareModal.tsx`
- Modify: `frontend/src/i18n/translations/en-US.ts`

**Interfaces:**
- Consumes: `apiUploadUrl` field from Task 5's `POST /reverseShares` response.
- Produces: no new exports consumed elsewhere — this is the leaf of the chain.

- [ ] **Step 1: Make `CopyTextField` reusable for non-link text (the curl command)**

`CopyTextField` currently hardcodes the label (`t("common.text.link")`) and always shows an "open in browser" icon — wrong for a shell command. Add two optional props with defaults that preserve current behavior everywhere else it's used.

In `frontend/src/components/upload/CopyTextField.tsx`, change the function signature and usages:
```tsx
function CopyTextField(props: {
  link: string;
  label?: string;
  hideOpenLink?: boolean;
}) {
  const clipboard = useClipboard({ timeout: 500 });
  const t = useTranslate();

  const [checkState, setCheckState] = useState(false);
  const [textClicked, setTextClicked] = useState(false);
  const timerRef = useRef<number | ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const copyLink = () => {
    clipboard.copy(props.link);
    toast.success(t("common.notify.copied-link"));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCheckState(false);
    }, 1500);
    setCheckState(true);
  };

  return (
    <TextInput
      readOnly
      label={props.label ?? t("common.text.link")}
      variant="filled"
      value={props.link}
      onClick={() => {
        if (!textClicked) {
          copyLink();
          setTextClicked(true);
        }
      }}
      rightSectionWidth={props.hideOpenLink ? 31 : 62}
      rightSection={
        <>
          {!props.hideOpenLink && (
            <Tooltip
              label={t("common.text.navigate-to-link")}
              position="top"
              offset={-2}
              openDelay={200}
            >
              <a href={props.link}>
                <ActionIcon>
                  <IoOpenOutline />
                </ActionIcon>
              </a>
            </Tooltip>
          )}

          {window.isSecureContext && (
            <Tooltip
              label={t("common.button.clickToCopy")}
              position="top"
              offset={-2}
              openDelay={200}
            >
              <ActionIcon onClick={copyLink}>
                {checkState ? <TbCheck /> : <TbCopy />}
              </ActionIcon>
            </Tooltip>
          )}
        </>
      }
    />
  );
}
```

- [ ] **Step 2: Pass `apiUploadUrl` through the create-modal callback**

In `frontend/src/components/share/modals/showCreateReverseShareModal.tsx`, change:
```ts
    shareService
      .createReverseShare(
        values.expiration_num + values.expiration_unit,
        values.maxShareSize,
        values.maxUseCount,
        values.sendEmailNotification,
        values.simplified,
        values.publicAccess,
      )
      .then(({ link }) => {
        modals.closeAll();
        showCompletedReverseShareModal(modals, link, getReverseShares);
      })
      .catch(toast.axiosError);
```
to:
```ts
    shareService
      .createReverseShare(
        values.expiration_num + values.expiration_unit,
        values.maxShareSize,
        values.maxUseCount,
        values.sendEmailNotification,
        values.simplified,
        values.publicAccess,
      )
      .then(({ link, apiUploadUrl }) => {
        modals.closeAll();
        showCompletedReverseShareModal(
          modals,
          link,
          apiUploadUrl,
          getReverseShares,
        );
      })
      .catch(toast.axiosError);
```

- [ ] **Step 3: Show the curl command in the completed-share modal**

Replace `frontend/src/components/share/modals/showCompletedReverseShareModal.tsx` with:
```tsx
import { Button, Stack } from "@mantine/core";
import { useModals } from "@mantine/modals";
import { ModalsContextProps } from "@mantine/modals/lib/context";
import { FormattedMessage } from "react-intl";
import { translateOutsideContext } from "../../../hooks/useTranslate.hook";
import CopyTextField from "../../upload/CopyTextField";

const showCompletedReverseShareModal = (
  modals: ModalsContextProps,
  link: string,
  apiUploadUrl: string,
  getReverseShares: () => void,
) => {
  const t = translateOutsideContext();
  return modals.openModal({
    closeOnClickOutside: false,
    withCloseButton: false,
    closeOnEscape: false,
    title: t("account.reverseShares.modal.reverse-share-link"),
    children: (
      <Body
        link={link}
        apiUploadUrl={apiUploadUrl}
        getReverseShares={getReverseShares}
      />
    ),
  });
};

const Body = ({
  link,
  apiUploadUrl,
  getReverseShares,
}: {
  link: string;
  apiUploadUrl: string;
  getReverseShares: () => void;
}) => {
  const modals = useModals();
  const t = translateOutsideContext();
  const curlCommand = `curl -T archivo "${apiUploadUrl}"`;

  return (
    <Stack align="stretch">
      <CopyTextField link={link} />

      <CopyTextField
        link={curlCommand}
        label={t("account.reverseShares.modal.curl-command.label")}
        hideOpenLink
      />

      <Button
        onClick={() => {
          modals.closeAll();
          getReverseShares();
        }}
      >
        <FormattedMessage id="common.button.done" />
      </Button>
    </Stack>
  );
};

export default showCompletedReverseShareModal;
```

- [ ] **Step 4: Add the new translation key**

In `frontend/src/i18n/translations/en-US.ts`, next to the existing `account.reverseShares.modal.*` keys, add:
```ts
  "account.reverseShares.modal.curl-command.label": "Curl command (for uploading from a terminal, no browser needed)",
```

- [ ] **Step 5: Verify manually in the browser**

Run: `cd frontend && npm run dev`, then in the browser go to `/account/reverseShares`, click "Create", fill the form and submit. Confirm the completed modal shows two fields: the existing web link, and a new field with a `curl -T archivo "..."` command that ends in `/api/upload/<token>/`. Click the copy icon on the curl field and confirm it copies without the "open in browser" icon being present (that icon should only show on the first field).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/upload/CopyTextField.tsx frontend/src/components/share/modals/showCompletedReverseShareModal.tsx frontend/src/components/share/modals/showCreateReverseShareModal.tsx frontend/src/i18n/translations/en-US.ts
git commit -m "feat(upload): show curl command alongside reverse share link"
```

---

### Task 7: Newman system tests for the curl upload flow

**Files:**
- Modify: `backend/test/newman-system-tests.json`

**Interfaces:**
- Consumes: the live endpoints from Tasks 4 and 5 against a running server (`npm run test:system` starts one).
- Produces: nothing consumed by later tasks — this is the verification safety net for the whole feature.

- [ ] **Step 1: Add a new top-level `item` group**

Open `backend/test/newman-system-tests.json` and add a new object to the top-level `item` array (sibling of the existing `"_setup"`, `"Auth"`, `"Create Share"`, `"Get Share"` groups), placed after `"Create Share"`:

```json
{
  "name": "Curl Upload",
  "item": [
    {
      "name": "Create reverse share for curl upload test",
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test(\"Status code is 201\", () => {",
              "    pm.response.to.have.status(201);",
              "});",
              "",
              "const responseBody = pm.response.json();",
              "pm.collectionVariables.set(\"curlUploadToken\", responseBody.token);",
              "pm.test(\"Response has apiUploadUrl\", () => {",
              "    pm.expect(responseBody).to.have.property(\"apiUploadUrl\");",
              "    pm.expect(responseBody.apiUploadUrl).to.include(responseBody.token);",
              "});"
            ],
            "type": "text/javascript"
          }
        }
      ],
      "request": {
        "method": "POST",
        "header": [],
        "body": {
          "mode": "raw",
          "raw": "{\n    \"shareExpiration\": \"1-days\",\n    \"maxShareSize\": \"1000000\",\n    \"maxUseCount\": 1,\n    \"sendEmailNotification\": false,\n    \"simplified\": true,\n    \"publicAccess\": true\n}",
          "options": { "raw": { "language": "json" } }
        },
        "url": {
          "raw": "{{API_URL}}/reverseShares",
          "host": ["{{API_URL}}"],
          "path": ["reverseShares"]
        }
      },
      "response": []
    },
    {
      "name": "Upload file via curl-style PUT",
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test(\"Status code is 201\", () => {",
              "    pm.response.to.have.status(201);",
              "});",
              "",
              "pm.test(\"Body is a plain-text share link\", () => {",
              "    pm.expect(pm.response.text()).to.include(\"/s/\");",
              "});"
            ],
            "type": "text/javascript"
          }
        }
      ],
      "request": {
        "method": "PUT",
        "header": [],
        "body": {
          "mode": "raw",
          "raw": "This is a test file used for curl-style uploading in the system test."
        },
        "url": {
          "raw": "{{API_URL}}/upload/{{curlUploadToken}}/curl-test-file.txt",
          "host": ["{{API_URL}}"],
          "path": ["upload", "{{curlUploadToken}}", "curl-test-file.txt"]
        }
      },
      "response": []
    },
    {
      "name": "Second upload with exhausted token fails",
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test(\"Status code is 403\", () => {",
              "    pm.response.to.have.status(403);",
              "});"
            ],
            "type": "text/javascript"
          }
        }
      ],
      "request": {
        "method": "PUT",
        "header": [],
        "body": {
          "mode": "raw",
          "raw": "This second upload should be rejected because maxUseCount was 1."
        },
        "url": {
          "raw": "{{API_URL}}/upload/{{curlUploadToken}}/curl-test-file-2.txt",
          "host": ["{{API_URL}}"],
          "path": ["upload", "{{curlUploadToken}}", "curl-test-file-2.txt"]
        }
      },
      "response": []
    }
  ]
}
```

`pm.collectionVariables.set(...)` requires `curlUploadToken` to exist as a collection variable first. The top-level `"variable"` array in the same JSON file currently contains only:
```json
[
  {
    "key": "API_URL",
    "value": "http://localhost:8080/api",
    "type": "string"
  }
]
```
Add a second entry so it reads:
```json
[
  {
    "key": "API_URL",
    "value": "http://localhost:8080/api",
    "type": "string"
  },
  {
    "key": "curlUploadToken",
    "value": "",
    "type": "string"
  }
]
```

- [ ] **Step 2: Run the full system test suite**

Run: `cd backend && npm run test:system`
Expected: all requests pass, including the three new ones (`Create reverse share for curl upload test`, `Upload file via curl-style PUT`, `Second upload with exhausted token fails`). `maxUseCount: 1` sets `remainingUses: 1` at creation; `ShareService.complete` decrements it to `0` after the first successful upload, so `ReverseShareService.isValid` (`remainingUses <= 0`) correctly rejects the second upload with `403`.

- [ ] **Step 3: Commit**

```bash
git add backend/test/newman-system-tests.json
git commit -m "test(upload): add Newman system tests for curl upload endpoint"
```

---

### Task 8: Changelog entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the entry**

Under the existing `## [Unreleased]` heading, in the `### Features` section (create the section if Tasks above already added others and it doesn't exist), add:
```md
* **upload:** new `PUT /api/upload/:token/:filename` endpoint lets you upload a file with a single `curl -T file "<apiUploadUrl>"` command using an existing Reverse Share token — no login, no browser, no script needed
* **reverseShare:** creation response and UI now include a ready-to-copy curl command (`apiUploadUrl`) alongside the existing web link
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add changelog entry for curl upload feature"
```
