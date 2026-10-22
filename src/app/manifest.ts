import type { MetadataRoute } from "next";
import { PALETTES } from "@/lib/themes/palettes";
import { DEFAULT_THEME } from "@/lib/themes/registry";

/**
 * The web app manifest: what the browser reads to install Zaki Workspace like an app. Next serves it at
 * /manifest.webmanifest and links it from every page, no extra wiring.
 *
 * - The splash screen and the title bar take the default theme's surface colour, so an installed app opens
 *   in the same paper colour as the page (the icons are drawn on it too: scripts/make-icons.mjs).
 * - Icons are PNGs under /icons/ (committed; `node scripts/make-icons.mjs` redraws them). The maskable one
 *   is a separate file made for the mask, never one file with two purposes.
 * - `scope: "/"` and `start_url: "/"`: the whole site opens inside the app window. Pages behind the
 *   sign-in redirect to /login as usual (the middleware lets /manifest.webmanifest and /icons/* through).
 * - No service worker and no offline mode: the app needs the network, like the site does.
 */
export default function manifest(): MetadataRoute.Manifest {
  const surface = PALETTES[DEFAULT_THEME].colors.surface;
  return {
    id: "/",
    name: "Zaki Workspace",
    short_name: "زاكي",
    description: "نظام عمل الفريق: المساحات والمشاريع والمهام والدردشة والملفات في مكان واحد.",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // no `orientation`: a workspace is used on any device, in any direction — locking it would turn
    // a tablet sideways into letterboxing
    background_color: surface,
    theme_color: surface,
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
