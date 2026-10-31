import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addClient, removeClient, resetHubForTests } from "@/server/realtime/hub";
import { dropPresence, resetPresenceForTests, settleLastSeenWrites, touchPresence } from "@/server/realtime/presence";
import { withFeature } from "@/lib/features";
import { db, makeOrg, makeTeam, makeUser } from "./helpers";

/**
 * «آخر ظهور», the writing half (the owner, 2026-10-31): the presence layer records the last moment a person was at their
 * screen in the company the stream belongs to, at most once a minute, once more when their last stream closes, never
 * failing a request, and not at all when the company's switch is off.
 */
const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);

async function seenOf(orgId: string, userId: string): Promise<Date | null> {
  const row = await db.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: orgId, userId } }, select: { lastSeenAt: true } });
  return row.lastSeenAt;
}

beforeEach(() => {
  resetPresenceForTests();
  resetHubForTests();
});
afterEach(() => vi.restoreAllMocks());

describe("the throttled write", () => {
  it("two touches within a minute are ONE write; after 61 s the second goes through", async () => {
    const t = await makeTeam();
    const spy = vi.spyOn(db, "$executeRaw");

    touchPresence(t.member.id, T0, t.org.id);
    touchPresence(t.member.id, T0 + 30_000, t.org.id);
    touchPresence(t.member.id, T0 + 59_999, t.org.id);
    await settleLastSeenWrites();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await seenOf(t.org.id, t.member.id))?.getTime()).toBe(T0);

    touchPresence(t.member.id, T0 + 61_000, t.org.id);
    await settleLastSeenWrites();
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await seenOf(t.org.id, t.member.id))?.getTime()).toBe(T0 + 61_000);
  });

  it("the throttle is per person: a colleague's touch is a write of its own", async () => {
    const t = await makeTeam();
    touchPresence(t.member.id, T0, t.org.id);
    touchPresence(t.admin.id, T0 + 1_000, t.org.id);
    await settleLastSeenWrites();
    expect((await seenOf(t.org.id, t.member.id))?.getTime()).toBe(T0);
    expect((await seenOf(t.org.id, t.admin.id))?.getTime()).toBe(T0 + 1_000);
  });

  it("the database refuses a write younger than a minute even when the memory forgot (a restart): the UPDATE is conditional", async () => {
    const t = await makeTeam();
    touchPresence(t.member.id, T0, t.org.id);
    await settleLastSeenWrites();
    resetPresenceForTests(); // as after a restart: no memory of the last write
    touchPresence(t.member.id, T0 + 10_000, t.org.id);
    await settleLastSeenWrites();
    expect((await seenOf(t.org.id, t.member.id))?.getTime()).toBe(T0);
    resetPresenceForTests();
    touchPresence(t.member.id, T0 + 60_001, t.org.id);
    await settleLastSeenWrites();
    expect((await seenOf(t.org.id, t.member.id))?.getTime()).toBe(T0 + 60_001);
  });

  it("without a company only the memory is touched: no query at all", async () => {
    const t = await makeTeam();
    const spy = vi.spyOn(db, "$executeRaw");
    touchPresence(t.member.id, T0);
    await settleLastSeenWrites();
    expect(spy).not.toHaveBeenCalled();
    expect(await seenOf(t.org.id, t.member.id)).toBeNull();
  });
});

describe("the final write", () => {
  it("the last stream closing writes the real end of the session, unthrottled", async () => {
    const t = await makeTeam();
    touchPresence(t.member.id, T0, t.org.id);
    await settleLastSeenWrites();
    // 20 s later, well inside the minute, the person leaves: that is the time recorded
    dropPresence(t.member.id, t.org.id, T0 + 20_000);
    await settleLastSeenWrites();
    expect((await seenOf(t.org.id, t.member.id))?.getTime()).toBe(T0 + 20_000);
  });

  it("through the hub: one stream of two closing writes nothing, the last one closing writes", async () => {
    const t = await makeTeam();
    const a = addClient({ userId: t.member.id, orgId: t.org.id, send: () => undefined, close: () => undefined });
    const b = addClient({ userId: t.member.id, orgId: t.org.id, send: () => undefined, close: () => undefined });
    await settleLastSeenWrites();
    const connected = await seenOf(t.org.id, t.member.id);
    expect(connected).not.toBeNull();

    const spy = vi.spyOn(db, "$executeRaw");
    removeClient(a);
    await settleLastSeenWrites();
    expect(spy).not.toHaveBeenCalled();
    removeClient(b);
    await settleLastSeenWrites();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await seenOf(t.org.id, t.member.id))!.getTime()).toBeGreaterThanOrEqual(connected!.getTime());
  });
});

describe("whose row, and whether at all", () => {
  it("a person in two companies gets the column of the membership of the stream's company only", async () => {
    const t = await makeTeam();
    const other = await makeOrg();
    await db.organizationMember.create({ data: { organizationId: other.id, userId: t.member.id, role: "MEMBER" } });

    touchPresence(t.member.id, T0, other.id);
    await settleLastSeenWrites();
    expect((await seenOf(other.id, t.member.id))?.getTime()).toBe(T0);
    expect(await seenOf(t.org.id, t.member.id)).toBeNull();

    touchPresence(t.member.id, T0 + 5_000, t.org.id);
    await settleLastSeenWrites();
    expect((await seenOf(t.org.id, t.member.id))?.getTime()).toBe(T0 + 5_000);
    expect((await seenOf(other.id, t.member.id))?.getTime()).toBe(T0);
  });

  it("a company the person does not belong to is a write that matches nothing", async () => {
    const t = await makeTeam();
    const stranger = await makeUser({});
    touchPresence(stranger.id, T0, t.org.id);
    await settleLastSeenWrites();
    expect(await db.organizationMember.count({ where: { organizationId: t.org.id, lastSeenAt: { not: null } } })).toBe(0);
  });

  it("a suspended person is not written", async () => {
    const t = await makeTeam();
    await db.organizationMember.updateMany({ where: { userId: t.member.id }, data: { status: "SUSPENDED" } });
    touchPresence(t.member.id, T0, t.org.id);
    dropPresence(t.member.id, t.org.id, T0 + 1_000);
    await settleLastSeenWrites();
    expect(await seenOf(t.org.id, t.member.id)).toBeNull();
  });

  it("the company's switch off: nothing new is recorded; on again, it is", async () => {
    const t = await makeTeam();
    await db.organization.update({ where: { id: t.org.id }, data: { settings: withFeature({}, "lastSeen", false) as never } });
    touchPresence(t.member.id, T0, t.org.id);
    dropPresence(t.member.id, t.org.id, T0 + 1_000);
    await settleLastSeenWrites();
    expect(await seenOf(t.org.id, t.member.id)).toBeNull();

    await db.organization.update({ where: { id: t.org.id }, data: { settings: withFeature({}, "lastSeen", true) as never } });
    resetPresenceForTests();
    touchPresence(t.member.id, T0 + 2_000, t.org.id);
    await settleLastSeenWrites();
    expect((await seenOf(t.org.id, t.member.id))?.getTime()).toBe(T0 + 2_000);
  });

  it("a failing database is swallowed: presence never fails the caller", async () => {
    const t = await makeTeam();
    vi.spyOn(db, "$executeRaw").mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => touchPresence(t.member.id, T0, t.org.id)).not.toThrow();
    expect(() => dropPresence(t.member.id, t.org.id, T0 + 1)).not.toThrow();
    await settleLastSeenWrites();
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("db down");
  });
});
