import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <AppShell user={user}>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </AppShell>
  );
}
