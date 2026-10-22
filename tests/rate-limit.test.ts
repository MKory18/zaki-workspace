import { afterEach, describe, expect, it } from "vitest";
import { FixedWindowLimiter, RateLimitedError, clientIp } from "../src/server/rate-limit";

describe("FixedWindowLimiter", () => {
  it("allows up to the limit, then blocks until the window ends", () => {
    let t = 1_000_000;
    const l = new FixedWindowLimiter({ limit: 3, windowMs: 60_000 }, () => t);
    for (let i = 0; i < 3; i++) {
      expect(l.check("k").ok).toBe(true);
      l.hit("k");
    }
    const blocked = l.check("k");
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);
    t += 45_000;
    expect(l.check("k").retryAfterSec).toBe(15);
    t += 15_000;
    expect(l.check("k").ok).toBe(true); // window over
  });

  it("keeps keys independent and reset() clears one", () => {
    const l = new FixedWindowLimiter({ limit: 1, windowMs: 60_000 });
    l.hit("a");
    expect(l.check("a").ok).toBe(false);
    expect(l.check("b").ok).toBe(true);
    l.reset("a");
    expect(l.check("a").ok).toBe(true);
  });

  it("check() alone never counts", () => {
    const l = new FixedWindowLimiter({ limit: 1, windowMs: 60_000 });
    for (let i = 0; i < 10; i++) expect(l.check("k").ok).toBe(true);
  });

  it("refund() takes back one counted event, never below zero, and keeps the window", () => {
    let t = 1_000_000;
    const l = new FixedWindowLimiter({ limit: 2, windowMs: 60_000 }, () => t);
    const refund = (key: string) => (l as unknown as { refund: (k: string) => void }).refund(key);
    l.hit("k");
    l.hit("k");
    expect(l.check("k").ok).toBe(false);
    refund("k");
    expect(l.check("k").ok).toBe(true);
    l.hit("k");
    expect(l.check("k").ok).toBe(false);
    refund("k");
    refund("k");
    refund("k"); // more refunds than hits: harmless
    refund("never-seen");
    l.hit("k");
    l.hit("k");
    expect(l.check("k").ok).toBe(false);
    t += 60_000;
    expect(l.check("k").ok).toBe(true); // the window still ends on time
  });

  it("stays bounded under an attack with unique keys", () => {
    const l = new FixedWindowLimiter({ limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 25_000; i++) l.hit(`k${i}`);
    // no crash, and the most recent keys are still tracked
    l.hit("k24999");
    expect(l.check("k24999").ok).toBe(true);
  });
});

describe("RateLimitedError", () => {
  it("never reports a Retry-After below one second", () => {
    expect(new RateLimitedError(0).retryAfterSec).toBe(1);
    expect(new RateLimitedError(2.2).retryAfterSec).toBe(3);
  });
});

describe("clientIp", () => {
  const saved = process.env["TRUSTED_PROXY_HOPS"];
  afterEach(() => {
    if (saved === undefined) delete process.env["TRUSTED_PROXY_HOPS"];
    else process.env["TRUSTED_PROXY_HOPS"] = saved;
  });
  const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });

  it("uses the address the trusted proxy appended, not a value the client typed", () => {
    delete process.env["TRUSTED_PROXY_HOPS"];
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 198.51.100.9" }))).toBe("198.51.100.9");
  });

  it("counts several proxy hops from the right", () => {
    process.env["TRUSTED_PROXY_HOPS"] = "2";
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 198.51.100.9, 172.16.0.1" }))).toBe("198.51.100.9");
  });

  it("falls back to x-real-ip and then to 'unknown'", () => {
    delete process.env["TRUSTED_PROXY_HOPS"];
    expect(clientIp(req({ "x-real-ip": "203.0.113.4" }))).toBe("203.0.113.4");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
