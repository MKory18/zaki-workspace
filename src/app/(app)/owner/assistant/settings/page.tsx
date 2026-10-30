import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { SettingsForm } from "@/components/owner-assistant/settings-form";
import { NotFoundError } from "@/server/auth";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { MODEL_CHOICES, getSettings, usageSummary } from "@/server/services/owner-assistant-settings";

/**
 * «مساعد المالك» — the settings, /owner/assistant/settings. The OWNER alone, else «not found». The page is handed `hasKey` and the last
 * four characters and nothing else about the key: it is write-only (the cipher is never selected for a page).
 */
export default async function OwnerAssistantSettingsPage() {
  const { actor } = await pageActor();
  const access = await assistantAccess(actor).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const settings = await getSettings(access.orgId);
  return <SettingsForm settings={settings} usage={await usageSummary(access.orgId, settings)} models={MODEL_CHOICES} />;
}

export const dynamic = "force-dynamic";
