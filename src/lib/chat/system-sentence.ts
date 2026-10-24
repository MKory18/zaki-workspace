import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";

/**
 * The Arabic line of a system message («تثبيت رسالة بواسطة سارة») from its `{k, p}` and its author.
 * One place for the conversation screen and the chat home's last-message preview, so neither ever
 * shows the raw JSON a system row keeps in `body`. An unknown key reads as a neutral update.
 */
export function systemSentence(meta: { k: string } | null | undefined, name: string): string {
  const key = meta ? `chatc.sys.${meta.k}` : "";
  const template = (key && AR[key]) || AR["chatc.sys.other"] || "";
  return interpolate(template, { name });
}

/** `systemSentence` straight from a stored row's `body` (the JSON `{k, p}`); unparsable reads as an update. */
export function systemSentenceOfBody(body: string, name: string): string {
  try {
    const meta = JSON.parse(body) as { k?: unknown };
    return systemSentence(typeof meta?.k === "string" ? { k: meta.k } : null, name);
  } catch {
    return systemSentence(null, name);
  }
}
