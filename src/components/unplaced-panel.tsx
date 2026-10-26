"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { fmtShort } from "@/lib/format";

type Kind = "idea" | "file" | "goal" | "routine" | "customer" | "opportunity";
type Row = { kind: Kind; id: string; title: string; createdAt: string };
const KINDS: Kind[] = ["idea", "file", "goal", "routine", "customer", "opportunity"];

/**
 * «أشيا قديمة بلا مساحة» on «كل المساحات» (the OWNER and the ADMINs): the ideas, files, goals, routines, customers and
 * opportunities from before spaces had their own, grouped by kind. Each group moves one thing or all of it into a
 * space the person can open (src/server/services/move-to-space.ts decides again). Nothing to move: a quiet line.
 */
export function UnplacedPanel({ spaces }: { spaces: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["spaces", "unplaced"], queryFn: () => apiGet<{ rows: Row[] }>("/api/spaces/unplaced") });
  const groups = useMemo(() => KINDS.map((kind) => ({ kind, rows: (list.data?.rows ?? []).filter((r) => r.kind === kind) })).filter((g) => g.rows.length), [list.data]);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function move(kind: Kind, ids: string[]) {
    const spaceId = target[kind];
    if (!spaceId || busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ moved: number }>("/api/spaces/unplaced/move", { kind, ids, spaceId });
      toast(t("spaces.unplaced.moved", { n: res.moved }), "success");
      await qc.invalidateQueries({ queryKey: ["spaces", "unplaced"] });
    } catch {
      toast(t("spaces.unplaced.move_failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="unplaced-title" className="space-y-3 rounded-2xl border border-border bg-surface-1 p-4">
      <header>
        <h2 id="unplaced-title" className="text-base font-semibold text-fg">{t("spaces.unplaced.title")}</h2>
        <p className="text-sm text-fg-muted">{t("spaces.unplaced.hint")}</p>
      </header>
      {list.isLoading && <p role="status" className="text-sm text-fg-muted">{t("spaces.unplaced.loading")}</p>}
      {list.isError && <p role="alert" className="text-sm text-danger">{t("spaces.unplaced.failed")}</p>}
      {list.data && groups.length === 0 && <p className="text-sm text-fg-muted">{t("spaces.unplaced.none")}</p>}
      {groups.map((g) => (
        <div key={g.kind} className="rounded-xl border border-border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-semibold">
              {t(`spaces.unplaced.kind.${g.kind}`)} <span className="text-fg-muted">({g.rows.length})</span>
            </h3>
            <Select
              aria-label={`${t("spaces.unplaced.to")} ${t(`spaces.unplaced.kind.${g.kind}`)}`}
              value={target[g.kind] ?? ""}
              onChange={(e) => setTarget((prev) => ({ ...prev, [g.kind]: e.target.value }))}
              className="w-auto min-w-40"
            >
              <option value="">{t("spaces.unplaced.pick")}</option>
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
            <Button size="sm" disabled={!target[g.kind] || busy} onClick={() => void move(g.kind, g.rows.map((r) => r.id))}>
              {t("spaces.unplaced.move_all")}
            </Button>
          </div>
          {g.kind === "customer" && <p className="mb-2 text-xs text-fg-muted">{t("spaces.unplaced.customer_note")}</p>}
          <ul className="max-h-64 divide-y divide-border overflow-y-auto">
            {g.rows.map((r) => (
              <li key={r.id} className="flex min-h-11 items-center gap-2 py-1">
                <span className="min-w-0 flex-1 truncate text-sm"><bdi>{r.title}</bdi></span>
                <small className="shrink-0 text-xs text-fg-muted">{fmtShort(r.createdAt)}</small>
                <Button size="sm" variant="ghost" disabled={!target[g.kind] || busy} onClick={() => void move(g.kind, [r.id])}>
                  {t("spaces.unplaced.move")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
