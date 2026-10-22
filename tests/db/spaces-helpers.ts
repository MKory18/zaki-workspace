import type { MemberStatus, WorkspaceRole } from "@prisma/client";
import { db, makeOrg, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * Fixtures for the "a space is visible only to the people IN it, plus the OWNER" batch
 * (tests/db/spaces-*.test.ts). Kept apart from helpers.ts on purpose: that file belongs to the harness.
 */

export type Who = "owner" | "admin" | "lead" | "member" | "guest";

/**
 * An org with one person of every rank (owner, admin, lead, member, guest) and ONE space.
 * `rows` says who is in the space and as what; by default only the plain member is.
 * An ADMIN and the OWNER are in it only if the test says so: rank gives nobody a space.
 */
export async function makeSpaceWorld(rows: Partial<Record<Who, WorkspaceRole>> = { member: "MEMBER" }) {
  const team = await makeTeam();
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "Lead" });
  const people: Record<Who, { id: string }> = { owner: team.owner, admin: team.admin, lead, member: team.member, guest: team.guest };
  const ws = await makeWorkspace(
    team.org.id,
    (Object.entries(rows) as [Who, WorkspaceRole][]).map(([who, role]) => ({ userId: people[who].id, role })),
    `Space ${uid()}`,
  );
  return { ...team, lead, ws };
}

export type SpaceWorld = Awaited<ReturnType<typeof makeSpaceWorld>>;

/** A plain org member with a name and (optionally) a row in the space. */
export async function makePerson(w: { org: { id: string } }, name: string, opts: { in?: { id: string }; role?: WorkspaceRole } = {}) {
  const person = await makeUser({ orgId: w.org.id, role: "MEMBER", name });
  if (opts.in) await db.workspaceMember.create({ data: { workspaceId: opts.in.id, userId: person.id, role: opts.role ?? "MEMBER" } });
  return person;
}

/**
 * Moves a person's membership to `status` the way the account actions do (the status changes and
 * every session ends). `endSessions: false` leaves their old cookie valid, which is the only way to
 * reach the workspace guard itself with a person who is not ACTIVE (see `giveSecondHome`).
 */
export async function setStatus(orgId: string, userId: string, status: MemberStatus, opts: { endSessions?: boolean } = {}) {
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    data: { status, statusChangedAt: new Date() },
  });
  if (opts.endSessions ?? true) await db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
}

/**
 * A second, unrelated organization where the person is an ACTIVE member. While it exists, a
 * suspended/offboarded membership in the FIRST organization does not make them "signed out"
 * (they still have an ACTIVE membership somewhere), so the space guard has to refuse them itself.
 */
export async function giveSecondHome(userId: string, role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER" = "MEMBER") {
  const other = await makeOrg();
  // later than the first membership on purpose: `requireActor` works in the OLDEST ACTIVE one
  await db.organizationMember.create({ data: { organizationId: other.id, userId, role, createdAt: new Date(Date.now() + 5_000) } });
  return other;
}

/** Who is in a space and as what, in a stable order: used to prove that a refused request changed nothing. */
export async function rowsOf(workspaceId: string) {
  const rows = await db.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true, role: true } });
  return rows.sort((a, b) => a.userId.localeCompare(b.userId));
}

/** The in-app notifications a person has (their count must not move when the OWNER merely looks). */
export function notificationsOf(userId: string) {
  return db.notification.findMany({ where: { userId }, select: { type: true, title: true } });
}

/** A body for POST /api/workspaces/[id]/members. */
export const add = (...ids: string[]) => ({ addUserIds: ids });
export const remove = (...ids: string[]) => ({ removeUserIds: ids });
export const promote = (...ids: string[]) => ({ promoteUserIds: ids });
export const demote = (...ids: string[]) => ({ demoteUserIds: ids });
