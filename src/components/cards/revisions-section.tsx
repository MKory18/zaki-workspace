"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { History, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { apiGet } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import type { CardItem } from "@/lib/cards/shared";
import type { RevisionItem, RevisionsView } from "@/lib/cards/page";
import { diffSnapshots, type CardSnapshot } from "@/lib/cards/versions";
import { fieldText, snapshotOfItem } from "@/lib/cards/texts";

export const revisionsKey = (cardId: string) => ["card", cardId, "revisions"] as const;

function snapshotOfRevision(r: RevisionItem): CardSnapshot {
  return { title: r.title, body: r.body, data: r.data, color: r.color, category: r.category, tags: r.tags, fileId: r.fileId };
}

/** The difference between an old version and the card as it is now: every field that differs, before and after. */
export function RevisionDiff({ revision, card }: { revision: RevisionItem; card: CardItem }) {
  const { t } = useI18n();
  const rows = diffSnapshots(snapshotOfRevision(revision), snapshotOfItem(card));
  if (rows.length === 0) return <p className="text-xs text-fg-muted">{t("cards.p.diff_none")}</p>;
  return (
    <dl className="m-0 flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.field} className="rounded-lg border border-border bg-surface-2 p-2">
          <dt className="text-xs font-semibold text-fg">{t(`cards.field.${row.field}`)}</dt>
          <dd className="m-0 mt-1 grid gap-2 sm:grid-cols-2">
            <div>
              <p className="text-xs text-fg-muted">{t("cards.p.diff_before", { n: fmtNumber(revision.version) })}</p>
              <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-fg">{fieldText(row.field, row.before, t)}</p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">{t("cards.p.diff_after")}</p>
              <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-fg">{fieldText(row.field, row.after, t)}</p>
            </div>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * «الإصدارات»: every saved edit left the card as it was before it. Each can be compared with the card now and restored;
 * restoring writes a NEW version (the server never rewrites history), so it can itself be undone.
 */
export function RevisionsSection({ card, canWrite, onRestore, initial }: { card: CardItem; canWrite: boolean; onRestore: (version: number) => Promise<void>; initial?: RevisionsView }) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState<number | null>(null);
  const query = useQuery({
    queryKey: [...revisionsKey(card.id), card.version ?? 0],
    queryFn: () => apiGet<RevisionsView>(`/api/cards/${card.id}/revisions`),
    ...(initial ? { initialData: initial } : {}),
    staleTime: 5_000,
  });
  if (query.isError) return <p role="alert" className="text-sm text-danger">{t("cards.p.load_failed")}</p>;
  const data = query.data;
  if (!data) return <p role="status" className="text-sm text-fg-muted">{t("cards.p.loading")}</p>;

  return (
    <section aria-label={t("cards.p.tab.versions")} className="flex flex-col gap-2">
      <p className="text-sm font-medium text-fg">{t("cards.p.version_current", { n: fmtNumber(data.currentVersion) })}</p>
      {canWrite ? <p className="text-xs text-fg-muted">{t("cards.p.restore_hint")}</p> : null}
      {data.revisions.length === 0 ? <p className="text-sm text-fg-muted">{t("cards.p.versions_empty")}</p> : null}
      <ul className="m-0 flex flex-col gap-2 p-0">
        {data.revisions.map((r) => (
          <li key={r.version} className="flex list-none flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  <History className="size-4 shrink-0" aria-hidden="true" />
                  {t("cards.p.version_n", { n: fmtNumber(r.version) })}
                </p>
                <p dir="auto" className="text-xs text-fg-muted">
                  {t("cards.p.version_by", { name: r.editorName })} · {fmtDateTime(r.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" aria-expanded={open === r.version} onClick={() => setOpen(open === r.version ? null : r.version)}>
                  {open === r.version ? t("cards.p.version_hide") : t("cards.p.version_show")}
                </Button>
                {canWrite ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => {
                      setBusy(r.version);
                      void onRestore(r.version).finally(() => setBusy(null));
                    }}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {t("cards.p.version_restore")}
                  </Button>
                ) : null}
              </div>
            </div>
            {open === r.version ? <RevisionDiff revision={r} card={card} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
