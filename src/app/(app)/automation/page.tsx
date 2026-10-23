import { Suspense } from "react";
import { pageActor, presentedRole } from "@/app/(app)/_access";
import { AutomationView } from "@/components/automation-view";

export default async function AutomationPage() {
  const { actor } = await pageActor();

  // The view shows its management controls to an OWNER or an ADMIN: here that is whoever holds the
  // `integrations.manage` switch (the server decides again on every request).
  return (
    <Suspense fallback={null}>
      <AutomationView ctx={{ orgRole: presentedRole(actor, "integrations.manage") }} />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";
