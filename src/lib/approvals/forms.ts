/**
 * «نموذج» — the pure part: what a form template may contain, how an answer is checked against it, and how the answers are
 * written out as labelled lines.
 *
 * Pure (no React, no Next, no server imports). A form is DATA, never code: six field types, a fixed list of properties per
 * type, and any property outside that list is refused — there is nowhere to put a script, a formula, a default expression or
 * a file. A template is edited by adding a new version (the service), so a request keeps exactly the questions it was filled with.
 */
import { AR } from "@/lib/i18n/dict";
import { fmtDMY } from "@/lib/format";
import { APPROVAL_LIMITS } from "./shared";

export const FIELD_TYPES = ["text", "textarea", "number", "date", "choice", "yesno"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FORM_LIMITS = {
  fields: 20,
  options: 20,
  name: 80,
  description: 300,
  label: 80,
  option: 80,
  text: 200,
  textarea: 1000,
  /** A number answer is bounded so a typo cannot be a 30-digit value. */
  numberAbs: 1_000_000_000_000,
} as const;

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  /** `choice` only: two to twenty distinct options. */
  options?: string[];
  /** `number` only. */
  min?: number;
  max?: number;
}

export interface FormSchema {
  fields: FormField[];
  /** The preset chain: one to three people, in order. */
  approvers: string[];
}

export type AnswerValue = string | number | boolean;
export type Answers = Record<string, AnswerValue>;

export interface Issue {
  path: string;
  message: string;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

const FIELD_ID = /^[a-z][a-z0-9_]{0,23}$/;
const SCHEMA_KEYS = new Set(["fields", "approvers"]);
const COMMON_KEYS = ["id", "type", "label", "required"];
const KEYS_BY_TYPE: Record<FieldType, string[]> = {
  text: COMMON_KEYS,
  textarea: COMMON_KEYS,
  number: [...COMMON_KEYS, "min", "max"],
  date: COMMON_KEYS,
  choice: [...COMMON_KEYS, "options"],
  yesno: COMMON_KEYS,
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * A template's structure, checked and tidied (labels and options trimmed). Every refusal is an Arabic key under
 * `approvals.f.*` and names the field it is about (`fields.2.options`). Nothing outside the lists above is accepted.
 */
export function validateSchema(raw: unknown): Checked<FormSchema> {
  const issues: Issue[] = [];
  const fail = (path: string, message: string) => void issues.push({ path, message });
  if (!isRecord(raw)) return { ok: false, issues: [{ path: "schema", message: "approvals.f.schema_invalid" }] };
  for (const key of Object.keys(raw)) if (!SCHEMA_KEYS.has(key)) fail(key, "approvals.f.unknown_property");

  const fields: FormField[] = [];
  const rawFields = raw["fields"];
  if (!Array.isArray(rawFields) || rawFields.length === 0) fail("fields", "approvals.f.fields_empty");
  else if (rawFields.length > FORM_LIMITS.fields) fail("fields", "approvals.f.fields_long");
  else {
    const seen = new Set<string>();
    rawFields.forEach((item, i) => {
      const at = `fields.${i}`;
      if (!isRecord(item)) return fail(at, "approvals.f.field_invalid");
      const type = item["type"];
      if (!isFieldType(type)) return fail(`${at}.type`, "approvals.f.type_invalid");
      for (const key of Object.keys(item)) if (!KEYS_BY_TYPE[type].includes(key)) fail(`${at}.${key}`, "approvals.f.unknown_property");
      const id = item["id"];
      if (typeof id !== "string" || !FIELD_ID.test(id)) fail(`${at}.id`, "approvals.f.id_invalid");
      else if (seen.has(id)) fail(`${at}.id`, "approvals.f.id_duplicate");
      else seen.add(id);
      const label = typeof item["label"] === "string" ? clean(item["label"]) : "";
      if (!label) fail(`${at}.label`, "approvals.f.label_required");
      else if (label.length > FORM_LIMITS.label) fail(`${at}.label`, "approvals.f.label_long");
      const required = item["required"];
      if (required !== undefined && typeof required !== "boolean") fail(`${at}.required`, "approvals.f.required_invalid");

      const field: FormField = { id: typeof id === "string" ? id : "", type, label, required: required === true };
      if (type === "choice") {
        const options = item["options"];
        if (!Array.isArray(options) || options.some((o) => typeof o !== "string")) fail(`${at}.options`, "approvals.f.options_invalid");
        else {
          const tidy = (options as string[]).map(clean);
          if (tidy.length < 2) fail(`${at}.options`, "approvals.f.options_few");
          else if (tidy.length > FORM_LIMITS.options) fail(`${at}.options`, "approvals.f.options_long");
          else if (tidy.some((o) => !o || o.length > FORM_LIMITS.option)) fail(`${at}.options`, "approvals.f.option_invalid");
          else if (new Set(tidy).size !== tidy.length) fail(`${at}.options`, "approvals.f.options_duplicate");
          else field.options = tidy;
        }
      }
      if (type === "number") {
        for (const bound of ["min", "max"] as const) {
          const v = item[bound];
          if (v === undefined) continue;
          if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > FORM_LIMITS.numberAbs) fail(`${at}.${bound}`, "approvals.f.bound_invalid");
          else field[bound] = v;
        }
        if (field.min !== undefined && field.max !== undefined && field.min > field.max) fail(`${at}.min`, "approvals.f.bound_order");
      }
      fields.push(field);
    });
  }

  const approvers = raw["approvers"];
  let chain: string[] = [];
  if (!Array.isArray(approvers) || approvers.length === 0) fail("approvers", "approvals.e.chain_empty");
  else if (approvers.length > APPROVAL_LIMITS.approvers) fail("approvers", "approvals.e.chain_long");
  else if (approvers.some((a) => typeof a !== "string" || !a)) fail("approvers", "approvals.e.chain_invalid");
  else if (new Set(approvers).size !== approvers.length) fail("approvers", "approvals.e.chain_duplicate");
  else chain = approvers as string[];

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: { fields, approvers: chain } };
}

/** A calendar date written YYYY-MM-DD that exists (no 31 February). */
export function isCalendarDay(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

/**
 * The answers of one filling, checked against ONE version of a template. Each type has its own rule; an optional field left
 * empty is simply absent; an answer for a field the template does not have is refused. Returns only the checked answers.
 */
export function validateAnswers(schema: FormSchema, raw: unknown): Checked<Answers> {
  const issues: Issue[] = [];
  if (!isRecord(raw)) return { ok: false, issues: [{ path: "answers", message: "approvals.f.answers_invalid" }] };
  const ids = new Set(schema.fields.map((f) => f.id));
  for (const key of Object.keys(raw)) if (!ids.has(key)) issues.push({ path: key, message: "approvals.f.unknown_field" });

  const answers: Answers = {};
  for (const field of schema.fields) {
    const fail = (message: string) => void issues.push({ path: field.id, message });
    const value = raw[field.id];
    const empty = value === undefined || value === null || (typeof value === "string" && clean(value) === "");
    if (empty) {
      if (field.required) fail("approvals.f.answer_required");
      continue;
    }
    switch (field.type) {
      case "text":
      case "textarea": {
        if (typeof value !== "string") {
          fail("approvals.f.answer_type");
          break;
        }
        // a long text keeps its line breaks; a short one is one line
        const text = field.type === "text" ? clean(value) : value.replace(/\r\n?/g, "\n").trim();
        const max = field.type === "text" ? FORM_LIMITS.text : FORM_LIMITS.textarea;
        if (text.length > max) fail("approvals.f.answer_long");
        else answers[field.id] = text;
        break;
      }
      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value)) fail("approvals.f.answer_type");
        else if (Math.abs(value) > FORM_LIMITS.numberAbs) fail("approvals.f.number_range");
        else if (field.min !== undefined && value < field.min) fail("approvals.f.number_low");
        else if (field.max !== undefined && value > field.max) fail("approvals.f.number_high");
        else answers[field.id] = value;
        break;
      }
      case "date": {
        if (typeof value !== "string" || !isCalendarDay(value.trim())) fail("approvals.f.date_invalid");
        else answers[field.id] = value.trim();
        break;
      }
      case "choice": {
        if (typeof value !== "string" || !(field.options ?? []).includes(clean(value))) fail("approvals.f.choice_invalid");
        else answers[field.id] = clean(value);
        break;
      }
      case "yesno": {
        if (typeof value !== "boolean") fail("approvals.f.answer_type");
        else answers[field.id] = value;
        break;
      }
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: answers };
}

/** One answer as a person reads it: «نعم», «20 آذار 2031», the number as written, the text itself. */
export function answerText(field: FormField, value: AnswerValue | undefined): string {
  if (value === undefined) return "—";
  if (field.type === "yesno") return value === true ? (AR["approvals.yes"] ?? "") : (AR["approvals.no"] ?? "");
  if (field.type === "date" && typeof value === "string") {
    const [y, m, d] = value.split("-").map(Number);
    return fmtDMY(new Date(y!, m! - 1, d!));
  }
  return String(value);
}

/**
 * The details of the request a form creates: one labelled line per answered field, in the template's order
 * («التاريخ: 20 آذار 2031»). A field left empty is a line that says so, so a reader never wonders whether it was skipped.
 */
export function renderAnswers(schema: FormSchema, answers: Answers): string {
  return schema.fields
    .map((field) => {
      const value = answers[field.id];
      const text = value === undefined ? (AR["approvals.f.not_answered"] ?? "—") : answerText(field, value);
      // a long text goes under its label so its own line breaks stay readable
      return field.type === "textarea" && value !== undefined ? `${field.label}:\n${text}` : `${field.label}: ${text}`;
    })
    .join("\n");
}

/** The details are bounded like any request's; a form whose answers are longer is refused with this key. */
export function renderedProblem(details: string): string | null {
  return details.length > APPROVAL_LIMITS.details ? "approvals.f.details_long" : null;
}

/** An empty template to start from: one short-text field. */
export function blankSchema(): FormSchema {
  return { fields: [{ id: "f1", type: "text", label: "", required: true }], approvers: [] };
}

/** The next free field id (`f1`, `f2`, …) of a list being edited. */
export function nextFieldId(fields: readonly { id: string }[]): string {
  const used = new Set(fields.map((f) => f.id));
  for (let n = 1; n <= FORM_LIMITS.fields + 1; n += 1) if (!used.has(`f${n}`)) return `f${n}`;
  return `f${Date.now()}`;
}
