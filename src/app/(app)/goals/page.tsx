import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { GoalsView } from "@/components/goals-view";

/** الأهداف الشهرية والاسبوعية — period goals with live progress. */
export default async function GoalsPage() {
	const user = await currentUser();
	if (!user) redirect("/login");
	const membership = await db.organizationMember.findFirst({
		where: { userId: user.id },
		orderBy: { createdAt: "asc" },
		select: { role: true },
	});
	if (!membership) redirect("/login");
	const canManage = membership.role === "OWNER" || membership.role === "ADMIN";
	return <GoalsView canManage={canManage} />;
}

export const dynamic = "force-dynamic";
