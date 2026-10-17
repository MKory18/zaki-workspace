import { redirect } from "next/navigation";
import { Suspense } from "react";
import { currentUser, ForbiddenError } from "@/server/auth";
import { db } from "@/server/db";
import { AutomationView } from "@/components/automation-view";

export default async function AutomationPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { role: true },
  });
  if (!membership) throw new ForbiddenError("not_org_member");

  return <Suspense fallback={null}><AutomationView ctx={{ orgRole: membership.role }} /></Suspense>;
}

export const dynamic = "force-dynamic";
