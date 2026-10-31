import { ApiError } from "@/lib/api-client";

/** The Arabic line for a failed request of «الأداء والتطوير»: the first message key the server sent that the dictionary knows. */
export function devErrorText(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    const detail = Array.isArray(err.details) ? (err.details[0] as { message?: string } | undefined)?.message : undefined;
    for (const key of [detail, err.messageKey]) {
      if (!key) continue;
      const text = t(key);
      if (text !== key) return text;
    }
  }
  return t("common.error");
}
