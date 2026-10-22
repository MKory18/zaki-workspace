"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import type { Audience } from "@/lib/guide/audience";
import type { NavModel, NavRole } from "@/lib/nav/places";
import { DolphinMark } from "@/components/logo";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { PageHelpButton } from "@/components/guide/page-help-button";
import { AvatarMenu, type AvatarUser } from "./avatar-menu";

/**
 * The bar over every page, 56px under the notch (`env(safe-area-inset-top)`):
 *
 *   phone      the dolphin mark (to Today) · search · «؟» · the bell · the avatar
 *   computer   search · «؟» · the bell (the mark and the avatar live in the side menu)
 *
 * Every control is a 44px target. `data-tour`: "search" around the palette's button, "inbox" on the
 * bell (notification-bell.tsx), "avatar" on the avatar (avatar-menu.tsx).
 */
export function TopBar({
  nav,
  pathname,
  audience,
  user,
  rank,
}: {
  nav: NavModel;
  pathname: string;
  audience: Audience;
  user: AvatarUser;
  rank: NavRole;
}) {
  const { t } = useI18n();
  return (
    <header className="shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-1 px-2 md:gap-2 md:px-4">
        <Link href="/" aria-label={t("nav.place.today")} className="grid size-11 shrink-0 place-items-center rounded-xl md:hidden">
          <span aria-hidden="true">
            <DolphinMark className="size-8" />
          </span>
        </Link>
        <div data-tour="search" className="min-w-0 flex-1 md:max-w-md">
          <CommandPalette nav={nav} />
        </div>
        <div className="flex shrink-0 items-center gap-0.5 md:ms-auto">
          <PageHelpButton pathname={pathname} audience={audience} />
          <NotificationBell />
          <div className="md:hidden">
            <AvatarMenu user={user} rank={rank} variant="bar" />
          </div>
        </div>
      </div>
    </header>
  );
}
