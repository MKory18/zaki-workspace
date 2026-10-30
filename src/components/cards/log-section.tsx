"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { apiGet } from "@/lib/api-client";
import type { LogEntry } from "@/lib/cards/page";
import { logText } from "@/lib/cards/texts";

export const logKey = (cardId: string) => ["card", cardId, "log"] as const;

/**
 * «السجل»: what happened to the card, newest first, read-only, built from the audit log by the server. It never carries
 * anybody's stars, and a rating line names its person only for the owner and the card's creator.
 */
export function LogSection({ cardId, version, initial }: { cardId: string; version?: number; initial?: LogEntry[] }) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: [...logKey(cardId), version ?? 0],
    queryFn: async () => (await apiGet<{ entries: LogEntry[] }>(`/api/cards/${cardId}/log`)).entries,
    ...(initial ? { initialData: initial } : {}),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
  if (query.isError) return <p role="alert" className="text-sm text-danger">{t("cards.p.load_failed")}</p>;
  const entries = query.data;
  if (!entries) return <p role="status" className="text-sm text-fg-muted">{t("cards.p.loading")}</p>;
  if (entries.length === 0) return <p className="text-sm text-fg-muted">{t("cards.p.log_empty")}</p>;
  return (
    <ol aria-label={t("cards.p.tab.log")} className="m-0 flex flex-col p-0">
      {entries.map((e) => (
        <li key={e.id} className="flex list-none flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0">
          <p dir="auto" className="text-sm text-fg">
            {e.action === "rated" && !e.actorName
              ? logText(e, t)
              : t("cards.p.log_by", { name: e.actorName ?? t("cards.p.someone"), what: logText(e, t) })}
          </p>
          <p className="text-xs text-fg-muted">{fmtDateTime(e.at)}</p>
        </li>
      ))}
    </ol>
  );
}
