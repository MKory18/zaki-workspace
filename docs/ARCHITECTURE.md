# Architecture — Zaki Workspace

## Principles

1. **Modular monolith** (Next.js app + dedicated worker). No microservices until real scale requires them.
2. **One source of truth per concept.** The `Task` service is the only task-mutation path; UI, Telegram, API and automation call it.
3. **Authorization is server-side and per-request.** Helpers: `requireUser`, `requireOrgMember(orgId)`, `requireWorkspace(wsId, roles)`. Every service resolves ownership chains inside its own transaction.
4. **Fail loudly, never silently.** All API routes wrap `withApi`, mapping typed errors to HTTP codes. Unknown errors log structured JSON and return opaque 500s (no stack traces in responses).
5. **Structured events, not free-form logs.** `TaskActivity` rows power feeds; `AuditLog` rows power security review; `log.*` powers ops.

## Layers

```
UI (server components fetch DB directly for page render)
 └─ client components mutate via /api/* with TanStack Query
     └─ route handlers (validation: Zod; auth: requireX)
         └─ services (src/server/services/*) — business rules, transactions
             └─ repositories/prisma — persistence
```

- **Counts/aggregate pages** (dashboard, project overview) read Prisma directly in server components — faster render, no extra hop, still permission-checked via helpers first.
- **Mutations always go through the API + services**, never through UI-side Prisma calls.

## Key data model

```
Organization ─< OrganizationMember >─ User
Workspace ─< WorkspaceMember
Workspace ─< Team ─< Project
Project ─< Board ─< BoardColumn ─< Task
Task: number (per-org counter → ZW-42 key), position (fractional ranking)
Task ─< TaskComment / TaskActivity / TaskLabel >─ Label / TaskDependency
Notification, AuditLog
```

- **Task key uniqueness:** `TaskCounter` per org, incremented inside the create transaction; `@@unique([orgId, number])` prevents races.
- **Fractional ordering:** moving/creating writes one row with `position = midpoint(prev, next)`; column indexes use raw ordered SELECT inside the same transaction.
- **Board "done" semantics:** `BoardColumn.done` marks terminal columns; moving into them stamps `completedAt`. Workflow is data, not code.

## Concurrency & idempotency

- Multi-record writes run in `$transaction` (project create, board create, task create, move).
- Drag-and-drop moves are optimistic in the UI; on failure the client restores pre-move state (rejected moves never look successful).
- Background jobs (worker) must be idempotent when they land; retries use exponential backoff (BullMQ planned for Phase 5+).

## Localization

- Dictionaries `src/lib/i18n/{ar,fr,en}.json`, provider sets `dir` + `lang`; Arabic default (RTL).
- Dates formatted via `Intl` per locale; layout uses logical CSS (`ms-`, `me-`) so RTL mirrors automatically.

## Security controls in place

- bcrypt(12) password hashes; HS256 session cookie (httpOnly, SameSite=Lax, Secure in prod).
- Middleware redirects unauthenticated page loads; API routes independently enforce auth.
- Workspace-boundary scoping in task queries (org + workspace joins in `where`).
- Guest (GUEST role) gets read-only surfaces; write APIs require ADMIN/MEMBER.
- Zod validation on every request body; `password.min8` + letter/digit rules at registration.
- Health endpoint: component status only, no secrets/stack traces.

## Extension points (already wired)

- `worker/index.ts` — single place for background jobs (Telegram, automation, recurring tasks, AI summaries).
- `src/server/services/tasks.ts` — all task mutations; new entry surfaces (Telegram, agents) call these, never raw Prisma.
- `env.ts` — namespaced env contract; new integrations (Telegram/AI) extend the schema and stay disabled when blank.
