import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
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
	// the goals row of the person's grid: «يشوف», «يضيف ويعدّل» (by default the admins'), «يحذف»
	if (!actorCan(actor, "goals.view")) return <SectionOffNotice />;
	return <GoalsView canManage={actorCan(actor, "goals.edit")} canDelete={actorCan(actor, "goals.delete")} />;
}

export const dynamic = "force-dynamic";
