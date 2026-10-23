import { describe, expect, it } from "vitest";
import {
  DECOR_COOKIE,
  DECOR_LEVELS,
  DEFAULT_DECOR,
  DEFAULT_THEME,
  PREF_COOKIE_MAX_AGE,
  THEME_COOKIE,
  THEME_KEYS,
  THEME_LIST,
  THEMES,
  decorLevelOf,
  isDarkTheme,
  isDecorLevel,
  isThemeKey,
  prefCookieOptions,
  prefCookieString,
  rootThemeAttributes,
  themeLabelKey,
  themeMoodKey,
  themeOf,
} from "@/lib/themes/registry";

describe("the four themes", () => {
  it("are exactly the four agreed keys, in the picker's order", () => {
    expect([...THEME_KEYS]).toEqual(["islamic-calm", "islamic-epic", "neon-coast", "day"]);
    expect(THEME_LIST.map((t) => t.key)).toEqual([...THEME_KEYS]);
  });

  it("«إسلامي هادي» is the default, and it is a light theme", () => {
    expect(DEFAULT_THEME).toBe("islamic-calm");
    expect(isDarkTheme(DEFAULT_THEME)).toBe(false);
  });

  it("two are dark (they also carry the `dark` class) and two are light", () => {
    expect(THEME_KEYS.filter(isDarkTheme)).toEqual(["islamic-epic", "neon-coast"]);
    expect(THEME_KEYS.filter((k) => !isDarkTheme(k))).toEqual(["islamic-calm", "day"]);
  });

  it("the Islamic themes title in Reem Kufi, the others in IBM Plex", () => {
    expect(THEMES["islamic-calm"].headingFont).toBe("reem-kufi");
    expect(THEMES["islamic-epic"].headingFont).toBe("reem-kufi");
    expect(THEMES["neon-coast"].headingFont).toBe("plex");
    expect(THEMES.day.headingFont).toBe("plex");
  });
});

describe("whatever was stored becomes a real theme", () => {
  it("keeps a valid key", () => {
    for (const key of THEME_KEYS) {
      expect(isThemeKey(key)).toBe(true);
      expect(themeOf(key)).toBe(key);
    }
  });

  it("maps the old light/dark/system values, garbage, nothing and non-strings to the default", () => {
    for (const value of ["system", "light", "dark", "", "ISLAMIC-CALM", " day", "neon", "<script>", undefined, null, 7, {}, ["day"]]) {
      expect(isThemeKey(value), String(value)).toBe(false);
      expect(themeOf(value), String(value)).toBe(DEFAULT_THEME);
    }
  });
});

describe("decoration level", () => {
  it("is off / light / full, light by default, and anything else is the default", () => {
    expect([...DECOR_LEVELS]).toEqual(["off", "light", "full"]);
    expect(DEFAULT_DECOR).toBe("light");
    for (const level of DECOR_LEVELS) {
      expect(isDecorLevel(level)).toBe(true);
      expect(decorLevelOf(level)).toBe(level);
    }
    for (const value of ["", "FULL", "none", undefined, null, 1]) {
      expect(isDecorLevel(value), String(value)).toBe(false);
      expect(decorLevelOf(value), String(value)).toBe("light");
    }
  });
});

describe("the attributes <html> carries for a theme", () => {
  it("names the theme and the decoration level, and asks for the dark class on dark themes only", () => {
    expect(rootThemeAttributes("islamic-epic", "full")).toEqual({ "data-theme": "islamic-epic", "data-decor": "full", dark: true });
    expect(rootThemeAttributes("day", "off")).toEqual({ "data-theme": "day", "data-decor": "off", dark: false });
  });
});

describe("the preference cookies", () => {
  it("are called zaki_theme and zk-decor", () => {
    expect(THEME_COOKIE).toBe("zaki_theme");
    expect(DECOR_COOKIE).toBe("zk-decor");
  });

  it("live one year, on every path, SameSite=Lax, and are readable by the page (it writes them too)", () => {
    expect(PREF_COOKIE_MAX_AGE).toBe(365 * 24 * 60 * 60);
    expect(prefCookieOptions(false)).toEqual({ path: "/", maxAge: PREF_COOKIE_MAX_AGE, sameSite: "lax", httpOnly: false, secure: false });
    expect(prefCookieOptions(true).secure).toBe(true);
  });

  it("are written by the browser as one document.cookie string", () => {
    expect(prefCookieString(THEME_COOKIE, "neon-coast", false)).toBe(`zaki_theme=neon-coast; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax`);
    expect(prefCookieString(DECOR_COOKIE, "off", true)).toBe(`zk-decor=off; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax; Secure`);
  });
});

describe("the Arabic name and mood of a theme", () => {
  it("are looked up under theme.<key> and theme.<key>.mood", () => {
    expect(themeLabelKey("neon-coast")).toBe("theme.neon-coast");
    expect(themeMoodKey("day")).toBe("theme.day.mood");
  });
});
