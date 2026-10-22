/**
 * Where to send the browser after signing in or finishing the onboarding, from a `?next=` value.
 * Anybody can put anything in a link, so only a path on THIS site is accepted; everything else
 * becomes "/". No Node or Next imports: the Edge middleware, server pages and the browser use it.
 *
 * Refused (-> "/"):
 *  - anything that does not start with exactly one "/": absolute URLs, "javascript:", "//host"
 *    (protocol-relative) and "/\host" (browsers read "\" as "/");
 *  - control characters and whitespace anywhere: browsers drop tabs and newlines, so
 *    "/<TAB>/host" would become "//host";
 *  - a path that only becomes "//host" after "." and ".." are resolved ("/.//host");
 *  - the sign-in, registration and onboarding pages and the API (no loops, no JSON pages).
 */
const BASE = "http://next.invalid";
const NOT_A_DESTINATION = ["/login", "/register", "/onboarding", "/api"];

export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return "/";
  if (raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return "/";
  if (/[\\\s\u0000-\u001f\u007f]/.test(raw)) return "/";
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE || url.pathname.startsWith("//")) return "/";
  if (NOT_A_DESTINATION.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
