import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * SSRF guard for URLs an organisation admin types in (the n8n webhook).
 *
 * The server will POST to whatever address is stored, so the address must be a
 * public https endpoint: never a private network, a loopback or link-local
 * address, the cloud metadata service, or a name that merely RESOLVES to one.
 * The check runs when the URL is saved AND again right before every delivery
 * (DNS answers change), and the caller must not follow redirects.
 *
 * Known limit: the name is resolved here and again by `fetch`, so a DNS server
 * that answers differently the second time (rebinding) can still slip through
 * that gap. Closing it needs a connection-level hook (an undici dispatcher that
 * pins the resolved address), which is not available without a new dependency.
 */

export type HostResolver = (hostname: string) => Promise<string[]>;

/** Why a URL was refused. `n8n.url_<code>` is the matching i18n key. */
export type UnsafeUrlCode = "invalid" | "https_only" | "credentials" | "private" | "unresolvable";

export class UnsafeUrlError extends Error {
  readonly code: UnsafeUrlCode;
  constructor(code: UnsafeUrlCode) {
    super(`unsafe url: ${code}`);
    this.name = "UnsafeUrlError";
    this.code = code;
  }
}

export interface UrlGuardOptions {
  /** Resolves a host name to ALL of its addresses (A + AAAA). Injectable for tests. */
  resolve?: HostResolver;
  /**
   * Allow http(s)://localhost, 127.0.0.1 and [::1] (a local n8n while developing).
   * Defaults to `NODE_ENV !== "production"`, read at call time.
   */
  allowLoopbackHttp?: boolean;
  /** Give up on DNS after this long (default 3000 ms) so a slow resolver cannot stall a request. */
  timeoutMs?: number;
}

const DEFAULT_DNS_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------

/** Non-public IPv4 blocks (IANA special-purpose registry + the ranges clouds use for metadata). */
const V4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT (also 100.100.100.200, Alibaba metadata)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (169.254.169.254, cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments (192.0.0.192, Oracle metadata)
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + 255.255.255.255 broadcast
];

function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Dotted-quad to an unsigned 32-bit number; null unless it is a canonical IPv4 address. */
function v4ToInt(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  const parts = ip.split(".").map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

const V4_RANGES = V4_BLOCKED.map(([base, prefix]) => {
  const mask = maskOf(prefix);
  return { net: (v4ToInt(base)! & mask) >>> 0, mask };
});

function isPrivateV4Int(n: number): boolean {
  return V4_RANGES.some((r) => ((n & r.mask) >>> 0) === r.net);
}

// ---------------------------------------------------------------------------
// IPv6
// ---------------------------------------------------------------------------

/** Expands an IPv6 literal to its eight 16-bit groups; null if it is not well formed. */
function v6ToGroups(ip: string): number[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const items = part.split(":");
    const out: number[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]!;
      if (item.includes(".")) {
        // an embedded dotted quad is only legal as the very last item
        if (i !== items.length - 1) return null;
        const n = v4ToInt(item);
        if (n === null) return null;
        out.push((n >>> 16) & 0xffff, n & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(item)) return null;
        out.push(parseInt(item, 16));
      }
    }
    return out;
  };

  const head = toGroups(halves[0]!);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = toGroups(halves[1]!);
  if (!tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function isPrivateV6(g: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const embedded = (hi: number, lo: number) => isPrivateV4Int(((hi << 16) | lo) >>> 0);

  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0xffff) return embedded(g6, g7); // ::ffff:a.b.c.d  IPv4-mapped
    if (g5 === 0) return true; // ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d
  }
  if (g0 === 0x64 && g1 === 0xff9b) {
    // 64:ff9b::/96 NAT64 carries an IPv4 address; the local-use 64:ff9b:1::/48 is never public
    return g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 ? embedded(g6, g7) : true;
  }
  if (g0 === 0x2002) return embedded(g1, g2); // 6to4 carries an IPv4 address in bits 16-48

  // Global unicast is 2000::/3. Everything else (unique-local, link-local, site-local,
  // multicast, discard-only, ...) is refused, so a range nobody listed cannot slip through.
  if ((g0 & 0xe000) !== 0x2000) return true;
  if (g0 === 0x2001 && g1 < 0x0200) return true; // 2001::/23 IETF protocol block (Teredo, benchmarking, ORCHID, ...)
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g0 === 0x3fff && (g1 & 0xf000) === 0) return true; // 3fff::/20 documentation
  return false;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

function normalizeAddress(input: string): string {
  let s = input.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  return s;
}

/**
 * True when connecting to this address would reach a private, loopback,
 * link-local, CGNAT, multicast, reserved or otherwise non-public destination.
 *
 * IPv4-mapped, NAT64 and 6to4 forms are judged by the IPv4 address they carry.
 * Anything that is not a valid IP literal is reported as private (fail closed).
 */
export function isPrivateAddress(input: string): boolean {
  const ip = normalizeAddress(input);
  const family = isIP(ip);
  if (family === 4) {
    const n = v4ToInt(ip);
    return n === null ? true : isPrivateV4Int(n);
  }
  if (family === 6) {
    const groups = v6ToGroups(ip);
    return groups === null ? true : isPrivateV6(groups);
  }
  return true;
}

const defaultResolve: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("dns timeout")), ms);
  });
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isLoopbackName(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Throws `UnsafeUrlError` unless `rawUrl` is an https URL (no credentials) whose
 * host is a public address, literal or resolved. Returns the parsed URL; use its
 * `href` for the request so what was checked is what is fetched.
 *
 * http is accepted only for localhost / 127.0.0.1 / [::1] and only outside
 * production (see `UrlGuardOptions.allowLoopbackHttp`).
 */
export async function assertPublicHttpsUrl(rawUrl: string, opts: UrlGuardOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("invalid");
  if (url.username || url.password) throw new UnsafeUrlError("credentials");

  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const family = isIP(host);
  if (family === 0 && host.endsWith(".")) host = host.slice(0, -1);

  const allowLoopback = opts.allowLoopbackHttp ?? process.env["NODE_ENV"] !== "production";
  const devLoopback = allowLoopback && isLoopbackName(host);

  if (url.protocol === "http:" && !devLoopback) throw new UnsafeUrlError("https_only");
  if (devLoopback) return url;

  if (family !== 0) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError("private");
    return url;
  }

  // Internal names are refused outright, without asking DNS: localhost, *.localhost and
  // single-label names (container / service names such as `db` or `redis`).
  if (host === "localhost" || host.endsWith(".localhost") || !host.includes(".")) throw new UnsafeUrlError("private");

  let addresses: string[];
  try {
    addresses = await withTimeout((opts.resolve ?? defaultResolve)(host), opts.timeoutMs ?? DEFAULT_DNS_TIMEOUT_MS);
  } catch {
    throw new UnsafeUrlError("unresolvable");
  }
  if (addresses.length === 0) throw new UnsafeUrlError("unresolvable");
  // ANY private answer refuses the URL: the connection may pick any of them.
  if (addresses.some(isPrivateAddress)) throw new UnsafeUrlError("private");
  return url;
}
