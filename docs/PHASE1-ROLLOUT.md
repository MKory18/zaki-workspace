# Phase 1 rollout — accounts, ranks and permissions (يوم النشر)

Date: 2026-10-23 · Applies to: the Phase 1 release (migrations `20261023090000` … `20261023092000`).

This page is for the **owner**. It says what changes for the team on deploy day, what to check
**before** deploying, and how to undo it. Nothing here needs a programmer except the two SQL
checks, and those only read.

## 1. What the team will notice

| # | What changes | Why |
|---|---|---|
| 1 | **Everybody signs in once more** after the deploy. | Sessions now carry a version number (`tokenVersion`); old cookies do not have one and are refused. This is also what makes "suspend" sign a person out instantly. |
| 2 | **Everybody sees a one-time notice** the first time: "work chats and files here are kept and visible to the owner". They accept it once (the date is recorded). | The oversight design (Phase 3) needs people to know; it also protects the company legally. When you raise the notice version later, everybody accepts again. |
| 3 | **Accounts are created by you** (name, username, temporary password, rank). The person changes the temporary password on first sign-in. | Open registration is closed. `/register` only works for the very first company on an empty database. |
| 4 | **Sign-in by username or e-mail.** | An employee does not need an e-mail address. |
| 5 | **A space is visible only to the people in it, and to you.** An admin who is not in a space no longer sees it. | The migration copies today's access into explicit rows first (section 2), so nobody is locked out on deploy day. |
| 6 | **Suspend / offboard / reactivate** exist (People screen). Suspending signs the person out immediately; offboarding removes them from every space and hands their open work to someone you choose. Old messages stay. | Nothing is ever hard-deleted. |
| 7 | **A new rank: قائد فريق (team lead)** between admin and member, and **per-person switches** (capabilities) on top of the rank. Only the switches that change something today are shown (spaces, people, directory, customers, integrations). | You switch single abilities on or off instead of inventing ranks. |
| 8 | **Who can manage whom:** everybody manages only people **below** their own rank (an admin: team leads, members, guests; a team lead: members, guests). Only the owner manages admins. | A person holding the "manage people" switch can reset the password of anybody below them, which lets them sign in as that person. ⚠️ 🔧 Give the switch only to somebody you trust; every reset is audited. |

## 2. What the migration does to space access — review BEFORE deploying

Until now an organization OWNER/ADMIN reached every workspace by inheritance, and a plain member
passed most checks without any membership row. To keep everybody inside on deploy day, the third
migration (`20261023092000_membership_backfill`) **copies today's access into explicit rows**:

- every **admin** becomes **ADMIN** of every workspace of the organization;
- every **member** becomes **MEMBER** of every workspace of the organization;
- the **owner** gets no rows: the owner opens every space without one, and reading as the owner
  leaves no trace (nothing in the members list, no "seen", no notification);
- an external partner (guest) stays a **guest** in the workspaces they are already in (no new rows).

It is safe to run twice. After the deploy you remove people from the spaces they should not be in
(each removal is audited).

⚠️ **This is a choice, and it is yours.** Before this release a member could already open any space
by its link, but the lists only showed the spaces they had been put in. The plan chose "nobody is
locked out on deploy day", so every member starts inside every space, **including a space that only
admins used before**. 🔧 If you would rather start closed (members only keep the spaces they were
put in), tell me **before the first deploy**: it is a one-line change in the migration, which
cannot be edited after it has run on the live database.

### Preview (read-only SQL — run it in Coolify's database terminal, then send me the output)

Who will be in which workspace right after the migration:

```sql
SELECT w."name" AS workspace,
       u."name" AS person,
       om."role" AS org_role,
       CASE WHEN om."role" = 'ADMIN' THEN 'ADMIN' ELSE 'MEMBER' END AS workspace_role
FROM "Workspace" w
JOIN "OrganizationMember" om ON om."organizationId" = w."organizationId"
JOIN "User" u ON u."id" = om."userId"
WHERE om."role" IN ('ADMIN','MEMBER')
ORDER BY w."name", om."role", u."name";
```

People who are in the organization but will get **no** workspace (guests, or an organization with
no workspace yet):

```sql
SELECT u."name", u."email", om."role"
FROM "OrganizationMember" om
JOIN "User" u ON u."id" = om."userId"
WHERE om."role" = 'GUEST'
   OR NOT EXISTS (SELECT 1 FROM "Workspace" w WHERE w."organizationId" = om."organizationId")
ORDER BY om."role", u."name";
```

If the list of people in a workspace is longer than you want, it is fine: you trim it from the app
afterwards. The preview only tells you the starting point.

## 3. Order of deployment

1. Do the Phase 0 production checks first (`docs/PHASE0-AUDIT.md`, section 4): especially the
   read-only `_prisma_migrations` check — a migration that failed in production must be dealt with
   **before** a new one is applied.
2. Tell the team: "tomorrow you sign in once more; you will see a short notice; accept it".
3. Deploy (Coolify pulls the image; `prisma migrate deploy` applies the three migrations).
4. Sign in as the owner. Open **People**, create the accounts you want with a username, a rank and
   the spaces, copy each person's login message to WhatsApp.
5. Remove people from spaces they should not be in.

## 4. Undoing it

The three migrations only **add** things (an enum value, columns, rows); they delete nothing, so
the database does not need to be rolled back. Re-deploying the Phase 0 image is safe **as long as**
you have not yet created a username-only account (no e-mail) or a team-lead account, because the
Phase 0 code cannot read those. Space rows created by the copy are simply ignored by the old code.

## 5. Residual risks of this phase

- The session version (`tokenVersion`) lives in the database, so suspending a person works across
  restarts; the sign-in attempt counters live in the app process (`docs/PHASE0-AUDIT.md`, R6).
- A person who is **suspended** loses access immediately. A person whose **rank** is lowered keeps
  the open session, but every request reads the new rank and capabilities from the database (they
  are never stored in the cookie), so the change applies on the very next click.
- The owner's own account has no suspend/offboard action by design. If the owner's password is ever
  lost it has to be reset directly in the database by a developer.
