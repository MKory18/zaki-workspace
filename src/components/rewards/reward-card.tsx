"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trophy } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { fmtDMY } from "@/lib/format";
import { interpolate } from "@/lib/i18n/interpolate";
import { useI18n } from "@/lib/i18n";
import { fmtReward, minorToAmountText, timeLeftText } from "@/lib/rewards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { MoneyNote, RewardFields, draftReady, emptyDraft, rewardBodyOf, rewardErrorText, type RewardDraft } from "./reward-fields";

/**
 * «المكافأة» on the task's page: the amount, the status, the deadline with the time left, the note. The OWNER also gets the
 * controls (add or edit the reward, «اعتمد المكافأة لـ…» once the task is finished, «ألغِ المكافأة»); everybody else who may open
 * the task reads it, with the line that says why they cannot change it. A partner is never given this card (the page
 * passes nothing). ⚠️ + 🔧: the app records and approves, the payroll pays.
 */
export interface RewardCardData {
  status: "OPEN" | "AWARDED" | "CANCELLED" | null;
  amountMinor: number | null;
  currency: string | null;
  note: string | null;
  /** The task's own due date (the reward needs one). */
  dueDate: string | null;
  /** The task is finished (completedAt is set): the owner may award. */
  completed: boolean;
  awardedToName: string | null;
  awardedAt: string | null;
  cancelReason: string | null;
}

export interface RewardPerson {
  id: string;
  name: string;
}

/** The pure face of the card: no network, so a render test (and the owner's page) draw exactly the same thing. */
export function RewardCardView({
  reward,
  owner,
  people,
  now = new Date(),
  busy = false,
  onAward,
  onStartCancel,
  onStartEdit,
}: {
  reward: RewardCardData;
  owner: boolean;
  /** The people of the task (assignee and co-assignees): who the owner may award. */
  people: RewardPerson[];
  now?: Date;
  busy?: boolean;
  onAward?: (person: RewardPerson) => void;
  onStartCancel?: () => void;
  onStartEdit?: () => void;
}) {
  const { t } = useI18n();
  const open = reward.status === "OPEN";
  return (
    <div className="space-y-3" data-reward-card={reward.status ?? "NONE"}>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-fg-muted">{t("reward.card.amount")}</dt>
          <dd className={cn("font-semibold text-fg", reward.status === "CANCELLED" && "text-muted line-through")}>{fmtReward(reward.amountMinor, reward.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">{t("reward.card.status")}</dt>
          <dd className={cn("font-medium", reward.status === "AWARDED" ? "text-ok" : reward.status === "CANCELLED" ? "text-muted" : "text-warn")}>
            {t(`reward.status.${reward.status ?? "NONE"}`)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">{t("reward.card.deadline")}</dt>
          <dd className="text-fg" suppressHydrationWarning>
            {reward.dueDate ? fmtDMY(reward.dueDate) : "—"}
            {open && reward.dueDate && !reward.completed ? <span className="ms-1 text-xs text-fg-muted">({timeLeftText(reward.dueDate, now)})</span> : null}
          </dd>
        </div>
      </dl>
      {reward.note ? (
        <p className="text-sm text-fg-muted">
          <span className="text-xs">{t("reward.card.note")}: </span>
          {reward.note}
        </p>
      ) : null}
      {reward.status === "AWARDED" && reward.awardedToName ? (
        <p className="text-sm text-ok">
          {interpolate(t("reward.card.awarded_to"), { name: reward.awardedToName })}
          {reward.awardedAt ? ` · ${interpolate(t("reward.card.awarded_at"), { date: fmtDMY(reward.awardedAt) })}` : ""}
        </p>
      ) : null}
      {reward.status === "CANCELLED" && reward.cancelReason ? (
        <p className="text-sm text-fg-muted">{interpolate(t("reward.card.cancelled_reason"), { reason: reward.cancelReason })}</p>
      ) : null}

      {owner && open && reward.completed ? (
        <div data-reward-pending className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-3">
          <p className="text-sm font-semibold text-fg">{t("reward.pending.banner")}</p>
          <p className="text-xs text-fg-muted">{t("reward.pending.hint")}</p>
          {people.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {people.map((p) => (
                <Button key={p.id} type="button" size="sm" disabled={busy} onClick={() => onAward?.(p)}>
                  {interpolate(t("reward.award.button"), { name: p.name })}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-fg-muted">{t("reward.not_assignee")}</p>
          )}
        </div>
      ) : null}

      {owner ? (
        <div className="flex flex-wrap gap-2">
          {reward.status !== "AWARDED" ? (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onStartEdit}>
              {t("reward.card.edit")}
            </Button>
          ) : null}
          {open ? (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onStartCancel}>
              {t("reward.cancel.button")}
            </Button>
          ) : null}
        </div>
      ) : (
        <p data-reward-locked className="text-xs text-fg-muted">
          <span className="block font-medium text-fg">{t("reward.locked")}</span>
          {t("reward.locked_hint")}
        </p>
      )}
      <MoneyNote />
    </div>
  );
}

/** The card with its controls (the owner) or read-only (everybody else who may open the task). */
export function RewardCard({
  taskId,
  reward,
  owner,
  people,
  defaultCurrency,
}: {
  taskId: string;
  reward: RewardCardData | null;
  owner: boolean;
  people: RewardPerson[];
  defaultCurrency: string | null;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "cancel">("view");
  const [draft, setDraft] = useState<RewardDraft>(() =>
    reward?.amountMinor != null && reward.currency
      ? { amount: minorToAmountText(reward.amountMinor), currency: reward.currency, note: reward.note ?? "" }
      : emptyDraft(defaultCurrency),
  );
  const [day, setDay] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // nothing to show: no reward, and not the owner who could add one
  if (!reward && !owner) return null;

  async function run(job: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await job();
      toast(t(done), "success");
      setMode("view");
      router.refresh();
    } catch (err) {
      setError(rewardErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  const needsDay = !reward?.dueDate;
  return (
    <div data-reward-section>
    <Card>
      <CardHeader>
        <p className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Trophy className="size-4 text-warn" aria-hidden />
          {t("reward.card.title")}
        </p>
      </CardHeader>
      <CardBody className="space-y-3">
        {mode === "edit" || !reward ? (
          owner ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draftReady(draft) || busy) return;
                void run(() => apiPost(`/api/tasks/${taskId}/reward`, { ...rewardBodyOf(draft), ...(needsDay && day ? { dueDate: day } : {}) }), "reward.card.saved");
              }}
            >
              <RewardFields value={draft} onChange={setDraft} idPrefix={`reward-${taskId}`} />
              {needsDay ? (
                <label className="block space-y-1 text-xs">
                  <span className="font-medium text-fg">{t("reward.due")}</span>
                  <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
                  <span className="block text-fg-muted">{t("reward.due_hint")}</span>
                </label>
              ) : null}
              <MoneyNote />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || !draftReady(draft) || (needsDay && !day)}>
                  {t("reward.card.save")}
                </Button>
                {reward ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setMode("view")}>
                    {t("reward.card.cancel_edit")}
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null
        ) : mode === "cancel" ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim() && !busy) void run(() => apiPost(`/api/tasks/${taskId}/reward/cancel`, { reason: reason.trim() }), "reward.cancel.done");
            }}
          >
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("reward.cancel.reason")}</span>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reward.cancel.reason_placeholder")} maxLength={300} required autoFocus />
            </label>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy || !reason.trim()}>
                {t("reward.cancel.confirm")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMode("view")}>
                {t("reward.cancel.back")}
              </Button>
            </div>
          </form>
        ) : (
          <RewardCardView
            reward={reward}
            owner={owner}
            people={people}
            busy={busy}
            onStartEdit={() => setMode("edit")}
            onStartCancel={() => setMode("cancel")}
            onAward={(p) => {
              if (window.confirm(interpolate(t("reward.award.confirm"), { name: p.name }))) {
                void run(() => apiPost(`/api/tasks/${taskId}/reward/award`, { userId: p.id }), "reward.award.done");
              }
            }}
          />
        )}
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </CardBody>
    </Card>
    </div>
  );
}
