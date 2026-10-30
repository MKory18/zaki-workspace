"use client";

import { ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { currencyName, REWARD_CURRENCIES, REWARD_NOTE_MAX } from "@/lib/rewards";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * The three boxes of a reward — amount, currency, note — shared by the owner's «مهمة بمكافأة» toggle (the instant task
 * dialog) and the reward card of the task page. The amount is plain text ("12.5"): the SERVER turns it into integer minor
 * units (src/lib/rewards.ts), so no float is ever added or compared on the screen.
 */
export interface RewardDraft {
  amount: string;
  currency: string;
  note: string;
}

export const emptyDraft = (currency: string | null | undefined): RewardDraft => ({ amount: "", currency: currency ?? "", note: "" });

/** The body the routes take (`rewardBodySchema`). */
export function rewardBodyOf(draft: RewardDraft): { amount: string; currency: string | null; note: string | null } {
  return { amount: draft.amount.trim(), currency: draft.currency || null, note: draft.note.trim() || null };
}

/** Whether the boxes are filled enough to send (the server still checks every rule). */
export function draftReady(draft: RewardDraft): boolean {
  return draft.amount.trim() !== "" && draft.currency !== "";
}

/** The Arabic line for a refused request: the reason inside a 422's details, else the answer's own key, else the generic one. */
export function rewardErrorText(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    const detail = Array.isArray(err.details) ? (err.details[0] as { message?: string } | undefined)?.message : undefined;
    for (const key of [detail, err.messageKey]) {
      if (!key) continue;
      const text = t(key);
      if (text !== key) return text;
    }
  }
  return t("common.error");
}

export function RewardFields({ value, onChange, idPrefix }: { value: RewardDraft; onChange: (next: RewardDraft) => void; idPrefix: string }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-reward-fields>
      <label className="block space-y-1 text-xs" htmlFor={`${idPrefix}-amount`}>
        <span className="font-medium text-fg">{t("reward.amount")}</span>
        <Input
          id={`${idPrefix}-amount`}
          inputMode="decimal"
          dir="ltr"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          placeholder={t("reward.amount_placeholder")}
          maxLength={24}
          required
        />
      </label>
      <label className="block space-y-1 text-xs" htmlFor={`${idPrefix}-currency`}>
        <span className="font-medium text-fg">{t("reward.currency")}</span>
        <Select id={`${idPrefix}-currency`} value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })} required>
          <option value="">{t("reward.currency_pick")}</option>
          {REWARD_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {currencyName(code)}
            </option>
          ))}
        </Select>
      </label>
      <label className="block space-y-1 text-xs sm:col-span-2" htmlFor={`${idPrefix}-note`}>
        <span className="font-medium text-fg">{t("reward.note")}</span>
        <Input id={`${idPrefix}-note`} value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} maxLength={REWARD_NOTE_MAX} />
      </label>
    </div>
  );
}

/** ⚠️ + 🔧: the app records and approves; the payroll pays. Shown wherever a reward is set or approved. */
export function MoneyNote() {
  const { t } = useI18n();
  return (
    <p data-reward-money-note className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg">
      <span className="block font-medium">{t("reward.money_note")}</span>
      <span className="block text-fg-muted">{t("reward.money_fix")}</span>
    </p>
  );
}

/**
 * «مهمة بمكافأة»: the toggle of a creation form. Drawn ONLY when `offered` (the server offers it to the owner alone: `GET
 * /api/instant` answers `reward: null` to everybody else, and the routes refuse them anyway). The due date is required when it is on.
 */
export function RewardToggleBlock({
  offered,
  on,
  onToggle,
  draft,
  onDraft,
  dayMissing,
  idPrefix,
}: {
  offered: boolean;
  on: boolean;
  onToggle: (next: boolean) => void;
  draft: RewardDraft;
  onDraft: (next: RewardDraft) => void;
  dayMissing: boolean;
  idPrefix: string;
}) {
  const { t } = useI18n();
  if (!offered) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border p-2.5" data-reward-toggle>
      <label className="flex items-center gap-2 text-xs font-medium text-fg">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} className="size-4 accent-accent" />
        {t("reward.toggle")}
      </label>
      {on ? (
        <>
          <p className="text-xs text-fg-muted">{t("reward.toggle_hint")}</p>
          <RewardFields value={draft} onChange={onDraft} idPrefix={idPrefix} />
          {dayMissing ? <p className="text-xs text-danger">{t("reward.due_required")}</p> : null}
          <MoneyNote />
        </>
      ) : null}
    </div>
  );
}
