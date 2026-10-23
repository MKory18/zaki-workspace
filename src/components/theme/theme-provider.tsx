"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DECOR_COOKIE,
  DEFAULT_DECOR,
  DEFAULT_THEME,
  THEME_COOKIE,
  THEME_LIST,
  decorLevelOf,
  isDarkTheme,
  prefCookieString,
  themeOf,
  type DecorLevel,
  type ThemeInfo,
  type ThemeKey,
} from "@/lib/themes/registry";
import { themeColorOf } from "@/lib/themes/palettes";

/**
 * The theme on the client. The SERVER already painted the right theme (the root layout reads the
 * `zaki_theme` cookie), so this provider never repaints on load: it only changes things when a
 * person picks something. A choice is applied at once (the attribute and the `dark` class on
 * <html>, the browser bar colour), remembered in its cookie for a year, and saved to the account
 * with POST /api/me/theme so it follows the person to their other devices. The save is best-effort
 * (signed out, offline: the cookie still holds the choice) and the saves go out one after another,
 * so a slow answer can never bring back an older choice.
 */

export interface ThemeContextValue {
  theme: ThemeKey;
  setTheme: (key: ThemeKey) => void;
  decor: DecorLevel;
  setDecor: (level: DecorLevel) => void;
  themes: readonly ThemeInfo[];
}

let saving: Promise<void> = Promise.resolve();

function save(body: { theme: ThemeKey } | { decor: DecorLevel }): void {
  saving = saving.then(async () => {
    try {
      await fetch("/api/me/theme", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
    } catch {
      // best-effort: the cookie already holds the choice on this device
    }
  });
}

/** Resolves when every choice made so far has been sent (tests, and anything that must wait for it). */
export function savedPreferences(): Promise<void> {
  return saving;
}

function remember(name: string, value: string): void {
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  document.cookie = prefCookieString(name, value, secure);
}

/** Apply, remember and save a theme. Works without the provider (it only touches the page, the cookie and the API). */
export function chooseTheme(key: ThemeKey): void {
  const theme = themeOf(key);
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.setAttribute("data-theme", theme);
  html.classList.toggle("dark", isDarkTheme(theme));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColorOf(theme));
  remember(THEME_COOKIE, theme);
  save({ theme });
}

/** Apply, remember and save a decoration level. */
export function chooseDecor(level: DecorLevel): void {
  const decor = decorLevelOf(level);
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-decor", decor);
  remember(DECOR_COOKIE, decor);
  save({ decor });
}

/**
 * Outside a provider (an isolated render) `useTheme()` still answers: the default theme, and
 * setters that apply and save without re-rendering anything.
 */
const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: chooseTheme,
  decor: DEFAULT_DECOR,
  setDecor: chooseDecor,
  themes: THEME_LIST,
});

export function ThemeProvider({
  initialTheme,
  initialDecor,
  children,
}: {
  /** What the server painted (the cookie): anything unknown is the default. */
  initialTheme?: string;
  initialDecor?: string;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<ThemeKey>(() => themeOf(initialTheme));
  const [decor, setDecorState] = useState<DecorLevel>(() => decorLevelOf(initialDecor));

  // A server refresh brings the cookie's current value (another tab may have changed it): follow it.
  useEffect(() => setThemeState(themeOf(initialTheme)), [initialTheme]);
  useEffect(() => setDecorState(decorLevelOf(initialDecor)), [initialDecor]);

  const setTheme = useCallback((key: ThemeKey) => {
    const next = themeOf(key);
    setThemeState(next);
    chooseTheme(next);
  }, []);
  const setDecor = useCallback((level: DecorLevel) => {
    const next = decorLevelOf(level);
    setDecorState(next);
    chooseDecor(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, decor, setDecor, themes: THEME_LIST }),
    [theme, setTheme, decor, setDecor],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The current theme and decoration level, and how to change them. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
