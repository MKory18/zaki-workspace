"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Pin } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CardPageData } from "@/lib/cards/page";
import type { CardStatus } from "@/lib/cards/status";
import { statusOf } from "@/lib/cards/status";
import { COLOR_STYLE } from "./colors";
import { KIND_ICON } from "./card-tile";
import { StatusBadge } from "./status-badge";
import { RatersList, StarPicker, StarsAverage } from "./stars";

/**
 * The top of a card's page: the cover picture (above the title, never behind any text), the title with its kind and
 * status, the stars, the pin, the colour, the category, the tags, who made it and when. The status can be moved here by
 * a moderator; the stars can be given here by a person in the space.
 */
export function CardPageHeader({
  data,
  onStatus,
  onRate,
  busy = false,
}: {
  data: CardPageData;
  onStatus: (status: CardStatus) => void;
  onRate: (stars: number) => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const { card, abilities, rating } = data;
  const Icon = KIND_ICON[card.kind];
  const status = statusOf(card.status);

  return (
    <header className={cn("flex flex-col gap-3 rounded-2xl border p-3 md:p-4", COLOR_STYLE[card.color].card)}>
      <Link href="/cards" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-fg-muted hover:text-fg">
        <ArrowRight className="size-4" aria-hidden="true" />
        {t("cards.p.back")}
        <span dir="auto" className="truncate text-xs">· {data.spaceName}</span>
      </Link>

      {card.coverFileId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${card.coverFileId}/raw`}
          alt={t("cards.p.cover")}
          className="h-40 w-full rounded-xl border border-border bg-surface-2 object-cover md:h-60"
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span className="inline-flex items-center gap-1">
          <Icon className="size-4" aria-hidden="true" />
          {t(`cards.kind.${card.kind}`)}
        </span>
        <StatusBadge status={status} />
        {card.pinned ? (
          <span className="inline-flex items-center gap-1 text-accent">
            <Pin className="size-4" aria-hidden="true" />
            {t("cards.pinned")}
          </span>
        ) : null}
        <span>{t("cards.p.version", { n: fmtNumber(card.version ?? 1) })}</span>
      </div>

      <h1 dir="auto" className="break-words text-2xl font-bold text-fg">{card.title}</h1>

      {card.category || card.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {card.category ? <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-fg">{card.category}</span> : null}
          {card.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">{tag}</span>
          ))}
        </div>
      ) : null}

      <p dir="auto" className="text-xs text-fg-muted">
        {t("cards.p.created_by", { name: card.createdByName })} · {t("cards.p.created_at", { date: fmtDateTime(card.createdAt) })} · {t("cards.p.updated_at", { date: fmtDateTime(card.updatedAt) })}
      </p>

      {abilities.internal && rating ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h2 className="text-sm font-semibold text-fg">{t("cards.p.stars")}</h2>
          <StarsAverage rating={rating} />
          {abilities.participate ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-fg-muted">{t("cards.p.stars_mine")}</span>
              <StarPicker value={rating.mine} onPick={onRate} disabled={busy} />
            </div>
          ) : abilities.oversight ? (
            <p className="text-xs text-fg-muted">{t("cards.p.stars_silent")}</p>
          ) : null}
          {abilities.seeRaters ? <RatersList rating={rating} /> : null}
        </div>
      ) : null}

      {abilities.internal ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <h2 className="text-sm font-semibold text-fg">{t("cards.p.status")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {abilities.statusMoves.length === 0 ? <StatusBadge status={status} /> : null}
            {abilities.statusMoves.map((to) => (
              <Button key={to} type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onStatus(to)}>
                {t("cards.p.status_to", { status: t(`cards.status.${to}`) })}
              </Button>
            ))}
          </div>
          <p className="text-xs text-fg-muted">{t("cards.p.status_hint")}</p>
        </div>
      ) : null}
    </header>
  );
}
