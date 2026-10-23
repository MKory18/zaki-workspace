"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function isShown(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

/** Every ancestor of `el` that scrolls vertically (`overflow-y: auto | scroll`), nearest first. */
function scrollingAncestors(el: Element | null): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = window.getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") found.push(node);
  }
  return found;
}

/**
 * A panel over the page: a bottom sheet on a phone, a side panel on a wide screen.
 *
 * Keyboard and screen reader: it is a modal dialog labelled by its title, focus moves into it when
 * it opens and comes back to what opened it when it closes, Tab stays inside, Escape closes it, and
 * the page behind does not scroll. `dismissOnBackdrop={false}` stops a stray tap outside from
 * closing it (used while a password that is shown only once is on screen).
 */
export function Sheet({
  title,
  onClose,
  children,
  dismissOnBackdrop = true,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  dismissOnBackdrop?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // the latest callback without re-running the focus effect (and re-grabbing focus) on every render
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // The page behind must not scroll. In the app the scrolling element is a container inside the
    // layout, not the body, so every scrolling ancestor of what opened the panel is frozen as well.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frozen = scrollingAncestors(opener).map((el) => ({ el, overflowY: el.style.overflowY }));
    for (const { el } of frozen) el.style.overflowY = "hidden";
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const current = panelRef.current;
      if (!current) return;
      const items = Array.from(current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isShown);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        current.focus();
        return;
      }
      const active = document.activeElement;
      if (!current.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      for (const { el, overflowY } of frozen) el.style.overflowY = overflowY;
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  // A control that had the focus can disappear (the action it ran changed what is offered, or the form
  // was replaced by its result): without this the focus would fall to the page behind the dialog.
  // Declared after the effect above on purpose: that one records what opened the panel first.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/50 md:items-stretch md:justify-end"
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) closeRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-xl outline-none animate-fade-in",
          "md:max-h-none md:w-[28rem] md:rounded-none md:rounded-s-2xl md:border-y-0 md:border-e-0",
          className,
        )}
      >
        <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border md:hidden" />
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => closeRef.current()}
            aria-label={t("members.sheet_close")}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(5rem,env(safe-area-inset-bottom))] pt-4">
          {children}
        </div>
      </div>
    </div>
  );
}
