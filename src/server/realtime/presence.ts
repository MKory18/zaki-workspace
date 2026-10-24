import { db } from "@/server/db";

/**
 * Presence is in-memory per server process in Phase 3: a single Next.js instance serves
 * the whole workspace (no Redis in the stack). A user is "online" from the moment one of
 * their SSE clients connects until 30 s after the last one disconnects.
 *
 * The map lives on `globalThis`, like the hub's registry: `/api/rt` writes it and other routes
 * (sending a message decides who gets a bell) read it, and Next may load this module more
 * than once in one process. A module-level map gave each copy its own, mostly empty view.
 */
declare global {
  // eslint-disable-next-line no-var
  var __zkRtPresence: Map<string, number> | undefined;
}
const lastSeen: Map<string, number> = (globalThis.__zkRtPresence ??= new Map<string, number>());

const ONLINE_WINDOW_MS = 30_000;

export function touchPresence(userId: string, now: number = Date.now()): void {
  lastSeen.set(userId, now);
}

export function dropPresence(userId: string): void {
  lastSeen.delete(userId);
}

/** Test hook: clears the in-memory map (never call from server code). */
export function resetPresenceForTests(): void {
  lastSeen.clear();
}

export async function isOnline(userId: string): Promise<boolean> {
  const seen = lastSeen.get(userId);
  return typeof seen === "number" && Date.now() - seen <= ONLINE_WINDOW_MS;
}

export async function onlineUserIds(orgId: string): Promise<string[]> {
  const members = await db.organizationMember.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    select: { userId: true },
  });
  const now = Date.now();
  const online: string[] = [];
  for (const m of members) {
    const seen = lastSeen.get(m.userId);
    if (typeof seen === "number" && now - seen <= ONLINE_WINDOW_MS) online.push(m.userId);
  }
  return online;
}
