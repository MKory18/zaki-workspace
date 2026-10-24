"use client";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { badgeText } from "@/lib/chat/use-chat-unread";

/**
 * The unread number on a place («الدردشة»): the bell's own look (danger pill, «9+»). The pill is
 * decoration; the link gets the number in words for a screen reader.
 */
export function PlaceBadge({ count, className }: { count: number | undefined; className?: string }) {
  const { t } = useI18n();
  const text = badgeText(count ?? 0);
  if (!text) return null;
  return (
    <>
      <span
        aria-hidden="true"
        data-badge
        className={cn("flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold leading-none text-danger-fg", className)}
      >
        {text}
      </span>
      <span className="sr-only">{t("shell.place_unread", { count: count ?? 0 })}</span>
    </>
  );
}
