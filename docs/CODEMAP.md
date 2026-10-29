# Code map — Zaki Workspace

> Phase A of the owner's review (2026-10-29). This file is generated from the code, not written
> from memory: `scripts/codemap.mjs` reads `src/`, `prisma/schema.prisma` and `src/lib/features.ts`
> and prints every table below. Re-run it after a change and the map is right again.
> ⚠️ A hand-written map drifts. The generator is the source; this file is its output.
> 🔧 `node scripts/codemap.mjs` rewrites it in place.

## What this answers

1. **Where does a job live?** — the folder map (§2).
2. **Who may call this door, and what does it call?** — all 146 routes, one row each (§4).
3. **If I change a service, what breaks?** — every service and its callers (§6).
4. **If I change a table, who writes it?** — every model and the code that writes it (§7).
5. **If I flip a switch, what disappears?** — the seven feature switches and every place that reads them (§8).

## 1. The layers

```
browser
  │  a page (server component) reads through a service, never through Prisma directly
  │  a client component mutates through fetch('/api/…')
  ▼
src/middleware.ts        ← runs on the edge for every request
  · API writes must come from this app's own pages (Origin guard, canonical path)
  · a page needs a VERIFIED session cookie, else /login?next=…
  · a cookie still owing a password change or the notice → /onboarding
  ▼
src/app/api/**/route.ts  ← thin: parse with zod, call ONE service, wrap in withApi()
  · the door: requireActor / activeOrgCtx / requireWorkspace / crmContext … (§3)
  ▼
src/server/services/*     ← the rules and the transactions
  · re-checks the door (assertMemberCan / memberCan) so a new caller cannot forget it
  ▼
prisma/schema.prisma      ← the data; a write belongs to a service (§7 lists every file that writes)
```

Two rules the code keeps, and a reviewer can check by reading the map:

- **One door per route.** No route decides access by comparing a role name; it asks a guard (§3).
- **One writer per concept.** A model belongs to the service that owns it; §7 names every file that writes a row, and §9 the handlers that still write theirs directly.

## 2. Folder map

| Where | Job |
|---|---|
| `src/app/(app)/` | the signed-in screens: one folder per place (today, boards, chat, crm, …) |
| `src/app/api/` | 146 route handlers — the only mutating surface (§4) |
| `src/app/login`, `register`, `onboarding`, `go` | the doors that work without a session |
| `src/components/` | the interface, grouped by feature; `shell/` is the frame, `ui/` the primitives |
| `src/lib/` | pure helpers that run on both sides: `i18n/`, `format.ts`, `features.ts`, `nav/`, `themes/` |
| `src/server/` | everything that may only run on the server |
| `src/server/policy/` | who may do what: ranks, capabilities, the section grid, conversation and call rules |
| `src/server/services/` | 47 services — the business rules (§6) |
| `src/server/chat/`, `calls/`, `files/`, `watch/`, `realtime/` | the larger features, split out of `services/` |
| `prisma/` | the schema and the additive-only migrations |
| `worker/` | a heartbeat placeholder: no scheduled job runs today |
| `tests/` | unit tests (`tests/`) and the real-database tests (`tests/db/`) |
| `scripts/` | the gate scripts: migrations lint, secret scan, icon and CSS builders, this map |

## 3. The guards — what each one proves

| Guard | Where | What it proves |
|---|---|---|
| `requireUser()` | `server/auth.ts` | a valid session cookie whose `tokenVersion` still matches the database; 403 `auth.onboarding_required` for a pending person |
| `requireActor()` | `policy/actor.ts` | the above, plus an ACTIVE membership: the person, their organization, rank, capabilities, `isOwner`, `isExternal` |
| `requireOrgMember(orgId)` | `auth.ts` | membership of THAT organization, ACTIVE |
| `requireOrgRole(orgId, roles)` | `auth.ts` | the above, and one of the given ranks |
| `requireWorkspace(wsId)` | `auth.ts` | a `WorkspaceMember` row — an ADMIN inherits nothing; the owner needs no row |
| `requireProjectAccess` / `requireTaskAccess` / `requireTeamWork` | `auth.ts` | the workspace a project, a task or a team belongs to, and the caller is in it |
| `activeOrgCtx()` | `services/integrations.ts` | the caller's oldest ACTIVE membership, as `{userId, orgId, orgRole}` — the commonest door |
| `crmContext(mode)` / `directoryContext()` | `app/api/_access.ts` | not a guest, plus `crm.view` / `crm.edit` / `crm.delete` / `directory.view` |
| `ideaAccessCtx(id)` / `ideasCtx` | `services/ideas.ts` | not a guest, plus the idea's own visibility |
| `assertOrgManager(orgId)` | `services/integrations.ts` | the `integrations.manage` capability |
| `assertCan` / `assertMemberCan` / `memberCan` | `policy/actor.ts` | one named capability, on the session or on a member row read from the database |
| `assertNotGuest` / `assertCanWrite` | `services/guest-guard.ts` | an external partner never reads a staff area and never writes |
| `assertFeatureOn` | `services/features.ts` | the feature's switch in «الميزات» is on |
| `currentSpace()` | `services/current-space.ts` | which space this request is working in |
| `assertMayReadFile` | `services/files.ts` | this person may open this file (owner, space, or conversation) |

## 4. Every route — its door and its service

The **Door** column is the first guard the handler calls. `public by design` means there is none on
purpose — §5 says why for each one. A handler with no `withApi` wrapper is marked with † (it answers
by hand: SSE, a redirect, an HMAC check, or the account wrapper that adds `no-store`). A handler that
writes to the database itself, instead of through a service, is marked with ‡ (§9 counts them).
**Service imports** are the functions the handler imports from `server/services/*` — the door itself
is often one of them.

Doors in use: `activeOrgCtx` 71 · `requireActor` 20 · `requireTeamWork` 11 · `requireUser` 10 · `requireWorkspace` 8 · `(none)` 6 · `requireAccountsActor` 5 · `crmContext` 4 · `ideaAccessCtx` 4 · `directoryContext` 3 · `currentUser` 1 · `ideasCtx` 1 · `requireOrgMember` 1 · `requireTaskAccess` 1.

| Method | Path | Door | Service imports |
|---|---|---|---|
| POST | `/api/auth/login` | **none** (public by design) ‡ | — |
| POST | `/api/auth/logout` | currentUser | — |
| POST | `/api/auth/register` | **none** (public by design) | `registration`: RegistrationUnavailableError, requestRegistration |
| POST | `/api/auth/register/confirm` | **none** (public by design) | `registration`: confirmRegistration |
| GET | `/api/avatars/[id]` | requireActor | `avatars`: readAvatar |
| POST | `/api/boards` | requireTeamWork ‡ | `tasks`: DEFAULT_BOARD_COLUMNS |
| GET, PATCH, POST | `/api/boards/[id]` | requireTeamWork ‡ | — |
| POST | `/api/boards/[id]/columns` | requireTeamWork ‡ | — |
| PATCH, DELETE | `/api/boards/[id]/columns/[columnId]` | requireTeamWork ‡ | — |
| POST | `/api/calls` | activeOrgCtx | `integrations`: activeOrgCtx<br>`current-space`: currentSpace |
| GET | `/api/calls/[id]` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/end` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/invite` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/leave` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/mute` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/remove` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/calls/[id]/token` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST, DELETE | `/api/campaign-items/[itemId]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`campaigns`: deleteCampaignItem, toggleCampaignItem |
| GET, PATCH, DELETE | `/api/campaigns/[id]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`campaigns`: campaignDetail, deleteCampaign, updateCampaign, updateCampaignSchema |
| POST | `/api/campaigns/[id]/items` | activeOrgCtx | `integrations`: activeOrgCtx<br>`campaigns`: addCampaignItem, campaignItemSchema |
| GET | `/api/campaigns/mine` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`campaigns`: myCampaigns |
| GET | `/api/chat/archive` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/attachments/[id]` | requireActor | — |
| GET, POST | `/api/chat/conversations` | activeOrgCtx | `integrations`: activeOrgCtx<br>`current-space`: currentSpace |
| GET, POST, PATCH, DELETE | `/api/chat/conversations/[id]` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET, POST | `/api/chat/conversations/[id]/call` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/conversations/[id]/delivered` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/conversations/[id]/join` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/conversations/[id]/messages` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/conversations/[id]/purge` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/conversations/[id]/read` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/conversations/[id]/search` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET, PUT | `/api/chat/conversations/[id]/whiteboard` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/directory` | directoryContext | `current-space`: currentSpace |
| POST | `/api/chat/dm` | activeOrgCtx | `integrations`: activeOrgCtx<br>`current-space`: currentSpace |
| GET | `/api/chat/home` | activeOrgCtx | `current-space`: currentSpace<br>`integrations`: activeOrgCtx |
| PATCH, DELETE | `/api/chat/messages/[id]` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/forward` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/notes` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/pin` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/react` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/task` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/messages/[id]/ticket` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/oversight/conversations` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/oversight/conversations/[id]` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/spaces/[spaceId]/mute` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST | `/api/chat/spaces/[spaceId]/topics` | activeOrgCtx | `integrations`: activeOrgCtx |
| PATCH, DELETE | `/api/chat/topics/[id]` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST, DELETE | `/api/chat/topics/[id]/members` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/chat/unread` | activeOrgCtx | `current-space`: currentSpace<br>`integrations`: activeOrgCtx |
| POST | `/api/chat/uploads` | requireActor | — |
| GET, POST | `/api/crm/customers` | crmContext | `space-place`: placeOf<br>`crm`: createCustomer, createCustomerSchema, listCustomers |
| GET, PATCH, DELETE | `/api/crm/customers/[id]` | crmContext | `crm`: deleteCustomer, getCustomer, updateCustomer, updateCustomerSchema |
| GET, POST | `/api/crm/opportunities` | crmContext | `space-place`: placeOf<br>`crm`: createOpportunity, createOpportunitySchema, listOpportunities |
| GET, PATCH, DELETE | `/api/crm/opportunities/[id]` | crmContext | `crm`: deleteOpportunity, getOpportunity, updateOpportunity, updateOpportunitySchema |
| GET, POST | `/api/departments` | directoryContext | `integrations`: activeOrgCtx<br>`departments`: createDepartment, createDepartmentSchema, listDepartments |
| GET, PATCH, DELETE | `/api/departments/[id]` | directoryContext | `integrations`: activeOrgCtx<br>`departments`: deleteDepartment, getDepartment, updateDepartment, updateDepartmentSchema |
| GET, POST | `/api/departments/[id]/campaigns` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`campaigns`: createCampaign, createCampaignSchema, listDepartmentCampaigns |
| POST | `/api/departments/[id]/members` | activeOrgCtx | `integrations`: activeOrgCtx<br>`departments`: membersSchema, setMembers |
| GET, POST | `/api/departments/[id]/tickets` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`tickets`: createTicket, createTicketSchema, listDepartmentTickets |
| POST, GET | `/api/files` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`files`: ingest, listFiles<br>`current-space`: currentSpace<br>`google`: libraryOnDrive |
| GET, DELETE | `/api/files/[id]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`files`: assertMayReadFile, getFileMeta, softDelete |
| GET | `/api/files/[id]/raw` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`files`: assertMayReadFile, openStored |
| POST | `/api/files/[id]/versions` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`files`: assertMayReadFile, ingest, PENDING_PATH |
| GET, POST | `/api/goals` | requireActor | `guest-guard`: assertNotGuest<br>`goals`: createGoal, goalSchema, listGoals<br>`space-place`: placeOf |
| PATCH, DELETE | `/api/goals/[id]` | requireActor | `guest-guard`: assertNotGuest<br>`goals`: deleteGoal, goalPatchSchema, updateGoal |
| GET | `/api/health` | **none** (public by design) † | — |
| GET, POST | `/api/ideas` | ideasCtx | `guest-guard`: assertNotGuest<br>`ideas`: createIdea, listIdeas<br>`current-space`: currentSpace<br>`n8n`: dispatchEvent |
| PATCH, DELETE | `/api/ideas/[id]` | ideaAccessCtx | `ideas`: deleteIdea, updateIdea, ideaAccessCtx<br>`n8n`: dispatchEvent |
| POST | `/api/ideas/[id]/convert` | ideaAccessCtx | `ideas`: ideaAccessCtx, convertIdeaToTask |
| POST | `/api/ideas/[id]/share` | ideaAccessCtx | `ideas`: ideaAccessCtx, shareIdea |
| POST | `/api/ideas/[id]/vote` | ideaAccessCtx | `ideas`: ideaAccessCtx, toggleIdeaVote |
| GET | `/api/instant` | activeOrgCtx | `integrations`: activeOrgCtx<br>`current-space`: currentSpace<br>`features`: isFeatureOn<br>`workspaces`: listWorkspaceMembers |
| POST | `/api/instant/task` | activeOrgCtx | `integrations`: activeOrgCtx<br>`current-space`: currentSpace<br>`instant-work`: createInstantTask<br>`org-day`: orgTimeZone |
| POST | `/api/instant/ticket` | activeOrgCtx | `integrations`: activeOrgCtx<br>`features`: assertFeatureOn<br>`guest-guard`: assertNotGuest<br>`tickets`: createInstantTicket, instantTicketSchema |
| GET, DELETE | `/api/integrations/google` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`google`: disconnectGoogle, getGoogleStatus, listDriveFiles, type DriveFile |
| POST, DELETE | `/api/integrations/google/app` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`google`: clearGoogleApp, saveGoogleApp |
| GET | `/api/integrations/google/callback` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`google`: exchangeCode, connectGoogle, verifyState |
| GET | `/api/integrations/google/start` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`google`: buildAuthUrl, googleApp |
| GET, POST, DELETE | `/api/integrations/n8n` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`n8n`: configureN8n, disconnectN8n, getN8nStatus, recentEvents<br>`guest-guard`: assertNotGuest |
| POST | `/api/integrations/n8n/inbound` | **none** (public by design) † | `n8n`: handleInbound |
| POST | `/api/integrations/n8n/test` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`n8n`: sendTestPayload |
| GET, POST, DELETE | `/api/integrations/telegram` | activeOrgCtx | `integrations`: activeOrgCtx, assertOrgManager<br>`telegram`: connectBot, disconnect, listChats<br>`guest-guard`: assertNotGuest |
| GET | `/api/integrations/telegram/messages` | activeOrgCtx | `integrations`: activeOrgCtx<br>`telegram`: chatMessages<br>`guest-guard`: assertNotGuest |
| POST | `/api/integrations/telegram/send` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`telegram`: sendMessage |
| POST | `/api/integrations/telegram/sync` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`telegram`: syncUpdates |
| GET, POST | `/api/labels` | requireWorkspace ‡ | — |
| GET, PATCH | `/api/me` | requireUser | `users`: updateProfile |
| POST, DELETE | `/api/me/avatar` | requireActor | `avatars`: clearAvatar, setAvatar, AVATAR_MAX_BYTES |
| POST | `/api/me/digits` | requireUser ‡ | — |
| POST | `/api/me/password` | requireUser | `onboarding`: changeOwnPassword |
| POST | `/api/me/theme` | requireUser ‡ | — |
| POST | `/api/me/transparency` | requireUser | `onboarding`: acceptTransparency |
| GET | `/api/notifications` | requireUser | `current-space`: bellWhere, currentSpace |
| DELETE | `/api/notifications/[id]` | requireUser ‡ | — |
| POST | `/api/notifications/read` | requireUser ‡ | `current-space`: bellWhere, currentSpace |
| GET, PATCH | `/api/organizations/[id]` | requireOrgMember ‡ | — |
| POST, GET | `/api/organizations/[id]/join-code` | **none** (public by design) † | — |
| GET, POST | `/api/organizations/[id]/members` | requireAccountsActor | `accounts`: createAccount, createAccountSchema, requireAccountsActor<br>`org-members`: listOrgMembers |
| PATCH, DELETE | `/api/organizations/[id]/members/[userId]` | requireAccountsActor | `accounts`: offboardBodySchema, requireAccountsActor, setAccountStatus, updateAccount, … |
| POST | `/api/organizations/[id]/members/[userId]/logout` | requireAccountsActor | `accounts`: logoutEverywhere, requireAccountsActor |
| POST | `/api/organizations/[id]/members/[userId]/password` | requireAccountsActor | `accounts`: requireAccountsActor, resetAccountPassword |
| POST | `/api/organizations/[id]/members/[userId]/status` | requireAccountsActor | `accounts`: accountStatusSchema, requireAccountsActor, setAccountStatus |
| GET | `/api/presence` | requireActor | `guest-guard`: assertNotGuest<br>`presence-roster`: presenceRoster |
| GET | `/api/production` | requireActor | `production`: dayChecklist, dayIso<br>`guest-guard`: assertNotGuest<br>`space-place`: placeOf |
| POST | `/api/production/checklist` | requireActor | `production`: setRoutineDone |
| GET, POST | `/api/production/routines` | requireActor | `production`: createRoutine, listRoutines, routineSchema<br>`guest-guard`: assertNotGuest<br>`space-place`: placeOf |
| PATCH, DELETE | `/api/production/routines/[id]` | requireActor | `production`: deleteRoutine, routineSchema, updateRoutine |
| GET, POST | `/api/projects` | requireWorkspace ‡ | `team-scope`: teamFilterInSpace<br>`teams`: assertMayCreateInTeam |
| PATCH | `/api/projects/[id]` | requireTeamWork ‡ | `teams`: moveProjectToTeam |
| GET | `/api/projects/[id]/boards` | requireTeamWork | — |
| GET | `/api/projects/[id]/timeline` | requireTeamWork | `timeline`: getProjectTimeline |
| GET | `/api/push/key` | activeOrgCtx | `integrations`: activeOrgCtx |
| POST, DELETE | `/api/push/subscribe` | activeOrgCtx | `integrations`: activeOrgCtx |
| GET | `/api/rt` | requireActor † | — |
| POST | `/api/rt/typing` | requireActor | — |
| GET | `/api/search` | requireUser | `current-space`: currentSpace<br>`team-scope`: loadWorkScope, narrowScope, projectVisibleWhere, scopeSpaceIds, …<br>`files`: searchLibrary |
| GET, PATCH | `/api/settings/features` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`features`: listFeatures, setFeature |
| GET | `/api/spaces/unplaced` | requireActor | `move-to-space`: listUnplaced |
| POST | `/api/spaces/unplaced/move` | requireActor | `move-to-space`: moveSchema, moveToSpace |
| GET, POST | `/api/tasks` | requireWorkspace | `team-scope`: teamFilterInSpace<br>`tasks`: createTask, listTasks<br>`org-day`: orgTimeZone<br>`n8n`: dispatchEvent |
| GET, PATCH, DELETE | `/api/tasks/[id]` | requireTaskAccess | `team-scope`: userSeesProject<br>`tasks`: updateTask, deleteTask<br>`active-people`: assertActiveAssignee<br>`org-day`: orgTimeZone |
| POST, GET | `/api/tasks/[id]/comments` | requireTeamWork ‡ | `n8n`: dispatchEvent |
| PATCH, DELETE | `/api/tasks/[id]/comments/[commentId]` | requireTeamWork ‡ | — |
| POST | `/api/tasks/[id]/complete` | requireTeamWork | `tasks`: setTaskCompletion<br>`n8n`: dispatchEvent |
| POST | `/api/tasks/[id]/move` | requireTeamWork | `tasks`: moveTask<br>`n8n`: dispatchEvent |
| PATCH, DELETE | `/api/tickets/[id]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`tickets`: deleteTicket, updateTicket, updateTicketSchema |
| PATCH, DELETE | `/api/tickets/[id]/comments/[commentId]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`tickets`: deleteTicketComment, editTicketComment, ticketCommentSchema |
| GET, POST | `/api/tickets/[id]/detail` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`tickets`: addTicketComment, ticketCommentSchema, ticketDetail |
| GET | `/api/tickets/instant` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`tickets`: listInstantTickets |
| GET | `/api/tickets/mine` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`tickets`: myTickets |
| GET | `/api/users/[id]` | requireActor | `users`: getProfileForViewer |
| GET, POST | `/api/watch` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`features`: assertFeatureOn<br>`current-space`: currentSpace<br>`watch`: listWatch, startWatch, startWatchSchema |
| GET | `/api/watch/[id]` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`features`: assertFeatureOn<br>`watch`: watchDetail |
| POST | `/api/watch/[id]/end` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`features`: assertFeatureOn<br>`watch`: endWatch |
| GET, POST, PATCH | `/api/watch/[id]/remote` | activeOrgCtx | `integrations`: activeOrgCtx<br>`guest-guard`: assertNotGuest<br>`features`: assertFeatureOn<br>`watch`: handOverRemote, handOverSchema, pressRemote, pressSchema, … |
| GET, POST | `/api/workspaces` | requireUser | `workspaces`: createWorkspace<br>`access`: accessibleWorkspaceIds<br>`current-space`: currentSpace |
| GET, PATCH, DELETE | `/api/workspaces/[id]` | requireWorkspace ‡ | `workspaces`: SpaceConflictError, deleteEmptyWorkspace, readWorkspace |
| POST | `/api/workspaces/[id]/archive` | requireActor | `workspaces`: SpaceConflictError<br>`space-manage`: archiveSchema, setSpaceArchived |
| GET, POST | `/api/workspaces/[id]/delete-all` | requireActor | `workspaces`: SpaceConflictError<br>`space-delete`: deleteAllSchema, deleteSpaceWithWork, spaceContents |
| GET, POST, PATCH, DELETE | `/api/workspaces/[id]/members` | requireWorkspace | `workspaces`: SpaceConflictError, canManageHere, changeWorkspaceMembers, listWorkspaceMembers, … |
| GET, POST | `/api/workspaces/[id]/teams` | requireWorkspace | `teams`: TeamConflictError, createTeam, listTeams |
| PATCH, DELETE | `/api/workspaces/[id]/teams/[teamId]` | requireWorkspace | `teams`: TeamConflictError, deleteTeam, updateTeam |
| POST | `/api/workspaces/[id]/teams/[teamId]/members` | requireWorkspace | `teams`: setTeamMembers |
| PUT | `/api/workspaces/order` | requireActor | `space-manage`: orderSchema, reorderSpaces |
| GET | `/go` | requireActor | `current-space`: SPACE_COOKIE, spacesOf |

## 5. Routes with no guard — and why that is correct

Six of 146. Each one is a door that cannot have a session, or one that is closed.

| Route | Why it has no guard |
|---|---|
| `/api/health` | The liveness probe. Answers `{status, checks:{app,database}}` and nothing else; no data, no identity. |
| `/api/auth/login` | Sign-in itself. Rate-limited (`RateLimitedError`, `login-guard.ts`) and audited; the caller has no session yet by definition. |
| `/api/auth/register` | Asking for a NEW company. Always answers the same 202 (no address enumeration), capped per address and per server (`registration.ts`). |
| `/api/auth/register/confirm` | The one-time link e-mailed by the step above. The token in the body IS the credential. |
| `/api/integrations/n8n/inbound` | Machine door, no session: the caller proves it holds the org's secret with `x-zaki-signature` (HMAC over `timestamp.body`, 5-minute replay window) or the legacy `x-zaki-token`. Org from `x-zaki-org`. |
| `/api/organizations/[id]/join-code` | Retired: answers 410 to every method. It reads nothing and writes nothing. |

Everything else is behind a door. The middleware adds a second line in front of all of them: a write
to `/api/…` must carry an `Origin`/`Sec-Fetch-Site` this app accepts, judged on the canonical path.

## 6. Services → who calls them

`callers` counts the files that import the service (a route, a page, another service). A service with a
high count is a wide surface: changing its signature reaches all of them.

| Service | Lines | Imported by | What it owns |
|---|---|---|---|
| `integrations` | 180 | 79 | Connect/disconnect/config changes (org-level assets): the `integrations.manage` capability. |
| `current-space` | 123 | 41 | THE SPACE YOU ARE IN — the owner's decision (2026-10-25, «العزل شامل… كأني بفتح سايت جديد»): entering a space is like opening a separate site. |
| `guest-guard` | 30 | 37 | Org GUESTs are external partners (for example the factory): they see only what is shared with them, never write business data, and never see prices or the staff directory. |
| `team-scope` | 149 | 16 | TEAMS INSIDE A SPACE — the one place that says which projects and tasks a person may see. |
| `features` | 48 | 15 | «الميزات» on the server: the company's switches (`Organization.settings.features`), read on every request. |
| `tasks` | 454 | 14 | no header comment — exports `TASK_INCLUDE`, `DEFAULT_BOARD_COLUMNS`, `nextTaskNumber`, `createTask`, `moveTask`, … |
| `n8n` | 294 | 9 | Events we allow orgs to forward to n8n — the UI shows exactly this list. |
| `access` | 76 | 8 | Workspace-level isolation — the company's master switch. |
| `files` | 505 | 8 | no header comment — exports `fileLibrary`, `PENDING_PATH`, `PREVIEWABLE`, `INLINE_TEXT`, `logFile`, … |
| `google` | 355 | 8 | Only the files the app itself creates (the library's): a non-sensitive scope, so Google asks for no review and the owner's published app keeps its connection. |
| `space-place` | 30 | 8 | WHERE A SPACE'S OWN THINGS ARE READ (the owner's decision, 2026-10-25: each space is like a separate site) — for the goals, the daily routines, the customers and the opportuniti… |
| `tickets` | 501 | 8 | IT tickets live inside a department. |
| `workspaces` | 325 | 8 | Spaces (workspaces): who is in one, who may change it. |
| `active-people` | 71 | 7 | "Nobody who was suspended or removed still counts." A suspended or offboarded member keeps their OrganizationMember row (history, authorship), so a query that reads that table w… |
| `ideas` | 395 | 7 | Membership context resolved from the idea's own org (shared by API routes). |
| `accounts` | 859 | 6 | The account lifecycle: the owner (and, below him, whoever holds `users.manage`) creates, edits, suspends, reactivates and offboards people, resets passwords and ends sessions. |
| `watch` | 372 | 6 | «نتفرّج سوا» — people of a space watch one link together (the owner's ask, 2026-10-26). |
| `campaigns` | 235 | 5 | Campaigns live inside a department (marketing calendars). |
| `production` | 262 | 5 | Daily production. |
| `teams` | 223 | 5 | TEAMS INSIDE A SPACE — who is in which team, and which project belongs to which (the reading rule is in team-scope.ts). |
| `telegram` | 299 | 5 | Validates a bot token by calling getMe. |
| `crm` | 228 | 4 | no header comment — exports `OPPORTUNITY_STAGES`, `createCustomerSchema`, `updateCustomerSchema`, `createOpportunitySchema`, `updateOpportunitySchema`, … |
| `departments` | 240 | 4 | The departments area is the company's staff directory (who works where, with which job title), so org GUESTs get 403 on every function here, read or write. |
| `users` | 287 | 4 | no header comment — exports `updateProfile`, `getProfileForViewer`, `getPublicProfile`, `memberDirectory` |
| `views` | 359 | 4 | Zones already warned about, per organization, so a bad stored zone is logged once and not on every request. |
| `org-day` | 26 | 3 | The start of the COMPANY's today — `Organization.timezone`, never the server's clock and never the browser's. |
| `registration` | 145 | 3 | Opening a company is open to anyone (owner's decision 23/10), behind three guards: The address is checked. |
| `space-manage` | 61 | 3 | MANAGING THE SPACES FROM «كل المساحات» (the owner's asks, 2026-10-26): put them in order by dragging, archive one (it leaves every list — the switcher, the overview, search by s… |
| `spaces-overview` | 73 | 3 | «كل المساحات» — the owner's and the admins' one look over every space they can open (the owner's decision, 2026-10-25): each space stays a separate site, and this page only coun… |
| `avatars` | 99 | 2 | A PERSON'S PICTURE (the owner's ask, 2026-10-29: «خيار إن المستخدم يحط صورة بروفايل»). |
| `goals` | 168 | 2 | no header comment — exports `periodWindow`, `goalSchema`, `goalStatus`, `listGoals`, `createGoal`, … |
| `member-rules` | 184 | 2 | The rank rules of account management, in ONE place, as pure functions with no database and no server-only import — so the members screen can offer exactly what the server allows… |
| `move-to-space` | 106 | 2 | «انقل لمساحة» (the plan, 2026-10-25: each space is like a separate site). |
| `onboarding` | 88 | 2 | The one-time onboarding every account goes through (the owner creates accounts with a temporary password and nobody has accepted the transparency notice yet): choose your own pa… |
| `org-members` | 192 | 2 | Organization members: the rank rules of account management and the roster. |
| `orgs` | 154 | 2 | no header comment — exports `JOIN_CODE_ALPHABET`, `generateJoinCode`, `registrationOpen`, `registerOrganization`, `canManageOrg` |
| `timeline` | 76 | 2 | Microsoft-Project-style timeline data for one project: dated tasks become bars, milestones become diamonds, undated tasks are reported separately. |
| `analytics` | 66 | 1 | Numbers behind the analytics page. |
| `calendar` | 62 | 1 | The calendar's data logic, taken out of the page so it can be tested with an injected `now`. |
| `credentials` | 64 | 1 | Account credentials as pure functions (no database): what a username may look like, the password policy, and the temporary passwords the owner hands to a new or reset account. |
| `department-space` | 93 | 1 | EVERY DEPARTMENT HAS ITS SPACE (the owner's decision, 2026-10-25: each space is like a separate site). |
| `first-steps` | 100 | 1 | The first-steps card («خطواتك الأولى») computed from REAL data for the signed-in actor: nothing is stored about "progress" - a step is done because the rows say so (a theme chos… |
| `instant-work` | 105 | 1 | «مهمة فورية» (the owner's ask, 2026-10-27: «+ بالمهام ومهمة فورية لشخص محدد مع أولوية»): a task typed in one go — a title, the person, the priority, a day — with no project to p… |
| `my-work` | 149 | 1 | The company's zone as the person's My Work page reads it: the first company they are an ACTIVE member of. |
| `presence-roster` | 59 | 1 | THE PEOPLE DOCK — who works here and who is at their screen right now (the owner's ask, 2026-10-29: «المستخدمين ظاهرين على زاوية الموقع تحت وكل واحد جنبه علامة خضراء أونلاين»). |
| `space-delete` | 93 | 1 | DELETING A SPACE WITH ALL ITS WORK (the owner's decision, 2026-10-26: «كلها مع شغلها»). |
| `today` | 289 | 1 | «اليوم» — everything the Today page shows, in one call (`getToday(actor)`), so the page decides nothing. |

## 7. Models → who writes them

Only `.create`, `.update`, `.upsert` and `.delete` are counted — that is the code that changes a row.
A model written from more than one place is listed with all of them: those are the places a new rule has
to be added to, and the places a bug can leave the row half-written.

| Model | Writes | Written by (file: calls) |
|---|---|---|
| `User` | 12 | `server/services/accounts.ts`: 3<br>`server/services/avatars.ts`: 2<br>`server/services/onboarding.ts`: 2<br>`app/api/auth/login/route.ts`: 1<br>+4 more |
| `Department` | 4 | `server/services/departments.ts`: 3<br>`server/services/accounts.ts`: 1 |
| `Ticket` | 6 | `server/services/tickets.ts`: 4<br>`server/chat/make-work.ts`: 1<br>`server/services/accounts.ts`: 1 |
| `TicketComment` | 3 | `server/services/tickets.ts`: 3 |
| `TicketActivity` | 7 | `server/services/tickets.ts`: 6<br>`server/services/accounts.ts`: 1 |
| `Campaign` | 4 | `server/services/campaigns.ts`: 3<br>`server/services/accounts.ts`: 1 |
| `CampaignItem` | 3 | `server/services/campaigns.ts`: 3 |
| `Routine` | 6 | `server/services/production.ts`: 3<br>`server/services/accounts.ts`: 1<br>`server/services/move-to-space.ts`: 1<br>`server/services/space-delete.ts`: 1 |
| `RoutineLog` | 2 | `server/services/production.ts`: 2 |
| `Goal` | 5 | `server/services/goals.ts`: 3<br>`server/services/move-to-space.ts`: 1<br>`server/services/space-delete.ts`: 1 |
| `DepartmentMember` | 3 | `server/services/departments.ts`: 2<br>`server/services/accounts.ts`: 1 |
| `StoredFile` | 11 | `server/services/files.ts`: 7<br>`server/chat/attachments.ts`: 1<br>`server/chat/purge.ts`: 1<br>`server/services/move-to-space.ts`: 1<br>+1 more |
| `Conversation` | 17 | `server/chat/topics.ts`: 6<br>`server/chat/dm.ts`: 3<br>`server/chat/messages.ts`: 2<br>`server/chat/hq.ts`: 1<br>+5 more |
| `ConversationMember` | 18 | `server/chat/topics.ts`: 6<br>`server/chat/dm.ts`: 4<br>`server/chat/messages.ts`: 3<br>`server/services/workspaces.ts`: 2<br>+3 more |
| `ChatMessage` | 6 | `server/chat/messages.ts`: 5<br>`server/chat/system.ts`: 1 |
| `ChatReaction` | 2 | `server/chat/messages.ts`: 2 |
| `MessageRevision` | 1 | `server/chat/messages.ts`: 1 |
| `MessageNote` | 1 | `server/chat/messages.ts`: 1 |
| `MessageAttachment` | 2 | `server/chat/attachments.ts`: 1<br>`server/chat/messages.ts`: 1 |
| `RealtimeEvent` | 1 | `server/realtime/emit.ts`: 1 |
| `Whiteboard` | 2 | `server/chat/whiteboard.ts`: 2 |
| `Call` | 4 | `server/calls/calls.ts`: 4 |
| `CallPerson` | 4 | `server/calls/calls.ts`: 4 |
| `PushSubscription` | 4 | `server/calls/push.ts`: 4 |
| `WatchSession` | 4 | `server/services/watch.ts`: 4 |
| `Organization` | 4 | `server/services/google.ts`: 2<br>`app/api/organizations/[id]/route.ts`: 1<br>`server/services/features.ts`: 1 |
| `OrganizationMember` | 4 | `server/services/accounts.ts`: 4 |
| `Workspace` | 9 | `server/services/department-space.ts`: 2<br>`server/services/space-manage.ts`: 2<br>`server/services/workspaces.ts`: 2<br>`app/api/workspaces/[id]/route.ts`: 1<br>+2 more |
| `WorkspaceMember` | 17 | `server/services/accounts.ts`: 6<br>`server/services/workspaces.ts`: 5<br>`server/services/department-space.ts`: 3<br>`server/chat/hq.ts`: 2<br>+1 more |
| `Team` | 8 | `server/services/teams.ts`: 4<br>`server/services/accounts.ts`: 3<br>`server/services/workspaces.ts`: 1 |
| `TeamMember` | 6 | `server/services/teams.ts`: 3<br>`server/services/accounts.ts`: 1<br>`server/services/department-space.ts`: 1<br>`server/services/workspaces.ts`: 1 |
| `Project` | 7 | `server/services/accounts.ts`: 2<br>`app/api/projects/[id]/route.ts`: 1<br>`app/api/projects/route.ts`: 1<br>`server/services/instant-work.ts`: 1<br>+2 more |
| `Milestone` | 2 | `server/services/accounts.ts`: 2 |
| `Board` | 3 | `app/api/boards/[id]/route.ts`: 1<br>`app/api/boards/route.ts`: 1<br>`server/services/instant-work.ts`: 1 |
| `BoardColumn` | 4 | `app/api/boards/[id]/columns/[columnId]/route.ts`: 2<br>`app/api/boards/[id]/columns/route.ts`: 1<br>`app/api/boards/[id]/route.ts`: 1 |
| `TaskCounter` | 1 | `server/services/tasks.ts`: 1 |
| `Task` | 9 | `server/services/tasks.ts`: 5<br>`server/chat/make-work.ts`: 1<br>`server/services/accounts.ts`: 1<br>`server/services/space-delete.ts`: 1<br>+1 more |
| `Label` | 1 | `app/api/labels/route.ts`: 1 |
| `TaskComment` | 3 | `app/api/tasks/[id]/comments/[commentId]/route.ts`: 2<br>`app/api/tasks/[id]/comments/route.ts`: 1 |
| `TaskActivity` | 7 | `server/services/tasks.ts`: 4<br>`app/api/tasks/[id]/comments/route.ts`: 1<br>`server/activity.ts`: 1<br>`server/services/accounts.ts`: 1 |
| `Notification` | 7 | `server/notify.ts`: 2<br>`app/api/notifications/[id]/route.ts`: 1<br>`app/api/notifications/read/route.ts`: 1<br>`server/chat/notify.ts`: 1<br>+2 more |
| `AuditLog` | 11 | `server/services/teams.ts`: 5<br>`server/chat/moderation.ts`: 2<br>`server/auth.ts`: 1<br>`server/chat/hq.ts`: 1<br>+2 more |
| `Idea` | 7 | `server/services/ideas.ts`: 5<br>`server/services/move-to-space.ts`: 1<br>`server/services/space-delete.ts`: 1 |
| `IdeaVote` | 2 | `server/services/ideas.ts`: 2 |
| `Integration` | 4 | `server/services/integrations.ts`: 2<br>`server/services/google.ts`: 1<br>`server/services/telegram.ts`: 1 |
| `TelegramChat` | 1 | `server/services/telegram.ts`: 1 |
| `TelegramMessage` | 3 | `server/services/telegram.ts`: 3 |
| `IntegrationEvent` | 1 | `server/services/integrations.ts`: 1 |
| `Customer` | 5 | `server/services/crm.ts`: 3<br>`server/services/move-to-space.ts`: 1<br>`server/services/space-delete.ts`: 1 |
| `Opportunity` | 7 | `server/services/crm.ts`: 3<br>`server/services/move-to-space.ts`: 2<br>`server/services/accounts.ts`: 1<br>`server/services/space-delete.ts`: 1 |
| `PendingRegistration` | 4 | `server/services/registration.ts`: 4 |

`TaskLabel` has no direct write of its own: it is filled only through a nested write on `Task.labels` in `server/services/tasks.ts` — counted here so a change there is read as a change here.
⚠️ **Nothing writes `TaskDependency` — not a route, not a service, not the seed, not a nested write.** The table was created by the first migration and has never held a row: a feature that was not built. 🔧 Keep the table (additive-only) and either build the feature or stop selecting it in Phase E.

## 8. Feature switches → where they are read

The owner's rule: every new feature sits behind its own switch, and off means the site is as it was
before it. A switch is only honest if something reads it, so this is the list of readers.

| Switch | Places that read it |
|---|---|
| `watch` | 27 — `app/(app)/watch/[id]/page.tsx`, `app/(app)/watch/page.tsx`, `app/api/watch/[id]/end/route.ts`, `app/api/watch/[id]/remote/route.ts`, `app/api/watch/[id]/route.ts`, `app/api/watch/route.ts`, `components/calls/call-room.tsx`, `components/shell/nav-icons.tsx`, `components/shell/new-wheel.tsx`, `components/watch/watch-comments.tsx`, `components/watch/watch-home.tsx`, `components/watch/watch-player.tsx`, `components/watch/watch-room.tsx`, `components/whiteboard/whiteboard-screen.tsx`, `lib/guide/page-help.ts`, `lib/i18n/dict.ts`, `lib/nav/new-actions.ts`, `lib/nav/places.ts`, `lib/watch/convert.ts`, `lib/watch/source.ts`, `server/chat/make-work.ts`, `server/chat/purge.ts`, `server/policy/capabilities.ts`, `server/policy/watch.ts`, `server/realtime/emit.ts`, `server/services/watch.ts`, `server/watch/title.ts` |
| `sectionPermissions` | 2 — `server/policy/capabilities.ts`, `server/policy/section-grid.ts` |
| `libraryDrive` | 2 — `lib/i18n/dict.ts`, `server/services/google.ts` |
| `pushEverything` | 1 — `server/notify.ts` |
| `chatRowMenu` | 2 — `server/chat/home.ts`, `server/chat/purge.ts` |
| `callNoiseFilter` | 1 — `server/calls/calls.ts` |
| `instantWork` | 4 — `app/api/instant/route.ts`, `app/api/instant/ticket/route.ts`, `components/instant-work.tsx`, `server/services/instant-work.ts` |

## 9. What this map noticed

Written down, not fixed: Phase E decides what becomes a PR. Every item was read in the code, not guessed.

- **Every guarded route asks a guard — none compares a role name.** 140 of 146 routes open with a function from §3; the other 6 are the doors listed in §5.
- **Two doors carry most of the traffic.** `activeOrgCtx()` and `requireActor()` are the first call of 91 routes; both re-read the membership and its status from the database on every request, so a suspension takes effect on the next call, not on the next sign-in.
- **16 route handlers write to the database themselves instead of calling a service.** 9 of them write their own `audit()` row (`/api/auth/login`, `/api/boards`, `/api/boards/[id]/columns`, `/api/boards/[id]/columns/[columnId]`, `/api/labels`, `/api/organizations/[id]`, `/api/projects`, `/api/projects/[id]`, `/api/workspaces/[id]`); one writes a task-feed row instead (`/api/tasks/[id]/comments`); 6 write neither (`/api/boards/[id]`, `/api/me/digits`, `/api/me/theme`, `/api/notifications/[id]`, `/api/notifications/read`, `/api/tasks/[id]/comments/[commentId]`); 4 of those are one person's own preference (`/api/me/digits`, `/api/me/theme`, `/api/notifications/[id]`, `/api/notifications/read`), which is right; the 2 left (`/api/boards/[id]`, `/api/tasks/[id]/comments/[commentId]`) are the ones Phase E looks at. Nothing is silently lost today, but *who may, what is logged and what is notified* lives in the handler, not in one place. No screen file writes directly: every write comes through `/api`.
- **14 models are written from more than three files** — see §7 for the list. Those are where a new invariant has to be added more than once, and where a half-written row is possible if one caller forgets a field.

