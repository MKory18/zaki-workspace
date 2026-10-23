import { Suspense } from "react";
import { pageActor, presentedRole } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { AutomationView } from "@/components/automation-view";

export default async function AutomationPage() {
  const { actor } = await pageActor();
  // staff only on the map (its routes already refuse a guest): the notice, not an empty automation view
  if (refusedToGuest(actor, "automation")) return <GuestNotice />;

  // The view shows its management controls to an OWNER or an ADMIN: here that is whoever holds the
  // `integrations.manage` switch (the server decides again on every request).
  return (
    <Suspense fallback={null}>
      <AutomationView ctx={{ orgRole: presentedRole(actor, "integrations.manage") }} />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";
