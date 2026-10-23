"use client";

import Link from "next/link";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { NavModel, NavRole, PlaceKey } from "@/lib/nav/places";
import { ThemeDecor } from "@/components/theme/theme-decor";
import { NavIcon } from "./nav-icons";
import { AvatarMenu, type AvatarUser } from "./avatar-menu";
import { SpaceSwitcher } from "./space-switcher";
import { ariaCurrent } from "./current";

/**
 * The computer's side menu (from `md`), on the START side — the right, in Arabic, as in the owner's
 * adopted mockup («نجمة وطريق»):
 *
 *   - the brand block: the «زاكي» wordmark in Lalezar with the gold stroke (`.zk-gta`), over the
 *     tiled eight-point star (`.zk-pattern`, one of the four places a decoration may be drawn) —
 *     the pattern stays in this block and never sits behind the list of places;
 *   - the space switcher;
 *   - the places (icon and label), the current one washed with gold and marked with a star;
 *   - a dashed gold thread down the whole menu (`.zk-side-rule`), the guide button and the avatar
 *     at the bottom, and the button that folds the menu to an icon rail.
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
}) {
  const { t } = useI18n();
  return (
    <aside
      className={cn(
        "zk-side-rule relative hidden shrink-0 flex-col border-e border-border bg-surface-1 md:flex",
        // the fold animates only after the person has toggled it in this visit: the FIRST frame must
        // already be the right width, so a hard load never plays the 236px → 72px shrink
        animated && "transition-[width] duration-150",
        collapsed ? "w-[72px]" : "w-[236px]",
      )}
    >
      <div
        className={cn(
          "relative isolate shrink-0 overflow-hidden pb-3 pt-4",
          collapsed ? "px-2" : "px-3.5",
        )}
      >
        <ThemeDecor kind="sidebar" />
        <span aria-hidden="true" className="zk-pattern pointer-events-none absolute inset-0 -z-10 text-accent-2 opacity-[0.075]" />
        <Link
          href="/"
          aria-label={collapsed ? t("app.name") : undefined}
          className={cn("relative flex items-center rounded-xl", collapsed ? "justify-center" : "px-1")}
        >
          <span className={cn("zk-gta truncate leading-tight", collapsed ? "text-[26px]" : "text-[42px]")}>{t("app.brand")}</span>
        </Link>
        <div className={cn("relative mt-3 flex items-center gap-2", collapsed && "justify-center")}>
          <SpaceSwitcher variant={collapsed ? "rail" : "sidebar"} isGuest={isGuest} />
        </div>
      </div>

      <nav aria-label={t("shell.places")} data-tour="places" className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
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
                    "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors",
                    collapsed && "justify-center px-0",
                    active ? "bg-accent-2/10 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <NavIcon icon={place.icon} className={cn("size-[22px] shrink-0", active && "text-accent")} />
                  <span className={cn("truncate", collapsed && "sr-only")}>{label}</span>
                  {active && !collapsed ? <span aria-hidden="true" className="zk-star ms-auto size-[11px] text-accent-2" /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className={cn("shrink-0 space-y-2 p-3", collapsed && "space-y-1 px-2")}>
        <Link
          href="/guide"
          aria-label={t("shell.guide.open")}
          title={collapsed ? t("shell.guide") : undefined}
          className={cn(
            "flex min-h-11 items-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-accent-2 text-sm font-semibold text-fg transition-colors hover:bg-accent-2/10",
            collapsed ? "justify-center px-0" : "px-3",
          )}
        >
          <span aria-hidden="true" className="grid size-[22px] shrink-0 place-items-center rounded-full border border-current text-[13px] font-bold">؟</span>
          <span className={cn("truncate", collapsed && "sr-only")}>{t("shell.guide")}</span>
        </Link>

        <div className={cn("flex items-center gap-1", collapsed && "flex-col")}>
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
      </div>
    </aside>
  );
}
