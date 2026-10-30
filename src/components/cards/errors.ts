import { AR } from "@/lib/i18n/dict";
import { ApiError } from "@/lib/api-client";

/**
 * The dictionary key that explains a failed request: the first validation message the server gave, else the key it
 * answered with, else a plain sentence from the status. Every key shown has an Arabic sentence (never the raw key).
 */
export function cardErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    const first = Array.isArray(err.details) ? (err.details[0] as { message?: unknown } | undefined)?.message : undefined;
    if (typeof first === "string" && first in AR) return first;
    if (err.messageKey && err.messageKey in AR) return err.messageKey;
    if (err.status === 404) return "cards.not_found";
    if (err.status === 403) return "forbidden";
  }
  return "common.error";
}
