/**
 * The decisions behind the "install the app" hint (src/components/pwa/install-hint.tsx), kept pure (no
 * React, no browser globals) so they are unit-tested: which iPhone instructions apply, whether the app is
 * already installed, whether the person dismissed the hint, and what the hint shows.
 *
 * Why the hint exists: Android and desktop Chrome offer an install prompt the page can trigger from its
 * own button; Safari on iPhone has no such prompt, so the page can only show the two taps (Share, then
 * Add to Home Screen) in Arabic.
 */

/** `safari`: the Share -> Add to Home Screen steps apply here. `other`: an iPhone browser that is not Safari. */
export type IosKind = "safari" | "other";

export interface BrowserEnv {
  userAgent: string;
  platform?: string | undefined;
  maxTouchPoints?: number | undefined;
}

/** Tokens that browsers other than Safari add to the user agent on iOS (they all use Safari's engine). */
const OTHER_IOS_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YaBrowser/;

/**
 * Is this an iPhone or iPad, and if so is it Safari?
 *
 * - iPhone and iPod say so in the user agent. An iPad too, except that since iPadOS 13 it asks for the
 *   desktop site by default and calls itself a Mac: the touch points give it away (a real Mac has none).
 * - Safari is the one with `Version/x` and `Safari/x` and none of the other browsers' tokens. An app's
 *   built-in browser has neither `Version/` nor `Safari/`, so it counts as `other`: it cannot add to the
 *   home screen at all, and "open it in Safari" is the right advice there too.
 * - Android and desktop browsers return null: they install through the browser's own prompt.
 */
export function detectIos(env: BrowserEnv): IosKind | null {
  const ua = env.userAgent ?? "";
  const phoneOrPad = /iPhone|iPad|iPod/.test(ua);
  const padAsMac = env.platform === "MacIntel" && (env.maxTouchPoints ?? 0) > 1;
  if (!phoneOrPad && !padAsMac) return null;
  const safari = /Version\/[\d.]+/.test(ua) && /Safari\//.test(ua) && !OTHER_IOS_BROWSER.test(ua);
  return safari ? "safari" : "other";
}

/**
 * Already installed and running like an app? The `display-mode: standalone` media query says so on
 * Android and desktop; iOS Safari says it with the non-standard `navigator.standalone`.
 */
export function isStandaloneDisplay(input: { displayModeStandalone: boolean; navigatorStandalone?: boolean | undefined }): boolean {
  return input.displayModeStandalone || input.navigatorStandalone === true;
}

export const INSTALL_DISMISS_KEY = "zk-install-dismissed";
/** A dismissed hint stays away this long, then may come back once. */
export const INSTALL_DISMISS_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Was the hint dismissed recently? `stored` is what localStorage held: the time of the dismissal in
 * milliseconds. Nothing stored, junk, or a time more than a day in the future (a clock that was set back,
 * a hand-edited value) all mean "not dismissed".
 */
export function isDismissed(stored: string | null | undefined, now: number): boolean {
  if (!stored) return false;
  const at = Number(stored);
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  if (age < -DAY_MS) return false;
  return age < INSTALL_DISMISS_DAYS * DAY_MS;
}

/** Reads the dismissal from storage. A browser that blocks storage (private mode, policy) must not break the page. */
export function readDismissal(storage: Pick<Storage, "getItem"> | null | undefined, now: number): boolean {
  if (!storage) return false;
  try {
    return isDismissed(storage.getItem(INSTALL_DISMISS_KEY), now);
  } catch {
    return false;
  }
}

/** Remembers the dismissal. Returns whether it could be stored. */
export function writeDismissal(storage: Pick<Storage, "setItem"> | null | undefined, now: number): boolean {
  if (!storage) return false;
  try {
    storage.setItem(INSTALL_DISMISS_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/**
 * What the hint shows: nothing (installed, dismissed, or nothing to offer), the install button (the
 * browser has offered its prompt), the iPhone steps (Safari), or "open this in Safari" (any other iPhone browser).
 */
export type InstallMode = "hidden" | "prompt" | "ios-safari" | "ios-other";

export function installMode(input: { standalone: boolean; dismissed: boolean; ios: IosKind | null; canPrompt: boolean }): InstallMode {
  if (input.standalone || input.dismissed) return "hidden";
  if (input.canPrompt) return "prompt";
  if (input.ios === "safari") return "ios-safari";
  if (input.ios === "other") return "ios-other";
  return "hidden";
}
