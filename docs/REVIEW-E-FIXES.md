# Phase E — the fixes

> Phase E of the owner's review (2026-10-29). Phase A mapped the code (`docs/CODEMAP.md`), Phase B
> tested the numbers (`docs/REVIEW-B-LOGIC.md`), Phase C tested who may do what
> (`docs/REVIEW-C-PERMISSIONS.md`), Phase D tested what somebody who is not allowed in can still do
> (`docs/REVIEW-D-SECURITY.md`). Phase E is the one that turns a finding into a change: one finding,
> one branch, one pull request, with a test that failed before and passes after.

## 1. What was fixed

| # | Where | What was wrong | What it does now |
|---|---|---|---|
| E1 | `src/app/api/boards/[id]/route.ts` PATCH | A board renamed or archived wrote its row and left nothing behind. Every other name change in the app (a project, a space, an organization) writes an `AuditLog` row; this one did not, so «who renamed this board» had no answer. | `board.updated` with the actor, the company, the board and what changed. |
| E2 | `src/app/api/boards/[id]/route.ts` POST | The same for a column reorder: the positions moved and nobody could say who moved them or to what. | `board.columns_reordered` with the order that was saved. |
| E3 | `src/app/api/tasks/[id]/comments/[commentId]/route.ts` PATCH | Editing a comment rewrote the text with no trace. On a task's own feed every other change (created, moved, completed) is a row; an edited comment was not, so the story of a task could be rewritten quietly. | `task.comment_edited` on the task's feed, with the comment id. |
| E4 | the same file, DELETE | Deleting a comment removed the row and left no trace at all — «where did my comment go» had no answer, not even a tombstone. | `task.comment_deleted` on the task's feed, with the comment id. |

Proved in `tests/db/phase-e-trail.test.ts` (4): each write leaves its row with the right actor and
company, and editing somebody else's comment still answers 403 and writes nothing. Three of the four
fail on the branch before the fix (verified by stashing the two route files and re-running: 3 failed,
1 passed — the refusal was already correct).

`docs/CODEMAP.md` §9 was the list this phase worked from; it is regenerated, and its "16 handlers
write directly" paragraph now reads: 10 audit themselves, 2 write a task-feed row, 4 are one
person's own preference. Nothing in it is left unnamed.

## 2. The same rule, for the day's new features

The owner's standing order (2026-10-26): every new feature sits behind its own switch in «الميزات»,
and switching it off returns the site to what it was before that feature while losing nothing. The
three features of 2026-10-29 shipped without one; they have it now:

| Key | Off means |
|---|---|
| `avatars` («الصورة الشخصية») | `/api/me/avatar` answers 404, and the profile page stops offering the picture. The pictures already uploaded keep showing — they are data. |
| `peopleDock` («شريط الموجودين») | `/api/presence` answers 404, and the shell does not draw the row. Presence itself is untouched. |
| `chatBubbles` («شكل الرسائل الحديث») | The conversation says so, and the log draws the older bubble: one shape for everybody, the name inside it, no picture beside it, no day lines. |

The words of a message — its reply, its body, its work chips, its files, its reactions, its time —
are one piece of JSX shared by both shapes, so switching the layout off cannot lose a message, and
switching it back on cannot lose an edit. `tests/db/feature-switches-new.test.ts` (4) fails on all
four before the change (verified by stashing `src/` and re-running: 4 failed).

## 2b. «التبعيات» — a table that had no writer, built instead of switched off

The owner's order (2026-10-30): «كمل ولا تطفى اي ميزة ضفناها». `TaskDependency` was the one model
this map named as dead — created by the first migration, never written, still selected by the task
detail (always an empty list). Switching it off would have been the easy answer; it is built.

| Piece | What it does |
|---|---|
| `src/server/services/task-links.ts` | lists a task's links in BOTH directions, adds one, removes one |
| `GET\|POST /api/tasks/[id]/links`, `DELETE /api/tasks/[id]/links/[linkId]` | the doors, behind the switch `taskLinks` |
| «التبعيات» on the task page | what this task points at, the tasks that point at it, and a picker of the other tasks of the same space |
| `task.linked` / `task.unlinked` | the link lands in the task's own story, so «who linked this» has an answer |

Both ends of a link pass the task page's own guard (`requireTaskAccess`: the space, and the
project's team), so a link can never name a task of another company or of a team the person does not
see. Three refusals, each its own key: `link.self`, `link.exists`, `link.cycle` (the pair that would
each block the other); a fourth for a stale id, `link.not_found`.

⚠️ The temptation is to make a link a lock — «this cannot move until that closes». 🔧 It is not:
a linked task still moves and still closes, and the card only says so. A note one person wrote must
not become another person's blockage, and the board must keep answering «why can't I move this».

`tests/db/task-links.test.ts` (9) proves the storage, the two directions, the four refusals, the
guest, the delete rule, and that the switch closes both doors while keeping every stored row.
7 of the 9 fail on the code before the feature (verified by stashing `src/`: 7 failed, 2 passed —
the two «not found» guards that already existed).

## 2c. «المعالم» — the other table that had a reader and no writer

`Milestone` was the last model in that shape, and it is built the same way (2026-10-30).
`MilestoneStatus.OVERDUE` is the one value that is never written: «متأخر» is a reading — open, and
its day has passed in the COMPANY's zone — so the badge follows the date by itself and no job has
to un-store it.

| Piece | What it does |
|---|---|
| `src/server/services/milestones.ts` | lists, creates, updates, deletes; the door is the project's space AND its team, then the «projects.edit» box |
| `GET\|POST /api/projects/[id]/milestones`, `PATCH\|DELETE /api/milestones/[id]` | the doors, behind the switch `milestones` (on by default) |
| «المعالم» on the project page | the list, a new-milestone form, mark complete/open, delete |
| «المعلم» on the task page | the milestones of THAT task's project only; `updateTask` refuses another project's (403 `milestone.invalid`) |

A milestone is a date, not the work: a task attached to one still moves and still closes, and
deleting a milestone never deletes a task (`onDelete: SetNull`). Deleting one that still has open
tasks attached is refused (403 `milestone.has_tasks`) — detach them first, or mark it complete.
`tests/db/milestones.test.ts` (9) proves the company-zone day, the refusals, the «متأخر» reading,
the delete rule and the switch; 6 of the 9 fail without the feature.

## 3. What Phase E looked at and left alone

| Finding | Why it is not a change here |
|---|---|
| `/api/me/digits`, `/api/me/theme`, `/api/notifications/[id]`, `/api/notifications/read` write with no audit row | They are one person's own preference, about nobody else. An audit trail of «he switched to the light theme» is noise, not evidence. |
| ~~⚠️ `TaskDependency` has never held a row~~ — **built, not switched off** (2026-10-30). | The owner's decision was to build it: `src/server/services/task-links.ts`, `GET\|POST /api/tasks/[id]/links`, `DELETE …/[linkId]`, the «التبعيات» card on the task page, and `task.linked` / `task.unlinked` in the task's own story. Behind the switch `taskLinks` (on by default), and a link is information, never a lock: a linked task still moves and still closes. Proven by `tests/db/task-links.test.ts` (9; 7 of them fail without the feature). |
| `activeOrgCtx()` and `requireActor()` are the first call of 91 routes | Correct, not a finding: both re-read the membership and its status from the database on every request, which is exactly the rule in `AGENTS.md`. |

## 4. Gates

Local, on the branch: `typecheck` · `lint` (2 pre-existing warnings, both older than this phase) ·
`npm test` 159 files / 2504 tests · `test:db` 160 files / 1822 tests · `node
scripts/lint-migrations.mjs` (40 migrations, 38 released) · `npm run scan:secrets` (998 files) ·
`npm run build`. CI judges the pull request.
