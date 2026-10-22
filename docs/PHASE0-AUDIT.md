# Phase 0 audit — the verified state (التدقيق: الحالة المتحقَّق منها)

Date: 2026-10-22 · Baseline: `main` at `a988409` (before Phase 0 started).

This document replaces, as the source of truth, the earlier audit documents
(`ENGINEERING_PROGRESS.md`, `SECURITY_AUDIT.md`, `DATABASE_AUDIT.md`, `PHASE1-REPORT.md`).
Those were written before this audit and each carries a warning banner: **some of what
they say does not match the code** (section 3). Nothing below is taken from them; every row
was checked against the code, and the infrastructure rows were checked by running the images.

**How to read the status column**

- **Fixed** — the change and a test that failed before it are in the repository; the commit is
  named when there is one. "Fixed in the tree" means it is in the working tree of the Phase 0
  branch and waits for the pull request and CI.
- **Being fixed in Phase 0** — the work is in progress on this branch and is not claimed here.
- **Planned Phase 1** — needs the account status, rank and permission-copy design of Phase 1,
  because it must not lock anyone out on deploy day.
- **Owner action** — only the owner can do it (production access, a decision).

## 1. Security findings

| # | Finding | Where in the code (baseline) | Status |
|---|---|---|---|
| S1 | **Open self-registration.** Anyone can create an organisation (and become its OWNER) or join one with its join code. | `src/app/api/auth/register/route.ts` (`registerOrganization`, `joinByCode`); `/register` is a public path in `src/middleware.ts` | **Planned Phase 1** — accounts are created by the owner only and `/register` closes (except for the very first company). Rate-limited since `a36cde0`, still open. |
| S2 | **Sessions cannot be revoked, and removed members keep access.** | `src/server/session.ts`: the token holds only `userId` and an expiry; `currentUser()` never looks at membership or status. `requireWorkspace` returns as soon as a `WorkspaceMember` row exists, even when the organisation membership is gone. | **Planned Phase 1** — account status, a session version checked on every request, and removal deletes every membership. Everyone signs in once more after that release. |
| S3 | **`requireWorkspace` is too permissive.** With no `WorkspaceMember` row it lets any non-GUEST organisation member through, and it ignores its `roles` argument in that case. | `src/server/auth.ts` `requireWorkspace` | **Planned Phase 1** — real membership and rank; the old helper becomes a thin wrapper over the policy module. |
| S4 | **Lists, search, My Work, calendar and analytics were not scoped** to the workspaces the caller can open; analytics counted every organisation in the database. | `src/server/services/views.ts`, `src/app/api/search/route.ts`, analytics and My Work pages | **Fixed** — `f36a82c` (`tests/db/scoping-*.test.ts`). The DM lookup is organisation-bound and refuses a guest peer; idea→task and assignee changes check the target workspace. |
| S5 | **An ADMIN could reset the OWNER's password** (the rank check covered role changes only). | `src/server/services/org-members.ts` `updateOrgMember` | **Fixed** — `8f79867` (`tests/db/org-members.test.ts`). |
| S6 | **No login rate limit and no Origin / CSRF check.** `SameSite=Lax` treats every `*.zakiai.io` site as same-site. | `src/app/api/auth/login/route.ts`; `src/middleware.ts` | **Fixed** — `a36cde0`: per-account and per-address limits (429 + `Retry-After`); the middleware refuses API writes whose Origin is not this app (machine endpoints exempt). |
| S7 | **n8n outbound sent the organisation's secret** in an `x-zaki-token` header with every delivery, and the signature covered the body only (no timestamp, so a captured request replays). The same secret opens the inbound webhook that creates tasks. | `src/server/services/integrations.ts` `emitOutbound`; `src/server/services/n8n.ts` | **Fixed** — `0be23f3`: outbound deliveries follow the ecosystem contract (`X-Zaki-Event` / `Delivery` / `Timestamp` / `Signature` over `timestamp.body`, 5-minute window) and never carry the secret; secrets come from `crypto.randomBytes` (they came from `Math.random`). ⚠️ The inbound webhook still accepts the legacy token header "for now", so existing n8n workflows keep working. 🔧 Remove that path once they send signed requests. |
| S8 | **SSRF on the n8n URL:** any `http://` or `https://` address was accepted, internal ones included. | `src/app/api/integrations/n8n/route.ts` | **Fixed** — `0be23f3`: the URL must be public https and is checked again before every send, with redirects off (`src/server/net-guard.ts`). |
| S9 | **`AUTH_SECRET` doubled as the key for secrets stored in the database**, so rotating it breaks the stored Telegram, n8n and Google secrets. | `src/server/crypto.ts` `key()` | **Fixed in code** — `0be23f3`: an optional `ENCRYPTION_KEY` gives new secrets a key independent of `AUTH_SECRET` (blank = the old behaviour; old values still decrypt) and `scripts/reencrypt-secrets.ts` migrates the stored ones. 🔧 **Owner action** to finish it: set `ENCRYPTION_KEY` in Coolify, then run the script once (section 4). Until then secrets still depend on `AUTH_SECRET`. |
| S10 | **The GUEST (external partner) role could** read CRM values (prices) and delete customers, write tickets and campaigns, use Google Drive and read the staff directory. | CRM, tickets, campaigns and Google routes without a role check; `src/app/api/chat/directory/route.ts` | **Fixed** — `d166125`: a GUEST gets 403 on CRM, departments, Google Drive and the chat directory, cannot create, edit or comment on tickets, campaigns or production routines, and sees names only in member lists; ticket editing is limited to the creator, the assignee, department members and admins; the Google callback requires the signed state to belong to the signed-in manager. |
| S11 | **The demo owner login was published** in a public repository (`lg.json`, `README.md`, `prisma/seed.ts`). | those three files | **Fixed in the tree** — `lg.json` deleted, README cleaned, the seed prints a random password once and refuses production (`ALLOW_PROD_SEED=1` to override); `tests/repo-hygiene.test.ts` and `npm run scan:secrets` (CI) keep it out. ⚠️ The old password stays in the public git history for ever. 🔧 **Owner action:** section 4, check 5. |

## 2. Infrastructure and delivery findings

| # | Finding | Evidence | Status |
|---|---|---|---|
| I1 | **Uploaded files did not reach the volume.** The code wrote to `<cwd>/.data/uploads`, which the non-root container user cannot create (`Permission denied`, reproduced in the pre-Phase-0 image), while compose mounted the volume at `/app/storage/uploads`. The file row is created first, so a failed upload leaves a `StoredFile` row with `path = 'pending'`. | `src/server/services/files.ts`; Dockerfile; `docker-compose.yml` | **Fixed in the tree** — `UPLOAD_DIR` (default unchanged), set to `/app/storage/uploads` in the image, created and owned by the runtime user, mounted at the same path for `app` and `worker`. Verified in the built image: an upload lands on the volume and is still served after the container is replaced. ⚠️ Files uploaded before this fix may be missing: section 4, check 3. |
| I2 | **The worker was not in the image.** `npm run worker` failed with `ERR_MODULE_NOT_FOUND /app/worker/index.ts` (reproduced), so the compose `worker` service could never run. | Dockerfile (`worker/` not copied) | **Fixed in the tree** — the image copies `worker/` (`tsx` was already there: dev dependencies are never pruned). It is still a heartbeat placeholder (a task count every 60 s): there are no background jobs yet, and they are planned to run inside the app process. |
| I3 | **`next.config.mjs` was not copied into the runtime image.** `next start` read no config, so the boot-time environment check (`src/instrumentation.ts`) never ran (no `boot.env_ok` line in the log) and `X-Powered-By: Next.js` was sent. | Dockerfile; `node_modules/next/dist/server/next-server.js` (`instrumentationHook`) | **Fixed in the tree** (verified before and after on the real images). ⚠️ From now on an invalid environment (e.g. `AUTH_SECRET` under 16 characters) stops the container at boot instead of failing on the first login. 🔧 That is the intended behaviour; it is one `COPY` line if you want it reverted. |
| I4 | **`/api/health` is prerendered at build time.** The image answers with the result of the build — `{"status":"degraded","checks":{"database":"fail"}}` and the build's timestamp — for ever, with HTTP 200. The Docker `HEALTHCHECK` only reads the status code, so it can never fail on the database. | `src/app/api/health/route.ts` has no `dynamic = "force-dynamic"`; response header `x-nextjs-cache: HIT` | **Fixed in the tree** — `export const dynamic = "force-dynamic";` added to `src/app/api/health/route.ts` (`tests/health-route.test.ts`; the production build no longer prerenders it). `image.yml` can now see the real database state. |
| I5 | **Node 20 (end of life since April 2026) in the image**, while CI runs the tests on Node 22. | Dockerfile | **Fixed in the tree** — Node 22; builds, migrates and serves. |
| I6 | **No CI and no image build on GitHub;** production built on the same server that serves the live apps. | no `.github/` | **Fixed in the tree** — `ci.yml` (typecheck → lint → unit tests → migration lint → fresh `migrate deploy` → `migrate diff` → `test:db` → secret scan → build) and `image.yml` (build, prove, publish to `ghcr.io/<owner>/zaki-workspace`; the Coolify webhook step is off until its two secrets exist). Each command was run locally against `pgvector/pgvector:pg16`; the workflows themselves run for the first time on the first pull request. |
| I7 | **`docker-compose.yml` publishes Postgres (5433) and Redis (6380) on every interface**, and the database password defaults to a well-known value. | `docker-compose.yml` | **Fixed in the tree** — both ports are published on `127.0.0.1` only (`tests/health-route.test.ts` pins it). The well-known default password still applies wherever `POSTGRES_PASSWORD` is not set, so set it on any server that runs this file. |
| I8 | **Dead files:** `src/app/api/files/[id]/route.delete.ts` (not a route file; it duplicated `DELETE`), `prisma/_d2.sql` and `prisma/_d3.sql`. | byte comparison: both SQL files are identical to `20261017090000_integrations` and `20261017100000_event_optional_link`; the real `DELETE` is in `route.ts` | **Fixed in the tree** — deleted. |
| I9 | **Migration rules were remembered, not enforced** (the 2026-10-19 incident came from a renamed folder and a dependency on a later migration). | `docs/DEPLOYMENT-INCIDENT-2026-10-19.md` | **Fixed in the tree** — `scripts/lint-migrations.mjs` and `prisma/migrations/RELEASED.txt` (all 12 folders), run in `npm test` and CI; a fresh deploy and a drift check run in CI. |
| I10 | **The `redis` service is not used** by any code. | grep: no Redis client in `src/` or `worker/` | Marked in `docker-compose.yml`, not removed. |
| I11 | **The compose `worker` showed as `unhealthy` for ever** once it could actually start: it runs the web image, so it inherits the image's `HEALTHCHECK` (an HTTP probe on port 3000) and it serves nothing. | reproduced with a throw-away copy of the stack: `docker ps` reported `(unhealthy)` | **Fixed in the tree** — the worker service disables the inherited check (`tests/repo-hygiene.test.ts` pins it). |

## 3. Claims in the earlier documents that the code does not support

| Document | Claim | What the code shows |
|---|---|---|
| `ENGINEERING_PROGRESS.md` #4 | "CSRF — origin validation added globally (`origin-host-must-match-host`)" | Nothing of the kind existed: `src/middleware.ts` only checked that a session cookie was present. Added later by `a36cde0`, with a different design. |
| `ENGINEERING_PROGRESS.md` #6 | "login attempts limited to 5 per minute per IP … 6th attempt returns 429" | The login route had no limit at all. Added later by `a36cde0` (per account and per address). |
| `ENGINEERING_PROGRESS.md` #2, #13, #15; `SECURITY_AUDIT.md` Q1 | Chat file download/preview routes, "attachments resolve through conversation membership" | There are no chat attachments: `ChatMessage` has no file field and no chat route serves files. `PHASE1-REPORT.md` itself says "No task/chat attachments yet". |
| `ENGINEERING_PROGRESS.md` #10 | "`createTaskDependency` blocks linking tasks from different orgs" | No such function. `TaskDependency` exists in the schema, but nothing in `src/` creates or reads one. |
| `ENGINEERING_PROGRESS.md` #15 | "`requireAuth()` … `requireOrgAccess()`" | Neither exists. The real guards are `requireUser`, `requireOrgMember`, `requireOrgRole`, `requireWorkspace` and `activeOrgCtx`. |
| `ENGINEERING_PROGRESS.md` #16, #18 | "Integration tests run against local DB", "vitest 68/68 (+ integration tests)" | The suite was logic-only (`tests/security-contracts.test.ts` says "no DB integration harness"). A real-database suite (`npm run test:db`) exists only since `382499f`. |
| `ENGINEERING_PROGRESS.md` #7 | "API resolves workspace from authenticated membership, not client-supplied id" | The workspace id is client-supplied and checked by `requireWorkspace`, which is too permissive (S3); lists were not scoped (S4). |
| `ENGINEERING_PROGRESS.md` #18; `DATABASE_AUDIT.md` | "43 models" | `prisma/schema.prisma` has **42** models (the incident report's 42 tables agrees). |
| `DATABASE_AUDIT.md` §3 | "`StoredFile` uses local disk — production needs a persistent volume" listed as a P3 note | It was a live defect (I1): uploads did not reach the volume. |
| `SECURITY_AUDIT.md` Q1 | "`createDm` / `createGroup` enforce org membership … and reject GUESTS"; "GUEST cannot enumerate or message others" | `createDm` accepted a guest peer and its "existing conversation" lookup was not bound to the organisation; `GET /api/chat/directory` had no role check. Fixed in `f36a82c` (DM) and `d166125` (directory, S10). |
| `PHASE1-REPORT.md` | "ar/fr/en dictionaries", "~150 new keys ar/fr/en" | Only `src/lib/i18n/ar.json` exists. |

## 4. What only the owner can do

**Read-only production checks** — run from the PostgreSQL service's terminal in Coolify
(`psql`). Every statement is a `SELECT`; none changes anything. Send the output.

```sql
-- 1. Which migrations ran, and did any fail? (12 rows, all finished = t, rolled_back_at empty)
SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at
FROM _prisma_migrations ORDER BY started_at;

-- 2. Who is in which workspace, and who is in the organisation?
SELECT o.name AS organisation, w.name AS workspace, u.email, wm.role
FROM "WorkspaceMember" wm
JOIN "Workspace" w ON w.id = wm."workspaceId"
JOIN "Organization" o ON o.id = w."organizationId"
JOIN "User" u ON u.id = wm."userId"
ORDER BY o.name, w.name, u.email;

SELECT o.name AS organisation, u.email, om.role
FROM "OrganizationMember" om
JOIN "Organization" o ON o.id = om."organizationId"
JOIN "User" u ON u.id = om."userId"
ORDER BY o.name, om.role, u.email;

-- 3. Uploaded files: never_written = true are uploads that failed (see I1)
SELECT (path = 'pending') AS never_written, count(*) AS files, coalesce(sum(size), 0) AS bytes
FROM "StoredFile" WHERE "deletedAt" IS NULL GROUP BY 1;

-- 4. Is pgvector available? (no row = not available; Phase 8 needs it before its migration)
SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'vector';

-- 5. Does the published demo account exist? (see S11)
SELECT id, email, "createdAt" FROM "User" WHERE email = 'owner@zaki.local';
```

- **Check 5 returns a row → change that account's password from the app (or delete the
  account) before anything else.** Treat the published password as working until proven otherwise.
- **Uploads:** in Coolify give the application a *persistent storage* mounted at
  `/app/storage/uploads`. Without it every redeploy empties the uploads. The old location
  (`/app/.data/uploads`) could not be created by the container user, so check 3 shows how many
  uploads never reached disk.
- **Wherever `docker-compose.yml` is used** (local, self-hosted): set `POSTGRES_PASSWORD` to a real value; the default is published in this repository.
- **Recommended (finishes S9):** set `ENCRYPTION_KEY` in Coolify to a separate random value
  (`openssl rand -hex 32`), redeploy, then run the re-encryption once from the app container's
  terminal: first `npx tsx scripts/reencrypt-secrets.ts` (a dry run that only counts), then
  `npx tsx scripts/reencrypt-secrets.ts --apply`. It prints counts only, and is safe to repeat.
- **Before the first new migration:** send the output of check 1 — the production state after
  the 2026-10-19 incident was never recorded here.

## 5. How this was verified

- Security rows: the findings come from the audit that produced the Phase 0 plan; the infrastructure
  batch re-read the code behind S1, S2, S3, S7, S8 and S9, and the Google and staff-directory routes
  of S10 (the CRM, ticket and campaign parts of S10 were not re-read here). S4, S5 and S6 are also
  proven by the database tests that shipped with their fixes (`tests/db/`).
- Infrastructure rows: the Dockerfile was built twice — once as it was at `HEAD` and once as it is
  now — and both images were started against a throw-away `pgvector/pgvector:pg16` database. Compared:
  Node version, whether the boot check logs, response headers, whether `UPLOAD_DIR` is writable by
  the runtime user (also on a fresh named volume), `npm run worker`, and the seed (refuses production,
  random password, idempotent). An upload was sent through the API and read back after the container
  was replaced. The image was built again from `0be23f3` (after the other Phase 0 commits): it boots
  with the empty `ENCRYPTION_KEY` that compose passes, and `npx tsx scripts/reencrypt-secrets.ts`
  runs inside it. A throw-away copy of the whole Compose stack was started (other project name, other
  ports): `app` and `worker` mount the same volume at the same path and see the same uploaded file.
  The CI database steps (`migrate deploy`, `migrate status`,
  `migrate diff --exit-code` — which exits 2 on drift — and `npm run test:db`) were run against the
  same kind of server, and the image workflow's own step scripts were extracted and run against the image.
- Not verified, because it cannot be done from here: the GitHub workflows themselves (first run on the
  first pull request), the production database, and Coolify's configuration.
