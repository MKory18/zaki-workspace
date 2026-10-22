"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AR as ar } from "./dict";

const DICTS = { ar } as const;
export type Locale = keyof typeof DICTS;

type Dict = Record<string, string>;

interface I18nCtx {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (l: Locale) => void;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const dict = DICTS.ar as Dict;
      let s = dict[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      }
      return s;
    },
    [locale],
  );

  // Arabic is the only supported language; kept as a no-op for API stability.
  const setLocale = useCallback((_l: Locale) => {}, []);

  const value = useMemo<I18nCtx>(
    () => ({ locale, dir: "rtl" as const, t, setLocale }),
    [locale, t, setLocale],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
