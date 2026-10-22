import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  // An external partner (org GUEST) is not offered the areas that are closed to guests.
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { role: true },
  });
  return (
    <AppShell user={user} isGuest={membership?.role === "GUEST"}>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </AppShell>
  );
}
