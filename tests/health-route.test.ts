import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as health from "../src/app/api/health/route";

describe("/api/health", () => {
  it("is evaluated per request (a build-time snapshot made the Docker health check blind to a database outage)", () => {
    expect(health.dynamic).toBe("force-dynamic");
  });
});

describe("docker-compose.yml", () => {
  const compose = readFileSync(path.resolve(__dirname, "../docker-compose.yml"), "utf8");

  /** The `ports:` entries of one top-level service. */
  function ports(service: string): string[] {
    const block = new RegExp(`\\n  ${service}:\\n([\\s\\S]*?)(?=\\n  [a-z]+:\\n|\\nvolumes:|$)`).exec(compose)?.[1] ?? "";
    return [...block.matchAll(/ports:\s*\n((?:\s+-\s+"[^"]+"\s*\n?)+)/g)].flatMap((m) =>
      [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!),
    );
  }

  it("publishes Postgres and Redis on the loopback interface only (they have default passwords / none)", () => {
    for (const service of ["db", "redis"]) {
      const published = ports(service);
      expect(published.length, service).toBeGreaterThan(0);
      for (const p of published) expect(p.startsWith("127.0.0.1:"), `${service}: ${p}`).toBe(true);
    }
  });
});
