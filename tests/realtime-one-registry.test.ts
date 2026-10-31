import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({
  db: {
    // the presence layer records «آخر ظهور» through one raw UPDATE (fire-and-forget)
    $executeRaw: vi.fn().mockResolvedValue(0),
    user: { update: vi.fn().mockResolvedValue({}) },
    conversation: { findUnique: vi.fn().mockResolvedValue({ kind: "TOPIC" }) },
    organizationMember: { findMany: vi.fn().mockResolvedValue([{ userId: "u1" }]) },
  },
}));

/**
 * Next loads a server module more than once in one process: the LISTEN client starts from
 * instrumentation.ts with its copy of the hub, and the browsers register through /api/rt with
 * another. These tests load the module twice (vi.resetModules) and prove the two copies share ONE
 * registry and ONE presence map; with module-level state the event below reached nobody.
 */
afterEach(() => {
  delete (globalThis as { __zkRtHub?: unknown }).__zkRtHub;
  delete (globalThis as { __zkRtPresence?: unknown }).__zkRtPresence;
  vi.resetModules();
});

describe("one realtime hub per process, however many copies of the module Next loads", () => {
  it("an event delivered through one copy reaches a stream registered through the other", async () => {
    const routeCopy = await import("@/server/realtime/hub");
    const sends: string[] = [];
    routeCopy.addClient({ userId: "u1", orgId: "org1", send: (s) => sends.push(s), close: () => undefined });

    vi.resetModules();
    const listenerCopy = await import("@/server/realtime/hub");
    expect(listenerCopy).not.toBe(routeCopy); // really two copies of the module
    await listenerCopy.deliverEvent({ id: "9", orgId: "org1", kind: "conversation.changed", ids: { spaceId: "ws1" } });

    expect(sends).toHaveLength(1);
    expect(sends[0]).toContain('"kind":"conversation.changed"');
    expect(listenerCopy.clientCount()).toBe(1);
  });

  it("presence written by /api/rt is what another route reads (who is online decides who gets a bell)", async () => {
    const rtCopy = await import("@/server/realtime/presence");
    rtCopy.touchPresence("u1");

    vi.resetModules();
    const sendCopy = await import("@/server/realtime/presence");
    expect(await sendCopy.isOnline("u1")).toBe(true);
    expect(await sendCopy.onlineUserIds("org1")).toEqual(["u1"]);
  });
});
