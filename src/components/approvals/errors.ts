import { ApiError } from "@/lib/api-client";

/**
 * The Arabic line for a refused request: the reason inside a 422's details (a dictionary key), else the answer's own message
 * (a 403, 404 or 409 carries its key), else the generic one. A key the dictionary does not know is never printed raw.
 */
export function errorText(err: unknown, t: (key: string) => string): string {
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

/** The field a 422 is about (`fields.2.options`, a field id such as `f3`, `title`…), when it names one. */
export function errorPath(err: unknown): string | null {
  if (err instanceof ApiError && Array.isArray(err.details)) {
    const first = err.details[0] as { path?: string } | undefined;
    return first?.path ?? null;
  }
  return null;
}
