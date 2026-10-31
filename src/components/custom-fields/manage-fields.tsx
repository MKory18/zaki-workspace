"use client";

import * as React from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SortableItem, SortableList, Grip } from "@/components/shell/nav-sort";
import { COLOR_CLASS, FIELD_COLORS, FIELD_TYPES, MAX_ACTIVE_FIELDS, MAX_LABEL, MAX_OPTION_LABEL, MAX_OPTIONS, MAX_UNIT, isChoice, type FieldColor, type FieldDefDto, type FieldType } from "@/lib/custom-fields";
import { movedAfter } from "@/lib/custom-fields-ui";
import { REWARD_CURRENCIES, currencyName } from "@/lib/rewards";
import { errorKeyOf, rt } from "@/lib/reminders/client";
import { cn } from "@/lib/utils";

/**
 * «إدارة الحقول» on the project's page — the schema of the project's tasks: add, edit, archive and restore a field, drag the
 * live ones into order (the same drag as the side menu's: a grip, the keyboard, the Arabic announcements). Only the space's
 * ADMIN and the owner see the controls (`canEdit`); the server decides again on every request. Archiving hides a field and keeps
 * every value, and takes a field out of the 15-field count.
 *
 * Every change is sent at once and the list is replaced by what the server answers, so the screen is what is stored.
 */
interface Draft {
  /** The field being edited (absent: a new one). */
  id?: string;
  label: string;
  type: FieldType;
  required: boolean;
  unit: string;
  currency: string;
  options: { id?: string; label: string; color: FieldColor }[];
}

const blank = (): Draft => ({ label: "", type: "TEXT", required: false, unit: "", currency: "JOD", options: [{ label: "", color: "muted" }] });

const box = "h-11 w-full rounded-lg border-muted bg-surface px-3 text-base text-fg placeholder:text-muted focus:border-accent/60 md:h-9 md:text-sm";

function draftOf(f: FieldDefDto): Draft {
  return {
    id: f.id,
    label: f.label,
    type: f.type,
    required: f.required,
    unit: f.unit ?? "",
    currency: f.currency ?? "JOD",
    options: f.options.filter((o) => !o.deleted).map((o) => ({ id: o.id, label: o.label, color: o.color })),
  };
}

export function ManageFields({ projectId, initial, canEdit }: { projectId: string; initial: FieldDefDto[]; canEdit: boolean }) {
  const [fields, setFields] = React.useState<FieldDefDto[]>(initial);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const base = `/api/projects/${encodeURIComponent(projectId)}/fields`;
  const live = fields.filter((f) => !f.archived);
  const archived = fields.filter((f) => f.archived);

  async function reload(): Promise<void> {
    const res = await fetch(`${base}?archived=1`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setFields(((await res.json()) as { fields: FieldDefDto[] }).fields);
  }

  /** One request, then the list is read back (a drag, an archive and another tab's change all end the same way). */
  async function send(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      if (!res.ok) {
        setError(errorKeyOf(await res.json().catch(() => null), "fields.manage.failed"));
        return false;
      }
      return true;
    } catch {
      setError("fields.manage.failed");
      return false;
    } finally {
      await reload();
      setBusy(false);
    }
  }

  const patch = (id: string, body: Record<string, unknown>) => send(`${base}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    const options = isChoice(draft.type) ? draft.options.filter((o) => o.label.trim() !== "").map((o) => ({ ...(o.id ? { id: o.id } : {}), label: o.label.trim(), color: o.color })) : undefined;
    const config = {
      ...(draft.type === "NUMBER" ? { unit: draft.unit.trim() || null } : {}),
      ...(draft.type === "MONEY" ? { currency: draft.currency } : {}),
      ...(options ? { options } : {}),
    };
    const ok = draft.id
      ? await patch(draft.id, { label: draft.label, required: draft.required, ...config })
      : await send(base, { method: "POST", body: JSON.stringify({ label: draft.label, type: draft.type, required: draft.required, ...config }) });
    if (ok) setDraft(null);
  }

  function onReorder(keys: string[]) {
    const moved = movedAfter(live.map((f) => f.id), keys);
    if (!moved) return;
    // the screen follows the hand at once; the answer then replaces it
    setFields((all) => [...keys.map((id) => all.find((f) => f.id === id) as FieldDefDto), ...all.filter((f) => f.archived)]);
    void patch(moved.id, { afterId: moved.afterId });
  }

  const typeLabel = (t: FieldType) => rt(`fields.type.${t}`);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-fg">
            <Settings2 className="h-4 w-4" aria-hidden="true" /> {rt("fields.manage.title")}
          </p>
          <span data-fields-counter className="text-xs font-medium text-fg-muted">
            {rt("fields.manage.counter", { n: live.length, max: MAX_ACTIVE_FIELDS })}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">{canEdit ? rt("fields.manage.hint") : rt("fields.manage.readonly")}</p>
      </CardHeader>
      <CardBody className="space-y-3">
        {live.length === 0 ? <p className="text-xs text-muted">{rt("fields.manage.empty")}</p> : null}
        {canEdit ? (
          <SortableList id={`project-fields-${projectId}`} axis="vertical" entries={live.map((f) => ({ id: f.id, label: f.label }))} onReorder={onReorder}>
            <ul className="space-y-1">
              {live.map((f) => (
                <SortableItem key={f.id} id={f.id}>
                  {({ props }) => <FieldRow field={f} typeLabel={typeLabel(f.type)} busy={busy} grip={<Grip handle={props} label={f.label} />} onEdit={() => setDraft(draftOf(f))} onArchive={() => void patch(f.id, { archived: true })} />}
                </SortableItem>
              ))}
            </ul>
          </SortableList>
        ) : (
          <ul className="space-y-1">
            {live.map((f) => (
              <li key={f.id}>
                <FieldRow field={f} typeLabel={typeLabel(f.type)} busy grip={null} />
              </li>
            ))}
          </ul>
        )}

        {draft ? (
          <form onSubmit={save} data-field-form className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-muted">{rt("fields.manage.label")}</span>
              <input value={draft.label} maxLength={MAX_LABEL} required autoFocus onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder={rt("fields.manage.label_placeholder")} className={box} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-muted">{rt("fields.manage.type")}</span>
              <select
                value={draft.type}
                disabled={Boolean(draft.id)}
                onChange={(e) => setDraft({ ...draft, type: e.target.value as FieldType })}
                className={cn(box, "max-w-xs disabled:opacity-60")}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {typeLabel(t)}
                  </option>
                ))}
              </select>
              {draft.id ? <span className="mt-1 block text-xs text-muted">{rt("fields.manage.type_locked")}</span> : null}
            </label>
            {draft.type === "NUMBER" ? (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-fg-muted">{rt("fields.manage.unit")}</span>
                <input value={draft.unit} maxLength={MAX_UNIT} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder={rt("fields.manage.unit_placeholder")} className={cn(box, "max-w-xs")} />
              </label>
            ) : null}
            {draft.type === "MONEY" ? (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-fg-muted">{rt("fields.manage.currency")}</span>
                <select value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value })} className={cn(box, "max-w-xs")}>
                  {REWARD_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {currencyName(c)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {isChoice(draft.type) ? <OptionsEditor draft={draft} setDraft={setDraft} /> : null}
            <label className="flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} className="size-4 rounded border-muted" />
              {rt("fields.manage.required")}
            </label>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || draft.label.trim() === ""}>
                {draft.id ? rt("fields.manage.save") : rt("fields.manage.create")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
                {rt("fields.manage.cancel")}
              </Button>
            </div>
          </form>
        ) : canEdit ? (
          <Button type="button" size="sm" variant="secondary" disabled={busy || live.length >= MAX_ACTIVE_FIELDS} onClick={() => setDraft(blank())}>
            <Plus className="size-4" aria-hidden="true" /> {rt("fields.manage.add")}
          </Button>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs text-danger">
            {rt(error)}
          </p>
        ) : null}

        {canEdit && archived.length > 0 ? (
          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-xs font-medium text-fg-muted">{rt("fields.manage.archived_title")}</p>
            <ul className="space-y-1">
              {archived.map((f) => (
                <li key={f.id} data-field-archived={f.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted">
                  <span className="min-w-0 flex-1 truncate">{f.label}</span>
                  <span className="text-xs">{typeLabel(f.type)}</span>
                  <button type="button" disabled={busy} aria-label={`${rt("fields.manage.restore")}: ${f.label}`} onClick={() => void patch(f.id, { archived: false })} className="rounded p-1 hover:bg-surface-2 hover:text-fg disabled:opacity-40">
                    <ArchiveRestore className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function FieldRow({
  field,
  typeLabel,
  busy,
  grip,
  onEdit,
  onArchive,
}: {
  field: FieldDefDto;
  typeLabel: string;
  busy: boolean;
  grip: React.ReactNode;
  onEdit?: () => void;
  onArchive?: () => void;
}) {
  return (
    <div data-field-row={field.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-2 py-1.5">
      {grip}
      <span className="min-w-0 flex-1 truncate text-sm text-fg">{field.label}</span>
      {field.required ? <span className="rounded bg-warn/10 px-1 text-xs text-warn">{rt("fields.required_mark")}</span> : null}
      <span className="shrink-0 text-xs text-fg-muted">{typeLabel}</span>
      {onEdit ? (
        <button type="button" disabled={busy} aria-label={`${rt("fields.manage.edit")}: ${field.label}`} onClick={onEdit} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40">
          <Pencil className="size-4" aria-hidden="true" />
        </button>
      ) : null}
      {onArchive ? (
        <button type="button" disabled={busy} aria-label={`${rt("fields.manage.archive")}: ${field.label}`} onClick={onArchive} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40">
          <Archive className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function OptionsEditor({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const set = (i: number, patch: Partial<Draft["options"][number]>) => setDraft({ ...draft, options: draft.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-xs font-medium text-fg-muted">{rt("fields.manage.options")}</legend>
      {draft.options.map((o, i) => (
        <div key={o.id ?? `new-${i}`} data-field-option className="flex items-center gap-2">
          <span aria-hidden="true" className={cn("size-5 shrink-0 rounded-full", COLOR_CLASS[o.color])} />
          <input value={o.label} maxLength={MAX_OPTION_LABEL} onChange={(e) => set(i, { label: e.target.value })} aria-label={rt("fields.manage.option_label")} placeholder={rt("fields.manage.option_label")} className={cn(box, "min-w-0 flex-1")} />
          <select value={o.color} onChange={(e) => set(i, { color: e.target.value as FieldColor })} aria-label={rt("fields.manage.option_color")} className={cn(box, "w-28 shrink-0")}>
            {FIELD_COLORS.map((c) => (
              <option key={c} value={c}>
                {rt(`fields.color.${c}`)}
              </option>
            ))}
          </select>
          <button type="button" aria-label={rt("fields.manage.option_remove")} disabled={draft.options.length <= 1} onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-30">
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      {draft.options.length < MAX_OPTIONS ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ ...draft, options: [...draft.options, { label: "", color: "muted" }] })}>
          <Plus className="size-4" aria-hidden="true" /> {rt("fields.manage.option_add")}
        </Button>
      ) : null}
    </fieldset>
  );
}
