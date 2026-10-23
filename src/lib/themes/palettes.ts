/**
 * THE FOUR PALETTES — every colour a screen may use, per theme, by ROLE and never by look.
 *
 * Pure data and pure functions (no React, no DOM, no server imports, relative imports only: the
 * Tailwind config loads this file too). `src/app/themes.css` is GENERATED from it by
 * `npx tsx scripts/build-themes-css.mjs`, and tests/themes-css.test.ts fails while the two disagree.
 * tests/themes-palettes.test.ts runs every palette through the contrast gate (contrast.ts).
 *
 * ── Where the colours come from ──
 * The four themes of the OMS (`OMS/src/lib/system-themes.ts`, entries islamic-calm, islamic-epic,
 * neon-coast, day), mapped onto the Workspace's tokens:
 *   surface <- background · surface-1 <- card · surface-2 <- surface · border <- border
 *   fg <- foreground · fg-muted <- muted-foreground · muted <- muted (the dimmer grey, still 4.5:1)
 *   accent <- primary · accent-fg <- primary-foreground · ok <- success · warn <- warning
 *   danger <- destructive · cat-1..6 <- the chart series (re-picked where two were twins, below)
 * and four roles the OMS does not have:
 *   accent-2  the theme's second accent: gold (calm), turquoise (epic), the rose neon (neon-coast),
 *             the cyan of the brand mark (day). A shape colour (3:1), not a text colour.
 *   info      a blue that fits the theme and is clearly not its accent.
 *   *-fg      the label colour ON a solid meaning (a solid danger button): white on the light
 *             themes, the page's own dark on the dark ones.
 *   scrim     a DARK veil, tinted to the theme, in every theme: the dialog / sheet backdrop
 *             (`bg-scrim/60`, SCRIM_BACKDROP_ALPHA) and the panel under a light caption on a photo
 *             (at least SCRIM_PANEL_ALPHA). It dims; it never lightens. (Dark text over a picture on
 *             a light theme sits on a `--surface` panel instead — the decoration layer does that.)
 *
 * ── Where they were moved, and why (each move is the smallest that passes, along the colour's own hue) ──
 * The gate in contrast.ts is stricter than the OMS's on two points the Workspace's code needs:
 *  1. Status colours and categories are drawn as TEXT on their own 10% tint (`bg-ok/10 text-ok`) —
 *     the colour codemod turns every `text-emerald-600` / `text-violet-500` into exactly that. So the
 *     light themes' ok/warn/danger and some categories are a few steps darker than the OMS's, and
 *     the dark themes' danger and some categories a few steps lighter.
 *  2. Six categories must be six different colours: the OMS series had twins (calm chart-1/chart-3
 *     are both purple, 0.044 apart; neon chart-4/chart-6 0.057). The set is now, in every theme, one
 *     colour per family, in this order: 1 violet · 2 fuchsia · 3 rose · 4 teal/cyan · 5 lime/olive ·
 *     6 indigo — the order the colour codemod maps violet, fuchsia, rose (and pink), teal, lime and
 *     purple onto.
 *  Also: «إسلامي ملحمي»'s warning moved from amber toward orange (the OMS amber was 0.058 from the
 *  theme's own gold: a warning that looks like the action colour); the OMS «إسلامي هادي» card shadow
 *  (54% black, copied from a dark theme) became a soft one.
 */
import { DEFAULT_THEME, type ThemeKey } from "./registry";
import { SCRIM_BACKDROP_ALPHA, SCRIM_PANEL_ALPHA, hexToTriplet } from "./contrast";

export { SCRIM_BACKDROP_ALPHA, SCRIM_PANEL_ALPHA };

/** The colour tokens, in the order they are written. Tailwind exposes each as `bg-x`, `text-x`, `border-x/40`, ... */
export const COLOR_TOKENS = [
  "surface",
  "surface-1",
  "surface-2",
  "border",
  "muted",
  "fg",
  "fg-muted",
  "accent",
  "accent-fg",
  "accent-2",
  "ok",
  "warn",
  "danger",
  "info",
  "ok-fg",
  "warn-fg",
  "danger-fg",
  "info-fg",
  "scrim",
  "cat-1",
  "cat-2",
  "cat-3",
  "cat-4",
  "cat-5",
  "cat-6",
  "on-photo",
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** The categorical colours (labels, departments, chart series): 1 violet · 2 fuchsia · 3 rose · 4 teal · 5 lime · 6 indigo. */
export const CAT_TOKENS = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"] as const;

/** The per-theme values that are not colours. */
export const STYLE_TOKENS = ["font-display", "radius-card", "shadow-card"] as const;
export type StyleToken = (typeof STYLE_TOKENS)[number];

export interface Palette {
  /** `#RRGGBB`, upper case. The stylesheet carries them as `R G B` triplets. */
  colors: Record<ColorToken, string>;
  style: Record<StyleToken, string>;
}

/**
 * Titles. IBM Plex Sans Arabic is the body face of every theme; Reem Kufi (public/fonts, SIL OFL,
 * loaded by the root layout through next/font/local with preload off, so only an Islamic theme
 * ever downloads it) is the face of the Islamic themes' h1-h3. Each `var()` carries a fallback so a
 * page rendered without the font classes still gets a valid stack.
 */
const PLEX_STACK = 'var(--font-plex, "IBM Plex Sans Arabic"), "Segoe UI", Tahoma, sans-serif';
const KUFI_STACK = `var(--font-reem, "Reem Kufi"), ${PLEX_STACK}`;

export const PALETTES: Record<ThemeKey, Palette> = {
  /** «إسلامي هادي» — ivory paper, deep emerald, a touch of gold. Light. The default. */
  "islamic-calm": {
    colors: {
      surface: "#F6F1E7",
      "surface-1": "#FFFFFF",
      "surface-2": "#F2F2F2",
      border: "#DBDBDB",
      muted: "#55716E",
      fg: "#1D2A29",
      "fg-muted": "#3F635E",
      accent: "#0E5E55",
      "accent-fg": "#FFFFFF",
      "accent-2": "#A2822A", // gold (new): the ornament's metal, as a shape only
      ok: "#027539", // OMS #147D40, darker for chips
      warn: "#895C0A", // OMS #916418, darker for chips
      danger: "#C12215", // OMS #CC2F21, darker for chips
      info: "#2863AB", // lapis (new)
      "ok-fg": "#FFFFFF",
      "warn-fg": "#FFFFFF",
      "danger-fg": "#FFFFFF",
      "info-fg": "#FFFFFF",
      scrim: "#0F1A19", // the ink of the text, deepened: a green-black veil
      "cat-1": "#6029AE", // violet (OMS chart-1)
      "cat-2": "#AE2997", // fuchsia (OMS chart-4)
      "cat-3": "#B6285B", // rose (new: the OMS chart-3 was chart-1's twin)
      "cat-4": "#0A6F81", // teal (OMS chart-5 #2997AE, darker)
      "cat-5": "#596D08", // olive (new)
      "cat-6": "#2929AE", // indigo (OMS chart-6)
      "on-photo": "#FFFFFF", // text painted over a photograph (the Today hero), on every theme
    },
    style: {
      "font-display": KUFI_STACK,
      "radius-card": "0.75rem",
      "shadow-card": "0 1px 2px rgb(29 42 41 / 0.06), 0 1px 3px rgb(29 42 41 / 0.08)",
    },
  },

  /** «ليلي» — the adopted look («نجمة وطريق»): deep sea-night navy, gold as the metal and teal as the action. Dark. The default. */
  "islamic-epic": {
    colors: {
      surface: "#050F1F",
      "surface-1": "#0A1A2E",
      "surface-2": "#0F2438",
      border: "#1C3A52",
      muted: "#9FB6C2",
      fg: "#E6F1F4",
      "fg-muted": "#AFC4CE",
      accent: "#36B5CC",
      "accent-fg": "#04182B",
      "accent-2": "#E3B04B", // the gold of the star, the ribbon and «جديد»
      ok: "#24DB70",
      warn: "#E98E3F",
      danger: "#F57B7E",
      info: "#8FA8FF", // periwinkle: the mockup's teal action owns the cyan, so info keeps its distance
      "ok-fg": "#04182B",
      "warn-fg": "#04182B",
      "danger-fg": "#04182B",
      "info-fg": "#04182B",
      scrim: "#030812", // the ink under the night
      "cat-1": "#AE7CF0", // violet
      "cat-2": "#DF67CB", // fuchsia
      "cat-3": "#F486AD", // rose
      "cat-4": "#62C6DA", // cyan
      "cat-5": "#AED561", // lime
      "cat-6": "#758DF8", // indigo
      "on-photo": "#FFFFFF",
    },
    style: {
      "font-display": KUFI_STACK,
      "radius-card": "1.125rem", // 18px: the adopted cards
      "shadow-card": "0 1px 2px rgb(0 0 0 / 0.52), 0 1px 3px rgb(0 0 0 / 0.30)",
    },
  },

  /** «ساحل النيون» — a coast after sunset: teal-black, aqua neon and rose neon. Dark. Original work. */
  "neon-coast": {
    colors: {
      surface: "#061C28",
      "surface-1": "#0B2737",
      "surface-2": "#113447",
      border: "#20506A",
      muted: "#7FA7B8",
      fg: "#EAF7F8",
      "fg-muted": "#A6C8D4",
      accent: "#4DD9DB",
      "accent-fg": "#05222E",
      "accent-2": "#F067AE", // the rose neon (OMS chart-2 #E75FA6, a step lighter)
      ok: "#4FC27C",
      warn: "#EAA23A",
      danger: "#FA7C76", // OMS #F0625C, lightened further: the 10% chip must clear 4.5:1 on surface-2
      info: "#6FB0E0", // sky (OMS chart-4)
      "ok-fg": "#05222E",
      "warn-fg": "#05222E",
      "danger-fg": "#05222E",
      "info-fg": "#05222E",
      scrim: "#03121A", // the sea at night
      "cat-1": "#C9A8F0", // lavender-violet (OMS chart-5)
      "cat-2": "#E27EE8", // fuchsia (new)
      "cat-3": "#F067AE", // rose: the theme's own rose neon
      "cat-4": "#4DD9DB", // aqua: the theme's own aqua neon (OMS chart-1)
      "cat-5": "#B3DC5E", // lime (new)
      "cat-6": "#8E94F0", // periwinkle-indigo (OMS chart-3)
      "on-photo": "#FFFFFF",
    },
    style: {
      "font-display": PLEX_STACK,
      "radius-card": "0.875rem",
      "shadow-card": "0 1px 2px rgb(0 0 0 / 0.66), 0 1px 3px rgb(0 0 0 / 0.44)",
    },
  },

  /** «نهاري» — the adopted look by day: warm ivory paper, deep petrol blue, gold as the metal. Light. */
  day: {
    colors: {
      surface: "#F6F2EA",
      "surface-1": "#FFFDF8",
      "surface-2": "#EFE9DE",
      border: "#D8CEBC",
      muted: "#5E6B72",
      fg: "#0C3252",
      "fg-muted": "#4E5A60",
      accent: "#1A6382",
      "accent-fg": "#FFFFFF",
      "accent-2": "#A8761F", // the gold of the star, the ribbon and «جديد»
      ok: "#1A7336",
      warn: "#90560E",
      danger: "#B42318",
      info: "#094982",
      "ok-fg": "#FFFFFF",
      "warn-fg": "#FFFFFF",
      "danger-fg": "#FFFFFF",
      "info-fg": "#FFFFFF",
      scrim: "#0C1A2B", // the navy of the text, deepened
      "cat-1": "#624F91", // violet
      "cat-2": "#9D3D8D", // fuchsia
      "cat-3": "#8F4A62", // rose (darkened for the warm ground)
      "cat-4": "#0A6B7A", // teal (darkened for the warm ground)
      "cat-5": "#56661A", // olive (darkened for the warm ground)
      "cat-6": "#384DB8", // indigo
      "on-photo": "#FFFFFF",
    },
    style: {
      "font-display": KUFI_STACK,
      "radius-card": "1.125rem",
      "shadow-card": "0 1px 2px rgb(12 50 82 / 0.06), 0 1px 3px rgb(12 50 82 / 0.08)",
    },
  },
};

/** One theme as CSS custom properties, in a fixed order: colours as `R G B` triplets, then the style values. */
export function themeVariables(key: ThemeKey): Array<[string, string]> {
  const { colors, style } = PALETTES[key];
  return [
    ...COLOR_TOKENS.map((token): [string, string] => [`--${token}`, hexToTriplet(colors[token])]),
    ...STYLE_TOKENS.map((token): [string, string] => [`--${token}`, style[token]]),
  ];
}

/** The browser chrome colour (`<meta name="theme-color">`) of a theme: its page colour. */
export function themeColorOf(key: ThemeKey): string {
  return PALETTES[key].colors.surface;
}

/** The default theme's palette — what an unthemed page (`:root`) shows. */
export const DEFAULT_PALETTE: Palette = PALETTES[DEFAULT_THEME];
