import { Pin } from "lucide-react";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { fmtReward, listBadgeStatus, rewardBadgeText } from "@/lib/rewards";
import { cn } from "@/lib/utils";

/**
 * «🏆 مكافأة 150 دينار» — the badge on a board card, a list row and the Today strip. Drawn only for somebody who may see a
 * reward (the server never hands the numbers to a partner, so a partner's rows carry nothing to draw). A reward that is
 * called off draws nothing here: it shows on the task's own page.
 */
export interface RewardBadgeData {
  status: string | null | undefined;
  amountMinor: number | null | undefined;
  currency: string | null | undefined;
}

export function RewardBadge({ reward, className }: { reward: RewardBadgeData | null | undefined; className?: string }) {
  if (!reward || !listBadgeStatus(reward.status) || reward.amountMinor == null || !reward.currency) return null;
  const awarded = reward.status === "AWARDED";
  return (
    <span
      data-reward-badge
      aria-label={interpolate(AR["reward.badge_aria"] ?? "", { amount: fmtReward(reward.amountMinor, reward.currency) })}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
        awarded ? "border-ok/40 bg-ok/10 text-ok" : "border-warn/40 bg-warn/10 text-warn",
        className,
      )}
    >
      {rewardBadgeText(reward.amountMinor, reward.currency)}
    </span>
  );
}

/** «مثبّتة»: the little pin of a pinned task. */
export function PinMark({ className }: { className?: string }) {
  return (
    <span data-pin-mark role="img" aria-label={AR["pin.pinned"] ?? ""} title={AR["pin.pinned"] ?? ""} className={cn("inline-flex shrink-0 text-accent", className)}>
      <Pin className="size-3.5" aria-hidden />
    </span>
  );
}
