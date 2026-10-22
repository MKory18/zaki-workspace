import { redirect } from "next/navigation";
import { currentUser, ForbiddenError } from "@/server/auth";
import { db } from "@/server/db";
import { getServerT } from "@/lib/i18n/server";
import { DepartmentsView } from "@/components/departments-view";

/**
 * Company departments — the company's pools; every org member reads, OWNER/ADMIN
 * manage. A guest gets only a notice: the page is the staff directory and the
 * API refuses guests (403), so the view is not even rendered for them.
 */
export default async function DepartmentsPage() {
  const { t } = await getServerT();
  const user = await currentUser();
  if (!user) redirect("/login");

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (!membership) throw new ForbiddenError("not_org_member");

  if (membership.role === "GUEST") {
    return (
      <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">
        {t("guest.no_access")}
      </div>
    );
  }

  return <DepartmentsView me={{ role: membership.role, id: user.id }} />;
}

export const dynamic = "force-dynamic";
