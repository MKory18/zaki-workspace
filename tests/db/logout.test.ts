import { beforeEach, describe, expect, it } from "vitest";
import * as logoutRoute from "@/app/api/auth/logout/route";
import { call, db, loginAs, logout, makeTeam } from "./helpers";
import { sessionCookie } from "./login-helpers";

/**
 * POST /api/auth/logout clears this browser's cookie for anybody, but writes an audit row only when
 * a valid session existed: an anonymous script (curl sends no Origin header, so the cross-site
 * guard lets it through by design) must not be able to grow the audit log without bound (found by
 * independent review A).
 */

beforeEach(() => logout());

const logoutRows = (actorId: string | null) => db.auditLog.count({ where: { action: "auth.logout", actorId } });

describe("signing out", () => {
  it("an anonymous caller (no cookie) leaves no audit row", async () => {
    const before = await logoutRows(null);
    for (let i = 0; i < 5; i++) expect((await call(logoutRoute.POST, { method: "POST" })).status).toBe(200);
    expect((await logoutRows(null)) - before, "anonymous sign-outs written to the audit log").toBe(0);
  });

  it("a dead cookie (the session was already ended) leaves no audit row either", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    await db.user.update({ where: { id: member.id }, data: { tokenVersion: { increment: 1 } } }); // "log out everywhere"
    const before = { mine: await logoutRows(member.id), anonymous: await logoutRows(null) };
    expect((await call(logoutRoute.POST, { method: "POST" })).status).toBe(200);
    expect(sessionCookie()).toBeUndefined();
    expect({ mine: await logoutRows(member.id), anonymous: await logoutRows(null) }).toEqual(before);
  });

  it("a real session: the cookie is cleared and one row names the person", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const before = await logoutRows(member.id);
    expect((await call(logoutRoute.POST, { method: "POST" })).status).toBe(200);
    expect(sessionCookie()).toBeUndefined();
    expect((await logoutRows(member.id)) - before).toBe(1);
  });
});
