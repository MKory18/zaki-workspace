import { beforeEach, describe, expect, it } from "vitest";
import * as passwordRoute from "@/app/api/me/password/route";
import { hashPassword, verifyPassword } from "@/server/auth";
import { call, db, loginAs, logout, makeTeam, TEST_PASSWORD } from "./helpers";

/**
 * POST /api/me/password limits WRONG current passwords to ten per person per 15 minutes, so a stolen
 * session cookie cannot be used to guess the real password (found by independent review A: the limit
 * used to be check-then-act across the bcrypt await). Every attempt is counted BEFORE the comparison,
 * and at most a couple of comparisons run at once in the whole process (bcrypt is CPU-bound: a
 * signed-in person must not be able to pin the single container's CPU with this route).
 */

beforeEach(() => logout());

describe("own password change: the wrong-current-password limit holds under concurrency", () => {
  it("twenty simultaneous wrong guesses: at most ten are compared, the rest get 429", async () => {
    const { member } = await makeTeam();
    // a production-cost hash (bcrypt 12) so the comparison takes as long as it does in production
    await db.user.update({ where: { id: member.id }, data: { passwordHash: await hashPassword("Real-pass-12") } });
    await loginAs(member.id); // a stolen cookie

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        call(passwordRoute.POST, { body: { currentPassword: `Guess-${i}-pass`, newPassword: "Thief-pass-99" } }),
      ),
    );
    const checked = results.filter((r) => r.status === 403).length;
    const limited = results.filter((r) => r.status === 429).length;
    expect(checked + limited).toBe(20);
    expect(checked, `${checked} guesses were compared with the real password (limit: 10)`).toBeLessThanOrEqual(10);
    for (const r of results.filter((x) => x.status === 429)) {
      expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    }

    // nothing changed, of course: every guess was wrong
    const row = await db.user.findUniqueOrThrow({ where: { id: member.id }, select: { passwordHash: true } });
    expect(await verifyPassword("Real-pass-12", row.passwordHash)).toBe(true);
  }, 120_000);

  it("a correct change after a few wrong tries clears the count", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    for (let i = 0; i < 9; i++) {
      expect((await call(passwordRoute.POST, { body: { currentPassword: `Wrong-${i}-pass`, newPassword: "Next-pass-11" } })).status).toBe(403);
    }
    expect((await call(passwordRoute.POST, { body: { currentPassword: TEST_PASSWORD, newPassword: "Next-pass-11" } })).status).toBe(200);
    // the count started again: nine more wrong tries are still compared (403), not refused (429)
    for (let i = 0; i < 9; i++) {
      expect((await call(passwordRoute.POST, { body: { currentPassword: `Wrong-${i}-again`, newPassword: "Other-pass-12" } })).status).toBe(403);
    }
  });
});
