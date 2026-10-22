import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import { TIP_KEYS, TIP_ROTATION_MS, tipFor, tipSeed, tipsFor } from "@/lib/tips";

/** The tip texts, from the same dictionary the screens read. */
const texts = TIP_KEYS.map((key) => ({ key, text: AR[key] ?? "" }));

describe("usage tips for the loading screen", () => {
  it("there are about a dozen of them", () => {
    expect(TIP_KEYS.length).toBeGreaterThanOrEqual(11);
    expect(TIP_KEYS.length).toBeLessThanOrEqual(14);
  });

  it("every tip has a text in the Arabic dictionary (a missing one would print its key)", () => {
    for (const { key, text } of texts) expect(text, key).not.toBe("");
  });

  it("every tip is Arabic: it has Arabic letters and no Latin letter at all", () => {
    for (const { key, text } of texts) {
      expect(text, key).toMatch(/[؀-ۿ]/);
      expect(text, key).not.toMatch(/[A-Za-z]/);
    }
  });

  it("every tip is short enough for a loading screen: at most 90 characters", () => {
    for (const { key, text } of texts) expect(text.length, `${key} (${text.length})`).toBeLessThanOrEqual(90);
  });

  it("every tip is a real sentence, not a stub: at least 25 characters, ending with a full stop", () => {
    for (const { key, text } of texts) {
      expect(text.length, key).toBeGreaterThanOrEqual(25);
      expect(text, key).toMatch(/[.؟!]$/);
    }
  });

  it("no two tips share a key or a text, and none is a repeat of another with a different ending", () => {
    expect(new Set(TIP_KEYS).size).toBe(TIP_KEYS.length);
    expect(new Set(texts.map((t) => t.text)).size).toBe(texts.length);
    const starts = texts.map((t) => t.text.slice(0, 18));
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("tip keys live in the `tips.` namespace of the ui fragment", () => {
    for (const key of TIP_KEYS) expect(key, key).toMatch(/^tips\.[a-z_]+$/);
  });

  it("covers the features the owner asked about: search, the five places, a task, the theme, installing the app, the guide", () => {
    const all = texts.map((t) => t.text).join("\n");
    for (const word of ["البحث", "أماكن قليلة", "مهمة", "مظهر", "ثبّت التطبيق", "الدليل"]) expect(all, word).toContain(word);
  });

  it("names the five places exactly as the navigation does", () => {
    const places = texts.find((t) => t.key === "tips.places")?.text ?? "";
    for (const name of ["الشريط السفلي", "الموبايل", "القائمة الجانبية", "الكمبيوتر"]) expect(places, name).toContain(name);
  });
});

describe("tipFor: the tip is a pure function of a seed (no Math.random at render, so server and client agree)", () => {
  it("the same seed always gives the same tip", () => {
    for (const seed of [0, 1, 7, 12345, 1_000_000]) expect(tipFor(seed)).toBe(tipFor(seed));
  });

  it("walks through all the tips in order, then starts again", () => {
    const n = TIP_KEYS.length;
    expect(Array.from({ length: n }, (_, i) => tipFor(i))).toEqual([...TIP_KEYS]);
    expect(tipFor(n)).toBe(TIP_KEYS[0]);
    expect(tipFor(n + 3)).toBe(TIP_KEYS[3]);
  });

  it("any number is a valid seed: negative, fractional, huge, NaN, Infinity", () => {
    for (const seed of [-1, -37, 2.9, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity]) {
      expect(TIP_KEYS as readonly string[]).toContain(tipFor(seed));
    }
  });

  it("the seed of a moment changes every 30 seconds and is the same for everybody inside that window", () => {
    expect(TIP_ROTATION_MS).toBe(30_000);
    const start = Date.UTC(2026, 9, 22, 9, 0, 0);
    expect(tipSeed(start)).toBe(tipSeed(start + 29_999));
    expect(tipSeed(start + 30_000)).toBe(tipSeed(start) + 1);
  });

  it("over a few minutes every tip gets its turn", () => {
    const start = Date.UTC(2026, 9, 22, 9, 0, 0);
    const seen = new Set<string>();
    for (let i = 0; i < TIP_KEYS.length; i++) seen.add(tipFor(tipSeed(start + i * TIP_ROTATION_MS)));
    expect(seen.size).toBe(TIP_KEYS.length);
  });
});


describe("tipsFor: what a guest may see", () => {
  it("a guest does not get the tips that promise writing or files the server refuses them", () => {
    const guest = tipsFor("everyone");
    expect(guest).not.toContain("tips.chat");
    expect(guest).not.toContain("tips.files");
    expect(guest.length).toBe(TIP_KEYS.length - 2);
  });

  it("staff and managers get every tip", () => {
    expect(tipsFor("staff")).toEqual(TIP_KEYS);
    expect(tipsFor("managers")).toEqual(TIP_KEYS);
    expect(tipsFor()).toEqual(TIP_KEYS);
  });
});
