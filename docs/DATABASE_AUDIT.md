# Zakai.io — Database Audit (Phase 4)

Scope: Prisma schema, migrations, query patterns, cascade integrity, concurrency.

**Files examined:** `prisma/schema.prisma` (43 models, 67 indexes/uniques, 10 migrations), `src/server/services/tasks.ts`, `src/server/services/chat.ts`, `src/server/services/crm.ts`.

---

## 1. Schema structure

- **43 models, 67 indexes/uniques**, covering org, workspace, department, chat, files, CRM, production, goals.
- Every tenant-scoped model carries `orgId` with `onDelete: Cascade` from `Organization` — deleting an org removes all its data atomically.
- **SetNull** used correctly for optional relations: `Project.departmentId` (dept deletion frees projects) and `ChatMessage.replyToId` (reply survives message deletion).

## 2. Cascade integrity

| Relation | onDelete | Correct? |
|----------|----------|----------|
| Organization → all tenant models | Cascade | ✅ Full tenant wipe |
| Project → Board → BoardColumn → Task | Cascade | ✅ |
| Task → Comment/Activity/Label/Dependency | Cascade | ✅ |
| Department → DepartmentMember | Cascade | ✅ |
| Department → Project | **SetNull** | ✅ Projects survive |
| Conversation → Member/Message/Reaction | Cascade | ✅ |
| ChatMessage → ReplyTo | **SetNull** | ✅ Replies survive |
| Customer → Opportunity | Cascade | ✅ |
| User → created/assigned tasks | Cascade | ⚠️ Deleting a user cascades their tasks; acceptable for MVP but production should prefer soft-delete |

## 3. Concurrency

- **Task numbering:** `TaskCounter` per-org upserted inside the caller's transaction; `@@unique([orgId, number])` protects against two concurrent creates claiming the same number. Race-safe.
- **Fractional ordering:** Kanban move writes at most 2 prior rows + 1 new row with `position = midpoint(prev, next)`. Concurrent identical inserts resolved by deterministic `(position, id)` tiebreaker via raw SQL `ORDER BY "position" ASC, id ASC`. Race-safe.
- **Completed stamping:** `completedAt` derived from `BoardColumn.done` (data-driven, not code-driven). Moving into a done column stamps; moving out clears.
- **Multi-record writes:** All use `db.$transaction` (project create, board create, task create/move/complete).

## 4. Migration safety

- 10 migrations, all **additive-only** (no destructive ALTERs).
- `prisma migrate deploy` is idempotent (safe to re-run).
- No `db push` used for schema changes.
- Encoding: migration files verified UTF-8 without BOM.

## 5. Query patterns

- **N+1:** `listConversations` does `Promise.all` per-conversation unread count — N+1 for conversation list. Acceptable for MVP scale (<100 conversations/user); can be optimized with a single GROUP BY query later.
- **Scoping:** Every service query includes `orgId` (and/or `workspaceId`) in the `where` clause. No cross-tenant query bypass found.
- **Pagination:** Cursor-based (`id: { lt: cursor }`) with `limit: max(100)` — no unbounded queries found.

## 6. Data integrity risks (all P3, documented)

1. `Task.assigneeId` has no FK constraint on the Prisma level (it's a relation, so Prisma generates one, but there's no explicit check that assignee belongs to the task's org at the DB level — enforced at service level).
2. `Label` model has no explicit `orgId` check on delete; org-scoped at service level.
3. `StoredFile` uses local disk (`.data/uploads`) — production needs persistent volume or S3/Blob migration.

## Verdict: PASS — schema is well-structured, migrations are safe, concurrency handled correctly.
