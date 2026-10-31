"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPatch, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { PLAN_LIMITS } from "@/lib/team-plans";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { NoteDTO } from "@/server/services/team-plans";
import { devErrorText } from "./errors";

/**
 * «ملاحظات ١:١» — a private thread between the owner and the supervisors about one person. The person reads only the notes that were
 * marked «مشاركة»; nothing else of the thread reaches them (the server does not send it). A note is never edited or deleted.
 */
export function NotesPanel({ userId, notes, canWrite, selfView }: { userId: string; notes: NoteDTO[]; canWrite: boolean; selfView: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  async function run(job: () => Promise<unknown>) {
    setBusy(true);
    try {
      await job();
      router.refresh();
    } catch (err) {
      toast(devErrorText(err, t), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4" data-notes-panel>
      <p className="text-xs leading-5 text-fg-muted">{t(selfView ? "teamdev.notes.hint_self" : "teamdev.notes.hint")}</p>
      {canWrite ? (
        <form
          className="space-y-2 rounded-xl border border-border bg-surface p-3 shadow-card"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await apiPost(`/api/team-development/people/${userId}/notes`, { body, shared });
              setBody("");
              setShared(false);
            });
          }}
          data-note-form
        >
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={PLAN_LIMITS.note} rows={3} placeholder={t("teamdev.notes.placeholder")} aria-label={t("teamdev.notes.placeholder")} className="w-full rounded-lg border border-border bg-surface-1 px-2 py-2 text-sm text-fg" />
          <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-9">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="size-5" />
            {t("teamdev.notes.share")}
          </label>
          <Button type="submit" size="sm" disabled={busy || body.trim() === ""}>
            {t("teamdev.notes.add")}
          </Button>
        </form>
      ) : null}
      {notes.length === 0 ? <p className="rounded-xl border border-border bg-surface p-4 text-sm text-fg-muted">{t(selfView ? "teamdev.notes.none_self" : "teamdev.notes.none")}</p> : null}
      <ul className="space-y-3">
        {notes.map((n) => (
          <li key={n.id} className="rounded-xl border border-border bg-surface p-3 shadow-card" data-note={n.id} data-note-shared={n.shared ? "true" : "false"}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <b className="text-sm text-fg">{n.author}</b>
              <span>{fmtDateTime(n.createdAt)}</span>
              <span className={n.shared ? "text-ok" : ""}>{n.shared ? t("teamdev.notes.is_shared") : `🔒 ${t("teamdev.notes.is_private")}`}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{n.body}</p>
            {n.canShare ? (
              <div className="mt-2">
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => run(() => apiPatch(`/api/team-development/notes/${n.id}`, { shared: !n.shared }))} data-toggle-note={n.id}>
                  {t(n.shared ? "teamdev.notes.unshare" : "teamdev.notes.share_now")}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
