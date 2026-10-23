import { pageActor } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { GoalsView } from "@/components/goals-view";

/**
 * الأهداف الأسبوعية والشهرية — period goals with live progress. The company's own plans (titles,
 * descriptions, who set them): the tab is for staff, and /api/goals refuses an external partner, so the
 * view is not rendered for them - they get a notice instead of a page that never loads.
 */
export default async function GoalsPage() {
	const { actor } = await pageActor();
	if (refusedToGuest(actor, "goals")) return <GuestNotice />;
	const canManage = actor.role === "OWNER" || actor.role === "ADMIN";
	return <GoalsView canManage={canManage} />;
}

export const dynamic = "force-dynamic";
