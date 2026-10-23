import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  INSTALL_DISMISS_DAYS,
  INSTALL_DISMISS_KEY,
  detectIos,
  installMode,
  isDismissed,
  isStandaloneDisplay,
  readDismissal,
  writeDismissal,
} from "@/lib/pwa-install";
import { InstallHint, InstallHintView } from "@/components/pwa/install-hint";
import { getServerT } from "@/lib/i18n/server";
import { classesOf, classTokens, render, textOf } from "./ui-render";

const { t } = getServerT();
const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 9, 22, 9, 0, 0);
const noop = () => {};

// Real user-agent strings (shortened only where the tail does not matter).
const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15",
  iphoneEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/124.2478.62 Mobile/15E148 Safari/605.1.15",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.12.100 (iPhone14,2; iOS 17_4; ar_JO; ar; scale=3.00; 1170x2532; 589282654)",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ asks for the desktop site by default: it says "Macintosh", only the touch points give it away
  ipadDesktopClass:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
};

describe("detectIos: which iPhone instructions apply", () => {
  it("iPhone and iPad Safari get the Share -> Add to Home Screen steps", () => {
    expect(detectIos({ userAgent: UA.iphoneSafari })).toBe("safari");
    expect(detectIos({ userAgent: UA.ipadSafari })).toBe("safari");
  });

  it("an iPad that asks for the desktop site is still an iPad: platform MacIntel with touch points", () => {
    expect(detectIos({ userAgent: UA.ipadDesktopClass, platform: "MacIntel", maxTouchPoints: 5 })).toBe("safari");
  });

  it("a real Mac is not an iPad (no touch points)", () => {
    expect(detectIos({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 })).toBeNull();
    expect(detectIos({ userAgent: UA.macSafari })).toBeNull();
  });

  it("Chrome, Firefox and Edge on iPhone are not Safari, and neither is an app's built-in browser", () => {
    expect(detectIos({ userAgent: UA.iphoneChrome })).toBe("other");
    expect(detectIos({ userAgent: UA.iphoneFirefox })).toBe("other");
    expect(detectIos({ userAgent: UA.iphoneEdge })).toBe("other");
    expect(detectIos({ userAgent: UA.iphoneInstagram })).toBe("other");
  });

  it("Android and desktop browsers are not iOS (they install through the browser's own prompt)", () => {
    expect(detectIos({ userAgent: UA.androidChrome })).toBeNull();
    expect(detectIos({ userAgent: UA.windowsChrome })).toBeNull();
    expect(detectIos({ userAgent: UA.windowsFirefox })).toBeNull();
    expect(detectIos({ userAgent: "" })).toBeNull();
  });
});

describe("isStandaloneDisplay: already installed", () => {
  it("is standalone when the display-mode media query says so, or when iOS says navigator.standalone", () => {
    expect(isStandaloneDisplay({ displayModeStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ displayModeStandalone: false, navigatorStandalone: false })).toBe(false);
    expect(isStandaloneDisplay({ displayModeStandalone: false })).toBe(false);
  });
});

describe("the dismissal is remembered for a while, never for ever", () => {
  it("fresh dismissal: still dismissed", () => {
    expect(isDismissed(String(NOW - DAY), NOW)).toBe(true);
    expect(isDismissed(String(NOW), NOW)).toBe(true);
  });

  it(`after ${INSTALL_DISMISS_DAYS} days the hint may come back`, () => {
    expect(isDismissed(String(NOW - (INSTALL_DISMISS_DAYS * DAY - 1000)), NOW)).toBe(true);
    expect(isDismissed(String(NOW - INSTALL_DISMISS_DAYS * DAY - 1000), NOW)).toBe(false);
  });

  it("nothing stored, garbage and a date in the far future all mean: not dismissed", () => {
    expect(isDismissed(null, NOW)).toBe(false);
    expect(isDismissed(undefined, NOW)).toBe(false);
    expect(isDismissed("", NOW)).toBe(false);
    expect(isDismissed("yes", NOW)).toBe(false);
    expect(isDismissed("NaN", NOW)).toBe(false);
    expect(isDismissed(String(NOW + 400 * DAY), NOW)).toBe(false);
  });

  it("reads and writes through localStorage inside try/catch: a browser that blocks storage must not break the page", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readDismissal(storage, NOW)).toBe(false);
    expect(writeDismissal(storage, NOW)).toBe(true);
    expect(store.get(INSTALL_DISMISS_KEY)).toBe(String(NOW));
    expect(readDismissal(storage, NOW + DAY)).toBe(true);

    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readDismissal(blocked, NOW)).toBe(false);
    expect(writeDismissal(blocked, NOW)).toBe(false);
    expect(readDismissal(null, NOW)).toBe(false);
    expect(writeDismissal(undefined, NOW)).toBe(false);
  });
});

describe("installMode: what the hint shows", () => {
  const base = { standalone: false, dismissed: false, ios: null, canPrompt: false } as const;

  it("an installed app shows nothing, whatever else is true", () => {
    expect(installMode({ ...base, standalone: true, canPrompt: true })).toBe("hidden");
    expect(installMode({ ...base, standalone: true, ios: "safari" })).toBe("hidden");
  });

  it("a dismissed hint shows nothing", () => {
    expect(installMode({ ...base, dismissed: true, canPrompt: true })).toBe("hidden");
    expect(installMode({ ...base, dismissed: true, ios: "safari" })).toBe("hidden");
  });

  it("Android and desktop Chrome: the install button, once the browser has offered the prompt", () => {
    expect(installMode({ ...base, canPrompt: true })).toBe("prompt");
    expect(installMode(base)).toBe("hidden"); // no prompt offered (yet): nothing to show
  });

  it("iPhone Safari: the steps. Other iPhone browsers: open it in Safari first", () => {
    expect(installMode({ ...base, ios: "safari" })).toBe("ios-safari");
    expect(installMode({ ...base, ios: "other" })).toBe("ios-other");
  });
});

describe("InstallHint", () => {
  it("renders nothing on the server and on the first client render (it looks at the browser only after it mounted: no hydration mismatch)", () => {
    expect(render(createElement(InstallHint))).toBe("");
  });
});

describe("InstallHintView", () => {
  const view = (mode: "prompt" | "ios-safari" | "ios-other", className?: string) =>
    render(createElement(InstallHintView, { mode, onInstall: noop, onDismiss: noop, className }));

  it("android / desktop: a title, a reason and the button «تثبيت التطبيق»", () => {
    const markup = view("prompt");
    expect(markup).toContain(t("pwa.install_title"));
    expect(markup).toContain(t("pwa.install_text"));
    expect(markup).toMatch(/<button[^>]*>.*تثبيت التطبيق<\/button>/s);
    expect(markup).not.toContain(t("pwa.ios_steps"));
  });

  it("iPhone Safari: the exact Arabic steps, each with a small description of its icon", () => {
    const markup = view("ios-safari");
    expect(textOf(markup)).toContain("اضغط مشاركة ثم إضافة إلى الشاشة الرئيسية");
    expect(markup).toContain("<ol");
    expect((markup.match(/<li\b/g) ?? []).length).toBe(3);
    for (const key of ["pwa.ios_step_share", "pwa.ios_step_share_icon", "pwa.ios_step_add", "pwa.ios_step_add_icon", "pwa.ios_step_confirm"]) {
      expect(markup, key).toContain(t(key));
    }
    // the icons are decoration: their meaning is in the words
    expect((markup.match(/<svg[^>]*aria-hidden="true"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // no install button: iOS has no install prompt to call
    expect(markup).not.toContain(t("pwa.install_button"));
  });

  it("iPhone with another browser: asks to open the page in Safari, then the same steps in one sentence", () => {
    const markup = view("ios-other");
    expect(textOf(markup)).toContain(t("pwa.ios_other"));
    expect(t("pwa.ios_other")).toContain("سفاري");
    expect(t("pwa.ios_other")).toContain("اضغط مشاركة ثم إضافة إلى الشاشة الرئيسية");
    expect(markup).not.toContain("<ol");
  });

  it("can always be dismissed: a labelled 44px button", () => {
    for (const mode of ["prompt", "ios-safari", "ios-other"] as const) {
      const markup = view(mode);
      expect(markup, mode).toContain(`aria-label="${t("pwa.dismiss_label")}"`);
      expect(classesOf(markup, /<button[^>]*aria-label="[^"]*"[^>]*>/), mode).toEqual(expect.arrayContaining(["size-11"]));
    }
  });

  it("every button is a thumb-sized target and has an Arabic name", () => {
    for (const mode of ["prompt", "ios-safari", "ios-other"] as const) {
      const markup = view(mode);
      for (const [whole, inner] of markup.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)) {
        const named = /[؀-ۿ]/.test(textOf(inner as string)) || /aria-label="[^"]*[؀-ۿ]/.test(whole);
        expect(named, whole.slice(0, 120)).toBe(true);
        expect(/(^|\s)(h|size)-(8|9|10)(\s|$)/.test(whole.match(/class="([^"]*)"/)?.[1] ?? ""), whole.slice(0, 120)).toBe(false);
      }
    }
  });

  it("is a labelled region that takes the caller's classes and uses logical CSS and theme tokens only", () => {
    const markup = view("ios-safari", "mt-4");
    expect(markup).toContain(`aria-label="${t("pwa.region_label")}"`);
    expect(classesOf(markup, /<section[^>]*>/)).toEqual(expect.arrayContaining(["mt-4", "rounded-xl", "border-border", "bg-surface-1"]));
    const physical = classTokens(markup).filter((c) => /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|inset-x)(?:-|$)/.test(c.split(":").pop() as string));
    expect(physical).toEqual([]);
  });
});
