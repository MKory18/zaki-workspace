/**
 * «حقول مخصصة» on the screen, pure: which fields a person chose to see on every row (kept in this browser only), and where
 * a dragged field landed. No React and no browser objects here: the screens read and write the browser's storage themselves,
 * inside a try/catch (it can be blocked or full), and hand the text to these.
 */
import { MAX_CHIP_FIELDS } from "./custom-fields";

/** The one key of the browser's storage that holds the chosen fields (a JSON list of field ids). */
export const CHOSEN_KEY = "zk.customFields.chips.v1";

/** The chosen field ids from the stored text: only strings, no repeats, at most `MAX_CHIP_FIELDS`. A broken value is «none». */
export function parseChosen(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    const ids = raw.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64);
    return [...new Set(ids)].slice(0, MAX_CHIP_FIELDS);
  } catch {
    return [];
  }
}

/** The choice after one box is ticked or cleared: a fourth tick is refused (the list is returned as it was). */
export function toggleChosen(current: readonly string[], id: string): string[] {
  if (current.includes(id)) return current.filter((x) => x !== id);
  if (current.length >= MAX_CHIP_FIELDS) return [...current];
  return [...current, id];
}

/**
 * After a drag, the field that moved and the one it now sits right after (`null`: first) — what `PATCH …/fields/<id>` takes
 * (`afterId`). `null` when the order did not change or the two lists are not the same ids.
 */
export function movedAfter(before: readonly string[], after: readonly string[]): { id: string; afterId: string | null } | null {
  if (before.length !== after.length || before.length < 2) return null;
  const at = before.findIndex((id, i) => id !== after[i]);
  if (at < 0) return null;
  const candidates = [after[at] as string, before[at] as string];
  for (const id of candidates) {
    const a = before.filter((x) => x !== id);
    const b = after.filter((x) => x !== id);
    if (a.length === b.length && a.every((x, i) => x === b[i]) && after.includes(id)) {
      const to = after.indexOf(id);
      return { id, afterId: to === 0 ? null : (after[to - 1] as string) };
    }
  }
  return null;
}
