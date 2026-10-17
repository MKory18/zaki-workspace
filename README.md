# Zaki Workspace

AI-powered collaborative work operating system: projects, Kanban boards, tasks,
teams, ideas, documents, Telegram integration, automation and an AI assistant.

Status: **Phase 1 (foundation) + first vertical slice implemented.**

## Stack

| Layer    | Choice |
| -------- | ------ |
| Frontend | Next.js 14 (App Router), React 18, TypeScript strict, Tailwind CSS 3, TanStack Query, @dnd-kit, lucide-react |
| Backend  | Next.js route handlers, Zod-validated typed contracts, centralized error mapping |
| Database | PostgreSQL 16 + Prisma (migrations in `prisma/migrations`) |
| Worker   | Dedicated Node service (`worker/index.ts`) |
| Tests    | Vitest (`tests/`) |
| Deploy   | Docker + Compose, Coolify-compatible |

## Layout

```
src/app/(app)/       authenticated app pages (dashboard, projects, boards, tasks)
src/app/api/         REST endpoints (auth, workspaces, projects, boards, tasks, health)
src/components/      UI shell, board, task detail, primitives
src/server/          db, env validation, session, rbac, task service, logging
prisma/              schema + migrations + seed
worker/              background jobs
docker-compose.yml   app + worker + db + redis + migrate
```

## Local development

1. Copy `.env.example` → `.env` (there is a local Postgres/Redis in compose):
   ```sh
   docker compose up db -d
   cp .env.example .env
   ```
   Set `AUTH_SECRET` to a long random string.
2. Install and migrate:
   ```sh
   npm install
   npm run db:migrate -- --name init
   npm run db:seed
   ```
3. Run:
   ```sh
   npm run dev        # app on :3000
   npm run worker     # background worker
   ```

Demo login after seed: `owner@zaki.local` / `owner1234` (dev only — change or delete before production).

## Production deployment

```sh
cp .env.example .env         # set AUTH_SECRET, POSTGRES_PASSWORD
docker compose up -d migrate # apply migrations
docker compose up -d app worker
```

- Database persists in `db_data`; uploads in `uploads` volume.
- HTTPS termination: put your reverse proxy (Traefik/Caddy/Coolify) in front of port 3000.
- Back up: `docker compose exec db pg_dump -U zaki zaki_workspace > backup.sql`
- Restore: `docker compose exec -T db psql -U zaki zaki_workspace < backup.sql`

## Testing

```sh
npm run typecheck
npm test              # unit/integration tests
npm run build         # production build gate
```

Integration endpoints are covered by `tests/`; DB-backed suites require
`DATABASE_URL` pointing at the compose Postgres (`npm run db:migrate` first).

## Security notes

- Passwords hashed with bcrypt (cost 12); sessions are signed JWTs in httpOnly cookies.
- Every API route validates input with Zod and resolves permissions server-side
  (`requireUser`, `requireWorkspace`, `requireOrgMember`) — no frontend-only auth.
- Cross-workspace access is prevented at the query level (task scoping by org).
- Secrets live in `.env` only; health endpoint reports component status without details.

## Roadmap

See `docs/ROADMAP.md` for the phased plan (Telegram, automation, AI, analytics).


## Deploy to Vercel + hosted Postgres (Neon/Supabase/Railway)

The app is a standard Next.js 14 App Router project — Vercel needs zero config.

1. **Push to GitHub**

   ```sh
   git init
   git add .
   git commit -m "Zakai.io — initial release"
   git branch -M main
   git remote add origin https://github.com/<you>/zakai-workspace.git
   git push -u origin main
   ```

2. **Create a hosted Postgres** (e.g. [Neon](https://neon.tech) free tier) and
   copy the pooled connection string.

3. **Import the repo on [Vercel](https://vercel.com/new)** and set the
   environment variables (Project → Settings → Environment Variables):

   | Variable | Value |
   | -------- | ----- |
   | `DATABASE_URL` | your Neon/Supabase pooled connection string (`?sslmode=require`) |
   | `AUTH_SECRET` | long random string (`openssl rand -base64 48`) |
   | `APP_URL` | your production URL (`https://<app>.vercel.app`) |

   `.env.example` documents every optional variable (Telegram, AI, uploads).

4. **Run migrations once against the production database** from your machine:

   ```sh
   DATABASE_URL="<neon-url>" npx prisma migrate deploy
   ```

   `prisma generate` runs automatically during the Vercel build
   (`build = prisma generate && next build`).

5. **Deploy.** Every push to `main` redeploys; PRs get preview deployments.

### Production notes & limitations

- **File uploads**: uploads are written to the local disk (`.data/uploads`).
  Vercel's filesystem is ephemeral — uploaded files reset between deployments
  and are not shared across serverless instances. For production file storage,
  wire the upload path to Vercel Blob or S3 (single write point in
  `src/server/services/files.ts`).
- **Worker / Redis**: the optional background worker and Redis URL are for
  self-hosted/Docker runs only; on Vercel everything runs in serverless
  functions and no Redis is required.
- **Migrations are additive-only** — `npx prisma migrate deploy` is always safe
  to re-run.
