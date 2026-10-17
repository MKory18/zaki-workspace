# Phase 1 Report — Foundation + First Vertical Slice

Date: 2026-10-17 · Repo was empty → greenfield build.

> **Phase 2 progress (same day, verified live):** workspace/project/board create
> (UI+API, chain tested end-to-end), column add/delete (empty-only, ≥1 kept),
> assignee picker (members API, org-member validation), labels toggle on task
> detail, task key `ZD-1` display, notification bell + unread badge +
> mark-all-read (assignment notification produced ZD-1 row, panel verified).


## Implemented

- **Auth**: register (bootstrap user+org, OWNER), login, logout. bcrypt(12),
  HS256 JWT in httpOnly/SameSite=Lax cookie, 7-day TTL.
- **Authorization**: `requireUser` / `requireOrgMember` / `requireWorkspace(roles)`;
  middleware page-guard; service-level org scoping (`orgId` in every task query).
- **Data model (Prisma/Postgres)**: User, Organization(+Member), Workspace(+Member),
  Team, Project, Milestone, Board, BoardColumn, Task(+Counter, labels, comments,
  activities, dependencies), Label, Notification, AuditLog. Migration `init` applied.
- **APIs** (Zod-validated, `withApi` error mapping): auth×3, workspaces, projects,
  boards(+[id] GET/PATCH/POST columns), tasks(+[id] GET/PATCH/DELETE, move, comments),
  health. Task key `ZD-<n>` via per-org counter in-transaction.
- **Task service**: single mutation path; fractional-position ordering; `done`
  columns stamp `completedAt`; activity events recorded transactionally.
- **UI**: app shell (collapsible sidebar, workspace selector, theme toggle, logout),
  dashboard, projects list/detail, board (dnd-kit DnD, optimistic + rollback,
  quick-add), task detail (inline edit, priority/due, comments), login/register.
- **i18n**: ar/fr/en dictionaries, RTL default Arabic, direction-aware layout,
  locale cookie. **Themes**: dark/light/system via next-themes.
- **Infra**: Dockerfile (non-root, healthcheck), Compose (app/worker/db/redis/migrate),
  worker service (heartbeat), `.env.example`, README/ARCHITECTURE/ROADMAP docs.

## Verified end-to-end (live, production build)

- Register→login→dashboard (Arabic RTL, dark) — screenshots confirmed.
- Board render with default columns; quick-add task → **persisted** (ZD-1).
- **Drag task between columns → DB updated** (`columnId` changed).
- Unauthenticated task move → rejected (404/401 path).
- `GET /api/health` → `{"status":"ok","checks":{"app":"ok","database":"ok"}}`.

## Quality gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ 0 errors |
| `vitest` | ✅ 20/20 (validation, error mapping, session, RBAC, format) |
| `next build` | ✅ all routes compiled |
| Migrations | ✅ `init` applied, seed idempotent |

## Pro-P1 — Views engine + My Work + Command palette (2026-10-17)

Continuation after the Phase-0 blueprint/roadmap docs and owner approval
(`docs/ZAKI_WORKSPACE_PRODUCT_BLUEPRINT.md`, `ZAKI_WORKSPACE_IMPLEMENTATION_ROADMAP.md`).

**Implemented**
- Toast system (`ui/toast.tsx`) mounted app-wide; wired to board moves, task
  saves/comments/create-errors and all create modals (success + failure).
- Shared query core `server/services/views.ts`: `queryTasksForView`
  (org-scoped, one source for all views), pure date-window helpers,
  `resolveWorkspaceView` (requireWorkspace semantics for RSC pages).
- Task service: `setTaskCompletion` (complete/reopen via board's done column /
  first open column, stamps `completedAt`, activity event) + endpoint
  `POST /api/tasks/[id]/complete`.
- **My Work** (`/my-work`): server-rendered tabs Today / Upcoming / Overdue /
  Completed (recent-100) / Assigned to me / Created by me, per-org scanning
  across the user's memberships, counts on tabs; rows with inline complete
  toggle, due-date editor, assignee display; GUEST rows render read-only.
- **List view** (`/list`): workspace selector, group by status/priority/
  project/assignee, priority + assignee (incl. unassigned `__none__`) filters
  and title search; same TaskRow with inline actions + member select.
- **Calendar view** (`/calendar`): month navigation, mine-only toggle, day-grid
  (Sunday start, Intl weekday/month labels per active locale), drag task → day
  persists via `PATCH dueDate` (auth-required; guests see errors, not fake moves).
- **Command palette** (Ctrl/Cmd+K): static nav + live `GET /api/search?q=`
  (org-scoped ILIKE over tasks/projects, LIKE-wildcard escaping, min length 2).
- Server-side `getServerT()` translator (same `zaki_lang` cookie) so new
  server pages are localized; new ar/fr/en keys for all new surfaces.

## Accounts, Profiles & Ideas (2026-10-17, per owner request)

**Implemented**
- Migration `20261017080000_accounts_ideas_profiles` (additive; joinCode
  backfilled with random unambiguous codes — no destructive ops):
  `User.jobTitle/bio`, `Organization.joinCode @unique`, `Idea`, `IdeaVote`
  (unique per user per idea), `IdeaStatus` enum.
- **Self-serve registration** — register page has two explicit modes: create
  organization (OWNER) or join by invitation code (MEMBER). Strong-password
  rules (≥8, letter+digit) + optional job title at signup.
- **Profiles**: `/profile` (edit name/jobTitle/bio/locale + password change
  with current-password verification) and public profiles `/u/[id]` visible
  only through shared-org membership (cross-org → 404, no existence oracle);
  deterministic hue avatars; stats (ideas, votes received, open/completed tasks).
- **Member directory** `/teams` (nav label "الأعضاء"): org members with roles,
  job titles, emails (admins only), and the org **join code** with copy +
  regenerate for OWNER/ADMIN (`POST /api/organizations/[id]/join-code`).
- **Ideas** (`/ideas`): real module replacing the earlier 404 nav item
  (also fixed: documents/telegram/automation/analytics/settings no longer 404 —
  explicit "upcoming phase" pages). Composer, filters (all/new/review/accepted/
  rejected/mine), upvotes (toggle; guests read-only), status flow
  NEW→UNDER_REVIEW→ACCEPTED/REJECTED enforced by transition map (ADMIN+;
  direct NEW→ACCEPTED rejected server-side), delete (author/admin), and
  **convert→task** through the single task service (`/api/ideas/[id]/convert`
  with workspace/project/board picker via new `GET /api/projects/[id]/boards`;
  prevents double conversion).
- APIs: `/api/ideas` (GET/POST), `/api/ideas/[id]` (PATCH/DELETE),
  `/api/ideas/[id]/vote`, `/api/ideas/[id]/convert`, `/api/me` (GET/PATCH),
  `/api/me/password`, `/api/users/[id]`, join-code route; register schema
  discriminated create/join in `server/validation.ts`.

**Verified live (production build, second real account)**
- Owner regenerated join code (`BYA2C2AR`); second user registered via code →
  MEMBER of the same org with stored job title.
- Idea created by the new member; owner voted + member self-voted
  (`voteCount:2`, `votedByMe:true`).
- Authorization: MEMBER changing status → 403; ADMIN direct NEW→ACCEPTED →
  403 `idea.invalid_transition:NEW->ACCEPTED`; NEW→UNDER_REVIEW → ok.
- Convert: creator converted idea → task `ZD-…` created through task service;
  `idea.taskId` set, status ACCEPTED; boards-picker endpoint returns columns.
- Profiles: member patched name/bio; owner's profile view shows stats
  (ideas 1, votes received 2); password change with wrong current → 403,
  correct → ok; outsider (separate org) opening the member profile → 404.
- Pages /ideas /teams /profile /u/[id] /my-work /list /calendar /documents
  /settings all 200 authed, 307 redirect unauthenticated.

**Quality gates re-run**
| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ 0 errors |
| `vitest` | ✅ 39/39 (+11 `tests/accounts-ideas.test.ts`: join-code alphabet/length/no-lookalikes/uniqueness, register create-vs-join discrimination, jobTitle/password rules, idea transition discipline) |
| `next build` | ✅ routes incl. /ideas, /teams, /profile, /u/[id], placeholders, all new APIs |
| Migrations | ✅ `accounts_ideas_profiles` applied (backfill joinCode, additive only) |
- Due date `PATCH` (date-only string) persisted; Calendar `/calendar?month=2026-10`
  and My Work "today" tab both render the scheduled task (`ZD-2`).
- List grouping renders `ZD-2` in its project group; tasks from another
  workspace correctly absent.
- Pages: /my-work(tabs), /list(groups), /calendar (fallback-workspace guard)
  all 200.

**Quality gates re-run**
| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ 0 errors |
| `vitest` | ✅ 28/28 (+8 `tests/view-windows.test.ts`: month/day windows, leap year, invalid-input fallback, year-boundary shifts) |
| `next build` | ✅ routes incl. /my-work, /list, /calendar, /api/search, /api/tasks/[id]/complete |

## Report section 3 — Integrations for real (Telegram / n8n / Google Drive / Analytics / Settings)

Owner ask: membuat مساحات العمل nav items (telegram/automation/analytics/settings) real —
Telegram: connect own bot + see conversations; Automation: link n8n **and** Google
Drive; Settings a complete hub. Delivered as production code, no fake states.

**Data (migration `20261017100000_event_optional_link`; both migrations additive)**
- `Integration` per org per type (`TELEGRAM|N8N|GOOGLE_DRIVE`), `secretEnc` AES-256-GCM
  JSON blob (key = SHA-256 over `AUTH_SECRET:zaki:secrets:v1`), non-secret `config`
  (botUsername / webhookUrl / events), `lastSyncAt`.
- `TelegramChat` (unique integrationId+chatId), `TelegramMessage`
  (unique integrationId+chatId+messageId — idempotent pulls, negative ids mark
  outgoing copies), `IntegrationEvent` org-scoped audit (direction IN/OUT,
  status OK/FAILED, detail) with optional integration link.

**Telegram (Bot-mode — MTProto user login explicitly out of scope, documented in UI)**
- Connect: token shape-validated (`\d+:[A-Za-z0-9_-]{30,}`) → verified against
  real `getMe` **before** storage; live check with a well-shaped fake token reached
  api.telegram.org and returned translated `telegram.invalid_token` (401 mapping).
- Chats + threads: `POST sync` pulls `getUpdates` (offset stored, `message` +
  `channel_post` only, edits ignored) → upsert chat/message; thread fetched per
  chat; send-as-bot (`sendMessage`) records an outgoing local copy so the
  thread stays single. Guests: read-only; connect/sync/disconnect OWNER/ADMIN.
- SSR: page passes initial chat list (no loading flash).

**n8n**
- Outbound: 8-event vocabulary closed server- and client-side
  (task.created/-completed/-moved, idea.created/-accepted/-rejected,
  comment.created, member.joined), emitted from the real API routes after
  their transactions. Delivery: POST webhook with `X-Zaki-Signature:
  sha256=HMAC(secret, body)` plus `x-zaki-org`/`x-zaki-token` headers, 5s
  timeout; every attempt logged IN/OUT with status + detail.
- Inbound: public `POST /api/integrations/n8n/inbound` (no session) guarded by
  `x-zaki-org` + `x-zaki-token` (timing-safe compare); `action/event:
  createTask` flows through the single task service (acting actor = org OWNER,
  documented), unknown actions acknowledged-ignored → workflows never hard-fail.
- Live **full signed loop**: outbound test event → Zaki's own inbound webhook →
  validated → logged OUT OK + IN OK. Negative: no/wrong token → 401
  `n8n.unauthorized`; malformed body → 400 logged. MEMBER attempts config → 403.
- Secret shown **once** on mint; rotate re-mints (old invalid immediately).

**Google Drive (read-only)**
- App credentials from env `GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET` (the app
  refuses to invent them; page explains exactly what to set). OAuth2:
  state = `orgId.userId.HMAC(AUTH_SECRET)` (CSRF-bound), consent → code
  exchange → tokens stored encrypted (refresh preserved across re-consent),
  `drive.readonly` only. Files list with 401 → one silent refresh retry.
- Honest states verified live: `not configured` (missing env), status endpoint
  correct before any credentials exist.

**Analytics** — server-rendered aggregates from live queries only: totals,
open/completed (+rate), overdue, created/completed 30d, due-next-7d, open by
priority (real enum incl `NONE`), per-member workload top-8, ideas funnel,
workspace/project counts. Zero-data states are explicit; nothing fabricated.

**Settings hub** — org rename (OWNER-only, audit-logged: live 200 + reverted),
join-code panel (reused), role/creation info, members link, three integration
status rows linking to their pages, profile/password shortcuts. `joinCode`
never returned by the new org GET (members/guests excluded).

**Files (new)** `src/server/{crypto.ts, services/{integrations,telegram,n8n,google}.ts}`,
routes `/api/integrations/{telegram{,/sync,/messages,/send},n8n{,/test,/inbound},google{,/start,/callback}}`,
`/api/organizations/[id]` (GET+PATCH), pages `(app)/{telegram,automation,analytics,settings}`,
components `{telegram,automation}-view, org-name-form, integration-badge`,
migration above; hooks wired in tasks/tasks-complete/tasks-move/comments/
ideas POST/PATCH/register-join; i18n ~150 new keys ar/fr/en (+`priority.*`).

**Quality gates re-run**
| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ 0 errors |
| `vitest` | ✅ 50/50 (+11 `tests/integrations-logic.test.ts`: AES-GCM roundtrip+temper, HMAC determinism, safeEqual, update normalize (private/group/channel/caption/edit), event vocabulary guard, OAuth state sign/verify + tamper) |
| `next build` | ✅ routes incl. /telegram /automation /analytics /settings, all integration APIs |
| `migrate deploy` | ✅ `20261017090000_integrations` + `20261017100000_event_optional_link` applied |
| Live | ✅ health, login; TG fake-token → real Telegram 401 → i18n error; n8n configure→signed self-loop OUT OK/IN OK; inbound 401s; member 403s; 4 pages 200 SSR (ar); org rename OWNER 200 + revert |

Limitations: Telegram operates in bot-mode (no personal-account MTProto login);
Google Drive requires owner-supplied OAuth keys in env before the connect
button works (documented on the page); outbound webhooks require a reachable
n8n endpoint; attachments from Drive remain future work.

## Notes / limitations

- Next pinned **14.2.35** (patches CVE-2025-55183/55184/67779).
- Local DB: isolated Postgres 16 cluster in `.pgdata/` (port 5433) registered as
  Windows service `Postgres_Zaki` — never touches the existing Odoo instance.
- UI strings partially hardcoded (dashboard/board legacy pages) — new Pro-P1
  surfaces fully localized via `getServerT`; remaining pages localize in P2.
- List/calendar/My Work/command palette shipped in Pro-P1; labels UI, mentions,
  saved views, notification depth → P2/P4.
- Worker has heartbeat only; real jobs (Telegram/automation/recurring) land Phase 5/6.
- Tests are unit-level + window helpers; DB integration + Playwright E2E planned P2/P9.

## Next phase

**Phase 2 — Core workspace**: project/board/task CRUD UI completion, column
management, labels, assignee picker, comments+mentions, notification center,
activity feed, list view, filters, saved views, i18n key audit.

## Report section 4 — Internal chat (2026-10-17, per owner pick)

Scope built (real, no placeholders): the fourth major missing piece from the Pro-vision
mapping — **الدردشة الداخلية** (DM + groups), on top of the org boundary.

### Data model (additive migration `20261017113000_internal_chat`)
- `Conversation` (orgId, kind=DM|GROUP, title/emoji for GROUP, updatedAt bump on send)
- `ConversationMember` (unique per conv+user, role member|admin, `lastReadAt` for unread math)
- `ChatMessage` (body ≤4000, `replyToId` self-relation, `pinned`, `editedAt`,
  `deletedAt` tombstone — row kept so reply threads survive deletion)
- `ChatReaction` (unique messageId+userId+emoji, 6-emoji palette enforced server-side)
- Guests are excluded at the directory and rejected by every write (`chat.guest_forbidden`).

### API (all Zod-validated, org-scoped, withApi)
- `GET/POST /api/chat/conversations` — my list (+unread counts +last-message preview);
  open DM (idempotent per pair) or create group (invitees must be same-org non-guests)
- `GET/POST/PATCH/DELETE /api/chat/conversations/[id]` — detail+latest 60 messages /
  mark-read / member+title+emoji management / leave group
- `POST /api/chat/conversations/[id]/messages` — send (+reply guard: parent in same conversation)
- `PATCH/DELETE /api/chat/messages/[id]` — edit / tombstoneDelete; policy:
  author always, group admins may moderate; tombstoned refuse edits
- `POST .../react` (palette toggle), `POST .../pin` (DM both sides, GROUP admins only)
- `GET /api/chat/directory` — chatable org members (self + guests excluded)

### Pure-logic policies (unit-tested)
`canModifyMessage`, `canPinMessage`, `isAllowedReaction`, `dmMembersKey` —
`tests/chat-logic.test.ts` (+6 tests, suite 50 → 56).

### UI (`/chat`, nav item **الدردشة** in the home section)
- RTL two-pane shell: conversations (poll 10s) ↔ thread (poll 4s), unread badges,
  tombstone/edited captions, pinned strip, reply bar, edit mode, hover actions,
  emoji palette (👍❤️😂🎉🔥👀), group members modal (add/remove/title/emoji, last-admin guard),
  leave-group, new-chat modal (DM/group with emoji picker), composer with Esc cancel.
- Send → optimistic invalidate; open conversation → auto mark-read (list badge clears).

### Verified live (production build, real accounts)
- DM owner↔salma: idempotent open (same id twice), send, salma unread=1 → read → 0,
  reply, replyToId message with `replyPreview.authorName` backfilled
- Reaction gate: 🚀 → `403 chat.bad_reaction` (correct negative); 👍 both → count=2 mine=true
- Pin 200; edit 200; delete by salma on owner's msg → 403 `chat.not_author`;
  owner tombstone own → body=null, deleted=true, reply preview + reactions intact
- Group: create, salma send, salma pin → 403 `chat.pin_admin_only`,
  salma patch-rename → 403 `chat.group_admin_only`, owner rename+re-emote → 200,
  salma leave → 200 (list drops group; group back to admin-only)
- UI E2E in browser (owner session): nav item renders, list shows group with unread
  badge and DM with tombstone preview, thread opens, message sent through composer,
  pin through UI → pinned strip appears twice-detected (strip + bubble)
- Server logs show `chat.*` events flowing into the same IntegrationEvent audit
  surface n8n already reads (IN direction; no webhook spam for chat by design).

### Gates
`tsc` clean · vitest **56/56** · `next build` green · health ok · live API+UI verified.

### Honest limits (next phase candidates)
- No realtime push yet (4–10s polling); SSE/WS upgrade is one phase, not a rewrite.
- Chat nav item has no shell unread counter (in-page badge only) — cosmetic add.
- No attachments/voice yet — lands with the Files phase (upload pipeline first).
- No typing presence/read-per-message UI — after realtime.

## Report section 5 — File library (2026-10-17, chain item 2 after chat)

The second of the vision's missing majors: **مكتبة الملفات** — org-wide, versioned,
sniffing-first.

### Data model (additive migration `20261017121500_file_library`)
- `StoredFile`: one row per version; `familyId` groups the version chain
  (v1 row is its own family), `version` monotonic, `isLatest` marks the head,
  `deletedAt` soft-delete (storage row on disk untouched until GC later).
- `path` is server-relative only; raw byte content never leaves the
  permission-checked proxy route. Display names are hand-off-safe
  (`safeStoredName`: control chars/traversal/dotfile starts stripped, ≤120 chars).

### Security posture
- **Magic bytes only** (`src/server/files/sniff.ts`): client MIME/extension ignored.
  Accepted: png/jpeg/gif/webp, mp4/webm, mp3/wav/ogg, pdf, zip-family
  (archive/docx/xlsx/pptx/odt), utf-8 plain text. MZ(exe)/unknown binaries →
  `403 files.unsupported`. Verified live: exeshell bytes named `.png` rejected.
- 25 MB cap per file (`files.too_large`), empty payload rejected.
- Content-Disposition inline for previewable, `attachment` with `?download=1`,
  `X-Content-Type-Options: nosniff`, private caching.
- Serve is org-scoped (`readStored(orgId, id)`) and gated by membership via
  `activeOrgCtx`; guests can read but never upload/delete (same guest rule as chat).
- Delete policy (unit-tested `canManageFile`): uploader, org OWNER, org ADMIN.

### API
- `POST /api/files` (multipart), `GET /api/files` (heads only + version counts)
- `GET /api/files/[id]` (meta resolves the family head even when asked with an
  old version id), `GET /api/files/[id]/raw`
- `POST /api/files/[id]/versions` (new head in the chain, old head demoted)
- `DELETE /api/files/[id]` (soft: if head removed → newest survivor promoted)

### UI (`/files`, nav **الملفات** in الأفكار section)
Header + drag&drop zone, cards with type glyph, version line, image thumbnails,
preview modal (image/video/audio/pdf/text), versions modal (per-version download
+ upload next v), download/delete actions per permission.
Share-д guide: `apiUpload` multipart path in api-client; ApiError now carries the
server's translated `messageKey` for toasts.

### Verified live (production build)
- upload png→`image/png`, txt→`text/plain`, zip→`application/zip`; fake.png (MZ) → 403
- raw download 200 `image/png` as salma; `?download=1` sends attachment + nosniff
- version flow: v2 upload → meta of v1 id returns head v2; list count 3 файлов
- permissions: salma (member, non-uploader) delete → 403; owner moderates salma's
  txt delete → 200 (list drops it); head v2 delete → heir v1 promoted head
- UI E2E: page renders cards + versions badge "نسخة 1 من 2", preview modal opens
  with the real image served through the proxy route

### Gates
`tsc` clean · vitest **65/65** (+9 files-logic; crypto tamper test made deterministic)
· `next build` green · health ok.

### Honest limits
- Storage is local disk under `.data/uploads` (no S3); EC2/server move = rsync dir.
- No task/chat attachments yet (links to tasks land with Pro-P2 depth or later).
- No GC for tombstoned bytes; no quota per user yet.

## Report section 6 — Departments (2026-10-17, chain item 3)

Foundation for the "department-special experience" from the Pro-vision: the org
gets real departments that aggregate members and projects.

### Data model (additive migration `20261017133500_departments`)
- `Department` (name ≤40, emoji, color token, optional leadId — must be an org
  member) + `DepartmentMember` (unique per dept+user).
- `Project.departmentId` **nullable** with `onDelete: SetNull` — nothing breaks:
  unlinking a department frees its projects intact. Additive-only as always.

### Policy
- Manage (create/rename/bind/delete/members): OWNER + ADMIN only — MEMBER gets
  the honest "OWNER/ADMIN only" copy, GUEST read-only.
- Stats on the card come from live task data: open = `completedAt IS NULL`,
  overdue = open with dueDate < now (completedAt semantics, not a fake status).

### API
- `GET/POST /api/departments`, `GET/PATCH/DELETE /api/departments/[id]`
  (DELETE cascades members, frees projects)
- `POST /api/departments/[id]/members` ({addUserIds, removeUserIds})
- New `PATCH /api/projects/[id]` (workspace-scoped) — fields incl.
  `departmentId` with cross-org dept rejection (dept must be in the project's org).

### UI (`/departments`, nav **الأقسام**)
Cards grid (emoji chip, member avatars, projects/open/overdue counters),
new/edit modal (name + emoji + 6-color chip + lead picker from the chatable
directory), members modal (add/remove everyone), delete with confirm copy
explaining projects are freed, not deleted. MEMBER sees read-only note.

### Verified live (production build)
- OWNER created "التصميم والإنتاج" 🎨 with salma; salma create → 403
- Project "Website Redesign" bound via PATCH → dept detail shows it with live
  counts (openTasks 2) and its workspace
- rename + lead set 200; member remove ✓ re-add ✓ (salma list reflects all)
- DELETE → project survived with `departmentId: null` (verified by reading it back)
- UI E2E: card renders members chip + counters + admin actions for OWNER

### Gates
`tsc` clean · vitest **68/68** (+3: role policy, palette stability, live-stats reduce)
· `next build` green · health ok.

### Honest limits
- No department-scoped files/chat filter yet (both libraries are org-wide).
- Department "lead" is informational (no power propagation) by design for now.
- No bulk bind (multi-project attach) — one PATCH per project today.

## Report section 7 — Interface refresh (2026-10-17, design system pass)

Full UI reskin per owner request ("تغيير شكل الواجهة بالكامل... احترافي,
ملون") inspired by the supplied minimal-CRM reference (21st-crm style).
**No features added or removed** — pure styling, tokens flow through existing
semantic CSS variables so every page/chat/board/file view adapts automatically.

### Design tokens (`globals.css`, light + dark)
- Light: canvas `#FFFFFF`, muted panels `#FAFAFA`, hover `#F0F0F1`,
  hairline borders `#E5E5E5`, text `#171717` / `#777777`,
  **accent `#4385FF`** (reference blue — primary buttons, links, focus rings).
- Dark: `#0F1117` canvas, `#14161D` panels, brighter accent `#6CA6FF` with
  dark-ink on-accent for contrast on solid buttons.
- `::selection` accent tint; negative tracking off the Inter-only
  font-feature settings; radio-dark kept color-scheme aware.

### Typography
- Replaced system stack with **IBM Plex Sans Arabic** (400/500/600/700) via
  `next/font/google` — one professional face for Arabic + Latin, falling back
  to Segoe UI/Tahoma if the variable is unavailable.

### Tailwind (`tailwind.config.ts`)
- Radii tightened to reference geometry: controls `8px`, cards/dialogs `12px`,
  large `16px` (was 10/14).
- New shadows `card` (0 1px 2px / .04) and `card-hover` (0 2px 6px / .07).

### Components
- `Button`: secondary is now a true white-outline button (reference style);
  primary stays solid accent; ghost/danger unchanged.
- `Input/Textarea/Select`: white background with soft accent focus border
  (was gray fill).
- `AppShell`: canvas flipped to white with the **`#FAFAFA` sidebar** (mirror of
  the reference layout), nav rows 36px with subtle labels, and **every nav icon
  colorized** (14 distinct lucide tints: blue/violet/emerald/sky/orange/rose/
  amber/indigo/teal/fuchsia/cyan/purple/green/slate) — the "ملون" ask.

### Verified live (production build, owner session)
- Computed styles: body white, sidebar `rgb(250,250,250)`, primary button
  `rgb(67,133,255)`, font `__IBM_Plex_Sans_Arabic_*` ✓
- 14 uniquely-colored nav icons ✓
- Dark mode: fresh-element probes show `#0F1117` body, `#14161D` panels,
  `#6CA6FF` accent, `#2C2F3A` borders ✓ (visual-only discrepancy seen in some
  stale-element computed reads was a tool-cache artifact; new-element probes
  and the stylesheet rules confirm correctness)
- Pages walked: `/`, `/projects`, `/chat`, `/departments`, `/login` — no load
  or render errors; RTL layout intact.

### Gates
`tsc` clean · vitest **68/68** · `next build` green (font self-hosted in
bundle) · health ok.

### Honest limits
- Not visually pixel-compared side-by-side (no visible screenshot window in
  this environment; DOM/computed-style verification only).
- Kanban column stage-dot colors, task cards, chat bubbles, file cards all
  inherit the new tokens; no per-page hand re-tuning was needed or done.

## Report section 8 — Brand, Timeline, Workspace isolation, error sweep (2026-10-17)

Three feature legs + a full error hunt, per owner request.

### 1) Logo → Zakai.io (dolphin)
- `logo.tsx` rewritten: hand-built **poly-dolphin SVG** (teal facets, circuit
  wave with glowing nodes) + wordmark **Zakai.io**/"INTELLIGENT SYSTEMS";
  collapsed sidebar shows the dolphin alone.
- New `src/app/icon.svg` favicon (dark rounded tile + dolphin) — browser picked
  it up (`/icon.svg`).
- Metadata title → `Zakai.io`; login page inherits the same `<Logo/>`.

### 2) Per-project timeline (MS-Project-style Gantt)
- `services/timeline.ts`: dated tasks ⇒ bars (start=startDate??dueDate,
  end=dueDate??startDate, done via completedAt/column.done), milestones ⇒
  diamonds, undated tasks listed honestly; month/day axis auto-windowed around
  data ∪ today, min 30 days.
- `GET /api/projects/[id]/timeline` (requireWorkspace).
- `/projects/[id]/timeline` SSR page + `<TimelineGantt>`: day/week/month zoom,
  **today** marker, dashed project window (startDate→targetDate), colored bars
  (sky=active, amber=priority, emerald=done, red=late), assignee in tooltip,
  months in Arabic via the deterministic formatter; chart body is `dir=ltr`
  (time axis stays left→right inside the RTL page).
- Project header gained a "التايم لاين" button (all locales).
- Verified live: owner → salma added to Operations sees it; 2 dated tasks
  render with titles+dates; scale buttons work; undated list hides.

### 3) Workspace isolation (bomo–employees–projects)
Root cause: every SSR page and the switcher gated on **org membership only**,
and `?workspace` param was even ignored by /projects. No door to assign people.
- New `services/access.ts`: `accessibleWorkspaceIds` (org OWNER/ADMIN inherit
  org workspaces; everyone else only explicit WorkspaceMember rows; guests
  never inherit) + `canManageWorkspaceMembers`.
- Scoped now: switcher `GET /api/workspaces` (salma ⇒ [] before assignment),
  `/projects` (+ honors `?workspace`), `/projects/[id]`, home dashboard, 
  `/boards/[id]`, `/tasks/[id]` (all previously org-wide), analytics tasks.
- New `POST /api/workspaces/[id]/members` — add/remove/**promote/demote**
  (org OWNER/ADMIN or ws ADMIN; callers scoped to org members only).
- `WorkspaceMembersButton` UI on projects header (when a workspace is
  selected): member list with roles, inherited-row badges (org inherit), add
  from directory, promote/demote/remove; 403 toasts translate.
- Verified live: salma []→[Operations]; main-workspace project = 404 for her;
  salma promote attempt 403; owner demote/promote self works.

### 4) Error sweep (fixes)
- **React hydration #418/#423 on 8+ pages** — root cause: Intl formatting
  differs between Node ICU and browser ICU. Fix: deterministic manual
  formatters in `format.ts` (`fmtDMY/fmtShort/fmtTime/fmtDateTime/fmtNumber/
  weekdayName/monthName`, hand-rolled Arabic/French/English month & weekday
  names, plain digits); replaced every Intl/toLocale* call site (chat time,
  files, task rows, calendar grid+page, settings, automation events, telegram
  messages, analytics numbers, gantt). **Post-fix sweep: zero console errors on
  all 16 routes.**
- **analytics/page.tsx lost to a failed scripted edit → recovered 1:1 from
  `.next` compiled bundle**, also upgraded: task stats moved from org-wide via
  `orgId` to **workspace-scoped** (accessible list) matching the isolation ask.
- **Owner self-demote lockout** — `requireWorkspace` threw before org
  inheritance was checked when a lower explicit WorkspaceMember row existed;
  now org OWNER/ADMIN outrank a lower ws row for "ADMIN"-requiring calls
  (org GUEST still never inherits). Live-verified demote→promote roundtrip.
- `insufficient_role` messageKey now translated (honest 403 copy in 3 langs).

### Gates
`tsc` clean · `next build` green · vitest **68/68** · health ok · console
errors: **0/16 routes**.

### Honest limits
- Gantt has no dependency arrows, no critical path, no drag-to-reschedule
  (dates are edited from the task detail page as before).
- Workspace creation still automatically grants creator ADMIN; org admins see
  all workspaces by design (inheritance), that is a policy, not a leak.
- Timeline zoom is per-session, not persisted.


## Report section 9 — Notifications everywhere, employee & role management, everything-editable (2026-10-17)

### 1) Notifications (بشكل شامل)
- `notify.ts` rebuilt around a generic `pushNotification` + `pushNotificationToMany`;
  kept `notifyAssignment`. New event types: `comment`, `welcome`,
  `ws_member_added`, `dept_member_added`, `org_role_changed`.
- Hooked into: task comment posted (assignee + creator, never the author),
  employee added (welcome w/ org name), workspace member added, department
  member added, org role change.
- Bell upgraded: per-item **mark-read** (on click or via ✓) and **delete**
  (trash), hover-revealed actions; `POST /api/notifications/read` accepts
  `{ids:[...]}` batch; new `DELETE /api/notifications/[id]` (own only).
- Verified live: welcome notif for a fresh employee; role-change notifs to
  salma; comment notif "ZD-2 · Salma Abed: …" delivered to owner; delete 200.

### 2) Members & permissions management (الأعضاء)
- Service `org-members.ts` with a pure role policy:
  - OWNER can grant ADMIN/MEMBER/GUEST and manage anyone except the OWNER row.
  - ADMIN can grant MEMBER/GUEST and manage only MEMBER/GUEST rows.
- New routes: `GET/POST /api/organizations/[id]/members`,
  `PATCH/DELETE /api/organizations/[id]/members/[userId]`.
  - POST = admin **creates the employee account directly** (name, email,
    temporary password, role) — no join code needed; Zod-validated, bcrypt(12),
    audit-logged (`org.member_added`, `org.member_role_changed`,
    `org.member_password_reset`, `org.member_removed`).
- New page `/members` (nav "الأعضاء", cyan): roster with avatar/role badges,
  add-employee modal (role picker), edit modal (role change + password reset),
  remove with confirm; MEMBERS see an honest "owner/admins only" notice.
- Verified live: employee "Karim Test" created → logged in with temp password →
  saw welcome notif; salma POST → 403; salma promoted ADMIN then back to
  MEMBER; edit/delete own-comment guards enforced.
- Tests: `tests/org-members-logic.test.ts` (+4) → suite **72/72**.

### 3) Everything editable (كل شيء قابل للتعديل)
- New `PATCH /api/workspaces/[id]` — rename + description (ws ADMIN or org
  admin) with `WorkspaceEditButton` beside "أعضاء المساحة" on /projects.
- New `PATCH/DELETE /api/tasks/[id]/comments/[commentId]` — authors edit/delete
  their own comments; TaskDetail now shows pencil/trash + inline edit form.
- Already-existing edit surfaces re-audited: tasks (title/desc/priority/due/
  assignee/labels/move/complete), projects, departments (+members), boards,
  columns, ideas (+convert), chat conversations & messages, files, labels,
  org name, own profile/password, integrations.

### Gates
`tsc` clean · build green · vitest **72/72** · health ok · temp test files
cleaned.


## Report section 10 — IT Tickets, first department product (2026-10-17)

- Migration `20261017123500_it_tickets` (additive): `TicketStatus` enum
  (OPEN/IN_PROGRESS/RESOLVED/CLOSED) + `Ticket` table (orgId, departmentId,
  per-org sequential `number` reusing the task counter -> key `${prefix}-T{n}`,
  priority, creator/assignee, resolvedAt). Unique(orgId, number). NOTE: the
  migration.sql must be written UTF-8 **without BOM** (Out-File -Encoding utf8
  adds a BOM and fails P3009; rewritten via .NET UTF8Encoding($false) after a
  `migrate resolve --rolled-back`).
- Service `tickets.ts`: policy — org OWNER/ADMIN full manage; department
  members create/assign (assignee must be a dept member or org admin) and
  transition; other org members read-only and may only edit their own OPEN
  tickets; explicit status transition matrix (CLOSED reopens; RESOLVED stamps
  resolvedAt). Sequential per-org numbering reuses the task counter
  (`${prefix}-T{n}`), protected by unique(orgId, number).
- Routes: `GET/POST /api/departments/[id]/tickets` (GET verifies the
  department belongs to the caller's org), `PATCH/DELETE /api/tickets/[id]`.
- UI: every department card gains a "تذكرة" button (LifeBuoy, rose) + an
  inline ticket list (T# key, title, creator → assignee, status chip, status
  dropdown for dept members/org admins, delete); card stat row gains an
  "N تذكرة مفتوحة" counter (open tickets from the departments list API).
- Notifications: assigning a ticket notifies the assignee (`ticket_assigned`,
  key `${prefix}-T{n}`).
- Verified live: owner created "الطابعة لا تطبع من الشبكة" (HIGH, assigned to
  salma) → T5; salma listed it, transitioned OPEN→IN_PROGRESS→RESOLVED;
  non-member karim PATCH → 403; assignee notification delivered.
- Visual: departments card shows "1 تذكرة مفتوحة" stat and the ticket row
  inside the department card.

### Honest limits
- Ticket comments/threads not included (tasks still own threaded discussion);
  tickets are single-post + status desk. Priority/assignee editing is via the
  same PATCH API — the modal edits at creation; in-row editing covers status
  and delete only (priority/assignee/title changes go through the API).


## Report section 10 — IT Tickets, first department product (2026-10-17)

- Migration `20261017123500_it_tickets` (additive-only): `TicketStatus` enum
  (OPEN / IN_PROGRESS / RESOLVED / CLOSED) + `Ticket` table (orgId,
  departmentId, per-org sequential `number` shared with the task counter so
  keys are unique `${prefix}-T{n}`, priority, creator/assignee, resolvedAt).
  Unique(orgId, number); indexes on (departmentId, status) and assigneeId.
  Migration written UTF-8 no-BOM after the known Out-File BOM failure
  (`migrate resolve --rolled-back` + .NET UTF8Encoding($false) rewrite).
- Service `tickets.ts`: policy — any org member may open a ticket in an org
  department; only department members or org OWNER/ADMIN may assign (assignee
  must be a department member or org admin), transition status, edit, or
  delete; plain org members may only edit their own ticket while OPEN.
  Status transition matrix enforced (CLOSED reopens; RESOLVED stamps
  resolvedAt, reopening clears it). Sequential per-org numbering shares the
  task counter so `T{n}` never collides with task keys `${prefix}-{n}`.
- Routes: `GET/POST /api/departments/[id]/tickets` (GET verifies the
  department belongs to the caller's org), `PATCH/DELETE /api/tickets/[id]`.
- UI: every department card gains a "تذكرة" button (LifeBuoy) that opens the
  create form inline in the card and lists the department's tickets with
  T# key, creator → assignee, status chip, status dropdown for dept members /
  org admins, and delete; card stat row shows "N تذكرة مفتوحة" for open
  tickets. Department members and org admins manage; other org members see a
  read-only list.
- Notifications: assigning a ticket notifies the assignee (`ticket_assigned`,
  key `${prefix}-T{n}`).
- Verified live: owner opened T5 "الطابعة لا تطبع من الشبكة" (HIGH, assigned
  salma) in "التصميم والإنتاج"; salma listed it, transitioned OPEN →
  IN_PROGRESS → RESOLVED (resolvedAt stamped); non-member karim got 403;
  assignment notification delivered; card shows the ticket row and the status
  dropdown.
- Bell UI visually verified: popup lists notifications with per-item
  mark-read (check) and delete (trash) buttons.


## Report section 10 — IT Tickets, first department product (2026-10-17)

- Migration `20261017123500_it_tickets` (additive-only): `TicketStatus` enum
  (OPEN / IN_PROGRESS / RESOLVED / CLOSED) + `Ticket` table (orgId,
  departmentId, per-org sequential `number` sharing the task counter -> key
  `${prefix}-T{n}`, priority, creator/assignee, resolvedAt). Unique(orgId,
  number). BOM-in-migration.sql failure fixed via
  `migrate resolve --rolled-back` + no-BOM rewrite (same Out-File trap as §8).
- Service `tickets.ts`: any org member may open a ticket in an org department;
  department members or org OWNER/ADMIN may assign (assignee must be a
  department member or org admin), transition status, edit, or delete; plain
  org members may edit only their own ticket while OPEN. Status transition
  matrix enforced (OPEN<->IN_PROGRESS->RESOLVED->CLOSED, CLOSED reopens;
  RESOLVED stamps resolvedAt, reopening clears it). Ticket numbering shares
  the per-org task counter so `T{n}` never collides with task keys.
- Routes: `GET/POST /api/departments/[id]/tickets` (GET verifies the department
  belongs to the caller's org), `PATCH/DELETE /api/tickets/[id]`.
- UI: every department card gains a "تذكرة" button (LifeBuoy) that expands an
  inline ticket desk inside the card: create form (title/description/priority/
  assignee-to-dept-members), T# rows with creator -> assignee, status chip,
  status dropdown for dept members/org admins, delete; card stat row gains
  "N تذكرة مفتوحة" (open tickets from the departments list API).
- Notifications: assigning a ticket notifies the assignee (`ticket_assigned`,
  key `${prefix}-T{n}`) — verified live ("ZD-T5" to salma).
- Verified live: owner opened "الطابعة لا تطبع من الشبكة" (HIGH, assigned
  salma) in "التصميم والإنتاج"; salma listed it and transitioned OPEN →
  IN_PROGRESS → RESOLVED; non-member karim PATCH → 403; card shows the ticket
  row and the status dropdown; bell popup lists items with per-item mark-read
  and delete buttons.

### Section 10 addendum — Arabic-only UI + stale-server incident (2026-10-17)
- French/English removed entirely: `fr.json`/`en.json` deleted, i18n provider
  and `getServerT` are Arabic-only (dir always rtl), language selectors removed
  from the topbar, login page and profile form; `profileSchema.locale` is now
  `ar`-only. Server HTML verified clean via curl (no "Français").
- Incident: a stale `next start` process (PID from `F:\n8n server\node.exe`,
  started 2:13 PM) survived every blanket `Get-Process node | Stop-Process`
  cycle and kept port 3000, serving an old build for prerendered pages while
  new dynamic routes worked — explaining all the "old UI" browser probes.
  Fixed by killing the PID explicitly (netstat -> Stop-Process -Id) and
  restarting one clean server. Lesson: always kill by port owner
  (Get-NetTCPConnection -LocalPort 3000) before builds.

### Section 10 addendum 2 — polish pass (2026-10-17)
- Ticket full editing: pencil button on every ticket row opens an edit modal
  (title, description, priority, assignee) -> PATCH; in-row status dropdown
  and delete remain. Verified live (modal opens pre-filled for T5).
- Command palette: added الإنتاج اليومي / الأهداف / الأعضاء entries.
- Gantt zoom (day/week/month) now persists in localStorage, restored after
  mount (post-hydration, no mismatch).
- i18n audit script cross-checks every static t("...") key in src against
  ar.json: found and fixed **50 missing keys** (all of prod.* and goal.* were
  showing raw keys on the pages, plus ideas.empty, nav.production,
  nav.goals, ticket edit strings, and the prod.wd_* weekday names). Now 0
  missing.
