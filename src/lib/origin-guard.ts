/**
 * Cross-site write protection for the JSON API.
 *
 * The session cookie is SameSite=Lax, which only separates *sites*; every
 * sub-domain of the company domain counts as "same site" to every other one, so
 * a page on a sibling app could still make a signed-in browser POST here. Browsers
 * always send `Origin` on such writes, so a write whose Origin is not this app is refused.
 *
 * Pure function (no Next imports) so it runs in the Edge middleware and in unit tests.
 */
export interface OriginInput {
  method: string;
  origin: string | null;
  host: string | null;
  forwardedHost: string | null;
  secFetchSite: string | null;
  /** The public URL of the app (APP_URL), accepted even if the proxy rewrites Host. */
  appUrl?: string | undefined;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function originAllowed(i: OriginInput): boolean {
  if (SAFE_METHODS.has(i.method.toUpperCase())) return true;

  if (i.origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(i.origin).host.toLowerCase();
    } catch {
      return false; // "null" (sandboxed/opaque origin) and garbage
    }
    const allowed = new Set<string>();
    if (i.host) allowed.add(i.host.toLowerCase());
    if (i.forwardedHost) for (const h of i.forwardedHost.split(",")) allowed.add(h.trim().toLowerCase());
    if (i.appUrl) {
      try {
        allowed.add(new URL(i.appUrl).host.toLowerCase());
      } catch {
        // an unparsable APP_URL simply adds nothing
      }
    }
    return allowed.has(originHost);
  }

  // No Origin: trust Fetch Metadata when the browser sends it.
  if (i.secFetchSite !== null) return i.secFetchSite === "same-origin" || i.secFetchSite === "none";

  // Neither header: not a browser (curl, a server). A browser cannot be made to forge a write like this.
  return true;
}
