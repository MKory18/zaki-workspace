import { AR } from "./dict";
import { interpolate } from "./interpolate";

const DICT: Record<string, string> = AR;

export type ServerT = (key: string, vars?: Record<string, string | number>) => string;

/** Server-side translator. Arabic is the only supported language. */
export function getServerT(_locale?: string): { t: ServerT; locale: "ar" } {
	const t: ServerT = (key, vars) => interpolate(DICT[key] ?? key, vars);
	return { t, locale: "ar" };
}
