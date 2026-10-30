"use client";

import Link from "next/link";
import { BookOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { InstallAppButton } from "@/components/pwa/install-hint";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { NavModel, NavRole, PlaceKey } from "@/lib/nav/places";
import { ThemeDecor } from "@/components/theme/theme-decor";
import { PlaceBadge } from "./place-badge";
import { NavIcon } from "./nav-icons";
import { AvatarMenu, type AvatarUser } from "./avatar-menu";
import { SpaceSwitcher, type ShellSpace } from "./space-switcher";
import { ariaCurrent } from "./current";

/**
 * The computer's side menu (from `md`), on the START side — the right, in Arabic («نجمة وطريق»):
 *
 *   - the 88px header: the theme's ornament (`ThemeDecor kind="sidebar"`, one of the four places a
 *     decoration may be drawn — the field of stars on «ليل»/«نهار») behind the wordmark «زاكي» in
 *     Lalezar (`.zk-wordmark`) and the company's name. The header is `relative` and clips the layer;
 *     its content is `relative` too, so it paints over the layer. The ornament stays in the header:
 *     never behind the list of places;
 *   - the space switcher, and «+» for whoever may open a space;
 *   - the places (icon and label), the current one washed in gold and marked with a star, the unread
 *     count beside «الدردشة»;
 *   - a dashed gold thread down the menu's end edge (`.zk-side-rule`, decoration only);
 *   - at the bottom «دليل زاكي», the avatar menu and the button that folds the menu to an icon rail
 *     (remembered on this device by the shell).
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
  orgName,
  space = null,
  canOverview = false,
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
  /** The company's name under the wordmark (the active organization). */
  orgName?: string;
  /** The space the person is in: the switcher wears its name. */
  space?: ShellSpace | null;
  /** The owner and the admins: «كل المساحات». */
  canOverview?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  animated?: boolean;
  /** unread numbers per place (today: «الدردشة» only) */
  badges?: Partial<Record<PlaceKey, number>>;
}) {
  const { t } = useI18n();
  // the space you are in, written where «زاكي» was and in its lettering (the owner's ask, 2026-10-25); a long name
  // steps down a size so it fits the menu, and the folded rail keeps the space's mark
  const brand = space?.name ?? t("app.brand");
  const brandSize = collapsed ? "text-2xl" : brand.length > 12 ? "text-2xl" : brand.length > 8 ? "text-[32px]" : "text-[40px]";
  return (
    <aside
      className={cn(
        // `h-full min-h-0`: the menu is exactly as tall as the window, so the list of places in the middle (`min-h-0 flex-1
        // overflow-y-auto`) is what gives way on a short window and scrolls, while the header and the block below it stay put
        "zk-side-rule relative hidden h-full min-h-0 shrink-0 flex-col border-e border-border bg-surface-1 md:flex",
        // the fold animates only after the person has toggled it in this visit: the FIRST frame must
        // already be the right width, so a hard load never plays the 256px → 72px shrink
        animated && "transition-[width] duration-150",
        collapsed ? "w-[72px]" : "w-64",
      )}
    >
      <div className="relative isolate flex h-[88px] shrink-0 flex-col justify-center overflow-hidden border-b border-border px-4">
        <ThemeDecor kind="sidebar" />
        <Link
          href="/"
          aria-label={brand}
          className={cn("relative flex min-w-0 flex-col rounded-xl", collapsed && "mx-auto items-center")}
        >
          <span aria-hidden="true" className={cn("zk-wordmark block max-w-full truncate py-0.5 leading-tight", brandSize)}>
            <bdi>{collapsed ? (space?.emoji ?? Array.from(brand)[0] ?? "") : brand}</bdi>
          </span>
          {orgName && !collapsed ? (
            <span aria-hidden="true" className="mt-1.5 truncate text-xs font-semibold text-fg-muted">
              <bdi>{orgName}</bdi>
            </span>
          ) : null}
        </Link>
      </div>

      <div className={cn("flex shrink-0 items-center gap-2 px-3 pt-3", collapsed && "justify-center")}>
        <SpaceSwitcher variant={collapsed ? "rail" : "sidebar"} isGuest={isGuest} current={space} canOverview={canOverview} />
      </div>

      <nav aria-label={t("shell.places")} data-tour="places" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
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
                    // a short window (a zoomed-in screen) takes a tighter row, so the whole list shows before it needs to scroll
                    "flex h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors [@media(max-height:760px)]:h-9",
                    collapsed && "justify-center px-0",
                    active ? "bg-accent-2/10 font-semibold text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <span className="relative shrink-0">
                    <NavIcon icon={place.icon} className={cn("size-5 shrink-0", active && "text-accent")} />
                    {collapsed && <PlaceBadge count={badges[place.key]} className="absolute -end-2 -top-2" />}
                  </span>
                  <span className={cn("truncate", collapsed && "sr-only")}>{label}</span>
                  {!collapsed && <PlaceBadge count={badges[place.key]} className="ms-auto" />}
                  {active && !collapsed ? (
                    <span aria-hidden="true" className={cn("zk-star size-3 shrink-0 text-accent-2", !badges[place.key] && "ms-auto")} />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* the pinned block: «دليل زاكي», the install button, the fold and the person. It never shrinks and never overlaps the list above it (`data-sidebar="footer"`) */}
      <div data-sidebar="footer" className="relative z-10 shrink-0 bg-surface-1">
      <div className={cn("shrink-0 px-3 pb-1", collapsed && "px-2")}>
        <Link
          href="/guide"
          aria-current={ariaCurrent(pathname.startsWith("/guide"), "/guide", pathname)}
          title={collapsed ? t("shell.guide") : undefined}
          className={cn(
            "flex h-11 items-center gap-2.5 rounded-xl border border-dashed border-accent-2 text-sm font-semibold text-fg transition-colors hover:bg-accent-2/10 [@media(max-height:760px)]:h-9",
            collapsed ? "justify-center px-0" : "px-3",
          )}
        >
          <BookOpen aria-hidden="true" className="size-5 shrink-0 text-accent-2" />
          <span className={cn("truncate", collapsed && "sr-only")}>{t("shell.guide")}</span>
        </Link>
        <InstallAppButton collapsed={collapsed} />
        {/* the fold, with its word: an icon alone in the corner was missed (the owner, 2026-10-26: «زر يضب القائمة ع جنب») */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t("shell.sidebar.expand") : t("shell.sidebar.collapse")}
          title={collapsed ? t("shell.sidebar.expand") : undefined}
          className={cn(
            "flex h-11 w-full items-center gap-2.5 rounded-xl text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg [@media(max-height:760px)]:h-9",
            collapsed ? "justify-center px-0" : "px-3",
          )}
        >
          {collapsed ? <PanelRightOpen aria-hidden="true" className="size-5 shrink-0" /> : <PanelRightClose aria-hidden="true" className="size-5 shrink-0" />}
          <span className={cn("truncate", collapsed && "sr-only")}>{collapsed ? t("shell.sidebar.expand") : t("shell.sidebar.collapse")}</span>
        </button>
      </div>

      <div className={cn("flex shrink-0 items-center gap-1 border-t border-border p-3", collapsed && "flex-col")}>
        <div className={cn("min-w-0", collapsed ? "flex justify-center" : "flex-1")}>
          <AvatarMenu user={user} rank={rank} variant={collapsed ? "rail" : "sidebar"} />
        </div>
      </div>
      </div>
    </aside>
  );
}
