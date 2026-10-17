import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { getServerT } from "@/lib/i18n/server";
import { OrgMembersView } from "@/components/org-members-view";
import { ForbiddenError } from "@/server/auth";

/** الأعضاء — org roster management (OWNER/ADMIN); members get an honest notice. */
export default async function MembersPage() {
  const { t } = getServerT();
  const user = await currentUser();
  if (!user) redirect("/login");
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (!membership) redirect("/login");
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-border bg-surface-1 p-8 text-center">
          <h1 className="text-base font-semibold text-fg">{t("orgm.title")}</h1>
          <p className="mt-2 text-sm text-fg-muted">{t("orgm.members_only")}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <OrgMembersView orgId={membership.organizationId} actorRole={membership.role as "OWNER" | "ADMIN"} />
    </div>
  );
}

export const dynamic = "force-dynamic";
