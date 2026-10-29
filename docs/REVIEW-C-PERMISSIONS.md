# Phase C — the permissions the server actually answers

> Phase C of the owner's review (2026-10-29). Phase A mapped the code (`docs/CODEMAP.md`), Phase B
> tested the numbers. Phase C asks one question of every screen and every route: does the server
> decide who may read and write, on every request, from the database — or does the screen only hide
> a button?
>
> The model is one (`src/server/policy/`: rank `OWNER > ADMIN > LEAD > MEMBER > GUEST`, the
> per-person boxes of `effectiveCapabilities`, and a space visible only to the people in it and to
> the OWNER). This phase looked for places that decide access another way.

## 1. What was fixed in this PR

| # | Where | What was wrong | What it does now |
|---|---|---|---|
| C1 | `chat/archive.ts` `readArchive` · `readArchiveFilterOptions`, `chat/oversight.ts` `listOversight` · `assertOversightRead` | The archive and the owners' «كل محادثات الشركة» tested the RANK only (`canArchive(role)`). A partner is an OWNER, and the primary owner can take `archive.view` away from him in «الأشخاص» — the box was decoration: the partner kept reading the deleted messages and every DM in the company. | `chat/archive-access.ts` → `holdsArchiveView()` reads the member row (ACTIVE) and asks `effectiveCapabilities`: the capability decides, and a suspended or revoked partner gets 403 `chat.e.archive_denied` / `chat.e.oversight_denied`. The primary owner, who holds everything, is unaffected. |

Proved in `tests/db/archive-capability.test.ts`: it failed before the change
(`expected 200 to be 403`) and passes after it — a partner reads both, the box taken away closes
both, giving it back opens them again, and `archive.view` can never be handed to a third person
(403 `accounts.cap_owner_only`, nothing stored).

## 2. What the phase checked and found already correct

Each line is a database test that exists and passes today; none of them is a reading of a file name.

| Area | Test | What it pins |
|---|---|---|
| The per-person grid — tasks, projects, goals, ideas, production, library, tickets, campaigns | `section-permissions*.test.ts` (5 files), `active-capabilities.test.ts` | Every box is the server's answer, for reading, adding, and deleting; a partner loses a box the primary owner takes away. |
| Space visibility | `scoping-views` · `scoping-pages` · `scoping-search` · `spaces-access` | A space is visible only to its people and the OWNER; an ADMIN inherits nothing by rank; a MEMBER with no space gets none, never a fallback. |
| Teams inside a space | `teams-scoping.test.ts` | The other team's task, board and project are «not found», in the lists and in the routes. |
| The external partner (GUEST) | `guest-*.test.ts` (6), `partners.test.ts`, `guest-directory` | No staff directory, no job titles, no library, no CRM, no writing. |
| Search | `tests/db/search-capabilities.test.ts` (new, 2) | Revoking `tasks.view` / `projects.view` / `files.view` takes the rows out of `/api/search` too — search is not a back door to a section. |
| Live updates (SSE replay) | `tests/db/realtime-replay-gate.test.ts` (new, 4) | A reconnect replays only what the person may read: their space's topic yes, a colleague's DM no, a removal and a suspension drop it, another company never. Runs against the real `policy/conversation`, not a stub. |
| Changing permissions | `accounts-*.test.ts`, `partners.test.ts` | A person grants only what he holds himself, `archive.view` is never grantable, nobody edits himself, and rank can only be given strictly below one's own. |
| Reports | `pages-access-capabilities.test.ts` | `/analytics` checks `reports.view` on the page and loads its data server-side; no route serves the same numbers without the check. |
| Ideas | `scoping-ideas-tasks.test.ts` (re-read) | The `ideaAccessCtx` door only proves the caller is staff; every downstream read and write re-checks the target's space (`assertIdeaScope` → `accessibleWorkspaceIds`). Not a hole. |

## 3. Found, written down, and NOT changed here

⚠️ **C2 — `prices.view` is a box with nothing behind it.**
`services/crm.ts:58` says it plainly: opportunity `value` is price data and hiding it from staff is
`prices.view`'s job, «wired later — not here». Today `listOpportunities` and `getOpportunity`
answer the amount to anybody holding `crm.view`, so the primary owner can untick «الأسعار» for a
person and that person still reads every deal's value. External partners are not affected (a GUEST
never reaches the CRM at all: 403 `guest.no_access`) — this is the staff box.
🔧 The same shape as C1: a `seesPrices(ctx)` from the member row's `effectiveCapabilities`, then
`value: null` in the DTO (and a refusal to write one) without it, and «—» on the CRM screens. It
changes a payload, a screen and its Arabic strings, so it belongs in its own PR rather than this one.

⚠️ **C3 — four capabilities guard nothing in this repository yet.**
`cash.view`, `penalties.view` (the OMS's cash and penalties cards), `announce.send` and
`escalation.configure` are switches on «الأشخاص» and defaults in the catalogue, and no route, page
or service asks any of them: there is no cash card, no announcement sender and no thresholds screen
here. Nobody is exposed by that — it is the opposite: the owner believes he closed a door that has
no wall yet.
🔧 When the OMS data lands, each read asks its box before it answers. Until then the honest fix is
marking the four on the People screen as «قريباً» — a product decision, so it waits for the owner.

✅ **C4 — Checked, and intended: a partner keeps the archive until the primary owner takes it.**
A partner is an OWNER (his decision, 2026-10-26), so he holds `archive.view` like everything else,
and C1 is what makes taking it away mean something. Written down so the next reader does not read
it as a leak.
