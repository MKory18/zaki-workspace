"use client";

import { useState } from "react";
import { apiPost, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import type { ProposalView } from "@/server/services/owner-assistant-proposals";

/**
 * «مساعد المالك» — a proposal as a card: «اقتراح: …», the exact parameters in plain Arabic (real names and titles, put back on the
 * server), the reason, and two buttons. Nothing has been done until «وافق»; the card says so in words (⚠️ + 🔧).
 * Pressing a button asks the server, which decides again (a second click, a stale proposal, a changed task: it answers, the card
 * shows the answer).
 */

const TONE: Record<string, string> = {
  PENDING: "border-warn/40 bg-warn/10 text-warn",
  APPROVED: "border-ok/40 bg-ok/10 text-ok",
  REJECTED: "border-border bg-surface-2 text-muted",
  EXPIRED: "border-border bg-surface-2 text-muted",
  FAILED: "border-danger/40 bg-danger/10 text-danger",
};

export function ProposalCard({ proposal, onChange }: { proposal: ProposalView; onChange?: (next: ProposalView) => void }) {
  const { t } = useI18n();
  const [view, setView] = useState<ProposalView>(proposal);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (what: "approve" | "reject") => {
    setBusy(what);
    setError(null);
    try {
      const res = await apiPost<{ proposal: ProposalView }>(`/api/owner-assistant/proposals/${view.id}/${what}`);
      setView(res.proposal);
      onChange?.(res.proposal);
    } catch (err) {
      setError(err instanceof ApiError && err.messageKey ? t(err.messageKey) : t("common.error"));
    } finally {
      setBusy(null);
    }
  };

  const title = t(`assistant.proposal.${view.type}`) === `assistant.proposal.${view.type}` ? t("assistant.proposal.unknown") : t(`assistant.proposal.${view.type}`);
  return (
    <article className="rounded-xl border border-border bg-surface p-3 shadow-card" data-testid="ai-proposal" data-status={view.status} data-type={view.type}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${TONE[view.status] ?? TONE["EXPIRED"]}`} data-testid="ai-proposal-status">
          {t(`assistant.status.${view.status}`)}
        </span>
      </header>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {view.lines.map((line) => (
          <div key={`${line.labelKey}:${line.value}`} className="contents">
            <dt className="text-muted">{t(line.labelKey)}</dt>
            <dd className="break-words">{line.value}</dd>
          </div>
        ))}
      </dl>
      {view.reason ? (
        <p className="mt-2 text-sm leading-6 text-muted">
          <span className="font-medium text-fg">{t("assistant.proposal.reason")}: </span>
          {view.reason}
        </p>
      ) : null}
      {view.requested ? <p className="mt-2 text-xs text-info">{t("assistant.proposal.requested")}</p> : null}
      {view.status === "FAILED" ? (
        <p className="mt-2 text-xs text-danger" role="status">
          {t("assistant.proposal.failed_prefix")} {t(view.errorKey ?? "assistant.exec_failed")}
        </p>
      ) : null}
      {view.status === "PENDING" ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy !== null} onClick={() => decide("approve")} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50" data-testid="ai-approve">
              {busy === "approve" ? t("assistant.proposal.working") : t("assistant.proposal.approve")}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => decide("reject")} className="rounded-lg border border-border bg-surface-1 px-4 py-1.5 text-sm text-fg disabled:opacity-50" data-testid="ai-reject">
              {t("assistant.proposal.reject")}
            </button>
            <span className="text-xs text-muted">{t("assistant.proposal.expires")}</span>
          </div>
          <p className="text-xs text-muted">{t("assistant.proposal.safety")}</p>
        </div>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
