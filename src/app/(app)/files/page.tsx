import { redirect } from "next/navigation";
import { currentUser, ForbiddenError } from "@/server/auth";
import { db } from "@/server/db";
import { getServerT } from "@/lib/i18n/server";
import { FilesView } from "@/components/files-view";

/** Org-wide file library — versions, previews, permission-checked downloads. */
export default async function FilesPage() {
  const { t } = await getServerT();
  const user = await currentUser();
  if (!user) redirect("/login");

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (!membership) throw new ForbiddenError("not_org_member");

  return <FilesView me={{ id: user.id, role: membership.role }} />;
}

export const dynamic = "force-dynamic";
