import { redirect } from "next/navigation";
import { currentUser, ForbiddenError } from "@/server/auth";
import { db } from "@/server/db";
import { getServerT } from "@/lib/i18n/server";
import { DepartmentsView } from "@/components/departments-view";

/** Company departments — the company's pools; everyone reads, OWNER/ADMIN manage. */
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

  return <DepartmentsView me={{ role: membership.role, id: user.id }} />;
}

export const dynamic = "force-dynamic";
