import type { OrgRole } from "@prisma/client";
import * as membersRoute from "@/app/api/organizations/[id]/members/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import * as statusRoute from "@/app/api/organizations/[id]/members/[userId]/status/route";
import * as passwordRoute from "@/app/api/organizations/[id]/members/[userId]/password/route";
import * as logoutRoute from "@/app/api/organizations/[id]/members/[userId]/logout/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import { currentUser } from "@/server/auth";
import { COOKIE_NAME } from "@/server/session";
import { call, db, makeTeam, makeUser, uid, type CallInit } from "./helpers";

/**
 * Fixtures and shortcuts for the account-lifecycle suites (tests/db/accounts-*.test.ts).
 * Every call goes through the real route handlers, the way the browser reaches them.
 */

/** The standard team (owner, admin, member, guest) plus a team lead. */
export async function makeRankTeam() {
  const team = await makeTeam();
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "Lead" });
  return { ...team, lead };
}

/** Switches extra capabilities on for one member (what the owner does from the members page). */
export async function grantCapabilities(orgId: string, userId: string, capabilities: string[]) {
  await db.organizationMember.update({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    data: { capabilities },
  });
}

export async function memberRow(orgId: string, userId: string) {
  return db.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgId, userId } } });
}

export async function userRow(userId: string) {
  return db.user.findUniqueOrThrow({ where: { id: userId } });
}

export async function makeMemberWithRole(orgId: string, role: OrgRole, name?: string) {
  return makeUser({ orgId, role, name: name ?? `${role} ${uid()}` });
}

// ---------- the session cookie ----------

function jar(): Map<string, string> {
  return (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
}

/** The session cookie the browser holds right now (keep it to replay it later). */
export function sessionCookie(): string {
  const token = jar().get(COOKIE_NAME);
  if (!token) throw new Error("nobody is signed in");
  return token;
}

/** Puts an old cookie back, as a browser that kept it would send it. */
export function replaySessionCookie(token: string): void {
  jar().set(COOKIE_NAME, token);
}

/** Does this cookie still sign somebody in? Checked on the server path AND on a protected route. */
export async function cookieWorks(token: string): Promise<boolean> {
  replaySessionCookie(token);
  const user = await currentUser();
  const route = await call(notificationsRoute.GET);
  if ((user === null) !== (route.status === 401)) {
    throw new Error(`currentUser() and the protected route disagree (route said ${route.status})`);
  }
  return user !== null;
}

// ---------- the account routes ----------

export const accountsApi = {
  list: (orgId: string) => call(membersRoute.GET, { params: { id: orgId } }),
  create: (orgId: string, body: unknown) => call(membersRoute.POST, { method: "POST", params: { id: orgId }, body }),
  update: (orgId: string, userId: string, body: unknown) =>
    call(memberRoute.PATCH, { method: "PATCH", params: { id: orgId, userId }, body }),
  remove: (orgId: string, userId: string, init: Pick<CallInit, "body" | "url"> = {}) =>
    call(memberRoute.DELETE, { method: "DELETE", params: { id: orgId, userId }, ...init }),
  status: (orgId: string, userId: string, body: unknown) =>
    call(statusRoute.POST, { method: "POST", params: { id: orgId, userId }, body }),
  password: (orgId: string, userId: string) => call(passwordRoute.POST, { method: "POST", params: { id: orgId, userId } }),
  logout: (orgId: string, userId: string) => call(logoutRoute.POST, { method: "POST", params: { id: orgId, userId } }),
};

/** The machine key a refusal carries: `message` for 4xx answers, the first issue for a 422. */
export function reason(res: { json: Record<string, unknown> | null }): string | undefined {
  const json = res.json ?? {};
  if (json["error"] === "validation.failed") {
    const details = json["details"] as { message: string }[] | undefined;
    return details?.[0]?.message;
  }
  return json["message"] as string | undefined;
}

/** A unique, valid username for a test. */
export function username(prefix = "user"): string {
  return `${prefix}.${uid()}`;
}

/**
 * Makes matching UPDATEs of `table` wait `seconds` right after they wrote (still inside their
 * transaction, so their row locks are held), to force a second request to overlap the first one.
 * `match` is column -> value (ids made by the test, or enum names); call the returned function to remove it.
 */
export async function slowUpdatesWhere(table: "OrganizationMember", match: Record<string, string>, seconds: number) {
  const pairs = Object.entries(match);
  if (pairs.length === 0 || pairs.some(([c, v]) => !/^[A-Za-z]+$/.test(c) || !/^[A-Za-z0-9_]+$/.test(v))) {
    throw new Error("unsafe trigger argument");
  }
  const name = `zk_slow_${uid()}`;
  const when = pairs.map(([c, v]) => `NEW."${c}"::text = '${v}'`).join(" AND ");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(${Number(seconds)}); RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(`CREATE TRIGGER ${name} AFTER UPDATE ON "${table}" FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION ${name}()`);
  return async () => {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "${table}"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
  };
}

/** Lets a request that was just started reach the database before the next one starts. */
export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Makes the database refuse one kind of write, to prove a multi-step change is ONE transaction:
 * a failure in a late step must leave none of the earlier steps behind. The trigger fires only
 * for rows whose `column` equals `value` (an id made by the test), so nothing else in the run is
 * affected. Call the returned function to remove it.
 */
export async function failWritesWhere(table: "Routine" | "WorkspaceMember", column: string, value: string) {
  if (!/^[A-Za-z]+$/.test(column) || !/^[a-z0-9]+$/.test(value)) throw new Error("unsafe trigger argument");
  const name = `zk_fail_${uid()}`;
  await db.$executeRawUnsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON "${table}" FOR EACH ROW WHEN (NEW."${column}" = '${value}') EXECUTE FUNCTION ${name}()`,
  );
  return async () => {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "${table}"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
  };
}
