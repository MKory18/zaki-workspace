"use client";

import Link from "next/link";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { NavModel, NavRole, PlaceKey } from "@/lib/nav/places";
import { DolphinMark } from "@/components/logo";
import { ThemeDecor } from "@/components/theme/theme-decor";
import { PlaceBadge } from "./place-badge";
import { NavIcon } from "./nav-icons";
import { AvatarMenu, type AvatarUser } from "./avatar-menu";
import { SpaceSwitcher } from "./space-switcher";
import { ariaCurrent } from "./current";

/**
 * The computer's side menu (from `md`), on the START side — the right, in Arabic:
 *
 *   - the 72px header: the theme's ornament (`ThemeDecor kind="sidebar"`, one of the four places a
 *     decoration may be drawn) behind the dolphin mark and the «Zaki Workspace» wordmark. The header is
 *     `relative` and clips the layer; its content is `relative` too, so it paints over the layer. The
 *     ornament stays in the header: never behind the list of places;
 *   - the space switcher, and «+» for whoever may open a space;
 *   - the places (icon and label), the current one marked;
 *   - at the bottom the avatar menu and the button that folds the menu to an icon rail (remembered on
 *     this device by the shell).
 *
 * `data-tour="places"` on the list (the bottom bar carries it on a phone).
 */
export function Sidebar({
  nav,
  current,
  pathname,
  user,
  rank,
  isGuest,
  collapsed,
  onToggle,
  /** True after a toggle in this session: then, and only then, the width animates. */
  animated = false,
  badges = {},
}: {
  nav: NavModel;
  current: PlaceKey | null;
  pathname: string;
  user: AvatarUser;
  rank: NavRole;
  isGuest: boolean;
  collapsed: boolean;
  onToggle: () => void;
  animated?: boolean;
  /** unread numbers per place (today: «الدردشة» only) */
  badges?: Partial<Record<PlaceKey, number>>;
}) {
  const { t } = useI18n();
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-e border-border bg-surface-1 md:flex",
        // the fold animates only after the person has toggled it in this visit: the FIRST frame must
        // already be the right width, so a hard load never plays the 256px → 72px shrink
        animated && "transition-[width] duration-150",
        collapsed ? "w-[72px]" : "w-64",
      )}
    >
      <div className="relative isolate flex h-[72px] shrink-0 items-center overflow-hidden border-b border-border px-4">
        <ThemeDecor kind="sidebar" />
        <Link
          href="/"
          aria-label={collapsed ? t("app.name") : undefined}
          className={cn("relative flex min-w-0 items-center gap-2.5 rounded-xl", collapsed && "mx-auto")}
        >
          <span aria-hidden="true" className="shrink-0">
            <DolphinMark className="size-9" />
          </span>
          {collapsed ? null : (
            <span lang="en" dir="ltr" className="truncate text-base font-bold tracking-tight text-fg">
              {t("app.name")}
            </span>
          )}
        </Link>
      </div>

      <div className={cn("flex shrink-0 items-center gap-2 px-3 pt-3", collapsed && "justify-center")}>
        <SpaceSwitcher variant={collapsed ? "rail" : "sidebar"} isGuest={isGuest} />
      </div>

      <nav aria-label={t("shell.places")} data-tour="places" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ul className="space-y-1">
          {nav.places.map((place) => {
            const active = place.key === current;
            const label = t(place.labelKey);
            return (
              <li key={place.key}>
                <Link
                  href={place.href}
                  aria-current={ariaCurrent(active, place.href, pathname)}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors",
                    collapsed && "justify-center px-0",
                    active ? "bg-accent/10 font-semibold text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <span className="relative shrink-0">
                    <NavIcon icon={place.icon} className={cn("size-5 shrink-0", active && "text-accent")} />
                    {collapsed && <PlaceBadge count={badges[place.key]} className="absolute -end-2 -top-2" />}
                  </span>
                  <span className={cn("truncate", collapsed && "sr-only")}>{label}</span>
                  {!collapsed && <PlaceBadge count={badges[place.key]} className="ms-auto" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={cn("flex shrink-0 items-center gap-1 border-t border-border p-3", collapsed && "flex-col")}>
        <div className={cn("min-w-0", collapsed ? "flex justify-center" : "flex-1")}>
          <AvatarMenu user={user} rank={rank} variant={collapsed ? "rail" : "sidebar"} />
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? t("shell.sidebar.expand") : t("shell.sidebar.collapse")}
          aria-expanded={!collapsed}
          title={collapsed ? t("shell.sidebar.expand") : t("shell.sidebar.collapse")}
          className="grid size-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          {collapsed ? <PanelRightOpen aria-hidden="true" className="size-5" /> : <PanelRightClose aria-hidden="true" className="size-5" />}
        </button>
      </div>
    </aside>
  );
}
