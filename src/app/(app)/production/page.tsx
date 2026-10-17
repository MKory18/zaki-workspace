import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { ProductionView } from "@/components/production-view";

/** الإنتاج اليومي — recurring daily-production checklist. */
export default async function ProductionPage() {
	const user = await currentUser();
	if (!user) redirect("/login");
	const membership = await db.organizationMember.findFirst({
		where: { userId: user.id },
		orderBy: { createdAt: "asc" },
		select: { role: true },
	});
	if (!membership) redirect("/login");
	const canManage = membership.role === "OWNER" || membership.role === "ADMIN";
	return <ProductionView canManage={canManage} />;
}

export const dynamic = "force-dynamic";
