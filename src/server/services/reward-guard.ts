import { db } from "@/server/db";
import { ForbiddenError } from "@/server/auth";
import { canEditRewardTask } from "@/server/policy/reward";
import { isFeatureOn } from "@/server/services/features";
import { isRewardTaskStatus } from "@/lib/rewards";

/**
 * «مهمة بمكافأة» — the guard every writer of a task goes through (tasks.ts `updateTask` / `deleteTask` / `createTask`,
 * the reward routes). It lives apart from tasks.ts and rewards.ts so both can use it without importing each other.
 *
 * The owner is read from the database on every call (an ACTIVE membership with the OWNER rank: the company's owners, the
 * co-owners with him), never from the cookie or the request body.
 */

/** Is this person an ACTIVE OWNER of the company? */
export async function isOrgOwner(ctx: { orgId: string; userId: string }): Promise<boolean> {
  const row = await db.organizationMember.findFirst({
    where: { organizationId: ctx.orgId, userId: ctx.userId, role: "OWNER", status: "ACTIVE" },
    select: { id: true },
  });
  return row !== null;
}

/** The company's switch «مهام بمكافأة وتثبيت». Off, the rewards and pins are inert: the task is a plain task again. */
export async function rewardsOn(orgId: string): Promise<boolean> {
  return isFeatureOn(orgId, "taskRewards");
}

/**
 * The lock on a reward task: 403 `reward.owner_only` for anybody but an owner, when the task carries a reward and the
 * switch is on. A task with no reward (or a switch that is off) is never locked here.
 */
export async function assertRewardEditable(ctx: { orgId: string; userId: string }, task: { rewardStatus: string | null | undefined }): Promise<void> {
  if (!isRewardTaskStatus(task.rewardStatus)) return;
  if (!(await rewardsOn(ctx.orgId))) return;
  if (canEditRewardTask({ isOwner: await isOrgOwner(ctx) }, task)) return;
  throw new ForbiddenError("reward.owner_only");
}
