import { db } from "@/server/db";
import { loadWorkScope, narrowScope, scopeSpaceIds, taskVisibleWhere } from "@/server/services/team-scope";
import { listBadgeStatus } from "@/lib/rewards";
import type { RewardLens } from "@/server/services/rewards";

/**
 * «مثبّتة» — the pinned tasks a person may be shown, for the strip at the top of a project and the compact card of «اليوم».
 * The same rule every task list uses (the spaces they can open and the teams they are in: `taskVisibleWhere`); a pin
 * never opens anything to anybody. A reward is on a card only for somebody whose `lens.rewards` is true.
 */
export interface PinnedCard {
  id: string;
  key: string;
  title: string;
  dueDate: string | null;
  completed: boolean;
  projectName: string;
  reward: { status: string; amountMinor: number; currency: string } | null;
}

const TAKE = 8;

export async function pinnedTasks(
  who: { userId: string; orgId: string },
  where: { projectId?: string; spaceId?: string | null },
  lens: RewardLens,
): Promise<PinnedCard[]> {
  if (!lens.pins) return [];
  const scope = await loadWorkScope(who.userId);
  const narrowed = where.spaceId === undefined ? scope : narrowScope(scope, where.spaceId);
  const spaceIds = scopeSpaceIds(narrowed);
  if (spaceIds.length === 0) return [];
  const rows = await db.task.findMany({
    where: {
      orgId: who.orgId,
      archived: false,
      pinnedAt: { not: null },
      workspaceId: { in: spaceIds },
      ...(where.projectId ? { projectId: where.projectId } : {}),
      AND: [taskVisibleWhere(narrowed)],
    },
    orderBy: [{ pinnedAt: "desc" }, { id: "asc" }],
    take: TAKE,
    select: {
      id: true,
      number: true,
      title: true,
      dueDate: true,
      completedAt: true,
      rewardStatus: true,
      rewardAmountMinor: true,
      rewardCurrency: true,
      project: { select: { name: true } },
      organization: { select: { keyPrefix: true } },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    key: `${t.organization.keyPrefix}-${t.number}`,
    title: t.title,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    completed: t.completedAt != null,
    projectName: t.project.name,
    reward:
      lens.rewards && listBadgeStatus(t.rewardStatus) && t.rewardAmountMinor != null && t.rewardCurrency
        ? { status: t.rewardStatus as string, amountMinor: t.rewardAmountMinor, currency: t.rewardCurrency }
        : null,
  }));
}
