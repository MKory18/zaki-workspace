import { NextResponse } from "next/server";
import { ValidationError } from "@/server/auth";
import { noStore, readJson, withAssistantApi } from "@/server/ai/api";
import { requireActor } from "@/server/policy/actor";
import { assistantAccess } from "@/server/services/owner-assistant-access";
import { removeKey, saveKey } from "@/server/services/owner-assistant-settings";

/**
 * «مساعد المالك» — THE KEY, WRITE-ONLY. The owner types his own key here; it is encrypted at rest and never returned: the answer
 * is `{ hasKey, keyLast4 }` and nothing more, and no other route, page or log line carries it. A bad key is refused with a
 * sentence that does not repeat what was sent.
 *
 *   PUT     { key }   save or replace
 *   DELETE            «احذف المفتاح»
 */
export async function PUT(req: Request) {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    const body = await readJson(req);
    const key = body && typeof body === "object" ? (body as { key?: unknown }).key : undefined;
    if (typeof key !== "string") throw new ValidationError([{ path: "key", message: "assistant.key_invalid" }]);
    const settings = await saveKey(access, key);
    return NextResponse.json({ hasKey: settings.hasKey, keyLast4: settings.keyLast4 }, noStore);
  });
}

export async function DELETE() {
  return withAssistantApi(async () => {
    const access = await assistantAccess(await requireActor());
    const settings = await removeKey(access);
    return NextResponse.json({ hasKey: settings.hasKey, keyLast4: settings.keyLast4 }, noStore);
  });
}
