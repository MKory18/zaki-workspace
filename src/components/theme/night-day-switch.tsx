"use client";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useTheme } from "./theme-provider";

/**
 * «ليل / نهار» — the two-theme switch of the top bar, as in the owner's adopted mockup.
 *
 * It is a shortcut, not the whole choice: «ليل» is the night theme (`islamic-epic`, the default) and
 * «نهار» is `day`, while the four themes and the decoration level stay in the avatar menu
 * (theme-picker.tsx). Pressed state follows what is actually painted: on the other two themes
 * neither side is pressed, so the switch never lies about the current look.
 */
export function NightDaySwitch() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const night = theme === "islamic-epic";
  const day = theme === "day";
  const item = "min-h-8 rounded-[9px] px-3 text-sm font-semibold transition-colors";
  return (
    <div role="group" aria-label={t("shell.theme.aria")} className="flex items-center rounded-xl border border-border bg-surface-1 p-[3px]">
      <button
        type="button"
        onClick={() => setTheme("islamic-epic")}
        aria-pressed={night}
        className={cn(item, night ? "zk-seg-on text-fg" : "text-muted hover:text-fg")}
      >
        {t("shell.theme.night")}
      </button>
      <button
        type="button"
        onClick={() => setTheme("day")}
        aria-pressed={day}
        className={cn(item, day ? "zk-seg-on text-fg" : "text-muted hover:text-fg")}
      >
        {t("shell.theme.day")}
      </button>
    </div>
  );
}
