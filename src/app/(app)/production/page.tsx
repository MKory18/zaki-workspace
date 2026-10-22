import { pageActor } from "@/app/(app)/_access";
import { ProductionView } from "@/components/production-view";
import { resolveTimeZone } from "@/lib/zoned-time";
import { db } from "@/server/db";

/** الروتين اليومي — recurring daily checklist. */
export default async function ProductionPage() {
	const { actor } = await pageActor();
	const canManage = actor.role === "OWNER" || actor.role === "ADMIN";
	// the company's zone: the checklist's default day and its weekdays are cut there
	const zone = resolveTimeZone(
		(await db.organization.findUnique({ where: { id: actor.orgId }, select: { timezone: true } }))?.timezone,
	);
	return <ProductionView canManage={canManage} readOnly={actor.isExternal} timeZone={zone} />;
}

export const dynamic = "force-dynamic";
