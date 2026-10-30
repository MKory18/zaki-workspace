"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useOptionalToast } from "@/components/ui/toast";
import { LIMITS } from "@/lib/cards/shared";
import type { CardAbilities, NoteItem, NotesView, NoteVisibility } from "@/lib/cards/page";
import { cardErrorKey } from "./errors";

export const notesKey = (cardId: string) => ["card", cardId, "notes"] as const;

function Composer({ visibility, onAdd }: { visibility: NoteVisibility; onAdd: (body: string) => Promise<void> }) {
  const { t } = useI18n();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <Textarea
        dir="auto"
        rows={3}
        value={text}
        maxLength={LIMITS.note}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("cards.p.note_placeholder")}
        aria-label={visibility === "PRIVATE" ? t("cards.p.note_private_add") : t("cards.p.note_add")}
      />
      <Button type="submit" disabled={busy || !text.trim()} className="self-start">
        {visibility === "PRIVATE" ? t("cards.p.note_private_add") : t("cards.p.note_add")}
      </Button>
    </form>
  );
}

function NoteRow({ note, mine, canDelete, onEdit, onDelete }: { note: NoteItem; mine: boolean; canDelete: boolean; onEdit: (id: string, body: string) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const { t } = useI18n();
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(note.body);
  return (
    <li className="flex list-none flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span dir="auto" className="font-medium text-fg">{note.authorName}</span>
        <span>
          {fmtDateTime(note.createdAt)}
          {note.editedAt ? ` · ${t("cards.p.note_edited")}` : ""}
        </span>
      </div>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onEdit(note.id, text.trim()).then(() => setEditing(false));
          }}
          className="flex flex-col gap-2"
        >
          <Textarea dir="auto" rows={3} value={text} maxLength={LIMITS.note} onChange={(e) => setText(e.target.value)} aria-label={t("cards.p.note_edit")} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!text.trim()}>{t("cards.p.note_save")}</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => { setEditing(false); setText(note.body); }}>{t("common.cancel")}</Button>
          </div>
        </form>
      ) : (
        <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-fg">{note.body}</p>
      )}
      {!editing && (mine || canDelete) ? (
        <div className="flex gap-1">
          {mine ? (
            <button type="button" onClick={() => setEditing(true)} aria-label={t("cards.p.note_edit")} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg">
              <Pencil className="size-4" aria-hidden="true" />
              {t("cards.p.note_edit")}
            </button>
          ) : null}
          <button type="button" onClick={() => void onDelete(note.id)} aria-label={t("cards.p.note_delete")} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-danger">
            <Trash2 className="size-4" aria-hidden="true" />
            {t("cards.p.note_delete")}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * «الملاحظات»: the space's thread, and «ملاحظاتي الخاصة» below it, which nobody else ever sees (the server sends a person
 * only their own private notes). Leaving a note needs a place in the space: the owner reading silently sees the thread
 * and is told why he cannot write.
 */
export function NotesSection({ cardId, userId, abilities, initial }: { cardId: string; userId: string; abilities: CardAbilities; initial?: NotesView }) {
  const { t } = useI18n();
  const toast = useOptionalToast()?.toast;
  const qc = useQueryClient();
  const key = notesKey(cardId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => apiGet<NotesView>(`/api/cards/${cardId}/notes`),
    ...(initial ? { initialData: initial } : {}),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
  const fail = (err: unknown) => toast?.(t(cardErrorKey(err)), "error");
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  async function add(visibility: NoteVisibility, body: string) {
    try {
      await apiPost(`/api/cards/${cardId}/notes`, { body, visibility });
      toast?.(t("cards.p.note_added"), "success");
      await refresh();
    } catch (err) {
      fail(err);
      throw err;
    }
  }
  async function edit(id: string, body: string) {
    try {
      await apiPatch(`/api/cards/${cardId}/notes/${id}`, { body });
      await refresh();
    } catch (err) {
      fail(err);
      throw err;
    }
  }
  async function remove(id: string) {
    try {
      await apiDelete(`/api/cards/${cardId}/notes/${id}`);
      toast?.(t("cards.p.note_deleted"), "success");
      await refresh();
    } catch (err) {
      fail(err);
    }
  }

  if (query.isError) return <p role="alert" className="text-sm text-danger">{t("cards.p.load_failed")}</p>;
  const data = query.data;
  if (!data) return <p role="status" className="text-sm text-fg-muted">{t("cards.p.loading")}</p>;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t("cards.p.notes_public")} className="flex flex-col gap-2">
        <div>
          <h3 className="text-base font-semibold text-fg">{t("cards.p.notes_public")}</h3>
          <p className="text-xs text-fg-muted">{t("cards.p.notes_public_hint")}</p>
        </div>
        {(data.publicNotes ?? []).length === 0 ? <p className="text-sm text-fg-muted">{t("cards.p.notes_empty")}</p> : null}
        <ul className="m-0 flex flex-col gap-2 p-0">
          {(data.publicNotes ?? []).map((n) => (
            <NoteRow key={n.id} note={n} mine={n.authorId === userId && abilities.participate} canDelete={n.authorId === userId || abilities.moderate} onEdit={edit} onDelete={remove} />
          ))}
        </ul>
        {abilities.participate ? <Composer visibility="PUBLIC" onAdd={(body) => add("PUBLIC", body)} /> : <p className="text-xs text-fg-muted">{abilities.oversight ? t("cards.p.note_silent") : t("cards.p.read_only")}</p>}
      </section>

      <section aria-label={t("cards.p.notes_private")} className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-surface-1 p-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-base font-semibold text-fg">
            <Lock className="size-4" aria-hidden="true" />
            {t("cards.p.notes_private")}
          </h3>
          <p className="text-xs text-fg-muted">{t("cards.p.notes_private_hint")}</p>
        </div>
        {data.privateNotes.length === 0 ? <p className="text-sm text-fg-muted">{t("cards.p.notes_private_empty")}</p> : null}
        <ul className="m-0 flex flex-col gap-2 p-0">
          {data.privateNotes.map((n) => (
            <NoteRow key={n.id} note={n} mine canDelete onEdit={edit} onDelete={remove} />
          ))}
        </ul>
        {abilities.participate ? <Composer visibility="PRIVATE" onAdd={(body) => add("PRIVATE", body)} /> : null}
      </section>
    </div>
  );
}
