"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { AnswerValue, Answers, FormField, FormSchema } from "@/lib/approvals/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorPath, errorText } from "./errors";

/**
 * The answers as the boxes hold them: text for every box (a number is its digits, a yes/no is "yes" | "no" | "" and a date is
 * YYYY-MM-DD). `answersOf` turns them into what the route takes; the SERVER checks every answer against the form's version.
 */
export type Draft = Record<string, string>;

/** The boxes' start: the answers a request already has (a resubmit), else everything empty. */
export function draftOf(schema: FormSchema, answers: Answers = {}): Draft {
  const draft: Draft = {};
  for (const field of schema.fields) {
    const value = answers[field.id];
    draft[field.id] = value === undefined ? "" : typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  }
  return draft;
}

/** The body's `answers`: an empty box is left out; a number is a number (anything that is not one is sent as typed, so the server refuses it with its reason). */
export function answersOf(schema: FormSchema, draft: Draft): Record<string, AnswerValue> {
  const out: Record<string, AnswerValue> = {};
  for (const field of schema.fields) {
    const raw = draft[field.id] ?? "";
    if (raw.trim() === "") continue;
    if (field.type === "yesno") out[field.id] = raw === "yes";
    else if (field.type === "number") {
      const n = Number(raw.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/٫/g, "."));
      out[field.id] = Number.isFinite(n) ? n : raw;
    } else out[field.id] = raw;
  }
  return out;
}

function Box({ field, value, onChange, id, error }: { field: FormField; value: string; onChange: (next: string) => void; id: string; error?: string }) {
  const { t } = useI18n();
  const common = { id, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-err` : undefined } as const;
  switch (field.type) {
    case "textarea":
      return <Textarea {...common} rows={4} value={value} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <Input {...common} type="text" inputMode="decimal" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.min !== undefined || field.max !== undefined ? `${field.min ?? ""} – ${field.max ?? ""}` : undefined} />;
    case "date":
      return <Input {...common} type="date" dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} />;
    case "choice":
      return (
        <Select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("approvals.fill.pick")}</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    case "yesno":
      return (
        <Select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t("approvals.fill.pick")}</option>
          <option value="yes">{t("approvals.yes")}</option>
          <option value="no">{t("approvals.no")}</option>
        </Select>
      );
    default:
      return <Input {...common} type="text" value={value} maxLength={200} onChange={(e) => onChange(e.target.value)} />;
  }
}

/** The boxes of a form, one labelled box per field, in order; `errors` maps a field id to the Arabic line under its box. */
export function FormFields({ schema, draft, onDraft, errors = {}, idPrefix }: { schema: FormSchema; draft: Draft; onDraft: (next: Draft) => void; errors?: Record<string, string>; idPrefix: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3" data-form-fields>
      {schema.fields.map((field) => {
        const id = `${idPrefix}-${field.id}`;
        return (
          <div key={field.id} className="space-y-1" data-field={field.id} data-field-type={field.type}>
            <label htmlFor={id} className="block text-xs font-medium text-fg">
              {field.label}
              {field.required ? <span className="ms-1 text-danger" aria-label={t("approvals.fill.required")}>*</span> : null}
            </label>
            <Box field={field} id={id} value={draft[field.id] ?? ""} onChange={(next) => onDraft({ ...draft, [field.id]: next })} error={errors[field.id]} />
            {errors[field.id] ? (
              <p id={`${id}-err`} className="text-xs text-danger" role="alert">
                {errors[field.id]}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * «املأ النموذج»: the boxes and the send button. `send` receives the answers and does the call (a new request, or a resubmit);
 * a refusal puts its reason under the box it is about.
 */
export function FormFiller({
  schema,
  initial,
  send,
  submitLabel,
  extra,
}: {
  schema: FormSchema;
  initial?: Answers;
  send: (answers: Record<string, AnswerValue>) => Promise<void>;
  submitLabel?: string;
  /** Anything that goes under the boxes (files, a link). */
  extra?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Draft>(() => draftOf(schema, initial));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setGeneral(null);
    try {
      await send(answersOf(schema, draft));
    } catch (err) {
      const path = errorPath(err);
      const text = errorText(err, t);
      if (path && schema.fields.some((f) => f.id === path)) setErrors({ [path]: text });
      else setGeneral(text);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-form-filler>
      <FormFields schema={schema} draft={draft} onDraft={setDraft} errors={errors} idPrefix="fill" />
      {extra}
      {general ? (
        <p className="text-xs text-danger" role="alert">
          {general}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? t("common.saving") : (submitLabel ?? t("approvals.fill.send"))}
      </Button>
    </form>
  );
}
