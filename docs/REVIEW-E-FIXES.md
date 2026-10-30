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

## 3. What Phase E looked at and left alone

| Finding | Why it is not a change here |
|---|---|
| `/api/me/digits`, `/api/me/theme`, `/api/notifications/[id]`, `/api/notifications/read` write with no audit row | They are one person's own preference, about nobody else. An audit trail of «he switched to the light theme» is noise, not evidence. |
| ⚠️ `TaskDependency` has never held a row: nothing writes it, no screen reads it, and the task detail still selects it (always an empty list). | The table was created by the first migration. Removing a select is a change to a published response for a feature the owner may still want; dropping the table is destructive and forbidden. 🔧 **The owner's decision**: build «تعطّل / معطّلة بسبب / مكرّرة» as a real feature, or say the word and the select goes. Nothing breaks either way today. |
| `activeOrgCtx()` and `requireActor()` are the first call of 91 routes | Correct, not a finding: both re-read the membership and its status from the database on every request, which is exactly the rule in `AGENTS.md`. |

## 4. Gates

Local, on the branch: `typecheck` · `lint` (2 pre-existing warnings, both older than this phase) ·
`npm test` 159 files / 2504 tests · `test:db` 159 files / 1813 tests · `node
scripts/lint-migrations.mjs` (40 migrations, 38 released) · `npm run scan:secrets` (990 files) ·
`npm run build`. CI judges the pull request.
