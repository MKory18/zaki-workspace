import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error next.config.mjs carries no declaration file; its shape is asserted below
const { default: config } = await import("../next.config.mjs");

/**
 * WP-UI2 item 8: the brand artwork, the icons and the self-hosted font get one Cache-Control
 * policy — fresh for a day, then revalidated while stale copies serve — so a repeat visit does not
 * re-download the logo, yet a changed logo arrives the next day at the latest.
 */
describe("static brand assets carry a caching policy (next.config headers)", () => {
  it("the three static trees — /brand, /icons, /fonts — are covered", async () => {
    const rules = (await config.headers()) as Array<{ source: string }>;
    expect(rules.map((h) => h.source)).toEqual(["/brand/:path*", "/icons/:path*", "/fonts/:path*"]);
  });

  it("the policy is fresh for a day, serves stale while revalidating, and never trusts a year-old copy", async () => {
    for (const { headers } of (await config.headers()) as Array<{ headers: Array<{ key: string; value: string }> }>) {
      const cc = headers.find((h) => h.key === "Cache-Control")?.value ?? "";
      expect(cc).toMatch(/public/);
      expect(cc).toMatch(/max-age=86400/);
      expect(cc).toMatch(/stale-while-revalidate=/);
      expect(cc).toMatch(/must-revalidate/);
      // no `immutable`: these files have no fingerprint in their name
      expect(cc).not.toMatch(/immutable/);
    }
  });

  it("the trees it caches really exist in public/", () => {
    for (const dir of ["brand", "icons", "fonts"]) {
      expect(existsSync(path.resolve(__dirname, "..", "public", dir)), dir).toBe(true);
    }
  });
});
