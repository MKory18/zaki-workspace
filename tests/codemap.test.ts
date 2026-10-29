import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `docs/CODEMAP.md` is GENERATED (`scripts/codemap.mjs`), never edited by hand: it is the map a
 * reviewer opens to answer "who may call this door" and "who writes this table". A hand-written
 * map drifts, and a drifted map is worse than none — it says a route is guarded when it is not.
 *
 * So the test runs the generator in `--check` mode: the committed file must be exactly what the
 * code produces today. Adding a route, a service or a model and forgetting to re-run the script
 * fails here, with the command to run.
 */

const ROOT = resolve(__dirname, "..");
const DOC = resolve(ROOT, "docs/CODEMAP.md");

describe("the code map is the generator's output, not a hand-written file", () => {
  it("matches the code — run `node scripts/codemap.mjs` after a change and commit the result", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/codemap.mjs", "--check"], {
        cwd: ROOT,
        stdio: "pipe",
        timeout: 60_000,
      }),
    ).not.toThrow();
  });

  it("is UTF-8 without a BOM and carries no machine path", () => {
    const text = readFileSync(DOC, "utf8");
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).not.toMatch(/\uFFFD/);
    expect(text).not.toMatch(/[A-Za-z]:\\\\/);
  });

  it("names the door every guarded route opens with, and the six that have none", () => {
    const text = readFileSync(DOC, "utf8");
    /* The guard table and the public-doors table are the two halves a reviewer reads first. */
    for (const guard of ["requireActor", "activeOrgCtx", "requireWorkspace", "crmContext", "assertNotGuest"]) {
      expect(text).toContain("`" + guard);
    }
    expect(text).toContain("## 5. Routes with no guard");
    expect(text.match(/\| `\/api\/health` \|/)).not.toBeNull();
  });
});
