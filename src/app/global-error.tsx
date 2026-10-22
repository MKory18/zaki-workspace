"use client";

import { getServerT } from "@/lib/i18n/server";

/**
 * The last line of defence: what Next shows when the ROOT layout itself fails (or the app shell, or a screen
 * outside the shell such as sign-in). It REPLACES the root layout, so nothing of the app is left under it:
 *
 *  - it draws its own <html> and <body> (Arabic, right to left);
 *  - there is no stylesheet (the theme tokens and Tailwind come from the layout that just failed), so it brings
 *    its own tiny one, made only of the browser's SYSTEM colours — `color-scheme: light dark` makes Canvas and
 *    CanvasText follow the device — and logical properties;
 *  - there are no providers and no router here, so no hook: the words come straight from the merged dictionary
 *    and the retry button (`errpage.retry`) reloads the page (`reset()` would only draw the failed render again);
 *  - the way out is a plain <a href="/">, a full navigation, which also starts the whole app over.
 *
 * ⚠️ The error itself is never printed: not its message, not its stack, not its digest.
 * 🔧 The warning and its way out are drawn together, as everywhere in the system.
 *
 * The style is a constant on purpose: React escapes the text of a <style> (a quote would become &quot;), so the
 * rules use none of the characters that would be touched.
 */
const CSS = [
  "html{color-scheme:light dark}",
  "body{margin:0;min-height:100vh;box-sizing:border-box;display:grid;place-items:center;padding:1.5rem;background:Canvas;color:CanvasText;font-family:system-ui,Tahoma,sans-serif;line-height:1.8}",
  "main{max-width:26rem}",
  "h1{margin:0 0 1rem;font-size:1.25rem}",
  "p{margin:0 0 .75rem;display:flex;gap:.75rem}",
  "p span:last-child{flex:1}",
  ".row{display:flex;flex-wrap:wrap;gap:.5rem;margin-block-start:1.25rem}",
  ".btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding-inline:1.25rem;border:1px solid currentColor;border-radius:.5rem;background:ButtonFace;color:ButtonText;font:inherit;text-decoration:none;cursor:pointer}",
].join("");

export default function GlobalError() {
  const { t } = getServerT();
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{t("errpage.global.doc_title")}</title>
        <style>{CSS}</style>
      </head>
      <body>
        <main role="alert">
          <h1>{t("errpage.global.title")}</h1>
          <p>
            <span aria-hidden="true">⚠️</span>
            <span>{t("errpage.global.warn")}</span>
          </p>
          <p>
            <span aria-hidden="true">🔧</span>
            <span>{t("errpage.global.fix")}</span>
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              {t("errpage.retry")}
            </button>
            <a href="/" className="btn">
              {t("errpage.home")}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
