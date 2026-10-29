import { db } from "@/server/db";
import { onlineUserIds } from "@/server/realtime/presence";

/**
 * THE PEOPLE DOCK — who works here and who is at their screen right now (the owner's ask,
 * 2026-10-29: «المستخدمين ظاهرين على زاوية الموقع تحت وكل واحد جنبه علامة خضراء أونلاين»).
 *
 * The roster is the staff directory: the ACTIVE people of the company who are not GUESTS (an
 * external partner is nobody's colleague, and never appears in a list of the team). The viewer is
 * on it too, and always counted as online — they are looking at this very screen.
 *
 * «Online» is the existing presence of `src/server/realtime/presence.ts` (an open realtime stream,
 * or 30 s after the last one): one source of truth, so the dock and the chat's member pills never
 * disagree. It is in-memory and per process, so the answer is only as good as this server — that is
 * the same caveat the chat has carried since Phase 3.
 */
export interface PresencePerson {
  userId: string;
  name: string;
  jobTitle: string | null;
  role: string;
  online: boolean;
  /** `/api/avatars/<id>`, or null. */
  avatarUrl?: string | null;
}

export interface PresenceRoster {
  people: PresencePerson[];
  onlineCount: number;
  /** everybody on the roster, online or not */
  total: number;
}

export async function presenceRoster(orgId: string, viewerId: string): Promise<PresenceRoster> {
  const rows = await db.organizationMember.findMany({
    where: {
      organizationId: orgId,
      role: { not: "GUEST" },
      status: "ACTIVE",
    },
    select: { userId: true, role: true, user: { select: { id: true, name: true, jobTitle: true, avatarUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  const online = new Set(await onlineUserIds(orgId));
  const people = rows
    .map((r) => ({
      userId: r.userId,
      name: r.user.name,
      jobTitle: r.user.jobTitle,
      role: r.role,
      avatarUrl: r.user.avatarUrl,
      // the viewer is looking at this very screen: they are at their screen, whatever the stream says
      online: r.userId === viewerId || online.has(r.userId),
    }))
    // whoever is at their screen first, then by name: the list is read top-down on a phone
    .sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name, "ar") : a.online ? -1 : 1));
  return { people, onlineCount: people.filter((p) => p.online).length, total: people.length };
}
