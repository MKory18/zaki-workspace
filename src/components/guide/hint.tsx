"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { browserStore, dismissHint, isHintDismissed } from "@/lib/guide/storage";
import { cn } from "@/lib/utils";

/** The tip itself: a note with the words and a «فهمت» button (a thumb-sized one). */
export function HintView({
  children,
  onDismiss,
  className,
}: {
  children?: ReactNode;
  onDismiss: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div role="note" className={cn("flex items-start gap-3 rounded-xl border border-border bg-surface-2 p-3", className)}>
      <span aria-hidden className="text-lg leading-7">
        💡
      </span>
      <p className="min-w-0 flex-1 text-sm leading-7 text-fg">{children}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-accent hover:bg-surface-1"
      >
        {t("guide.hint.dismiss")}
      </button>
    </div>
  );
}

/**
 * A tip shown ONCE on a device, the first time somebody reaches a place where it helps («ضغطة
 * مطوّلة على أي رسالة بتحوّلها لمهمة»). `id` names the tip: dismissing it hides it for good on this
 * device. Nothing is drawn on the server or before the device has been asked, so a tip that was
 * already dismissed never flashes.
 */
export function Hint({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const [state, setState] = useState<"asking" | "show" | "hidden">("asking");

  useEffect(() => {
    setState(isHintDismissed(browserStore(), id) ? "hidden" : "show");
  }, [id]);

  if (state !== "show") return null;
  return (
    <HintView
      className={className}
      onDismiss={() => {
        dismissHint(browserStore(), id);
        setState("hidden");
      }}
    >
      {children}
    </HintView>
  );
}
