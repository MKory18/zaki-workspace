"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { APPROVAL_LIMITS, reasonProblem, type Decision } from "@/lib/approvals/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "./errors";

/**
 * «قرارك»: approve, ask for changes or reject. A rejection and a request for changes need a written reason (the server refuses
 * without one too); an approval may carry a note. `send` makes the call; a refusal is shown here in Arabic.
 */
export function DecisionPanel({ send }: { send: (decision: Decision, reason: string) => Promise<void> }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(decision: Decision) {
    const problem = reasonProblem(decision, reason);
    if (problem) {
      setError(t(problem));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await send(decision, reason);
    } catch (err) {
      setError(errorText(err, t));
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2 rounded-xl border border-warn/40 bg-warn/10 p-3" data-decision-panel>
      <h2 className="text-sm font-semibold text-fg">{t("approvals.decision.title")}</h2>
      <p className="text-xs text-fg-muted">{t("approvals.decision.hint")}</p>
      <label className="block space-y-1 text-xs" htmlFor="decision-reason">
        <span className="font-medium text-fg">{t("approvals.decision.reason")}</span>
        <Textarea id="decision-reason" rows={3} value={reason} maxLength={APPROVAL_LIMITS.reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => void go("APPROVE")}>
          {t("approvals.decision.APPROVE")}
        </Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void go("CHANGES")}>
          {t("approvals.decision.CHANGES")}
        </Button>
        <Button type="button" variant="danger" disabled={busy} onClick={() => void go("REJECT")}>
          {t("approvals.decision.REJECT")}
        </Button>
      </div>
    </section>
  );
}
