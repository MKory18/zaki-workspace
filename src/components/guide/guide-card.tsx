"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { browserStore, storageKeys } from "@/lib/guide/storage";

/**
 * «دليل زاكي» — the little card under the route of «اليوم», as in the owner's adopted mockup: the
 * gold arch with the photograph inside, the welcome line, and two buttons — «يلا» starts the app's
 * tour (the same `startTour` the «؟» panel uses, loaded only when pressed), «بعدين» folds the card
 * away on this device (remembered per person, like the first-steps card).
 *
 * The arch is a decoration and stands beside the words, never behind them.
 */
export function GuideCard({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const store = browserStore();
    setHidden(store?.getItem(storageKeys.guideCardLater(userId)) === "1");
  }, [userId]);

  if (hidden) return null;

  async function start() {
    if (started) return;
    setStarted(true);
    const { startTour } = await import("./tour-runner");
    const ok = await startTour("shell", t);
    if (!ok) setStarted(false);
  }

  return (
    <section aria-label={t("guide.card.aria")} className="flex items-center gap-3.5 rounded-[18px] border border-border bg-surface-1 p-[18px]">
      <div aria-hidden="true" className="zk-arch relative h-[88px] w-[68px] shrink-0">
        <span className="zk-arch-in absolute start-[3px] top-1 block h-[84px] w-[62px]" />
      </div>
      <div className="min-w-0">
        <b className="block leading-6 text-fg">{t("guide.card.title")}</b>
        <p className="mb-2 mt-0.5 text-sm text-muted">{t("guide.card.body")}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void start()}
            disabled={started}
            className="inline-flex min-h-9 items-center justify-center rounded-lg bg-accent-2 px-4 text-sm font-bold text-scrim transition-[filter] hover:brightness-110 disabled:opacity-70"
          >
            {t("guide.card.start")}
          </button>
          <button
            type="button"
            onClick={() => {
              setHidden(true);
              browserStore()?.setItem(storageKeys.guideCardLater(userId), "1");
            }}
            className="inline-flex min-h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-muted transition-colors hover:text-fg"
          >
            {t("guide.card.later")}
          </button>
        </div>
      </div>
    </section>
  );
}
