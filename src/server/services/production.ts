import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, audit } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { assertCanWrite } from "@/server/services/guest-guard";
import { assertActiveAssignee } from "@/server/services/active-people";
import { resolveTimeZone, zonedParts, zonedWallTime } from "@/lib/zoned-time";
import { mySpacesWhere, placeWhere, type SpacePlace } from "@/server/services/space-place";

/**
 * Daily production. Reading the checklist and the routine list stays open to every
 * org member; every write (tick a routine off, create/edit/delete one) is refused to
 * org GUESTs with `guest.readonly`, and managing routines is OWNER/ADMIN only.
 * A routine is only ever handed to an ACTIVE member of the organization; one that somebody
 * already holds stays readable (and editable around them) after they are suspended or leave.
 */

/** Local calendar day string "YYYY-MM-DD" (the whole app runs on one machine). */
export function dayIso(d: Date, timeZone?: string): string {
  if (timeZone) {
    // the company's day: the zone's calendar date, whatever the machine says
    const p = zonedParts(d, resolveTimeZone(timeZone));
    const m = p.month;
    const day = p.day;
    return p.year + "-" + (m < 10 ? "0" + m : String(m)) + "-" + (day < 10 ? "0" + day : String(day));
  }
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const mm = m < 10 ? "0" + m : String(m);
  const dd = day < 10 ? "0" + day : String(day);
  return y + "-" + mm + "-" + dd;
}

/** Noon (in `timeZone`, or the machine's zone without one) of the "YYYY-MM-DD" day `s`. */
export function parseDayIso(s: string, timeZone?: string): Date {
  const parts = s.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (timeZone) {
    return zonedWallTime({ year: y, month: m, day: d, hour: 12 }, resolveTimeZone(timeZone));
  }
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function shiftDay(s: string, delta: number): string {
	const d = parseDayIso(s);
	d.setDate(d.getDate() + delta);
	return dayIso(d);
}

export interface RoutineRow {
	id: string;
	title: string;
	description: string | null;
	departmentId: string | null;
	departmentName: string | null;
	assigneeId: string | null;
	assigneeName: string | null;
	weekdays: string;
	active: boolean;
}

export async function listRoutines(orgId: string, place?: SpacePlace): Promise<RoutineRow[]> {
	const rows = await db.routine.findMany({
		// the routines of the space the person is in (and in «الشركة» the ones from before spaces had their own)
		where: { orgId, ...(place ? { AND: [placeWhere(place)] } : {}) },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			title: true,
			description: true,
			departmentId: true,
			assigneeId: true,
			assignee: { select: { name: true } },
			weekdays: true,
			active: true,
			department: { select: { name: true } },
		},
	});
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		description: r.description,
		departmentId: r.departmentId,
		departmentName: r.department?.name ?? null,
		assigneeId: r.assigneeId,
		assigneeName: r.assignee?.name ?? null,
		weekdays: r.weekdays,
		active: r.active,
	}));
}

/** Does a routine run on the given day? Empty weekdays = every day. The weekday is `timeZone`'s (or the machine's). */
export function runsOnDay(weekdays: string, day: string, timeZone?: string): boolean {
	if (!weekdays || weekdays === "") return true;
	const parts = weekdays.split(",");
	const weekday = String(parseDayIso(day, timeZone).getDay());
	return parts.indexOf(weekday) !== -1;
}

/** Checklist for one day: active routines scheduled that day + today's completion state. */
export async function dayChecklist(orgId: string, day: string, timeZone?: string, place?: SpacePlace) {
	const routines = await db.routine.findMany({
		where: { orgId, active: true, ...(place ? { AND: [placeWhere(place)] } : {}) },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			title: true,
			description: true,
			departmentId: true,
			department: { select: { name: true } },
			assigneeId: true,
			assignee: { select: { name: true } },
			weekdays: true,
		},
	});
	const due = routines.filter((r) => runsOnDay(r.weekdays, day, timeZone));
	const logs = await db.routineLog.findMany({
		where: { routineId: { in: due.map((r) => r.id) }, day },
		select: { routineId: true, completedAt: true, completedById: true },
	});
	const doneMap = new Map(logs.map((l) => [l.routineId, l.completedAt.toISOString()]));
	return {
		day,
		items: due.map((r) => ({
			id: r.id,
			title: r.title,
			description: r.description,
			departmentName: r.department?.name ?? null,
			assigneeId: r.assigneeId,
			assigneeName: r.assignee?.name ?? null,
			doneAt: doneMap.get(r.id) ?? null,
		})),
	};
}

export const routineSchema = z.object({
	title: z.string().trim().min(2, "title.too_short").max(120),
	description: z.string().trim().max(500).nullable().optional(),
	departmentId: z.string().nullable().optional(),
	assigneeId: z.string().nullable().optional(),
	weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
	active: z.boolean().optional(),
});

function weekdaysToCsv(days: number[] | undefined): string {
	if (!days || days.length === 0 || days.length === 7) return "";
	const sorted = [...new Set(days)].sort((a, b) => a - b);
	return sorted.join(",");
}

/**
 * A department named in a write must be one of the caller's own company (goals and routines both
 * store a `departmentId`): another company's id is "not found", like everywhere else (review B7).
 */
export async function assertDepartmentInOrg(orgId: string, departmentId: string | null | undefined): Promise<void> {
	if (!departmentId) return;
	const dept = await db.department.findFirst({ where: { id: departmentId, orgId }, select: { id: true } });
	if (!dept) throw new NotFoundError("dept.not_found");
}

async function assertRoutineOrg(orgId: string, routineId: string, userId?: string) {
	// of one of the person's spaces (or from before spaces had their own): anything else is «not found»
	const mine = userId ? { AND: [await mySpacesWhere(userId)] } : {};
	const r = await db.routine.findFirst({ where: { id: routineId, orgId, ...mine }, select: { id: true, assigneeId: true } });
	if (!r) throw new NotFoundError("routine.not_found");
	return r;
}

export async function createRoutine(ctx: { orgId: string; userId: string }, input: z.infer<typeof routineSchema>, spaceId: string | null = null) {
	await assertCanManageRoutines(ctx);
	if (input.assigneeId) await assertActiveAssignee(ctx.orgId, input.assigneeId);
	await assertDepartmentInOrg(ctx.orgId, input.departmentId);
	const routine = await db.routine.create({
		data: {
			orgId: ctx.orgId,
			title: input.title,
			description: input.description ?? null,
			departmentId: input.departmentId ?? null,
			assigneeId: input.assigneeId ?? null,
			weekdays: weekdaysToCsv(input.weekdays),
			active: input.active ?? true,
			// set in the space the person is in
			workspaceId: spaceId,
		},
		select: { id: true },
	});
	await audit("routine.created", { actorId: ctx.userId, orgId: ctx.orgId, target: routine.id });
	return routine;
}

export async function updateRoutine(ctx: { orgId: string; userId: string }, id: string, input: z.infer<typeof routineSchema>) {
	await assertCanManageRoutines(ctx);
	const current = await assertRoutineOrg(ctx.orgId, id, ctx.userId);
	// a NEW assignee must be active; re-sending the current one (who may have left since) changes nothing
	if (input.assigneeId && input.assigneeId !== current.assigneeId) await assertActiveAssignee(ctx.orgId, input.assigneeId);
	await assertDepartmentInOrg(ctx.orgId, input.departmentId);
	await db.routine.update({
		where: { id },
		data: {
			title: input.title ?? undefined,
			description: input.description ?? undefined,
			departmentId: input.departmentId ?? undefined,
			assigneeId: input.assigneeId ?? undefined,
			weekdays: input.weekdays !== undefined ? weekdaysToCsv(input.weekdays) : undefined,
			active: input.active ?? undefined,
		},
	});
	await audit("routine.updated", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
}

export async function deleteRoutine(ctx: { orgId: string; userId: string }, id: string) {
	await assertCanManageRoutines(ctx, "delete");
	await assertRoutineOrg(ctx.orgId, id, ctx.userId);
	await db.routine.delete({ where: { id } });
	await audit("routine.deleted", { actorId: ctx.userId, orgId: ctx.orgId, target: id });
}

/**
 * Managing routines takes the production boxes of the person's grid: «يضيف ويعدّل» to create or edit one, «يحذف» to
 * delete one (by default the admins', as before the grid). A guest is told it is read-only (`guest.readonly`), anyone
 * else without the box that their permission does not allow it.
 */
async function assertCanManageRoutines(ctx: { orgId: string; userId: string }, action: "edit" | "delete" = "edit"): Promise<void> {
	assertCanWrite({ orgRole: await orgRoleOf(ctx.orgId, ctx.userId) });
	await assertMemberCan(ctx, action === "edit" ? "production.edit" : "production.delete", "production.routines_role_denied");
}

/** Toggle (or force) one routine's completion for one day. Any org member except a guest may check off. */
export async function setRoutineDone(
	ctx: { orgId: string; userId: string },
	routineId: string,
	day: string,
	done: boolean,
): Promise<void> {
	assertCanWrite({ orgRole: await orgRoleOf(ctx.orgId, ctx.userId) });
	await assertMemberCan(ctx, "production.view", "section.view_denied");
	const routine = await db.routine.findFirst({ where: { id: routineId, orgId: ctx.orgId, AND: [await mySpacesWhere(ctx.userId)] }, select: { id: true } });
	if (!routine) throw new NotFoundError("routine.not_found");
	if (done) {
		await db.routineLog.upsert({
			where: { routineId_day: { routineId, day } },
			create: { routineId, day, completedById: ctx.userId },
			update: { completedById: ctx.userId },
		});
	} else {
		await db.routineLog.deleteMany({ where: { routineId, day } });
	}
}

/** The person's role in the organization. A suspended or offboarded member has none: they are "not a member". */
export async function orgRoleOf(orgId: string, userId: string) {
	const m = await db.organizationMember.findUnique({
		where: { organizationId_userId: { organizationId: orgId, userId } },
		select: { role: true, status: true },
	});
	if (!m || m.status !== "ACTIVE") throw new ForbiddenError("not_org_member");
	return m.role;
}
