"use client";

import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme-provider";

/**
 * «ليل / نهار» — the two-theme switch of the top bar («نجمة وطريق»), on a phone too.
 *
 * A shortcut, not the whole choice: «ليل» is `night`, «نهار» is `day`; the four themes and the
 * decoration level stay in the avatar menu (theme-picker.tsx). The pressed side follows what is
 * actually painted, so on «إسلامي ملحمي» or «ساحل النيون» neither side is pressed: the switch never
 * lies about the current look. Each side is a 44px target; on a phone it shows its icon only (the
 * name stays the button's accessible name).
 */
export function NightDaySwitch() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const sides = [
    { key: "night", label: t("shell.theme.night"), Icon: Moon },
    { key: "day", label: t("shell.theme.day"), Icon: Sun },
  ] as const;
  return (
    <div role="group" aria-label={t("shell.theme.aria")} className="flex shrink-0 items-center rounded-xl border border-border bg-surface-1">
      {sides.map(({ key, label, Icon }) => {
        const on = theme === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setTheme(key)}
            aria-pressed={on}
            aria-label={label}
            className={cn(
              "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[11px] px-2 text-sm font-semibold transition-colors sm:px-3",
              on ? "zk-seg-on text-fg" : "text-muted hover:text-fg",
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span aria-hidden="true" className="hidden sm:inline">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
