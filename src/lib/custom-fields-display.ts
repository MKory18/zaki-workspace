/**
 * «حقول مخصصة» — a value read aloud as the short text of a chip or a cell (pure: the server builds the cells of a page with it,
 * the editors show the same words). Western digits, Arabic names, theme-token colours: the same rules as every other screen.
 */
import { AR } from "./i18n/dict";
import { fmtDMY } from "./format";
import { fmtReward } from "./rewards";
import { optionLabel, type FieldColor, type FieldDefDto } from "./custom-fields";

export interface FieldCell {
  /** The field's label (the chip's small caption). */
  label: string;
  text: string;
  /** Only a choice has one. */
  color?: FieldColor;
}

/** «12 أيار 2026» for a stored day (`YYYY-MM-DD`): built from its own parts, so no zone can move it. */
export function fmtDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return "";
  return fmtDMY(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

const CHIP_TEXT_MAX = 40;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > CHIP_TEXT_MAX ? `${flat.slice(0, CHIP_TEXT_MAX - 1)}…` : flat;
}

/** The host of an address («example.com»), the way a link chip says it. */
export function linkHost(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A grouped decimal text with commas in the whole part («12,500.5»): the exact text, never a float. */
export function fmtDecimalText(text: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(text);
  if (!m) return text;
  return `${m[1]}${(m[2] as string).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${m[3] ?? ""}`;
}

/** The chip of a value, or null when there is nothing to show. `names` maps a person's id to their name. */
export function cellOf(def: FieldDefDto, value: unknown, names: ReadonlyMap<string, string> = new Map()): FieldCell | null {
  if (value === undefined || value === null) return null;
  const base = { label: def.label };
  switch (def.type) {
    case "TEXT":
    case "LONG_TEXT":
      return typeof value === "string" && value.trim() ? { ...base, text: clip(value) } : null;
    case "LINK":
      return typeof value === "string" && value ? { ...base, text: linkHost(value) || clip(value) } : null;
    case "NUMBER":
      return typeof value === "string" ? { ...base, text: `${fmtDecimalText(value)}${def.unit ? ` ${def.unit}` : ""}` } : null;
    case "MONEY":
      return typeof value === "number" ? { ...base, text: fmtReward(value, def.currency) || String(value) } : null;
    case "DATE":
      return typeof value === "string" && fmtDay(value) ? { ...base, text: fmtDay(value) } : null;
    case "BOOLEAN":
      return typeof value === "boolean" ? { ...base, text: AR[value ? "fields.yes" : "fields.no"] ?? "" } : null;
    case "PERSON":
      return typeof value === "string" ? { ...base, text: names.get(value) ?? AR["fields.person_gone"] ?? "" } : null;
    case "SINGLE_CHOICE": {
      if (typeof value !== "string") return null;
      const o = optionLabel(def.options, value, AR["fields.deleted"] ?? "");
      return { ...base, text: o.label, color: o.color };
    }
    case "MULTI_CHOICE": {
      if (!Array.isArray(value) || value.length === 0) return null;
      const parts = value.filter((v): v is string => typeof v === "string").map((id) => optionLabel(def.options, id, AR["fields.deleted"] ?? ""));
      return parts.length ? { ...base, text: parts.map((p) => p.label).join("، "), color: parts[0]!.color } : null;
    }
  }
}
