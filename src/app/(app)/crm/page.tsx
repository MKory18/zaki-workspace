import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { getServerT } from "@/lib/i18n/server";
import { CrmView } from "@/components/crm-view";

/**
 * CRM is staff-only: its API answers 403 to an external partner (guest), so the
 * view is not rendered for them — they get a notice instead of a page that never loads.
 */
export default async function CrmPage() {
	const { t } = getServerT();
	const user = await currentUser();
	if (!user) redirect("/login");
	const membership = await db.organizationMember.findFirst({
		where: { userId: user.id },
		orderBy: { createdAt: "asc" },
		select: { organizationId: true, role: true },
	});
	if (!membership) redirect("/onboarding");
	if (membership.role === "GUEST") {
		return (
			<div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">
				{t("guest.no_access")}
			</div>
		);
	}
	return <CrmView />;
}

export const dynamic = "force-dynamic";
