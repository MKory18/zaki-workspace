"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { NavPlace, PlaceKey } from "@/lib/nav/places";
import { NavIcon } from "./nav-icons";
import { ariaCurrent } from "./current";

/**
 * The phone's way around: the person's places along the bottom of the screen, an icon over a short
 * label, each a 56px-tall target, the current one highlighted. It is fixed, so the shell pads
 * the content by its height plus the home-indicator inset (`env(safe-area-inset-bottom)`, which the
 * root layout's `viewportFit: "cover"` makes real on an iPhone). From `md` the side menu takes over.
 *
 * `data-tour="places"`: the guide's tour points here on a phone (and at the side menu on a computer).
 */
export function BottomNav({ places, current, pathname }: { places: readonly NavPlace[]; current: PlaceKey | null; pathname: string }) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t("shell.places")}
      data-tour="places"
      className="fixed bottom-0 end-0 start-0 z-40 border-t border-border bg-surface-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex">
        {places.map((place) => {
          const active = place.key === current;
          return (
            <li key={place.key} className="min-w-0 flex-1">
              <Link
                href={place.href}
                aria-current={ariaCurrent(active, place.href, pathname)}
                className={cn(
                  // exactly the 56px the shell pads the content by (3.5rem): 28px pill + 4px + one 12px line fit inside
                  // leading-normal so a truncated label's descenders/clipped letters still render fully
                  "flex h-14 flex-col items-center justify-center gap-1 px-1 text-xs transition-colors",
                  active ? "font-semibold text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors", active && "bg-accent/15 text-accent")}>
                  <NavIcon icon={place.icon} className="size-5" />
                </span>
                <span className="max-w-full truncate">{t(place.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
