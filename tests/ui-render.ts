import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/lib/i18n";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;

/** Renders inside the provider every page gets (the Arabic dictionary). */
export function render(element: ReactElement): string {
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, element));
}

/** Every distinct class token that appears in a piece of markup. */
export function classTokens(markup: string): string[] {
  const out = new Set<string>();
  for (const attr of markup.matchAll(/\bclass="([^"]*)"/g)) {
    for (const token of (attr[1] as string).split(/\s+/)) if (token) out.add(token);
  }
  return [...out];
}

/** The class list of the first tag in the markup that matches `tag` (a regular expression for the whole opening tag). */
export function classesOf(markup: string, tag: RegExp): string[] {
  const opening = tag.exec(markup)?.[0];
  if (!opening) throw new Error(`no tag matching ${tag} in: ${markup.slice(0, 200)}`);
  return (/\bclass="([^"]*)"/.exec(opening)?.[1] ?? "").split(/\s+/).filter(Boolean);
}

/** The visible text of a piece of markup: tags removed, white space collapsed. */
export function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Physical-direction utilities. The interface is right-to-left: layout must use the logical ones
 * (start/end, ms/me, ps/pe, rounded-s/e, border-s/e, text-start/end), never left/right.
 */
export const PHYSICAL_UTILITY =
  /^-?(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|text-left|text-right|float-left|float-right|inset-x|scroll-ml|scroll-mr)(?:-|$)/;

/** Tailwind palette colours, black and white: none of them may appear, the theme tokens are the only colours. */
export const PALETTE_COLOUR =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|shadow|accent|caret|decoration|placeholder)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|black|white)\b/;
