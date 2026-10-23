import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A password reset by the owner must not be undone by a sign-in or a password change that was
 * already running (found by independent review A).
 *
 * Changing one's own password reads the hash, verifies the current password (bcrypt, ~0.25 s),
 * hashes the new one and writes. The write is conditional on the session version this request was
 * authenticated with AND the hash that was verified: if a reset (or anything else) changed the
 * account in between, nothing is written, the answer is 401 and no cookie is set. A sign-in signs
 * the session version it READ before the bcrypt check, so a reset that lands during the check
 * leaves the new cookie already stale.
 *
 * The reset is injected right after the current password verified, through a wrapper around
 * `verifyPassword`; the reset itself is the owner's real route.
 */

const hooks = vi.hoisted(() => ({ afterVerify: null as null | (() => Promise<void>) }));

vi.mock("@/server/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/auth")>();
  return {
    ...real,
    verifyPassword: async (pw: string, hash: string) => {
      const ok = await real.verifyPassword(pw, hash);
      const hook = hooks.afterVerify;
      if (ok && hook) {
        hooks.afterVerify = null;
        await hook();
      }
      return ok;
    },
  };
});

import * as loginRoute from "@/app/api/auth/login/route";
import * as passwordRoute from "@/app/api/me/password/route";
import * as meRoute from "@/app/api/me/route";
import * as memberPasswordRoute from "@/app/api/organizations/[id]/members/[userId]/password/route";
import { verifyPassword } from "@/server/auth";
import { call, db, loginAs, logout, makeTeam, TEST_PASSWORD } from "./helpers";
import { sessionCookie, setSessionCookie } from "./login-helpers";

beforeEach(() => {
  hooks.afterVerify = null;
  logout();
});
afterEach(() => {
  hooks.afterVerify = null;
});

describe("an owner's password reset is not undone by work already in flight", () => {
  it("a password change already running: the reset's temporary password stays, the changer gets 401 and no cookie", async () => {
    const { org, owner, member } = await makeTeam();
    await loginAs(member.id); // somebody who holds the session AND knows the current password
    const thief = sessionCookie() as string;
    let temporaryPassword = "";

    hooks.afterVerify = async () => {
      await loginAs(owner.id);
      const res = await call(memberPasswordRoute.POST, { method: "POST", params: { id: org.id, userId: member.id } });
      expect(res.status).toBe(200);
      temporaryPassword = String(res.json?.temporaryPassword ?? "");
      setSessionCookie(thief);
    };
    const change = await call(passwordRoute.POST, {
      body: { currentPassword: TEST_PASSWORD, newPassword: "Thief-keeps-it9" },
    });

    expect(temporaryPassword).not.toBe("");
    expect(change.status).toBe(401);
    expect(sessionCookie(), "the refused change handed out a cookie").toBe(thief);
    const row = await db.user.findUniqueOrThrow({
      where: { id: member.id },
      select: { passwordHash: true, mustChangePassword: true },
    });
    expect(
      { resetPasswordWorks: await verifyPassword(temporaryPassword, row.passwordHash), mustChangePassword: row.mustChangePassword },
      "the owner's reset was overwritten by the change that was already running",
    ).toEqual({ resetPasswordWorks: true, mustChangePassword: true });
    expect(await verifyPassword("Thief-keeps-it9", row.passwordHash)).toBe(false);
    expect((await call(meRoute.GET)).status, "the changer kept a working session through the reset").toBe(401);
  });

  it("a reset that lands while somebody signs in with the OLD password leaves them no session", async () => {
    const { org, owner, member } = await makeTeam();
    hooks.afterVerify = async () => {
      await loginAs(owner.id);
      const res = await call(memberPasswordRoute.POST, { method: "POST", params: { id: org.id, userId: member.id } });
      expect(res.status).toBe(200);
      logout();
    };
    const signIn = await call(loginRoute.POST, {
      method: "POST",
      body: { identifier: member.email, password: TEST_PASSWORD },
      headers: { "x-forwarded-for": "192.0.2.77" },
    });
    expect(signIn.status).toBe(200);
    expect((await call(meRoute.GET)).status, "the old password bought a session that outlives the reset").toBe(401);
  });

  it("without a reset, the change works and this browser stays signed in", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const res = await call(passwordRoute.POST, { body: { currentPassword: TEST_PASSWORD, newPassword: "Own-new-pass7" } });
    expect(res.status).toBe(200);
    expect((await call(meRoute.GET)).status).toBe(200);
  });
});
