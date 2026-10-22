/**
 * `aria-current` for a link of the navigation: "page" when the link IS the page on screen, "true" when
 * the page is inside the link's place or tab (a project inside «المشاريع», a tab inside «الشغل»), and
 * nothing otherwise. A screen reader says "current page" or "current" accordingly.
 */
export function ariaCurrent(active: boolean, href: string, pathname: string): "page" | "true" | undefined {
  if (!active) return undefined;
  return trim(href) === trim(pathname) ? "page" : "true";
}

function trim(path: string): string {
  const bare = (path.split(/[?#]/, 1)[0] ?? "").replace(/\/+$/, "");
  return bare === "" ? "/" : bare;
}
