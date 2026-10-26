import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { OrgRole, WorkspaceKind, WorkspaceRole } from "@prisma/client";
import { db } from "@/server/db";
import { HQ_SYSTEM_KEY } from "@/server/chat/hq";
import { isSpaceManager } from "@/server/workspace-role";

import { goHref } from "@/lib/space-link";

export { goHref, safeNext } from "@/lib/space-link";

/**
 * THE SPACE YOU ARE IN — the owner's decision (2026-10-25, «العزل شامل… كأني بفتح سايت جديد»): entering a
 * space is like opening a separate site. Its name sits at the top, and every page shows that space's work
 * only (today, my work, projects, list and calendar, reports, search, chat).
 *
 * The choice is a cookie (`zk-space`) holding a space id, written by the server only (`/go`). It is NEVER
 * trusted: every request checks it against the spaces the person may open in their company (the OWNER: all
 * of them; anybody else: the ones they were put in). A stale or foreign id falls back to «الشركة» (HQ), and
 * to the first space by name when HQ is not theirs (a guest).
 */

export const SPACE_COOKIE = "zk-space";

export interface SpaceEntry {
  id: string;
  name: string;
  emoji: string | null;
  kind: WorkspaceKind;
  /** The person's own row in the space (none for a space the OWNER sees without being put in it). */
  role: WorkspaceRole | null;
}

export interface CurrentSpace {
  id: string;
  name: string;
  emoji: string | null;
  kind: WorkspaceKind;
  /** OWNER, the space's ADMIN, an org ADMIN in it: sees every «مقطع» and manages the space. */
  manager: boolean;
}

/** Who is asking: the signed-in person in the company they work in (`requireActor` / `activeOrgCtx`). */
export interface SpaceSubject {
  userId: string;
  orgId: string;
  role: OrgRole;
}

/** The spaces of the person's company they may open: «الشركة» first, then by name. */
export async function spacesOf(who: SpaceSubject): Promise<SpaceEntry[]> {
  const [spaces, rows] = await Promise.all([
    db.workspace.findMany({
      where:
        who.role === "OWNER"
          ? { organizationId: who.orgId, archivedAt: null }
          : { organizationId: who.orgId, archivedAt: null, members: { some: { userId: who.userId } } },
      select: { id: true, name: true, emoji: true, kind: true, systemKey: true },
      // the order the owner put them in by dragging, then by name
      orderBy: [{ position: "asc" }, { name: "asc" }, { id: "asc" }],
    }),
    db.workspaceMember.findMany({
      where: { userId: who.userId, workspace: { organizationId: who.orgId } },
      select: { workspaceId: true, role: true },
    }),
  ]);
  const roleOf = new Map(rows.map((r) => [r.workspaceId, r.role] as const));
  const hqFirst = [...spaces.filter((s) => s.systemKey === HQ_SYSTEM_KEY), ...spaces.filter((s) => s.systemKey !== HQ_SYSTEM_KEY)];
  return hqFirst.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji, kind: s.kind, role: roleOf.get(s.id) ?? null }));
}

/** The space the person is in: the wanted one when it is theirs, else «الشركة», else the first; null with none. */
export async function resolveCurrentSpace(who: SpaceSubject, wanted: string | null | undefined): Promise<CurrentSpace | null> {
  const spaces = await spacesOf(who);
  const chosen = spaces.find((s) => s.id === wanted) ?? spaces[0];
  if (!chosen) return null;
  return {
    id: chosen.id,
    name: chosen.name,
    emoji: chosen.emoji,
    kind: chosen.kind,
    manager: isSpaceManager(who.role, chosen.role),
  };
}

/** The current space of this request (the cookie, checked). */
export async function currentSpace(who: SpaceSubject): Promise<CurrentSpace | null> {
  return resolveCurrentSpace(who, cookies().get(SPACE_COOKIE)?.value);
}

/**
 * A page of ONE thing (a task, a project, a board, a topic) that lives in another space of the person's: enter that
 * space first and come back (`/go`), so the name at the top always says where the thing is. A space that is not
 * theirs changes nothing: the page answers for itself («not found»), never a loop through `/go`.
 */
export async function keepInSpace(who: SpaceSubject, spaceId: string, path: string): Promise<void> {
  const wanted = cookies().get(SPACE_COOKIE)?.value;
  const spaces = await spacesOf(who);
  const here = spaces.find((s) => s.id === wanted) ?? spaces[0];
  if (here?.id === spaceId || !spaces.some((s) => s.id === spaceId)) return;
  redirect(goHref(spaceId, path));
}

/**
 * The notifications the bell shows inside a space: that space's, and the personal ones (no space: a welcome, a
 * changed rank, everything from before spaces had them). With no space at all: everything.
 */
export function bellWhere(userId: string, spaceId: string | null | undefined) {
  return spaceId ? { userId, OR: [{ workspaceId: spaceId }, { workspaceId: null }] } : { userId };
}
