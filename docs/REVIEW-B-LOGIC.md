# Phase B — the logic behind the numbers: counters, dates, completion

> Phase B of the owner's review (2026-10-29). Phase A mapped the code (`docs/CODEMAP.md`);
> Phase B asks whether the numbers the screens print are TRUE: is a late task late, is a finished
> task finished once, is a person in a space a person who is still there.
>
> Every claim below was read in the code and, where it is a defect, proved by a database test that
> failed before the fix and passes after it. Nothing here is a guess from a file name.

## 1. What was fixed in this PR

Four defects, one rule: the day a task was finished, and the day it is late, are the COMPANY's days
in its own zone, and they are written once.

| # | Where | What was wrong | What it does now |
|---|---|---|---|
| B1 | `services/tasks.ts` `moveTask` | `completedAt: column.done ? new Date() : null` on EVERY move. Dragging a finished card inside «تم» re-stamped it as finished today; the board and Today then disagreed about the same task. | The stamp moves on the transition only: open → done stamps once, a reorder inside done keeps the original day, done → open clears it. |
| B2 | `services/tasks.ts` `createTask` | A task born directly in a done column had `completedAt = null`: finished work that no counter (`completed`, `completed30`, «أُنجز اليوم») could ever see. | It is created stamped, the same rule as B1. |
| B3 | `services/departments.ts` `listDepartments` | «متأخرة» compared the due date with `new Date()` — the server's wall clock — while My Work, analytics, Today and «كل المساحات» compare it with the START of the company's today. A task due at 09:00 showed as late at noon on one screen and not on the next, and the number moved with the container's clock. | Compared with `zonedDayStart` in `Organization.timezone`, like everywhere else. `now` is injected (`listDepartments(ctx, now)`) so a test can pin the day, the shape `loadAnalytics` already had. |
| B4 | `services/spaces-overview.ts` | The people count on a space card counted `WorkspaceMember` rows. Suspending somebody keeps their organization row and, for a while, their space row: a space with seven people, one of them suspended, still said seven. | Counts only people whose membership of THIS organization is ACTIVE. A GUEST of the space (an external partner) still counts — the status decides, not the rank. |

Proved in `tests/db/`:

- `task-completion-stamp.test.ts` (4) — reorder inside done, open → done, done → open, born in done.
- `department-overdue.test.ts` (2) — due later today is not late, due before today began is; a
  finished task is never late. The test fixes `now` two days back so the old wall-clock code could
  not pass it by luck.
- `spaces-overview-people.test.ts` (3) — suspended, offboarded (row still present), and a GUEST who
  must keep counting.

All three files failed before the change: 5 failing assertions, the other 4 regressions guards.

## 2. Found here, and fixed afterwards

Each one was a real inconsistency that this review PR did not touch: they needed either a product
decision or a migration, and a review PR that quietly changes five behaviours cannot be reviewed.
**All three below are now closed** — each in its own PR, with its own test — and the text under each
one is kept as it was written so the next reader can see what was wrong, not just that it is fixed.

✅ **B5 — A due date was stored as the noon of the BROWSER's zone.** *Fixed: `src/lib/due-day.ts`
(`dueInstantForDay`, `parseDayText`), read by `api/tasks/route.ts`, `api/tasks/[id]/route.ts` and
`api/instant/task/route.ts`; the browser now sends `YYYY-MM-DD`.*
`src/components/task-row.tsx:77` sent `new Date(\`${value}T12:00:00\`).toISOString()`: the day the
person picked, read at noon *where the browser is*. A person working from another country (or a
phone whose clock is set elsewhere) stored a day the company does not live in, and the card showed
yesterday or tomorrow.
🔧 What it took: send the picked day as plain `YYYY-MM-DD` and convert it once on the server with
`zonedWallTime({…, hour: NOON_HOUR }, timeZone)` — exactly what `src/lib/today.ts:220` already did
for a quick add. One converter, one zone, no noon trick in the browser.

✅ **B6 — Two overdue filters compared with the wall clock.** *Fixed: `services/tasks.ts`
(`listTasks`) and `services/views.ts` both read `orgDayStart` now, and the `?? new Date()` fallback is
gone — a caller that forgets the line gets the company's own day, never the container's clock.*
`services/tasks.ts:441` (`listTasks`) used `dueDate: { lt: new Date() }`, and
`services/views.ts:318` fell back to `new Date()` when a caller passed `overdueOnly` without
`overdueBefore`. The API accepts `?overdue=true`, so the first was reachable; no screen sent
it, so nothing visible was wrong yet. The moment anything did, that list disagreed with My Work.
🔧 What it took: give both the company's day start (`orgDayStart(orgId, now)`), the same line as B3.

✅ **B7 — The bell mixed companies for somebody who is in two of them.** *Fixed: `Notification.organizationId`
(nullable, additive migration) plus `bellWhere` filtering on it.*
`services/current-space.ts:108` `bellWhere` filtered `{ userId, OR: [{ workspaceId }, { workspaceId: null }] }`.
`Notification` had no organization column, so the personal rows (`workspaceId: null` — a welcome, a
changed rank) of every company that person belongs to arrived in the same bell, with their links.
The recipient is a member of both, so nothing reached a stranger — but the screen said, in company
A, «مرحباً بك في الشركة ب».
🔧 What it took: a nullable `organizationId` on `Notification` in its own additive migration,
backfilled from the space where there is one, then `bellWhere` filtering on it.

✅ **B8 — Checked, and correct: delivery marks and the notification count.**
`chat/read-state.ts` writes `deliveredAt: new Date()`; that is an instant («when did this phone
connect»), not a day, so no zone applies. `chat/unread.ts` counts only conversations the person has
a row in, never their own messages, never an archived topic, and a topic only while they are still
in its space — the counter and the list it opens agree. Nothing to change.

## 3. What this phase changed in the product, in one line

A finished task is finished once, on the day the company says it was finished; «متأخرة» means the
same thing on every screen; and a space's people count is the people who are still there.

## 4. How to check it

```bash
npm run typecheck && npm run lint && npm test
npm run test:db          # the three new files, against a real PostgreSQL
```

Any of the three new test files run against the previous commit fails.
