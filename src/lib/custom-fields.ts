/**
 * «حقول مخصصة» — the custom fields of a project's tasks, pure (no React, no server imports): the types and their limits,
 * the validation of a value (the server's door AND the editor's), the exact decimal arithmetic, and how a value is read aloud.
 *
 * ONE canonical shape of a value travels everywhere (the editor, the request, the answer):
 *   TEXT, LONG_TEXT, LINK ........ string
 *   NUMBER ....................... a decimal STRING ("12.5"): never a float that is added or compared
 *   DATE ......................... "YYYY-MM-DD" (a calendar day, no zone)
 *   SINGLE_CHOICE ................ the option's id
 *   MULTI_CHOICE ................. an array of option ids
 *   BOOLEAN ...................... true | false
 *   PERSON ....................... the person's user id
 *   MONEY ........................ an integer count of MINOR units (cents); the currency belongs to the field
 * `toStored` cuts it into the typed columns of `TaskFieldValue`; `fromStored` joins them back.
 *
 * NUMBERS ARE EXACT. A number has at most 12 digits before the point and 4 after; it is kept as text, stored as a DECIMAL and
 * added with BigInt in units of 1/10 000 (`addDecimals`): 0.1 + 0.2 is 0.3, always.
 */
import { REWARD_CURRENCIES } from "./rewards";

export const FIELD_TYPES = ["TEXT", "LONG_TEXT", "NUMBER", "DATE", "SINGLE_CHOICE", "MULTI_CHOICE", "BOOLEAN", "PERSON", "LINK", "MONEY"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Fields a project may have at once (an archived field does not count: archiving frees the slot, and keeps the values). */
export const MAX_ACTIVE_FIELDS = 15;
/** Every field a project ever had, archived ones included: a bound so the table cannot be filled one archive at a time. */
export const MAX_TOTAL_FIELDS = 60;
export const MAX_LABEL = 60;
export const MAX_TEXT = 200;
export const MAX_LONG_TEXT = 2000;
export const MAX_LINK = 2000;
export const MAX_UNIT = 20;
export const MAX_OPTIONS = 30;
/** Options a field ever had (deleted ones are kept so their ids keep reading «محذوف»). */
export const MAX_OPTIONS_STORED = 120;
export const MAX_OPTION_LABEL = 40;
export const MAX_INT_DIGITS = 12;
export const MAX_FRACTION_DIGITS = 4;
export const MAX_MONEY_MINOR = 999_999_999_999;
/** How many fields the list and the board show on a row. */
export const MAX_CHIP_FIELDS = 3;

/** The theme tokens an option may wear: `text-<token>` on `bg-<token>/10`. A fixed set, never a hex value. */
export const FIELD_COLORS = ["muted", "accent", "ok", "warn", "danger", "info", "cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"] as const;
export type FieldColor = (typeof FIELD_COLORS)[number];

/** The class pair of a colour token, written out in full so Tailwind sees every one of them. */
export const COLOR_CLASS: Readonly<Record<FieldColor, string>> = {
  muted: "bg-surface-2 text-fg-muted",
  accent: "bg-accent/10 text-accent",
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/10 text-warn",
  danger: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info",
  "cat-1": "bg-cat-1/10 text-cat-1",
  "cat-2": "bg-cat-2/10 text-cat-2",
  "cat-3": "bg-cat-3/10 text-cat-3",
  "cat-4": "bg-cat-4/10 text-cat-4",
  "cat-5": "bg-cat-5/10 text-cat-5",
  "cat-6": "bg-cat-6/10 text-cat-6",
};

export const FILTER_TYPES: readonly FieldType[] = ["SINGLE_CHOICE", "BOOLEAN", "PERSON"];
export const SORT_TYPES: readonly FieldType[] = ["NUMBER", "DATE"];

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}
export function isFieldColor(value: unknown): value is FieldColor {
  return typeof value === "string" && (FIELD_COLORS as readonly string[]).includes(value);
}
export const isChoice = (type: string): boolean => type === "SINGLE_CHOICE" || type === "MULTI_CHOICE";

// ---------- the definition ----------

export interface FieldOption {
  id: string;
  label: string;
  color: FieldColor;
  /** Taken away: it can no longer be picked, and the values that hold its id read «محذوف». */
  deleted?: boolean;
}

export interface FieldConfig {
  unit?: string;
  currency?: string;
  options?: FieldOption[];
}

export interface FieldDef {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  archived: boolean;
  config: FieldConfig;
}

/** What a screen is handed of a field. */
export interface FieldDefDto {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  archived: boolean;
  unit: string | null;
  currency: string | null;
  options: FieldOption[];
}

/** The stored `config` JSON, read defensively (a broken one reads as empty, never throws). */
export function readConfig(raw: unknown): FieldConfig {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: FieldConfig = {};
  if (typeof r["unit"] === "string") out.unit = r["unit"];
  if (typeof r["currency"] === "string") out.currency = r["currency"];
  if (Array.isArray(r["options"])) {
    out.options = r["options"].flatMap((o): FieldOption[] => {
      if (!o || typeof o !== "object") return [];
      const x = o as Record<string, unknown>;
      if (typeof x["id"] !== "string" || typeof x["label"] !== "string") return [];
      return [{ id: x["id"], label: x["label"], color: isFieldColor(x["color"]) ? x["color"] : "muted", ...(x["deleted"] === true ? { deleted: true } : {}) }];
    });
  }
  return out;
}

export function toDefDto(row: { id: string; label: string; type: string; required: boolean; archived: boolean; config: unknown }): FieldDefDto {
  const config = readConfig(row.config);
  return {
    id: row.id,
    label: row.label,
    type: isFieldType(row.type) ? row.type : "TEXT",
    required: row.required,
    archived: row.archived,
    unit: config.unit ?? null,
    currency: config.currency ?? null,
    options: config.options ?? [],
  };
}

// ---------- validating a definition ----------

export interface Problem {
  ok: false;
  key: string;
  path: string;
}
export type Checked<T> = { ok: true; value: T } | Problem;
const bad = (key: string, path: string): Problem => ({ ok: false, key, path });

function stripControl(text: string, keepNewlines: boolean): string {
  // eslint-disable-next-line no-control-regex
  return keepNewlines ? text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") : text.replace(/[\u0000-\u001F\u007F]/g, " ");
}

export function cleanLabel(raw: unknown): Checked<string> {
  if (typeof raw !== "string") return bad("fields.label_required", "label");
  const label = stripControl(raw, false).replace(/\s+/g, " ").trim();
  if (!label) return bad("fields.label_required", "label");
  if (label.length > MAX_LABEL) return bad("fields.label_long", "label");
  return { ok: true, value: label };
}

export function cleanUnit(raw: unknown): Checked<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return bad("fields.unit_long", "unit");
  const unit = stripControl(raw, false).replace(/\s+/g, " ").trim();
  if (unit.length > MAX_UNIT) return bad("fields.unit_long", "unit");
  return { ok: true, value: unit || null };
}

export interface OptionInput {
  id?: string | undefined;
  label: string;
  color?: string | undefined;
}

/**
 * The options a choice field ends up with, from the list the person sent and the ones already stored. An option that is in the
 * list keeps its id (a new one gets `newId()`); an option that is stored and no longer listed is KEPT, marked deleted — so a value
 * that holds its id still reads «محذوف». At most `MAX_OPTIONS` stay live, with distinct labels.
 */
export function mergeOptions(stored: readonly FieldOption[], sent: readonly OptionInput[], newId: () => string): Checked<FieldOption[]> {
  const known = new Map(stored.map((o) => [o.id, o]));
  const live: FieldOption[] = [];
  const seenLabels = new Set<string>();
  const seenIds = new Set<string>();
  for (const [i, o] of sent.entries()) {
    const label = stripControl(String(o.label ?? ""), false).replace(/\s+/g, " ").trim();
    if (!label) return bad("fields.option_label_required", `options.${i}.label`);
    if (label.length > MAX_OPTION_LABEL) return bad("fields.option_label_long", `options.${i}.label`);
    if (seenLabels.has(label)) return bad("fields.option_duplicate", `options.${i}.label`);
    seenLabels.add(label);
    const color = o.color === undefined ? "muted" : o.color;
    if (!isFieldColor(color)) return bad("fields.option_color_invalid", `options.${i}.color`);
    // an id that is not one of this field's own is not trusted: it is a new option
    const id = o.id && known.has(o.id) && !seenIds.has(o.id) ? o.id : newId();
    seenIds.add(id);
    live.push({ id, label, color });
  }
  if (live.length > MAX_OPTIONS) return bad("fields.options_too_many", "options");
  const dropped = stored.filter((o) => !seenIds.has(o.id)).map((o) => ({ ...o, deleted: true as const }));
  const all = [...live, ...dropped];
  if (all.length > MAX_OPTIONS_STORED) return bad("fields.options_too_many", "options");
  return { ok: true, value: all };
}

export function isCurrency(value: unknown): value is string {
  return typeof value === "string" && (REWARD_CURRENCIES as readonly string[]).includes(value);
}

// ---------- the exact decimal ----------

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const SCALE = 4;
const UNIT = BigInt(10 ** SCALE);

/** Digits of any script to 0-9, the Arabic decimal mark to ".", thousands marks and spaces dropped. */
export function westernDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[٬,\s]/g, "");
}

/** A typed number, cut into whole and fraction digits, as text with no trailing zeros: "0.10" -> "0.1", "-0" -> "0". `null` = not a number. */
export function normalizeDecimal(input: unknown): string | null {
  let text: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    text = String(input);
    // 1e21 and 1e-7 print with an exponent: those are not numbers a person typed
    if (/e/i.test(text)) return null;
  } else if (typeof input === "string") {
    text = westernDigits(input.trim());
  } else return null;
  const m = /^(-?)(\d{1,12})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const whole = (m[2] as string).replace(/^0+(?=\d)/, "");
  const fraction = (m[3] ?? "").replace(/0+$/, "");
  const negative = m[1] === "-" && (whole !== "0" || fraction !== "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** A normalized decimal to a BigInt count of 1/10 000. */
export function decimalToUnits(text: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error("decimal");
  const units = BigInt(m[2] as string) * UNIT + BigInt(((m[3] ?? "") + "0000").slice(0, SCALE));
  return m[1] === "-" ? -units : units;
}

export function unitsToDecimal(units: bigint): string {
  const negative = units < BigInt(0);
  const abs = negative ? -units : units;
  const whole = abs / UNIT;
  const fraction = String(abs % UNIT).padStart(SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** The exact sum of decimals (text): 0.1 + 0.2 = "0.3". A value that is not a decimal is skipped. */
export function sumDecimals(values: readonly (string | null | undefined)[]): string {
  let total = BigInt(0);
  for (const v of values) {
    const n = v == null ? null : normalizeDecimal(v);
    if (n !== null) total += decimalToUnits(n);
  }
  return unitsToDecimal(total);
}
export const addDecimals = (a: string, b: string): string => sumDecimals([a, b]);

// ---------- a value ----------

/** The typed columns of `TaskFieldValue` (a column left out is null). */
export interface StoredValue {
  valueText: string | null;
  valueNumber: string | null;
  valueDate: string | null;
  valueJson: unknown;
}
const EMPTY: StoredValue = { valueText: null, valueNumber: null, valueDate: null, valueJson: null };

/** What a row of the table holds, in the columns' own types (the date as `YYYY-MM-DD`, the number as the decimal's text). */
export interface StoredRow {
  valueText: string | null;
  valueNumber: { toString(): string } | string | null;
  valueDate: Date | string | null;
  valueJson: unknown;
}

export type Checked2 = { ok: true; empty: true } | { ok: true; empty: false; stored: StoredValue } | Problem;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isValidDay(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const m = DAY.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** https only, a real host, no credentials in the address, no spaces or control characters. */
export function isHttpsLink(text: string): boolean {
  if (text.length > MAX_LINK || /[\s\u0000-\u001F\u007F]/.test(text)) return false;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.length > 0 && url.username === "" && url.password === "";
}

/**
 * A value a person typed, checked against its field. `empty` means «clear it» (the box was emptied). The problem carries the
 * dictionary key to show. PERSON is only shape-checked here: that the person is ACTIVE, not a guest and in the space is the
 * server's to read from the database (`assertPersonInSpace`).
 */
export function validateValue(field: Pick<FieldDef, "type" | "config">, raw: unknown): Checked2 {
  const empty = { ok: true as const, empty: true as const };
  const path = "value";
  if (raw === null || raw === undefined) return empty;
  const options = field.config.options ?? [];
  switch (field.type) {
    case "TEXT":
    case "LONG_TEXT": {
      if (typeof raw !== "string") return bad("fields.value_invalid", path);
      const long = field.type === "LONG_TEXT";
      const text = stripControl(raw, long).replace(long ? /[ \t]+$/gm : /\s+/g, long ? "" : " ").trim();
      if (!text) return empty;
      if (text.length > (long ? MAX_LONG_TEXT : MAX_TEXT)) return bad(long ? "fields.long_text_long" : "fields.text_long", path);
      return { ok: true, empty: false, stored: { ...EMPTY, valueText: text } };
    }
    case "NUMBER": {
      if (typeof raw === "string" && raw.trim() === "") return empty;
      const n = normalizeDecimal(raw);
      if (n === null) return bad("fields.number_invalid", path);
      return { ok: true, empty: false, stored: { ...EMPTY, valueNumber: n } };
    }
    case "MONEY": {
      let minor: unknown = raw;
      if (typeof raw === "object" && !Array.isArray(raw)) {
        const o = raw as { amountMinor?: unknown; currency?: unknown };
        // a currency sent along must be the field's own: a value is never kept in another currency
        if (o.currency !== undefined && o.currency !== field.config.currency) return bad("fields.currency_mismatch", path);
        minor = o.amountMinor;
      }
      if (typeof minor === "string" && minor.trim() === "") return empty;
      if (typeof minor === "string" && /^\d{1,12}$/.test(minor.trim())) minor = Number(minor.trim());
      if (typeof minor !== "number" || !Number.isInteger(minor) || minor < 0) return bad("fields.money_invalid", path);
      if (minor > MAX_MONEY_MINOR) return bad("fields.money_big", path);
      if (!isCurrency(field.config.currency)) return bad("fields.currency_invalid", path);
      return { ok: true, empty: false, stored: { ...EMPTY, valueNumber: String(minor) } };
    }
    case "DATE": {
      if (typeof raw === "string" && raw.trim() === "") return empty;
      if (!isValidDay(raw)) return bad("fields.date_invalid", path);
      return { ok: true, empty: false, stored: { ...EMPTY, valueDate: raw } };
    }
    case "SINGLE_CHOICE": {
      if (typeof raw === "string" && raw === "") return empty;
      if (typeof raw !== "string" || !options.some((o) => o.id === raw && !o.deleted)) return bad("fields.option_invalid", path);
      return { ok: true, empty: false, stored: { ...EMPTY, valueText: raw } };
    }
    case "MULTI_CHOICE": {
      if (!Array.isArray(raw)) return bad("fields.value_invalid", path);
      const ids = [...new Set(raw)];
      if (ids.length === 0) return empty;
      if (ids.length > MAX_OPTIONS || ids.some((id) => typeof id !== "string" || !options.some((o) => o.id === id && !o.deleted))) {
        return bad("fields.option_invalid", path);
      }
      return { ok: true, empty: false, stored: { ...EMPTY, valueJson: ids } };
    }
    case "BOOLEAN": {
      if (typeof raw !== "boolean") return bad("fields.value_invalid", path);
      return { ok: true, empty: false, stored: { ...EMPTY, valueNumber: raw ? "1" : "0" } };
    }
    case "PERSON": {
      if (typeof raw === "string" && raw === "") return empty;
      if (typeof raw !== "string" || raw.length > 64 || !/^[A-Za-z0-9_-]+$/.test(raw)) return bad("fields.person_invalid", path);
      return { ok: true, empty: false, stored: { ...EMPTY, valueText: raw } };
    }
    case "LINK": {
      if (typeof raw !== "string") return bad("fields.value_invalid", path);
      const text = raw.trim();
      if (!text) return empty;
      if (!isHttpsLink(text)) return bad("fields.link_invalid", path);
      return { ok: true, empty: false, stored: { ...EMPTY, valueText: text } };
    }
  }
}

function dayOf(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** The canonical value a stored row stands for (see the top of this file). `undefined` = the row holds nothing for this type. */
export function fromStored(type: FieldType, row: StoredRow): unknown {
  switch (type) {
    case "TEXT":
    case "LONG_TEXT":
    case "LINK":
    case "SINGLE_CHOICE":
    case "PERSON":
      return row.valueText ?? undefined;
    case "NUMBER":
      return row.valueNumber == null ? undefined : normalizeDecimal(row.valueNumber.toString()) ?? undefined;
    case "MONEY":
      return row.valueNumber == null ? undefined : Number(normalizeDecimal(row.valueNumber.toString()) ?? 0);
    case "BOOLEAN":
      return row.valueNumber == null ? undefined : Number(row.valueNumber.toString()) === 1;
    case "DATE":
      return row.valueDate == null ? undefined : dayOf(row.valueDate);
    case "MULTI_CHOICE":
      return Array.isArray(row.valueJson) ? (row.valueJson as unknown[]).filter((x): x is string => typeof x === "string") : undefined;
  }
}

/** Is there an answer in this row? (A yes/no stored as «no» IS an answer; a blank text is not.) */
export function isFilled(type: FieldType, row: StoredRow | undefined | null): boolean {
  if (!row) return false;
  const v = fromStored(type, row);
  if (v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// ---------- reading a value aloud ----------

/** The label of an option, or «محذوف» for an id the field no longer lists live. */
export function optionLabel(options: readonly FieldOption[], id: string, deletedText: string): { label: string; color: FieldColor; deleted: boolean } {
  const o = options.find((x) => x.id === id);
  if (!o) return { label: deletedText, color: "muted", deleted: true };
  return o.deleted ? { label: deletedText, color: "muted", deleted: true } : { label: o.label, color: o.color, deleted: false };
}

/** What the fields-bearing order of a task row is: the fields in the project's order, archived ones left out. */
export function liveFields<T extends { archived: boolean }>(fields: readonly T[]): T[] {
  return fields.filter((f) => !f.archived);
}

/** The labels of the required fields that hold no answer (for the 422 and for the editor that opens). */
export function missingRequired(
  fields: readonly { id: string; label: string; type: FieldType; required: boolean; archived: boolean }[],
  rows: ReadonlyMap<string, StoredRow>,
): { id: string; label: string }[] {
  return fields.filter((f) => f.required && !f.archived && !isFilled(f.type, rows.get(f.id))).map((f) => ({ id: f.id, label: f.label }));
}

/** Where the task's page opens its card (the address a refused completion sends the person to). */
export const FIELDS_ANCHOR = "custom-fields";

/** The answer of a refused completion, read back on the screen: the labels of what is missing, or null for any other error. */
export function requiredFieldsOf(err: unknown): { id: string; label: string }[] | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { status?: unknown; messageKey?: unknown; details?: unknown };
  if (e.status !== 422 || e.messageKey !== "fields.required") return null;
  const d = e.details as { missing?: unknown } | undefined;
  if (!d || !Array.isArray(d.missing)) return [];
  return d.missing.flatMap((m) => (m && typeof m === "object" && typeof (m as { label?: unknown }).label === "string" ? [{ id: String((m as { id?: unknown }).id ?? ""), label: (m as { label: string }).label }] : []));
}
