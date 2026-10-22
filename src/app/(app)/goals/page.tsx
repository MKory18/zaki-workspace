import { pageActor } from "@/app/(app)/_access";
import { GoalsView } from "@/components/goals-view";

/** الأهداف الشهرية والاسبوعية — period goals with live progress. */
export default async function GoalsPage() {
	const { actor } = await pageActor();
	const canManage = actor.role === "OWNER" || actor.role === "ADMIN";
	return <GoalsView canManage={canManage} />;
}

export const dynamic = "force-dynamic";
