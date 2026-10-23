"use client";

import { useCallback, useEffect, useId, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Audience } from "@/lib/guide/audience";
import {helpArticleHref, helpNextKey, matchHelp, type PageHelp, helpWhatKey } from "@/lib/guide/page-help";
import { cn } from "@/lib/utils";

/**
 * The panel itself: «شو هاي الصفحة» and «الخطوة الجاية» in two short lines, «فرجيني» when the page
 * has a tour, and the way to the guide. A bottom sheet on a phone, a floating panel on a computer.
 * No state of its own, so every audience and page can be rendered in a test.
 */
export function HelpPanel({
  help,
  audience,
  linkAudience,
  titleId,
  onClose,
  onTour,
  tourFailed = false,
  panelRef,
}: {
  help: PageHelp;
  /** Picks the second line (a guest gets the read-only one). */
  audience: Audience;
  /** Picks which articles may be linked; the same as `audience` unless told otherwise. */
  linkAudience?: Audience;
  titleId: string;
  onClose: () => void;
  onTour: () => void;
  tourFailed?: boolean;
  panelRef?: Ref<HTMLDivElement>;
}) {
  const { t } = useI18n();
  const href = helpArticleHref(help, linkAudience ?? audience);
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-card-hover animate-fade-in focus:outline-none motion-reduce:animate-none md:inset-x-auto md:bottom-4 md:end-4 md:w-[26rem] md:rounded-2xl"
    >
      <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-border md:hidden" />
      <div className="flex items-start justify-between gap-3">
        <h2 id={titleId} className="text-lg font-semibold text-fg">
          {t("guide.help.title")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("guide.help.close")}
          className="-mt-1 grid size-11 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>

      <section className="mt-2">
        <h3 className="text-sm font-semibold text-accent">{t("guide.help.what")}</h3>
        <p className="mt-1 text-[15px] leading-8 text-fg">{t(helpWhatKey(help, audience))}</p>
      </section>
      <section className="mt-4">
        <h3 className="text-sm font-semibold text-accent">{t("guide.help.next")}</h3>
        <p className="mt-1 text-[15px] leading-8 text-fg">{t(helpNextKey(help, audience))}</p>
      </section>

      {tourFailed ? (
        <p role="status" className="mt-3 text-sm leading-7 text-fg-muted">
          {t("guide.help.tour_unavailable")}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {help.tour ? (
          <button
            type="button"
            onClick={onTour}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
          >
            {t("guide.help.tour")}
          </button>
        ) : null}
        <Link
          href={href}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
        >
          {href === "/guide" ? t("guide.help.guide") : t("guide.help.article")}
        </Link>
      </div>
    </div>
  );
}

/**
 * The «؟» button for the top bar: it explains the page the person is on. Give it the current
 * `pathname`; on a page that has no help it draws nothing (no dead button).
 *
 * `audience` is the viewer's guide level (`audienceOf(actor)`, computed on the server): it picks the
 * read-only line for an external partner and keeps the «read more» link to an article that person
 * can open. Left out, the staff lines are shown and only articles for everyone are linked.
 *
 * The sheet is its own small dialog (role dialog, focus moves in and is kept inside, Escape and a
 * tap outside close it, focus goes back to the button) drawn into the page body, so a bar with a
 * blurred background cannot trap it. «فرجيني» loads the tour library only when it is asked for.
 */
export function PageHelpButton({
  pathname,
  audience,
  className,
}: {
  pathname: string;
  audience?: Audience;
  className?: string;
}) {
  const { t } = useI18n();
  const help = matchHelp(pathname);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tourFailed, setTourFailed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tourLoaded = useRef(false);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  // a new page: the sheet of the old one goes away, and so does a tour that was running on it
  useEffect(() => {
    setOpen(false);
    setTourFailed(false);
    return () => {
      if (tourLoaded.current) void import("./tour-runner").then((m) => m.stopTour());
    };
  }, [pathname]);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // while the sheet is open the page behind it must not scroll (a touch drag on the backdrop
  // scrolled the workspace under it); the lock is removed the moment it closes
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // while it is open: focus moves in, Tab stays inside, Escape closes
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("button, a[href]")?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!(active instanceof Node) || !panel.contains(active)) {
        // focus fell out of the sheet (a tap on plain text leaves it on the page): bring it back
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  const tourKey = help?.tour;
  const startTourNow = useCallback(async () => {
    if (!tourKey) return;
    setTourFailed(false);
    const { startTour } = await import("./tour-runner");
    tourLoaded.current = true;
    // the sheet goes first, so nothing of it stands in front of what the tour points at
    setOpen(false);
    // driver.js hands focus to `body` when its popover closes, so the focus must already be back
    // on the button — otherwise a keyboard user is dropped into nowhere (WP-UI2 item 11)
    triggerRef.current?.focus();
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    const started = await startTour(tourKey, t);
    if (!started) {
      setOpen(true);
      setTourFailed(true);
    }
  }, [tourKey, t]);

  if (!help) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("guide.help.open")}
        title={t("guide.help.open")}
        onClick={() => setOpen(true)}
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full text-lg font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg",
          className,
        )}
      >
        <span aria-hidden>؟</span>
      </button>

      {mounted && open
        ? createPortal(
            <div className="fixed inset-0 z-[90]">
              <div aria-hidden className="absolute inset-0 bg-scrim/50" onClick={close} />
              <HelpPanel
                help={help}
                audience={audience ?? "staff"}
                linkAudience={audience ?? "everyone"}
                titleId={titleId}
                onClose={close}
                onTour={() => void startTourNow()}
                tourFailed={tourFailed}
                panelRef={panelRef}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
