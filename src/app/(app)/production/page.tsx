import { pageActor } from "@/app/(app)/_access";
import { ProductionView } from "@/components/production-view";

/** الإنتاج اليومي — recurring daily-production checklist. */
export default async function ProductionPage() {
	const { actor } = await pageActor();
	const canManage = actor.role === "OWNER" || actor.role === "ADMIN";
	return <ProductionView canManage={canManage} readOnly={actor.isExternal} />;
}

export const dynamic = "force-dynamic";
