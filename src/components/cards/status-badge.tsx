import * as React from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CardStatus } from "@/lib/cards/status";

/** One class set per status, theme tokens only (never a default palette colour or a hex value). */
const STATUS_STYLE: Record<CardStatus, string> = {
  DRAFT: "border-border bg-surface-2 text-fg-muted",
  REVIEW: "border-warn/40 bg-warn/10 text-fg",
  APPROVED: "border-ok/40 bg-ok/10 text-fg",
  ARCHIVED: "border-info/40 bg-info/10 text-fg",
};

/** The approval status as a word in a pill (the colour alone says nothing to a screen reader). */
export function StatusBadge({ status, className }: { status: CardStatus; className?: string }) {
  const { t } = useI18n();
  return (
    <span data-status={status} className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_STYLE[status], className)}>
      {t(`cards.status.${status}`)}
    </span>
  );
}
