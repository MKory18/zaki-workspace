import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { CrmView } from "@/components/crm-view";

export default async function CrmPage() {
	const user = await currentUser();
	if (!user) redirect("/login");
	const membership = await db.organizationMember.findFirst({
		where: { userId: user.id },
		select: { organizationId: true },
	});
	if (!membership) redirect("/onboarding");
	return <CrmView />;
}

export const dynamic = "force-dynamic";
