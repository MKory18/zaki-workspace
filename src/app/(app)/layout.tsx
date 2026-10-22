import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  // Behind the middleware, which only sees the cookie: the owner may have raised the notice
  // version (or reset the password) after the cookie was issued. The database decides.
  if (user.mustChangePassword || user.transparencyPending) redirect("/onboarding");
  // An external partner (org GUEST) is not offered the areas that are closed to guests.
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { role: true },
  });
  return (
    <AppShell user={user} isGuest={membership?.role === "GUEST"}>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </AppShell>
  );
}
