# ZAKI WORKSPACE PRO — Product Blueprint

Phase 0 artifact · 2026-10-17 · Grounded in the actual repository audit (§1).

> Audit finding #0: this repository is **not** a Plane codebase. It is a
> greenfield "Zaki Workspace" platform built in this workspace (Next.js 14
> App Router, Prisma/PostgreSQL, worker service). Plane/Asana/Linear/Notion/
> Monday/ClickUp are used as capability references only. All "adapt" decisions
> below therefore mean "build custom", and Plane Community Edition boundaries
> do not apply.

---

## 1. Repository audit (what exists today)

Codebase: 67 TS/TSX/Prisma files, ≈4,400 lines, 18 API route groups,
19 Prisma models, migrations applied, isolated local Postgres 16 (port 5433).

### 1.1 Implemented and verified live (production build + browser-tested)

| Area | Capability |
|---|---|
| Auth | Register (bootstraps User+Organization as OWNER), login, logout; bcrypt(12); HS256 JWT in httpOnly/SameSite=Lax cookie (7d); middleware page guard |
| Data model | User, Organization(+Member, OrgRole OWNER/ADMIN/MEMBER/GUEST), Workspace(+Member, WorkspaceRole), Team, Project(+Milestone), Board(+BoardColumn), Task(+TaskCounter, TaskLabel/Label, TaskComment, TaskActivity, TaskDependency), Notification, AuditLog |
| Tenancy | Org-scoped queries at service level; `requireUser` / `requireOrgMember` / `requireWorkspace(roles)` / `requireOrgRole` guards; guest = read-only everywhere |
| Tasks | Create (UI/api), move (DnD → fractional ordering), update (title, description, priority, due, assignee with org-member check, label set replace), delete (ADMIN), list with filters (project/board/assignee/overdue); key `PREFIX-n` via per-org counter in-transaction; `completeAt` stamped by `done` column; TaskActivity events on create/move/update/comment |
| Boards | Default workflow columns; add column; delete empty column (≥1 kept); column reorder API; DnD optimistic with rollback |
| Collaboration | Task comments (create/list); notification on assignment; notification center (bell, unread badge, mark-all) |
| UI | App shell (collapsible sidebar groups, workspace switcher + create modal, bell, theme light/dark/system, locale ar/fr/en, RTL default), login/register, dashboard (stats, open tasks, active projects, integrations state), projects list + create modal, project detail (boards grid, milestones list), Kanban board (quick-add, overlays), task detail (key, assignee, priority, due, labels, description, comments) |
| Infra | Dockerfile (non-root, healthcheck), Compose (app/worker/db/redis/migrate), worker heartbeat, `.env.example`, `env.ts` fail-fast validation, structured JSON logger, `/api/health`, AuditLog recording |
| Quality gates | `tsc --noEmit` 0 errors; Vitest 20/20; `next build` green; migration `init` + idempotent seed |

### 1.2 Present in schema but no UI/API surface yet

Milestone (model only), Team (model only), TaskDependency (model only),
TaskActivity (recorded, no feed UI), AuditLog (recorded, no admin UI).
These are foundation to reuse, not to rebuild.

### 1.3 Not present at all

My Work views, list/calendar/table/timeline views, saved views, cycles/sprints,
modules, custom fields, estimates, recurring tasks, bulk operations, task
duplication/archive UI, documents/knowledge base, attachments/files, inbox &
triage, mentions, followers/subscribers, notification preferences & reminders,
automation engine, AI assistant, Telegram/integration layer, scoped API tokens,
global search, reports/analytics, command palette, invitations UI, member
directory, org settings UI, audit viewer, rate limiting, versioned public API.

---

## 2. Product modules (target)

M1 Identity & Orgs — auth, profiles, orgs, workspaces, teams, members,
invitations, roles, audit viewer, org settings.
M2 Task Engine — statuses config, types, priorities, subtasks/parent,
dependencies, checklists, custom fields, estimates, recurring, bulk ops,
duplication/archive.
M3 Views Engine — list/board/calendar/table/timeline over one query core;
filters, sorting, grouping, saved views.
M4 Projects — overview, members, milestones, cycles, modules, health, progress
from real rules, activity timeline.
M5 Documents — nested pages, rich text, versions, permissions, templates, soft
delete, links to tasks/projects.
M6 Files — task/document attachments, validate+store+serve safely, soft delete.
M7 Inbox & Triage — aggregated incoming items with accept/reject/assign/convert.
M8 Notifications — preferences, muted categories, due-soon/overdue reminders.
M9 Automation — trigger→condition→action with audit, retries, loop prevention.
M10 AI Assistant — provider abstraction, drafts/summaries/suggestions with
explicit approval, schema-validated outputs, authorized context only.
M11 Integrations — Telegram bot (webhook, dedup, review queue), scoped API
tokens, webhooks out.
M12 Search — permission-checked cross-entity search.
M13 Reporting — metrics with documented formulas from real records.
M14 Productivity — command palette, shortcuts, toasts, tooltips, keyboard nav.

---

## 3. Proposed UX (key shapes)

- **Shell** (exists, extend): org switcher added next to workspace switcher;
  right-side contextual panel on boards; breadcrumbs on project/task routes.
- **My Work**: saved-view tabs (Today / Upcoming / Overdue / Assigned by me / …)
  with inline quick-actions (complete, reassign, snooze) on rows.
- **Views engine**: one "view state" object (filters/sort/group/columns) in URL
  + localStorage; saved views persisted per user (new model).
- **Task detail**: right-side drawer on boards + full route; sections General /
  Checklist / Files / Relations / Activity.
- **Documents**: tree sidebar + editor route; breadcrumb of nested pages.
- **Inbox**: two-pane triage (list + preview) with explicit actions.
- **Command palette**: Ctrl+K; navigation, search, quick-create, recent items.
- **States**: consistent skeleton loaders, empty states, permission errors as
  actionable messages ("Ask an admin for access"), toasts for mutation results.

---

## 4. Architecture plan (extensions only)

- **Keep**: modular monolith (app + worker), services under `src/server/services/*`,
  `withApi` error mapping, Zod contracts, Prisma, activity/audit split.
- **New services**: `views.service`, `documents.service`, `files.service`,
  `automation.service`, `automation.runner` (worker), `ai.service`,
  `telegram.service`, `search.service`, `reports.service`.
- **New models** (detail in §6): SavedView, Subtask via Task.parentId,
  ChecklistItem, CustomField(Def/Value), Recurrence, Cycle, Module,
  Document(+Version, +Node tree), Attachment, InboxItem, Follower/Subscriber,
  NotificationPreference, AutomationRule(+Execution), ApiToken, IntegrationSetting,
  TelegramChat/TopicMapping/UpdateState.
- **Search**: Postgres FTS (tsvector columns + GIN) — no external cluster until
  scale demands it.
- **Files**: local volume via storage abstraction interface (S3-compatible later);
  signature checking via magic bytes; streaming responses.
- **Scheduling**: worker tick → due-soon/overdue reminders, recurring task
  generation (idempotent upserts), automation time triggers.

## 5. Security boundaries

- Inherit: server-side authorization per request; guest read-only; per-org
  scoping at query level; audit events; secrets in env only.
- Add: file type/signature validation + permission-checked streamed downloads
  (no public URLs); scoped API tokens (org-bound, read/write flag, expiry,
  revocation, hash-at-rest); Telegram webhook secret-token validation + update
  dedup table (idempotency); automation action permission checks + loop breaker
  (max chain depth + rule cooldown); rate limit middleware bucket (login, AI,
  webhooks); AI server-side only, schema-validated outputs, approval gate for
  side effects; FTS queries filtered by org/membership at SQL level (no snippets
  from unauthorized rows).

## 6. Data-model implications (incremental migrations only)

New tables: SavedView; Cycle(±Module); CustomFieldDef/CustomFieldValue;
TaskChecklistItem; RecurrenceConfig; Document/DocumentVersion/DocumentLink;
Attachment(attachedTo polymorph with type column); InboxItem; TaskFollower;
NotificationPreference; AutomationRule/AutomationExecution; ApiToken;
TelegramIntegration/ChatMapping/TopicMapping/UpdateDedup.
Altered: Task(+parentId, +cycleId, +moduleId, +estimateMinutes, +progressHint?),
Organization/Workspace (+settings JSON), BoardColumn (+wipLimit).
Every change ships as additive migration; no destructive ops; rollback docs.

## 7. Dependencies

Existing only: Next 14.2.35, Prisma 5, dnd-kit, TanStack Query, zod, jose,
bcryptjs, tailwind, lucide, next-themes. **To add (minimal set):**
rich-text editor (Tiptap), magic-bytes inspector (`file-type`), cron util,
OpenAI-compatible client (thin fetch wrapper — no SDK), Telegram Bot API via
plain fetch. No other frameworks; no external vector/queue/search services in
early phases.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Scope explosion (14 modules) | Strict phase gates; each phase = working increment behind acceptance criteria |
| Editor complexity (docs) | Tiptap with limited schema (no raw HTML); sanitize on render |
| Files abuse | Signature checks, size caps, streaming, private downloads |
| Automation loops | Chain depth ≤3, cooldown per pair, execution log + kill switch |
| AI hallucination into data | AI never writes directly; drafts + explicit approve endpoint |
| Telegram trust | Deterministic parser first; review queue for ambiguous; no auto-create without mapping+rules |
| Windows dev env | Postgres already a service; Docker optional; compose target is deployment |
| Search correctness | Permission filter in SQL, tests for cross-org leakage |

## 9. Acceptance criteria (per phase) — see Roadmap doc

Each phase must pass: typecheck=0 errors, tests green (incl. new suites),
production build, live browser verification of each new flow, negative
authorization tests, and an appended entry in the phase report doc.

## 10. Prioritized delivery

P1 Design system + My Work + Views engine core (list/calendar) →
P2 Task depth (subtasks, checklists, bulk, customize columns) →
P3 Documents + Files → P4 Inbox + Mentions + Notification prefs →
P5 Cycles/Milestones/Modules UI + Search → P6 Automation → P7 AI →
P8 Telegram + API tokens → P9 Reports + Production readiness.

Rationale: P1–P3 give daily-use value with zero external dependencies;
collaboration/notification depth (P4) precedes heavy machinery (automation/AI/
integrations) so triage surfaces exist when those arrive.
