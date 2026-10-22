import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkspaceView, resetInvalidZoneWarningsForTests } from "@/server/services/views";
import { db, loginAs, logout } from "./helpers";
import { makeScopedOrg } from "./scoping-helpers";

/**
 * A company whose row names a zone the platform does not know must not break the pages it opens: the
 * zone is resolved to the default, and the server says so — once per organization and bad zone, not
 * on every request. (resolveTimeZone itself stays pure and silent; the warning lives on the server.)
 */
describe("an invalid stored zone is resolved and warned about once", () => {
  afterEach(() => {
    resetInvalidZoneWarningsForTests();
    vi.restoreAllMocks();
    logout();
  });

  it("the ctx carries the company's resolved zone, and a bad zone warns exactly once then falls back", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.member.id);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await db.organization.update({ where: { id: f.org.id }, data: { timezone: "Asia/Damascuss" } });
    const first = await resolveWorkspaceView(f.wsIn.id);
    if (!("ctx" in first)) throw new Error("expected a ctx");
    expect(first.ctx.timeZone).toBe("Asia/Damascus"); // the default: the stored name is not a zone
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("org.timezone.invalid");
    expect(String(warn.mock.calls[0]?.[0])).toContain("Asia/Damascuss");

    // a second resolve of the same organization and zone does not warn again
    await resolveWorkspaceView(f.wsIn.id);
    expect(warn).toHaveBeenCalledTimes(1);

    // a VALID stored zone is carried as-is and never warns
    warn.mockClear();
    await db.organization.update({ where: { id: f.org.id }, data: { timezone: "Asia/Tokyo" } });
    const second = await resolveWorkspaceView(f.wsIn.id);
    if (!("ctx" in second)) throw new Error("expected a ctx");
    expect(second.ctx.timeZone).toBe("Asia/Tokyo");
    expect(warn).not.toHaveBeenCalled();
  });
});
