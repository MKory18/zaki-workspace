import { opensDay } from "@/lib/chat/day-separator";

/**
 * RUNS of a message log (the owner, 2026-10-29: «نظام دردشة نفس التطبيقات الحديثة»): consecutive messages
 * of one person are drawn as one group — the name on the first, the picture and the bubble's tail on the
 * last — instead of repeating both on every bubble. Pure: the caller asks about one index of the log.
 */
export const GROUP_GAP_MS = 5 * 60_000;

export interface RunMessage {
  authorId?: string | null;
  kind: string;
  createdAt: string;
}

/** Do `a` and `b` (adjacent, `a` first) belong to one run? */
function sameRun(a: RunMessage, b: RunMessage): boolean {
  if (a.kind === "SYSTEM" || b.kind === "SYSTEM") return false;
  if (!a.authorId || a.authorId !== b.authorId) return false;
  if (opensDay(b.createdAt, a.createdAt)) return false;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) <= GROUP_GAP_MS;
}

export function runFlags(list: readonly RunMessage[], index: number): { start: boolean; end: boolean } {
  const me = list[index];
  if (!me) return { start: true, end: true };
  const before = list[index - 1];
  const after = list[index + 1];
  return { start: !before || !sameRun(before, me), end: !after || !sameRun(me, after) };
}
