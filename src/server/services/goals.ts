import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, audit } from "@/server/auth";
import { canManageOrg } from "@/server/services/orgs";
import { orgRoleOf } from "@/server/services/production";

export type GoalPeriodT = "WEEKLY" | "MONTHLY";

/** Week starts Sunday; month is the calendar month containing the anchor. */
export function periodWindow(period: GoalPeriodT, anchor: Date): { start: Date; end: Date } {
	if (period === "WEEKLY") {
		const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay(), 0, 0, 0, 0);
		const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
		end.setMilliseconds(-1);
		return { start, end };
	}
	const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
	const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1, 0, 0, 0, 0);
	end.setMilliseconds(-1);
	return { start, end };
}

export const goalSchema = z.object({
	title: z.string().trim().min(2, "title.too_short").max(160),
	description: z.string().trim().max(1000).nullable().optional(),
	period: z.enum(["WEEKLY", "MONTHLY"]),
	anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "goal.bad_date"),
	progress: z.number().int().min(0).max(100).optional(),
	departmentId: z.string().nullable().optional(),
});

export function goalStatus(goal: { periodEnd: Date; progress: number }, now: Date): string {
	if (goal.progress >= 100) return "achieved";
	if (now > goal.periodEnd) return "missed";
	return "active";
}

export async function listGoals(orgId: string) {
	const rows = await db.goal.findMany({
		where: { orgId },
		orderBy: [{ periodStart: "desc" }, { createdAt: "asc" }],
		select: {
			id: true,
			title: true,
			description: true,
			period: true,
			periodStart: true,
			periodEnd: true,
			progress: true,
			departmentId: true,
			department: { select: { name: true } },
			creator: { select: { name: true } },
			createdAt: true,
		},
	});
	return rows.map((g) => ({
		id: g.id,
		title: g.title,
		description: g.description,
		period: g.period as GoalPeriodT,
		periodStart: g.periodStart.toISOString(),
		periodEnd: g.periodEnd.toISOString(),
		progress: g.progress,
		departmentId: g.departmentId,
		departmentName: g.department?.name ?? null,
		creatorName: g.creator.name,
	}));
}

export async function createGoal(ctx: { orgId: string; userId: string }, input: z.infer<typeof goalSchema>) {
	if (!canManageOrg(await orgRoleOf(ctx.orgId, ctx.userId))) throw new ForbiddenError("orgm.role_denied");
	const anchor = parseAnchor(input.anchorDate);
	const win = periodWindow(input.period, anchor);
	const goal = await db.goal.create({
		data: {
			orgId: ctx.orgId,
			title: input.title,
			description: input.description ?? null,
			period: input.period,
			periodStart: win.start,
			periodEnd: win.end,
			progress: input.progress ?? 0,
			departmentId: input.departmentId ?? null,
			creatorId: ctx.userId,
		},
		select: { id: true },
	});
	await audit("goal.created", { actorId: ctx.userId, orgId: ctx.orgId, target: goal.id });
	return goal;
}

export const goalPatchSchema = goalSchema.partial().refine((v) => Object.keys(v).length > 0, { message: "goal.no_change" });
export type GoalPatch = z.infer<typeof goalPatchSchema>;

export async function updateGoal(ctx: { orgId: string; userId: string }, id: string, input: GoalPatch) {
	if (!canManageOrg(await orgRoleOf(ctx.orgId, ctx.userId))) throw new ForbiddenError("orgm.role_denied");
	const existing = await db.goal.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true, periodStart: true, periodEnd: true, period: true } });
	if (!existing) throw new NotFoundError("goal.not_found");
	let data: Record<string, unknown> = {
		title: input.title ?? undefined,
		description: input.description ?? undefined,
		progress: input.progress ?? undefined,
		departmentId: input.departmentId ?? undefined,
	};
	if (input.period || input.anchorDate) {
		const period = (input.period ?? existing.period) as GoalPeriodT;
		const anchor = input.anchorDate
			? parseAnchor(input.anchorDate)
			: new Date(Math.min(Math.max(Date.now(), existing.periodStart.getTime()), existing.periodEnd.getTime()));
		const win = periodWindow(period, anchor);
		data.period = period;
		data.periodStart = win.start;
		data.periodEnd = win.end;
	}
	await db.goal.update({ where: { id }, data });
	await audit("goal.updated", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
}

export async function deleteGoal(ctx: { orgId: string; userId: string }, id: string) {
	if (!canManageOrg(await orgRoleOf(ctx.orgId, ctx.userId))) throw new ForbiddenError("orgm.role_denied");
	const existing = await db.goal.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
	if (!existing) throw new NotFoundError("goal.not_found");
	await db.goal.delete({ where: { id } });
	await audit("goal.deleted", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
}

function parseAnchor(s: string): Date {
	const parts = s.split("-");
	return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0, 0);
}
