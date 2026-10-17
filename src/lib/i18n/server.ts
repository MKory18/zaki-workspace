import ar from "./ar.json";

const DICT: Record<string, string> = ar;

export type ServerT = (key: string, vars?: Record<string, string | number>) => string;

/** Server-side translator. Arabic is the only supported language. */
export function getServerT(_locale?: string): { t: ServerT; locale: "ar" } {
	const t: ServerT = (key, vars) => {
		let s = DICT[key] ?? key;
		if (vars) {
			for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
		}
		return s;
	};
	return { t, locale: "ar" };
}
