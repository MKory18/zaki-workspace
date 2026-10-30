import { NextResponse } from "next/server";
import { noStore, readJson, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { MODEL_CHOICES, getSettings, updateSettings, usageSummary } from "@/server/services/owner-assistant-settings";

/**
 * «مساعد المالك» — the settings: the model id, the daily message limit, the monthly token budget and the two privacy switches.
 * OWNER ONLY (404 for anybody else, and for everybody while the feature is off). The answer says whether a key is saved and its
 * last four characters; the key itself is never in it (it has its own write-only route, /api/owner-assistant/key).
 */
export async function GET() {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    const settings = await getSettings(access.orgId);
    return NextResponse.json({ settings, usage: await usageSummary(access.orgId, settings), models: MODEL_CHOICES }, noStore);
  });
}

export async function PUT(req: Request) {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    const settings = await updateSettings(access, await readJson(req));
    return NextResponse.json({ settings, usage: await usageSummary(access.orgId, settings), models: MODEL_CHOICES }, noStore);
  });
}
