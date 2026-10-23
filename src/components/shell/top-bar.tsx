"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import type { Audience } from "@/lib/guide/audience";
import type { NavModel, NavRole } from "@/lib/nav/places";
import { DolphinMark } from "@/components/logo";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { PageHelpButton } from "@/components/guide/page-help-button";
import { NightDaySwitch } from "@/components/theme/night-day-switch";
import { AvatarMenu, type AvatarUser } from "./avatar-menu";
import { NewWheel } from "./new-wheel";

/**
 * The bar over every page, in the owner's adopted shape:
 *
 *   the page title (Reem Kufi, 26px) · the search pill «وين بدك تروح؟» with its Ctrl K hint ·
 *   «ليل / نهار» · «؟» · the bell · the gold «جديد» (and its wheel) · the avatar on a phone.
 *
 * `title` is drawn only where the page does not draw its own heading (today's page: the mockup's
 * «اليوم»); every other page keeps its own h1 and the bar starts with the search. Every control is
 * a 42–44px target. `data-tour`: "search" around the palette's button, "inbox" on the bell.
 */
export function TopBar({
  nav,
  pathname,
  audience,
  user,
  rank,
  title,
}: {
  nav: NavModel;
  pathname: string;
  audience: Audience;
  user: AvatarUser;
  rank: NavRole;
  /** The page title, when the page itself has none. */
  title?: string;
}) {
  const { t } = useI18n();
  return (
    <header className="shrink-0 bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-2 pt-3 md:px-[22px] md:pb-0 md:pt-[18px]">
        <Link href="/" aria-label={t("nav.place.today")} className="grid size-11 shrink-0 place-items-center rounded-xl md:hidden">
          <span aria-hidden="true">
            <DolphinMark className="size-8" />
          </span>
        </Link>
        {title ? <h1 className="min-w-0 truncate font-display text-[26px] leading-tight text-fg">{title}</h1> : null}
        <div data-tour="search" className="order-3 min-w-0 basis-full sm:order-none sm:max-w-[440px] sm:flex-1">
          <CommandPalette nav={nav} />
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-2.5">
          <div className="hidden sm:block">
            <NightDaySwitch />
          </div>
          <PageHelpButton pathname={pathname} audience={audience} className="rounded-xl border border-border bg-surface-1" />
          <NotificationBell />
          <NewWheel />
          <div className="md:hidden">
            <AvatarMenu user={user} rank={rank} variant="bar" />
          </div>
        </div>
      </div>
    </header>
  );
}
