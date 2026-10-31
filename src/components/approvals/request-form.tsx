"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { currencyName, REWARD_CURRENCIES } from "@/lib/rewards";
import { APPROVAL_LIMITS, type LinkKind } from "@/lib/approvals/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApproverPicker, type Candidate } from "./approver-picker";
import { AttachmentPicker, type PickedFile } from "./attachments";
import { errorText } from "./errors";

export interface RequestDraft {
  title: string;
  details: string;
  amount: string;
  currency: string;
  approverIds: string[];
  files: PickedFile[];
}

export const emptyRequest = (): RequestDraft => ({ title: "", details: "", amount: "", currency: "", approverIds: [], files: [] });

/** ⚠️ + 🔧: an approval only records a decision; no amount is ever moved from here. */
export function MoneyNote() {
  const { t } = useI18n();
  return (
    <p data-approval-money-note className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg">
      <span className="block font-medium">{t("approvals.money_note")}</span>
      <span className="block text-fg-muted">{t("approvals.money_fix")}</span>
    </p>
  );
}

/** The thing a request can be about, as the page was opened with it (`?link=TASK:<id>`). */
export function linkLabel(kind: LinkKind, t: (key: string) => string): string {
  return t(`approvals.link.${kind}`);
}

/**
 * «طلب موافقة»: title, details, an optional amount, the chain of approvers in order, files, and (when the page was opened from a
 * task, a card or a message) the thing it is about. `mode="resubmit"` is the same form for a request that was sent back: it sends a
 * NEW VERSION. A refusal is shown in Arabic under the form.
 */
export function RequestForm({
  workspaceId,
  people,
  mode,
  requestId,
  link,
  initial,
}: {
  workspaceId: string;
  people: Candidate[];
  mode: "create" | "resubmit";
  requestId?: string;
  link?: { kind: LinkKind; id: string } | null;
  initial?: RequestDraft;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [draft, setDraft] = useState<RequestDraft>(initial ?? emptyRequest());
  const [keepLink, setKeepLink] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const hasAmount = draft.amount.trim() !== "";
  const ready = draft.title.trim() !== "" && draft.approverIds.length > 0 && (!hasAmount || draft.currency !== "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const common = {
        title: draft.title,
        details: draft.details,
        approverIds: draft.approverIds,
        fileIds: draft.files.map((f) => f.id),
        // an empty amount is «no amount» (null clears it on a resubmit)
        amount: hasAmount ? draft.amount.trim() : null,
        currency: hasAmount ? draft.currency : null,
      };
      if (mode === "create") {
        const res = await apiPost<{ approval: { id: string } }>("/api/approvals", { ...common, workspaceId, ...(link && keepLink ? { link } : {}) });
        router.push(`/approvals/${res.approval.id}`);
      } else {
        await apiPost(`/api/approvals/${requestId}/resubmit`, common);
        router.refresh();
      }
    } catch (err) {
      setError(errorText(err, t));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-request-form={mode}>
      <label className="block space-y-1 text-xs" htmlFor="req-title">
        <span className="font-medium text-fg">{t("approvals.form.title")}</span>
        <Input id="req-title" value={draft.title} maxLength={APPROVAL_LIMITS.title} onChange={(e) => set("title", e.target.value)} required />
      </label>
      <label className="block space-y-1 text-xs" htmlFor="req-details">
        <span className="font-medium text-fg">{t("approvals.form.details")}</span>
        <Textarea id="req-details" rows={5} value={draft.details} maxLength={APPROVAL_LIMITS.details} onChange={(e) => set("details", e.target.value)} />
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1 text-xs" htmlFor="req-amount">
          <span className="font-medium text-fg">{t("approvals.form.amount")}</span>
          <Input id="req-amount" inputMode="decimal" dir="ltr" value={draft.amount} maxLength={24} onChange={(e) => set("amount", e.target.value)} placeholder={t("approvals.form.amount_placeholder")} />
        </label>
        <label className="block space-y-1 text-xs" htmlFor="req-currency">
          <span className="font-medium text-fg">{t("approvals.form.currency")}</span>
          <Select id="req-currency" value={draft.currency} onChange={(e) => set("currency", e.target.value)} required={hasAmount}>
            <option value="">{t("approvals.form.currency_pick")}</option>
            {REWARD_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {currencyName(code)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {hasAmount ? <MoneyNote /> : null}

      <div className="space-y-1 text-xs">
        <span className="block font-medium text-fg">{t("approvals.form.approvers")}</span>
        <ApproverPicker people={people} value={draft.approverIds} onChange={(next) => set("approverIds", next)} idPrefix="req" />
      </div>

      <div className="space-y-1 text-xs">
        <span className="block font-medium text-fg">{t("approvals.form.files")}</span>
        <AttachmentPicker value={draft.files} onChange={(next) => set("files", next)} />
      </div>

      {mode === "create" && link ? (
        <label className="flex items-center gap-2 text-xs text-fg" data-request-link>
          <input type="checkbox" className="size-4 accent-accent" checked={keepLink} onChange={(e) => setKeepLink(e.target.checked)} />
          {t("approvals.form.link", { what: linkLabel(link.kind, t) })}
        </label>
      ) : null}

      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy || !ready}>
        {busy ? t("common.saving") : mode === "create" ? t("approvals.form.send") : t("approvals.form.resend")}
      </Button>
    </form>
  );
}
