# Zaki Workspace

AI-powered collaborative work operating system: projects, Kanban boards, tasks,
teams, ideas, documents, Telegram integration, automation and an AI assistant.

Status: **Phase 1 (foundation) + first vertical slice implemented; Phase 0
(security hardening and cleanup) in progress** — see `docs/PHASE0-AUDIT.md` for the
verified state of every known gap. Rules for people and coding agents working in this
repository are in `AGENTS.md`.

## Stack

| Layer    | Choice |
| -------- | ------ |
| Frontend | Next.js 14 (App Router), React 18, TypeScript strict, Tailwind CSS 3, TanStack Query, @dnd-kit, lucide-react |
| Backend  | Next.js route handlers, Zod-validated typed contracts, centralized error mapping |
| Database | PostgreSQL 16 + Prisma (migrations in `prisma/migrations`) |
| Worker   | Node service (`worker/index.ts`) — a heartbeat placeholder today, no jobs yet |
| Tests    | Vitest: `tests/` (no database) and `tests/db/` (real Postgres) |
| Deploy   | Docker image built by GitHub Actions, run on Coolify (`workspace.zakiai.io`); Compose for local and self-hosted runs |

## Layout

```
src/app/(app)/       authenticated app pages (dashboard, projects, boards, tasks)
src/app/api/         REST endpoints (auth, workspaces, projects, boards, tasks, health)
src/components/      UI shell, board, task detail, primitives
src/server/          db, env validation, session, rbac, task service, logging
prisma/              schema + migrations + seed
worker/              background worker (heartbeat placeholder)
scripts/             secret scanner, migration linter, operator scripts (re-encrypt secrets)
.github/workflows/   CI (ci.yml) and the image build (image.yml)
docker-compose.yml   app + worker + db + redis (not used yet) + migrate
```

## Local development

1. Start Postgres and create your `.env`:
   ```sh
   docker compose up db -d          # Postgres 16 on localhost:5433
   cp .env.example .env
   ```
   In `.env` set `DATABASE_URL` (for the compose database:
   `postgresql://zaki:zaki_local@localhost:5433/zaki_workspace`) and `AUTH_SECRET`
   (a long random string: `openssl rand -hex 32`). `.env` is git-ignored — never commit it.
2. Install, apply the committed migrations, seed:
   ```sh
   npm install
   npm run db:deploy      # applies prisma/migrations to your database
   npm run db:seed        # demo organization + owner login (see below)
   ```
   `npm run db:migrate` (`prisma migrate dev`) is only for creating a NEW migration after
   changing `schema.prisma`. If it ever offers to **reset** the database, answer no.
3. Run:
   ```sh
   npm run dev        # app on :3000
   npm run worker     # optional: the heartbeat worker
   ```

The seed creates the demo owner with a **random password printed once** in your terminal
(it is not stored anywhere else). Set `SEED_OWNER_PASSWORD` to choose it, `SEED_OWNER_EMAIL`
to choose the address. The seed refuses to run when `NODE_ENV=production`, or when
`DATABASE_URL` points at another machine, unless `ALLOW_PROD_SEED=1` — never seed a real
database.

## Environment variables

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Signs session cookies (16+ characters; use `openssl rand -hex 32`) |
| `APP_URL` | yes in production | Public URL of the app (OAuth redirects, links) |
| `ENCRYPTION_KEY` | no | Key for secrets stored in the database (Telegram, n8n, Google). Empty = derived from `AUTH_SECRET`, the old behaviour. Set a separate random value (`openssl rand -hex 32`) so rotating `AUTH_SECRET` does not break the stored secrets, then run `scripts/reencrypt-secrets.ts` once |
| `UPLOAD_DIR` | no | Folder where uploaded files are written. Default `.data/uploads` in the working directory; the Docker image sets `/app/storage/uploads`, which must be a persistent volume |
| `SESSION_TTL_HOURS` | no | Session lifetime, default 168 (one week) |
| `LOG_LEVEL` | no | `debug`, `info` (default), `warn` or `error` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Read-only Google Drive integration |
| `TEST_DATABASE_ADMIN_URL` | tests only | A Postgres server for `npm run test:db`, with a role that may `CREATE DATABASE` (see Testing). Falls back to `DATABASE_URL` |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `ALLOW_PROD_SEED` | seed only | See Local development |

Never put real values in `.env.example`, the README or any tracked file; production values
live in Coolify's environment.

## Testing

```sh
npm run typecheck
npm run lint
npm test                         # unit tests, no database needed
node scripts/lint-migrations.mjs # migration rules (also part of `npm test`)
npm run test:db                  # tests against a real Postgres (below)
npm run scan:secrets             # fails on anything that looks like a committed secret
npm run build                    # production build gate
```

CI (`.github/workflows/ci.yml`) runs all of these on every pull request, plus a fresh
`prisma migrate deploy` on an empty database and `prisma migrate diff` against
`schema.prisma`. A red or conflicting pull request is never merged.

**Database tests (`npm run test:db`).** Each run creates its own throw-away database on a
Postgres server, applies the real migrations to it, and drops it afterwards, so it can never
touch development or production data. Point it at the compose database:

```sh
docker compose up db -d
export TEST_DATABASE_ADMIN_URL="postgresql://zaki:zaki_local@localhost:5433/postgres"   # or put it in .env
npm run test:db
```

The role needs `CREATEDB`. Hosts other than localhost are refused unless
`ALLOW_REMOTE_TEST_DB=1` (use that only for a disposable server). Set `KEEP_TEST_DB=1` to
keep the database after the run when you need to inspect it.

## Production deployment

Production is the Docker image of this repository, run by **Coolify** at
`workspace.zakiai.io`. The image is built by GitHub Actions
(`.github/workflows/image.yml`) and pushed to `ghcr.io/<owner>/zaki-workspace`, so the
production server never compiles anything. Nothing is deployed until Coolify is pointed at
that image or its webhook is enabled (see the comments in `image.yml`).

- The container applies the migrations (`prisma migrate deploy`) when it starts, then serves
  on port 3000. Put your reverse proxy (Traefik, Caddy, Coolify) in front of it.
- Migrations are additive only and a migration folder that was ever applied is never renamed
  (`prisma/migrations/RELEASED.txt`, `docs/DEPLOYMENT-INCIDENT-2026-10-19.md`).
- Required environment: `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`; optional `ENCRYPTION_KEY`.
- **Uploads:** mount a persistent volume at `/app/storage/uploads` (the image sets
  `UPLOAD_DIR` to that path and creates it for the runtime user). Without a volume, uploaded
  files disappear on every redeploy. If you mount a host folder instead of a named volume,
  it must be writable by the container user `zaki`.
- Back up the database **and** the uploads volume together.

Self-hosting with Compose (also what a developer can use to try the whole stack):

```sh
cp .env.example .env         # set AUTH_SECRET and POSTGRES_PASSWORD (optionally ENCRYPTION_KEY)
docker compose up -d migrate # apply migrations
docker compose up -d app worker
```

- Database persists in `db_data`; uploads in the `uploads` volume.
- The `redis` service is not used by the application yet.
- Back up: `docker compose exec db pg_dump -U zaki zaki_workspace > backup.sql`
- Restore: `docker compose exec -T db psql -U zaki zaki_workspace < backup.sql`
- ⚠️ `db` and `redis` publish their ports (5433, 6380) on every network interface, and `db`
  falls back to a well-known default password when `POSTGRES_PASSWORD` is unset.
  🔧 On a server, set `POSTGRES_PASSWORD` and put a firewall rule (or a `127.0.0.1:` prefix on
  the port mapping) in front of them.

## Security notes

- Passwords are hashed with bcrypt (cost 12); sessions are signed JWTs in httpOnly cookies.
- Every API route validates input with Zod and resolves the caller server-side. Some of the
  authorization rules are known to be too loose or not yet enforced everywhere
  (workspace membership, list scoping, session revocation, open self-registration) — they are
  listed with their status in `docs/PHASE0-AUDIT.md`. Earlier audit documents in `docs/`
  carry a warning banner where they claim more than the code does.
- Secrets live in the environment only. The health endpoint reports component status without
  details. The repository is public: `npm run scan:secrets` runs in CI and fails the build on
  anything that looks like a credential.

## Roadmap

See `docs/ROADMAP.md` for the phased plan (Telegram, automation, AI, analytics).
