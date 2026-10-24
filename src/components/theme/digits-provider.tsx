"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { DEFAULT_DIGITS, DIGITS_COOKIE, digitsOf, type DigitMode } from "@/lib/digits";
import { prefCookieString } from "@/lib/themes/registry";

/**
 * «الأرقام: 123 / ١٢٣» in the browser (src/lib/digits.ts says how it works). A choice applies at once — it is
 * the `data-digits` attribute of <html>, which globals.css reads, so nothing re-renders and nothing reloads —
 * then it is remembered (the cookie, for this device's next first frame) and saved (`POST /api/me/digits`, so
 * it follows the person; best-effort, like the theme: a failed save changes nothing on screen).
 */
export function chooseDigits(mode: DigitMode): void {
  const digits = digitsOf(mode);
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-digits", digits);
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  document.cookie = prefCookieString(DIGITS_COOKIE, digits, secure);
  void fetch("/api/me/digits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ digits }),
  }).catch(() => {
    // the attribute and the cookie already hold the choice on this device
  });
}

interface DigitsContextValue {
  digits: DigitMode;
  setDigits: (mode: DigitMode) => void;
}

/** Outside a provider it still answers: the default, and a setter that applies and saves. */
const DigitsContext = createContext<DigitsContextValue>({ digits: DEFAULT_DIGITS, setDigits: chooseDigits });

export function DigitsProvider({ initialDigits, children }: { initialDigits?: string; children: ReactNode }) {
  const [digits, setState] = useState<DigitMode>(() => digitsOf(initialDigits));
  const setDigits = useCallback((mode: DigitMode) => {
    setState(digitsOf(mode));
    chooseDigits(mode);
  }, []);
  return <DigitsContext.Provider value={{ digits, setDigits }}>{children}</DigitsContext.Provider>;
}

export function useDigits(): DigitsContextValue {
  return useContext(DigitsContext);
}
