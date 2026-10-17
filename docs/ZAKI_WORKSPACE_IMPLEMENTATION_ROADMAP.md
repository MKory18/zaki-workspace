# ZAKI WORKSPACE PRO â€” Implementation Roadmap

Phase 0 artifact آ· 2026-10-17 آ· Companion to `ZAKI_WORKSPACE_PRODUCT_BLUEPRINT.md`.
Baseline: greenfield Zaki Workspace ( audits at آ§1 of the blueprint), so Phase 0
of the master spec is DONE (audit below) and delivery starts at Pro-P1.

## Phase 0 â€” Repository audit (COMPLETE â€” this document)

- Architecture inspected: Next.js 14.2.35 App Router + Prisma/Postgres +
  worker; 67 files / â‰ˆ4.4k lines; 18 API groups; 19 models; migrations shipped.
- Tests/build verified pre-audit: tsc 0 errors, Vitest 20/20, build green.
- Conclusion: **no Plane codebase present** â†’ all Pro capabilities are custom
  work on this codebase; Plane CE licensing boundaries do not apply.
- No application code was modified during this audit.

---

## Pro-P1 â€” Design system completion + My Work + Views core

Scope:
1. Tokenized design system: Button/Input/Card/Badge/Modal/Tabs/Toast/Tooltip/
   Skeleton/EmptyState/Drawer as a coherent `src/components/ui` set; consistent
   states everywhere existing pages render.
2. `My Work` page: Today/Upcoming/Overdue/In Progress/Completed/Assigned by me
   tabs; inline complete/reassign/date actions; daily planner composition.
3. Views engine core: shared task-query service + URL-encoded view state;
   **List view** (group by status/priority/project, inline edit) and
   **Calendar view** (due dates, drag-to-reschedule w/ authorization);
   Board view refactored onto the same query core.
4. Command palette (Ctrl+K): navigation, search-through-known-entities,
   quick create task/project.
5. Toast system wired into all mutations (replaces alert()).

Acceptance:
- Every mutation surfaces success/error toast; failed DnD still rolls back.
- List/Calendar/Board render same task through one service; changing a status
  in any view updates the others after refetch.
- Negative tests: GUEST cannot complete/reassign from My Work; cross-org IDs 404.
- Gates: tsc, tests, build, live verification, phase report appended.

## Pro-P2 â€” Task engine depth

Scope: subtasks (parentId) w/ progress on parent; checklists
(TaskChecklistItem); bulk operations (multi-select â†’ status/priority/assignee/
label/archive); task duplication; archive + restore UI; configurable column
editor (rename/color/WIP limit/done flag); dependency UI (blocks/blocked-by,
circular-chain prevention â€” service-level ACYCLIC check); custom fields
(org-level defs, per-task values, surfaced in views); estimates; recurring
tasks (schedule in worker; idempotent, timezone-aware).

Acceptance:
- Bulk ops require confirmation and fail atomically in one transaction.
- Creating a circular dependency returns a typed error (test included).
- Recurring generation: rerunning the tick creates no duplicates (test).
- Custom field definitions only editable by org ADMIN (authz test).

## Pro-P3 â€” Documents + Files

Scope: Document tree (nested pages, breadcrumbs), Tiptap-based editor with a
constrained schema, document versions + restore, documentâ†’task/project links,
document search integration point; Attachment model + upload endpoint
(magic-byte validation, size caps, stored on volume), permission-checked
streamed download, soft delete + restore, task/document attachment UI.

Acceptance:
- Cross-org attachment fetch â†’ 403; deleted attachment â†’ 404; SVG rejected.
- Restore version preserves authorship; version list capped (e.g. 50).
- Private documents excluded from any list/search surfaces (test).

## Pro-P4 â€” Inbox, mentions, notification depth

Scope: InboxItem aggregation (assignments, mentions, comments, AI/integration
suggestions when they land); triage actions (accept/reject/assign/convert);
@mentions parsing in comments with notifications; subscribers/followers on
tasks; NotificationPreference (mute categories); due-soon/overdue reminders
from worker tick; duplicate-suppression rule (unique per user/type/source/day
window) â€” retried/relivered events create no dupes (test).

Acceptance:
- Mention notification only when mention target is org member.
- Reminder tick idempotent; disabled categories never notified (test).

## Pro-P5 â€” Cycles, milestones, modules, search

Scope: Cycle CRUD + assignment + carry-over + cycle summary (real counts);
milestone UI (exists in schema) incl. overdue states; modules UX; **global
search** via Postgres FTS with org/membership filter, type filters, keyboard
nav, deep links.

Acceptance:
- Search never returns unauthorized rows â€” leakage test suite included.
- Cycle progress = completed/total from persisted states (no fabricated %).

## Pro-P6 â€” Automation engine

Scope: AutomationRule (trigger/conditions/actions JSON, enabled flag),
runner in worker with event bus table; actions: status, assign, label,
notification, inbox item, reminder; per-run execution log; retries with
backoff; loop prevention (depth â‰¤3, cooldown); ADMIN manage UI; audit events.

Acceptance:
- Loop test: rule chain capped, no infinite runs (test).
- Failure recorded with reason; executions visible in admin UI.
- Disabled rule never runs (test).

## Pro-P7 â€” AI assistant

Scope: provider abstraction (OpenAI-compatible, server-side keys, blanks =
disabled UI state), capabilities: task draft from text, project breakdown
proposal, project/discussion summaries, overdue/blocked digest, label/priority
suggestions; all outputs Zod-validated; **draftâ†’approveâ†’apply** flow only;
usage log + rate limit.

Acceptance:
- Without AI_* env, features show disabled state (no fake results).
- Approved draft creates task through the same task service (authz checked).
- Unauthorized-context leakage test (other org's task in prompt â†’ refuses).

## Pro-P8 â€” Integrations: Telegram + API tokens

Scope: Telegram bot config (encrypted at rest), webhook endpoint with
secret-token validation, update/message dedup tables, deterministic command
parser (/create, /tasks, /mytasks, /status â€¦), chat/topicâ†’workspace/project
mapping w/ review queue fallback, outbound notifications, connection dashboard;
scoped ApiToken CRUD (org-bound, scope read/write, hashed, revocable) powering
a documented surface for external agents.

Acceptance:
- Unauthenticated/unmapped Telegram message â†’ review queue, never auto-task.
- Replay of same Telegram update â†’ no duplicate task (dedup test).
- ApiToken from another org â†’ 403 (isolation test); revocation immediate.

## Pro-P9 â€” Reports + production readiness

Scope: reports service with documented formulas (created/completed/overdue,
status distribution, workload, cycle-time where data exists); report page with
filters; backup/restore runbook verified on an isolated restored DB; rate
limiting on auth/AI/webhooks; audit viewer UI; final security review; docs
audit; Playwright E2E for critical flows (authâ†’createâ†’dragâ†’comment).

Acceptance:
- Every metric page states its formula; missing data labeled, not zero-filled.
- Restore drill executed from a `pg_dump` on test DB; checksums compared.
- Security checklist reviewed item-by-item (blueprint آ§5).

---

## Gate discipline (every phase)

1. `npx tsc --noEmit` â†’ 0 errors (capture exit code).
2. `npx vitest run` â†’ all green incl. new suites (no deletions to pass).
3. `npm run build` â†’ success.
4. Live browser verification of each acceptance bullet (screenshots).
5. Negative authorization tests for every new endpoint.
6. `docs/PHASE-REPORT.md` append: implemented / tested / partial / not done,
   actual outputs, limitations, next phase request.

## Sequencing note

Phases may swap after Pro-P1 only if implementation evidence justifies it
(e.g., pulling Search forward). Spec-level reorder needs owner approval; this
roadmap is the submission for that approval.

## Pro-vision alignment (2026-10-17) â€” the owner's full-DEPARTMENT vision map

After the integrations round the owner supplied the full ZAKI WORKSPACE PRO vision
(departments, chat, files, AI, automations). Inventory against what is real today:

| Vision pillar | Status now | Route |
|---|---|---|
| Unified projects/tasks/Kanban | âœ… real | done (earlier phases) |
| Internal chat (DM + groups) | âœ… **this round** | `/chat` â€” see PHASE1-REPORT آ§4 |
| Secure file library + versions | DONE this round (/files, PHASE1-REPORT 5) | previews/versioning/magic-bytes inside; task-attachments later |
| Departments (design/dev/IT/sales) | DONE this round (/departments, PHASE1-REPORT 6) | CRM/tickets/campaigns now buildable on top |
| CRM / IT tickets / campaigns tables | â‌Œ | builds *on top of* Departments; not separate apps |
| ZAKI AI (voiceâ†’text, summaries) | â›” needs owner LLM key | planner ready; plug when key provided |
| No-code automation rules | â—‘ partial | n8n event vocabulary exists (8 events); rules UI comes with Pro-P6 |
| Telegram notifications into chat | â—‘ | bot integration real; chatâ†’Telegram bridge is an optional rule |

Build order agreed with the owner (user picked chat first, docs-after):
1. ~~Internal chat~~ âœ… (this round)
2. **Files library** (upload, previews, versions, per-file permissions)
3. **Departments** â†’ then department-specific products (CRM, tickets, campaigns)
4. ZAKI AI + no-code rules once their external keys are supplied.
