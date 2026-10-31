"use client";

import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { StepView } from "@/lib/approvals/view";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

/**
 * «سلسلة الموافقة»: the approvers in order, each with the state of their step, the time and the reason they wrote. The step
 * whose turn it is carries «دوره الآن». The next approver is told only when the one before approves, and the line says so while
 * a later step is still waiting.
 */
export function Chain({ steps, status, currentStep }: { steps: StepView[]; status: string; currentStep: number }) {
  const { t } = useI18n();
  const waiting = status === "PENDING" && steps.some((s) => s.position > currentStep && s.status === "PENDING");
  return (
    <div className="space-y-2" data-approval-chain>
      <ol className="space-y-2">
        {steps.map((step) => {
          const turn = status === "PENDING" && step.position === currentStep && step.status === "PENDING";
          return (
            <li
              key={step.id}
              data-step={step.position}
              data-step-status={step.status}
              className={cn("flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm", turn ? "border-warn/40 bg-warn/10" : "border-border bg-surface-1")}
            >
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-semibold text-fg">{step.position}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-fg">{step.approver.name}</span>
                {step.reason ? <span className="block whitespace-pre-wrap text-xs text-fg-muted">{t("approvals.chain.reason", { reason: step.reason })}</span> : null}
                {step.decidedAt ? (
                  <span className="block text-xs text-fg-muted" suppressHydrationWarning>
                    {fmtDateTime(step.decidedAt)}
                  </span>
                ) : null}
              </span>
              {turn ? <span className="text-xs font-medium text-warn">{t("approvals.chain.turn")}</span> : null}
              <StatusBadge status={step.status} />
            </li>
          );
        })}
      </ol>
      {waiting ? <p className="text-xs text-fg-muted">{t("approvals.chain.sequential")}</p> : null}
    </div>
  );
}
