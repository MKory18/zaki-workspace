# Roadmap — Zaki Workspace

Status per phase. Baseline: Phase 0 audit done (empty repo → greenfield build).

## Phase 1 — Foundation ✅ (current)

- Auth: register (bootstrap org), login, logout, JWT session cookie, bcrypt hashes
- Org + workspace model, membership, roles (OWNER/ADMIN/MEMBER/GUEST)
- Server-side authorization: requireUser / requireOrgMember / requireWorkspace
- App shell: collapsible sidebar, workspace selector, theme toggle, topbar
- i18n: ar/fr/en dictionaries, RTL layout, locale cookie
- Dark/light/system themes
- Prisma schema (org → workspace → project → board → columns → tasks)
- Docker: app, worker, postgres, redis, migrate service; health endpoint
- Vitest: validation, error mapping, session, RBAC, format

## Phase 2 — Core workspace (in progress)

- Workspace create (API+UI) ✅ · Project create UI ✅ · Board create UI ✅
- Column add/delete (empty-only, ≥1 kept) ✅ · reorder API ✅
- Task detail: assignee picker (members API) ✅ · labels toggle ✅ · key `ZD-1` ✅
- Notification center: bell + unread badge + mark-all/read ✅ (30s polling)
- Task PATCH: labelIds replace, assignee must be org member ✅
- Remaining: rename column UI, list view, calendar view, filters/saved views,
  mentions, replies, activity feed UI, labels management page, i18n key audit

## Phase 3 — Advanced work management

- Timeline; dependencies UI — **done 2026-10-30** (`src/server/services/task-links.ts`, the «التبعيات»
  card on the task page, switch `taskLinks`)
- Milestones UI (model ready)
- Recurring tasks (idempotent generator in worker)
- Bulk operations, custom fields (CustomFieldDefinition/Value tables)
- Team workload view

## Phase 4 — Ideas & knowledge

- Ideas module + idea→project conversion (audit + linking)
- Documents (versioned), meeting notes, decisions
- Global search (Postgres FTS, permission-respecting)

## Phase 5 — Telegram integration

- Bot config (encrypted at rest), webhook endpoint with secret validation
- Update/message dedup (UpdateMessage ref tables), async processing
- Chat/topic → workspace/project/board mappings; review queue
- Commands (/create /tasks /mytasks …), notifications, audit events

## Phase 6 — Automation engine

- Trigger → conditions → actions with execution records, loop prevention

## Phase 7 — AI assistant + external API

- Provider abstraction (OpenAI-compatible), scoped API credentials, agent audit

## Phase 8 — Analytics & polish  ## Phase 9 — Production acceptance
- Dashboards, security review, backup/restore drill, docs audit
