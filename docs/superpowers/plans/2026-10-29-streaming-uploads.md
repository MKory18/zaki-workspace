# Streaming Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent upload endpoints from materializing the complete multipart file in memory while preserving validation, authorization, storage, and API responses.

**Architecture:** Keep the existing route contracts and `ingest` behavior. Replace `File.arrayBuffer()` at each upload boundary with a bounded multipart streaming helper that writes a temporary file, captures only a bounded prefix for MIME sniffing, enforces the existing per-kind and 25 MB limits, then hands a file-backed input to the storage service. Temporary files are removed on success and every failure.

**Tech Stack:** Next.js 14 route handlers, Web Streams, Node `fs`, TypeScript, Vitest, PostgreSQL DB tests.

**Spec:** D10 upload-memory finding; project rules in `AGENTS.md`.

## Global Constraints

- Do not send customer data to an external model.
- Preserve existing authorization and Arabic machine-error keys.
- No destructive migration or database reset.
- Every behavior change gets a failing-before/pass-after test.
- Keep the public API response shapes unchanged.
- Uploaded bytes must be sniffed from content; client MIME remains untrusted.
- Temporary files must not become stored-file rows or remain after failure.

## Review Focus

- A file exactly at the limit succeeds and one byte over it fails without a permanent row.
- A declared MIME type cannot override magic-byte sniffing.
- Failure during disk/Drive persistence removes both the temporary file and pending database row.
- Chat-specific kind limits still apply without buffering the entire file.
- Concurrent uploads use unique temporary paths and cannot read one another's bytes.

---

### Task 1: File-backed upload primitive

**Files:**
- Create: `src/server/files/upload-stream.ts`
- Modify: `src/server/files/sniff.ts` only if a bounded-prefix helper is needed
- Test: `tests/upload-stream.test.ts`

**Interfaces:**
- Produces `receiveUpload(stream: ReadableStream<Uint8Array>, options): Promise<ReceivedUpload>`.
- `ReceivedUpload` exposes temporary path, byte count, bounded prefix, and cleanup; it never exposes a complete in-memory byte array.
- Enforces a caller-provided byte limit while writing chunks to a unique temp file.

- [ ] Write tests for chunked writes, exact limit, over-limit cleanup, empty input, and concurrent unique paths.
- [ ] Run the focused test and verify it fails before implementation.
- [ ] Implement the primitive with `fs.open`/stream reads, bounded prefix capture, and `finally`-safe cleanup.
- [ ] Run focused tests and verify all pass.
- [ ] Commit `feat(files): add bounded streaming upload primitive`.

### Task 2: File-service ingest from disk

**Files:**
- Modify: `src/server/services/files.ts`
- Test: `tests/db/streaming-file-ingest.test.ts`

**Interfaces:**
- Add a file-backed ingest path that accepts `{ path, size, prefix, name }` and preserves `ingest` authorization, MIME sniffing, pending-row behavior, Drive fallback, versioning, and cleanup.
- Keep the existing byte-array path for trusted internal callers until all routes migrate.

- [ ] Add DB tests for accepted upload, over-limit rejection without a row, and persistence failure cleanup.
- [ ] Run tests against the old implementation and verify failure.
- [ ] Implement the minimal file-backed path; hash/read/write in bounded chunks and never build a full `Uint8Array`.
- [ ] Run focused DB tests and verify pass.
- [ ] Commit `feat(files): ingest uploads from temporary files`.

### Task 3: Migrate all multipart routes

**Files:**
- Modify: `src/app/api/files/route.ts`
- Modify: `src/app/api/files/[id]/versions/route.ts`
- Modify: `src/app/api/chat/uploads/route.ts`
- Modify: `src/server/chat/attachments.ts` only where the new input type is consumed
- Test: existing route DB tests plus `tests/db/streaming-upload-routes.test.ts`

**Interfaces:**
- Routes pass the temporary file-backed upload to the service and keep status codes, error keys, metadata, and response JSON unchanged.
- Chat route applies `CHAT_LIMITS` before persistence and retains declared-kind validation.

- [ ] Add route-level tests proving library, version, and chat uploads use the file-backed path and preserve MIME/kind behavior.
- [ ] Run focused tests against old routes and verify the new assertions fail.
- [ ] Replace every `req.formData()` + `entry.arrayBuffer()` upload path with the shared bounded receiver.
- [ ] Run focused route tests and verify pass.
- [ ] Commit `fix(files): stream multipart uploads without buffering`.

### Task 4: Full verification and PR

**Files:**
- Modify: none unless gates identify a task-scoped defect
- Test: full repository gates

- [ ] Run typecheck, lint, unit tests, DB tests, migration lint, secret scan, and build.
- [ ] Run `git diff --check` and verify no temporary files are tracked.
- [ ] Run an independent review focused on memory bounds, cleanup, security, and API compatibility.
- [ ] Push branch and open one PR with Definition of Done and known local Windows-only failures.
