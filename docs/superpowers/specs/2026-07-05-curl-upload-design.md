# Curl Upload via Reverse Share Token — Design Spec

**Date:** 2026-07-05
**Status:** Draft (approved in brainstorming, pending implementation plan)
**Scope:** Let a user upload a file from any machine with a single `curl` command (no browser, no script installation, no login), reusing the existing Reverse Share token mechanism.

## Problem Statement

The existing upload flow (frontend or raw API) always needs either:
- An interactive browser session, or
- A multi-step authenticated flow (sign in → create share → upload chunks → complete file → complete share), which requires a cookie jar and manual chunking when scripted.

The user needs to move files (from a few MB to several GB) from arbitrary machines — including ones with no browser and no ability to install a helper script — using only `curl`, which is assumed to always be available.

## Goals

- A single `curl` command uploads a file and returns a usable share link, with no prior setup on the target machine beyond having the command (self-contained, SAS-URL style).
- Reuse the existing Reverse Share token (already created once via the web UI) as the auth mechanism — no new token system.
- Support file sizes from a few MB to several GB without buffering the whole file in memory.
- Reuse existing business logic (`ShareService`, `ReverseShareService`) for expiration, size limits, use-count tracking, and email notification — no duplicated rules.

## Non-Goals

- Multi-file uploads in a single request (call `curl` once per file).
- Resumable/chunked uploads for this endpoint (that's what the existing chunked API is for, e.g. from the web frontend).
- Changing how Reverse Share tokens are created, listed, or revoked (`reverseShare.controller.ts` stays as-is except for the response payload addition below).
- Bearer-token/header-based auth for this endpoint (rejected during brainstorming in favor of an all-in-the-URL, SAS-like command).

## User-Facing Command

```bash
curl -T archivo.zip "https://<appUrl>/api/upload/<token>/"
```

`curl -T` (`--upload-file`) issues an HTTP `PUT`. Because the URL ends in `/`, curl automatically appends the local file's basename to the URL — the user never has to type or escape a filename.

## API Changes

### New endpoint: `PUT /api/upload/:token/:filename`

- No `JwtGuard` / cookie auth. Auth is the Reverse Share `:token` itself, validated the same way `ReverseShareController.getByToken` already does (`ReverseShareService.isValid()`).
- `:filename` is taken as-is from the URL path segment (must be sanitized — reject path traversal sequences like `..`, strip directory separators).
- Request body is the raw file content (whatever `curl -T` sends), not multipart — no field name, no boundary parsing needed.
- Response:
  - `201 Created`, `Content-Type: text/plain`, body = the share link (e.g. `https://<appUrl>/s/<shareId>\n`).
  - `403 Forbidden` (plain text) — token invalid, expired, or `remainingUses <= 0`.
  - `413 Payload Too Large` (plain text) — upload exceeded `reverseShare.maxShareSize` or the global `share.maxSize`.
  - `400 Bad Request` (plain text) — malformed filename.

### Updated endpoint: `POST /reverseShares` (existing, `reverseShare.controller.ts`)

Add one field to the existing response, built the same way `link` already is (via `general.appUrl` config — never a hardcoded domain):

```ts
const appUrl = this.config.get("general.appUrl");
const link = `${appUrl}/upload/${token}`;
const apiUploadUrl = `${appUrl}/api/upload/${token}/`;

return { token, link, apiUploadUrl };
```

### Frontend: Reverse Shares screen (`frontend/src/pages/account/reverseShares.tsx`)

When a token is generated, show two options:
- The existing web upload link (`link`).
- A ready-to-copy curl command built from `apiUploadUrl`:
  ```bash
  curl -T <archivo> "<apiUploadUrl>"
  ```
  with a "copy command" button.

## Request Flow (Backend)

1. Validate `:token` via `ReverseShareService.isValid()`. Reject early (403) if invalid/expired/exhausted — before touching disk.
2. Sanitize `:filename` (reject empty, `..`, `/`, `\`).
3. Generate a `shareId` (`crypto.randomUUID()`) and a `fileId` (`crypto.randomUUID()`).
4. Create the share via the existing `ShareService.create({ id: shareId, security: undefined, recipients: [] }, undefined, token)`. This already:
   - Overrides expiration from `reverseShare.shareExpiration`.
   - Links the share to the reverse share token (`reverseShare.shares.connect`).
   - Picks `storageProvider` (LOCAL or S3) from config.
5. Stream the request body directly to storage (see "Streaming" below), enforcing size limits as bytes arrive.
6. On successful write, register the file (same DB shape `LocalFileService.complete` produces: `id`, `name`, `size`).
7. Call the existing `ShareService.complete(shareId, token)`. This already handles, with no new code:
   - Decrementing `reverseShare.remainingUses`.
   - Emailing the reverse share creator if `sendEmailNotification` is enabled.
   - Kicking off the ClamAV scan.
   - Marking the share `uploadLocked`.
8. Respond `201` with the plain-text link.

If step 5 fails partway (size exceeded, disk error), the partially-written file and the created share/DB rows must be cleaned up (delete share cascade, as `ReverseShareService.remove` already does when tearing down a reverse share's children) so no orphaned, incomplete shares are left behind.

## Streaming (the one genuinely new piece)

The existing chunked upload path (`FileController.create` → `LocalFileService.create`/`S3FileService.create`) always receives a fully-buffered `Buffer` per chunk (`bodyParser.raw`, limited to chunk size, default 10MB). That's fine for browser-driven chunking but not for a single `PUT` that might be several GB — buffering the whole body in memory is out of the question.

This endpoint bypasses the global `bodyParser.raw` (it must not be registered against the `/api/upload` path) and reads the raw Node request stream directly:

- **Local storage:** pipe the request stream straight into `fs.createWriteStream(finalPath)`. No chunk files, no reassembly step — the request *is* the file, written incrementally.
- **S3 storage:** initialize a multipart upload (`CreateMultipartUploadCommand`, same as `S3FileService.create` already does), then accumulate the incoming stream into ~10MB parts in memory and call `UploadPartCommand` per part as each fills, so peak memory stays bounded to one part regardless of total file size.
- **Size enforcement while streaming:** track bytes written as they arrive; if the running total exceeds `reverseShare.maxShareSize` or the global `share.maxSize`, abort the write (delete the partial local file, or `AbortMultipartUploadCommand` for S3), delete the created share, and respond `413`. Don't rely solely on `Content-Length`, since it isn't guaranteed to be present or accurate for all `curl -T` invocations.

## Error Handling Summary

| Condition | Response |
|---|---|
| Token doesn't exist / expired / `remainingUses <= 0` | `403`, plain text |
| Invalid filename (empty, traversal characters) | `400`, plain text |
| Size exceeds `maxShareSize` or global `share.maxSize` | `413`, plain text, partial data cleaned up |
| Disk full / S3 error mid-stream | `500`, plain text, partial data cleaned up |
| Success | `201`, plain text share link |

Plain text errors (not JSON) so `curl -f` fails cleanly in scripts without needing a JSON parser.

## Testing

- Newman/system test: create a reverse share via the authenticated API, then `PUT` a small file to `/api/upload/:token/:filename` without any auth cookie, assert `201` and that the returned link resolves to a share containing exactly that one file.
- Test token exhaustion: use a reverse share with `maxUseCount: 1`, upload twice, assert the second returns `403`.
- Test oversized upload: reverse share with a small `maxShareSize`, upload a larger file, assert `413` and that no orphaned share/file rows or partial files remain on disk.
- Manual test: `curl -T` a multi-GB file against a local dev instance, watch backend memory stay flat (not growing with file size).

## Risks

- **Bypassing global body parsing for one path** is the main technical risk — needs care to ensure this route truly isn't touched by `bodyParser.raw`/`json`/`urlencoded`, in either direction (not double-parsed, not left unconsumed).
- Filename sanitization is a security boundary (path traversal) — must be enforced before any filesystem interaction.
