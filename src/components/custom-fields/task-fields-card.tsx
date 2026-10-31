"use client";

import * as React from "react";
import { ListTree } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useOptionalToast } from "@/components/ui/toast";
import { COLOR_CLASS, FIELDS_ANCHOR, MAX_LONG_TEXT, MAX_TEXT, optionLabel, validateValue, type FieldDefDto } from "@/lib/custom-fields";
import { cellOf, linkHost } from "@/lib/custom-fields-display";
import { currencyName, amountTextToMinor, minorToAmountText } from "@/lib/rewards";
import { errorKeyOf, rt } from "@/lib/reminders/client";
import { cn } from "@/lib/utils";

/**
 * «حقول مخصصة» on the task's own page: one row per live field of the task's project, an editor per type, each saved on its own
 * when the person leaves the box (blur; a choice, a date and a yes/no save at once). The screen updates BEFORE the answer
 * (optimistic) and puts the old value back, with a toast in Arabic, when the server refuses.
 *
 * `canEdit` is what the page worked out (who may edit the task; never a partner; never the owner reading silently): the server
 * decides again on every write, and without it the rows are plain text. A task page opened at `#custom-fields` (where a refused
 * completion sends the person) marks the required fields that are still empty.
 */
export interface PersonOption {
  id: string;
  name: string;
}

const box = "w-full rounded-lg border-muted bg-surface px-3 text-base text-fg placeholder:text-muted transition-colors focus:border-accent/60 md:text-sm disabled:opacity-60";
const oneLine = cn(box, "h-11 md:h-9");

export interface EditorProps {
  field: FieldDefDto;
  value: unknown;
  people: PersonOption[];
  disabled: boolean;
  invalid?: boolean;
  /** Sends the new canonical value (`null` clears). Resolves false when the save failed (the editor puts the old value back). */
  onCommit: (value: unknown) => Promise<boolean> | boolean | void;
}

/** One editor, chosen by the field's type. Pure of the network: it only calls `onCommit`. */
export function FieldEditor(props: EditorProps) {
  switch (props.field.type) {
    case "TEXT":
    case "LONG_TEXT":
    case "LINK":
      return <TextEditor {...props} />;
    case "NUMBER":
      return <NumberEditor {...props} />;
    case "MONEY":
      return <MoneyEditor {...props} />;
    case "DATE":
      return <DateEditor {...props} />;
    case "SINGLE_CHOICE":
      return <SingleChoiceEditor {...props} />;
    case "MULTI_CHOICE":
      return <MultiChoiceEditor {...props} />;
    case "BOOLEAN":
      return <BooleanEditor {...props} />;
    case "PERSON":
      return <PersonEditor {...props} />;
  }
}

function describe(f: FieldDefDto, invalid?: boolean) {
  return { "aria-label": f.label, "aria-required": f.required || undefined, "aria-invalid": invalid || undefined, "data-field-input": f.id } as const;
}

/** Checks a typed value with the same rules as the server before anything is sent: `null` = fine, else the dictionary key. */
function localProblem(field: FieldDefDto, value: unknown): string | null {
  const checked = validateValue({ type: field.type, config: { currency: field.currency ?? undefined, options: field.options } }, value);
  return checked.ok ? null : checked.key;
}

/** The text box a TEXT, LONG_TEXT or LINK field uses: saved when the person leaves it, if it changed. */
function TextEditor({ field, value, disabled, invalid, onCommit }: EditorProps) {
  const current = typeof value === "string" ? value : "";
  const [error, setError] = React.useState<string | null>(null);
  const common = {
    key: `${field.id}:${current}`,
    defaultValue: current,
    disabled,
    placeholder: rt(field.type === "LINK" ? "fields.link_placeholder" : "fields.text_placeholder"),
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = e.target.value.trim();
      if (next === current.trim()) return;
      const key = localProblem(field, next);
      setError(key);
      if (key) return;
      void onCommit(next === "" ? null : next);
    },
    ...describe(field, invalid || error !== null),
  };
  if (field.type === "LONG_TEXT") return <Wrapped error={error}><textarea {...common} rows={3} maxLength={MAX_LONG_TEXT} className={cn(box, "min-h-20 py-2")} /></Wrapped>;
  return (
    <Wrapped error={error}>
      <input
        {...common}
        type={field.type === "LINK" ? "url" : "text"}
        dir={field.type === "LINK" ? "ltr" : undefined}
        maxLength={field.type === "LINK" ? 2000 : MAX_TEXT}
        className={oneLine}
      />
      {field.type === "LINK" && current ? (
        <a href={current} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-accent hover:underline">
          {rt("fields.link_open")} · {linkHost(current)}
        </a>
      ) : null}
    </Wrapped>
  );
}

function Wrapped({ error, children }: { error: string | null; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      {children}
      {error ? <p role="alert" className="mt-1 text-xs text-danger">{rt(error)}</p> : null}
    </div>
  );
}

function NumberEditor({ field, value, disabled, invalid, onCommit }: EditorProps) {
  const current = typeof value === "string" ? value : "";
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Wrapped error={error}>
      <div className="flex items-center gap-2">
        <input
          key={`${field.id}:${current}`}
          type="text"
          inputMode="decimal"
          dir="ltr"
          defaultValue={current}
          disabled={disabled}
          placeholder={rt("fields.number_placeholder")}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next === current) return;
            const key = next === "" ? null : localProblem(field, next);
            setError(key);
            if (key) return;
            void onCommit(next === "" ? null : next);
          }}
          className={cn(oneLine, "max-w-[12rem]")}
          {...describe(field, invalid || error !== null)}
        />
        {field.unit ? <span className="shrink-0 text-xs text-fg-muted">{field.unit}</span> : null}
      </div>
    </Wrapped>
  );
}

function MoneyEditor({ field, value, disabled, invalid, onCommit }: EditorProps) {
  const minor = typeof value === "number" ? value : null;
  const current = minor === null ? "" : minorToAmountText(minor);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Wrapped error={error}>
      <div className="flex items-center gap-2">
        <input
          key={`${field.id}:${current}`}
          type="text"
          inputMode="decimal"
          dir="ltr"
          defaultValue={current}
          disabled={disabled}
          placeholder={rt("fields.money_placeholder")}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next === current) return;
            if (next === "") {
              setError(null);
              void onCommit(null);
              return;
            }
            const asMinor = amountTextToMinor(next);
            const key = asMinor === null ? "fields.money_invalid" : localProblem(field, asMinor);
            setError(key);
            if (key || asMinor === null) return;
            void onCommit(asMinor);
          }}
          className={cn(oneLine, "max-w-[12rem]")}
          {...describe(field, invalid || error !== null)}
        />
        <span className="shrink-0 text-xs text-fg-muted">{currencyName(field.currency)}</span>
      </div>
    </Wrapped>
  );
}

function DateEditor({ field, value, disabled, invalid, onCommit }: EditorProps) {
  const current = typeof value === "string" ? value : "";
  return (
    <input
      key={`${field.id}:${current}`}
      type="date"
      dir="ltr"
      defaultValue={current}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === current) return;
        void onCommit(e.target.value === "" ? null : e.target.value);
      }}
      className={cn(oneLine, "max-w-[12rem]")}
      {...describe(field, invalid)}
    />
  );
}

function SingleChoiceEditor({ field, value, disabled, invalid, onCommit }: EditorProps) {
  const current = typeof value === "string" ? value : "";
  const live = field.options.filter((o) => !o.deleted);
  // a value that holds a taken-away option stays visible as «محذوف» until it is changed
  const orphan = current && !live.some((o) => o.id === current) ? optionLabel(field.options, current, rt("fields.deleted")) : null;
  return (
    <select
      value={current}
      disabled={disabled}
      onChange={(e) => void onCommit(e.target.value === "" ? null : e.target.value)}
      className={cn(oneLine, "max-w-xs")}
      {...describe(field, invalid)}
    >
      <option value="">{rt("fields.pick")}</option>
      {orphan ? <option value={current}>{orphan.label}</option> : null}
      {live.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function MultiChoiceEditor({ field, value, disabled, invalid, onCommit }: EditorProps) {
  const current = Array.isArray(value) ? (value as string[]) : [];
  const live = field.options.filter((o) => !o.deleted);
  const orphans = current.filter((id) => !live.some((o) => o.id === id));
  const toggle = (id: string) => {
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    void onCommit(next.length === 0 ? null : next);
  };
  return (
    <div role="group" className="flex flex-wrap gap-1.5" {...describe(field, invalid)}>
      {live.map((o) => {
        const on = current.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => toggle(o.id)}
            className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60", on ? cn(COLOR_CLASS[o.color], "border-transparent font-medium") : "border-border text-fg-muted hover:bg-surface-2")}
          >
            {o.label}
          </button>
        );
      })}
      {orphans.map((id) => (
        <button key={id} type="button" aria-pressed disabled={disabled} onClick={() => toggle(id)} className="rounded-full border border-transparent bg-surface-2 px-2.5 py-1 text-xs text-fg-muted line-through disabled:opacity-60" title={rt("fields.option_deleted_hint")}>
          {rt("fields.deleted")}
        </button>
      ))}
    </div>
  );
}

function BooleanEditor({ field, value, disabled, invalid, onCommit }: EditorProps) {
  const current = typeof value === "boolean" ? value : null;
  const pick = (v: boolean) => void onCommit(current === v ? null : v);
  const cls = (on: boolean) => cn("min-w-14 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-60", on ? "border-transparent bg-accent text-accent-fg" : "border-border text-fg-muted hover:bg-surface-2");
  return (
    <div role="group" className="flex gap-1.5" {...describe(field, invalid)}>
      <button type="button" aria-pressed={current === true} disabled={disabled} onClick={() => pick(true)} className={cls(current === true)}>
        {rt("fields.yes")}
      </button>
      <button type="button" aria-pressed={current === false} disabled={disabled} onClick={() => pick(false)} className={cls(current === false)}>
        {rt("fields.no")}
      </button>
    </div>
  );
}

function PersonEditor({ field, value, people, disabled, invalid, onCommit }: EditorProps) {
  const current = typeof value === "string" ? value : "";
  const known = people.some((p) => p.id === current);
  return (
    <select
      value={current}
      disabled={disabled}
      onChange={(e) => void onCommit(e.target.value === "" ? null : e.target.value)}
      className={cn(oneLine, "max-w-xs")}
      {...describe(field, invalid)}
    >
      <option value="">{rt("fields.pick_person")}</option>
      {current && !known ? <option value={current}>{rt("fields.person_gone")}</option> : null}
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/** A value as plain text, for a card the person may only read. */
function ReadOnly({ field, value, people }: { field: FieldDefDto; value: unknown; people: PersonOption[] }) {
  const cell = cellOf(field, value, new Map(people.map((p) => [p.id, p.name])));
  if (!cell) return <span className="text-sm text-muted">{rt("fields.unset")}</span>;
  if (field.type === "LINK" && typeof value === "string") {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">
        {cell.text}
      </a>
    );
  }
  if (cell.color) return <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs", COLOR_CLASS[cell.color])}>{cell.text}</span>;
  return <span className="whitespace-pre-wrap text-sm text-fg">{cell.text}</span>;
}

export function TaskFieldsCard({
  taskId,
  fields,
  initialValues,
  people,
  canEdit,
}: {
  taskId: string;
  fields: FieldDefDto[];
  initialValues: Record<string, unknown>;
  people: PersonOption[];
  canEdit: boolean;
}) {
  const toast = useOptionalToast();
  const [values, setValues] = React.useState<Record<string, unknown>>(initialValues);
  const [marked, setMarked] = React.useState(false);

  // a refused completion opens the page at `#custom-fields`: show which required fields are still empty
  React.useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === `#${FIELDS_ANCHOR}`) {
      setMarked(true);
      document.getElementById(FIELDS_ANCHOR)?.scrollIntoView?.({ block: "start" });
    }
  }, []);

  async function commit(field: FieldDefDto, next: unknown): Promise<boolean> {
    const before = values[field.id];
    // optimistic: the screen shows the new value now and puts the old one back if the server refuses
    setValues((v) => {
      const copy = { ...v };
      if (next === null || next === undefined) delete copy[field.id];
      else copy[field.id] = next;
      return copy;
    });
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/fields/${encodeURIComponent(field.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: next }),
      });
      if (!res.ok) throw await res.json().catch(() => null);
      return true;
    } catch (body) {
      setValues((v) => {
        const copy = { ...v };
        if (before === undefined) delete copy[field.id];
        else copy[field.id] = before;
        return copy;
      });
      toast?.toast(rt(errorKeyOf(body, "fields.save_failed")), "error");
      return false;
    }
  }

  if (fields.length === 0) return null;
  const missing = marked ? fields.filter((f) => f.required && !hasAnswer(values[f.id])) : [];

  return (
    <div id={FIELDS_ANCHOR} data-custom-fields className="scroll-mt-4">
    <Card>
      <CardHeader>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <ListTree className="h-4 w-4" aria-hidden="true" /> {rt("fields.title")}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">{canEdit ? rt("fields.hint") : rt("fields.readonly")}</p>
      </CardHeader>
      <CardBody className="space-y-3">
        {missing.length > 0 ? (
          <p role="alert" data-fields-missing className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            {rt("fields.required_title")}: {missing.map((f) => f.label).join("، ")}
          </p>
        ) : null}
        {fields.map((f) => {
          const isMissing = missing.some((m) => m.id === f.id);
          return (
            <div key={f.id} data-field={f.id} className={cn("space-y-1 rounded-lg", isMissing && "ring-1 ring-warn/50 ring-offset-2 ring-offset-surface")}>
              <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                {f.label}
                {f.required ? <span className="rounded bg-warn/10 px-1 text-xs text-warn">{rt("fields.required_mark")}</span> : null}
              </p>
              {canEdit ? (
                <FieldEditor field={f} value={values[f.id]} people={people} disabled={false} invalid={isMissing} onCommit={(v) => commit(f, v)} />
              ) : (
                <ReadOnly field={f} value={values[f.id]} people={people} />
              )}
            </div>
          );
        })}
      </CardBody>
    </Card>
    </div>
  );
}

/** Is there an answer in this value? («no» is one; a blank text and an empty list are not.) */
function hasAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
