"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { NavPlace, TabKey } from "@/lib/nav/places";
import { ariaCurrent } from "./current";
import { Grip, SortableItem, SortableList } from "./nav-sort";

/**
 * The tabs of the place on screen, under the top bar (phone and computer alike): «مهامي · المشاريع ·
 * القائمة …» inside «الشغل». It scrolls sideways on a narrow screen and brings the current tab into
 * view; a place with a single tab (or none) has no strip at all — one tab is not a choice.
 *
 * In the reorder mode («ترتيب», `editing`) each tab wears a grip and is dragged instead of followed; the new order of the
 * tab keys goes to `onReorder`.
 *
 * `end` is pinned at the end of the strip, outside the part that scrolls (the phone's space switcher).
 * `data-tour="tabs"`: the guide's tour stop.
 */
export function PlaceTabs({
  place,
  tab,
  pathname,
  end,
  editing = false,
  onReorder,
}: {
  place: NavPlace | null;
  tab: TabKey | null;
  pathname: string;
  end?: ReactNode;
  editing?: boolean;
  onReorder?: (placeKey: string, keys: string[]) => void;
}) {
  const { t } = useI18n();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    // instant, and only as far as needed (nothing moves when the tab is already visible)
    listRef.current?.querySelector<HTMLElement>("[data-current]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [place?.key, tab]);

  if (!place || place.tabs.length < 2) return null;
  const listClass = "flex min-w-0 flex-1 gap-1 overflow-x-auto px-2 py-1 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden md:px-4";

  return (
    <nav
      aria-label={t("shell.tabs", { place: t(place.labelKey) })}
      data-tour="tabs"
      className="flex shrink-0 items-center border-b border-border bg-surface"
    >
      {editing && onReorder ? (
        <SortableList
          id={`nav-tabs-${place.key}`}
          axis="horizontal"
          entries={place.tabs.map((item) => ({ id: item.key, label: t(item.labelKey) }))}
          onReorder={(keys) => onReorder(place.key, keys)}
        >
          <ul ref={listRef} aria-label={t("navorder.tabs_label", { place: t(place.labelKey) })} className={listClass}>
            {place.tabs.map((item) => {
              const label = t(item.labelKey);
              return (
                <SortableItem key={item.key} id={item.key} className="shrink-0">
                  {({ props }) => (
                    <div className="inline-flex h-11 items-center gap-0.5 whitespace-nowrap rounded-lg border border-dashed border-border ps-0.5 pe-3 text-sm text-fg">
                      <Grip handle={props} label={label} />
                      {label}
                    </div>
                  )}
                </SortableItem>
              );
            })}
          </ul>
        </SortableList>
      ) : (
        <ul ref={listRef} className={listClass}>
          {place.tabs.map((item) => {
            const active = item.key === tab;
            return (
              <li key={item.key} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={ariaCurrent(active, item.href, pathname)}
                  data-current={active ? "" : undefined}
                  className={cn(
                    "inline-flex h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm transition-colors",
                    active ? "bg-accent/10 font-semibold text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {end}
    </nav>
  );
}
