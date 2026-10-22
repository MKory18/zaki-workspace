import { afterEach, describe, expect, it, vi } from "vitest";
import { bootWarnings } from "../src/server/env";
import { log } from "../src/server/log";

describe("bootWarnings (a running server with a config that is valid but wrong for production)", () => {
  const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

  it("warns when APP_URL is missing or blank in production (Google redirects and links would point at localhost)", () => {
    expect(bootWarnings({ ...prod })).toContain("boot.app_url_missing");
    expect(bootWarnings({ ...prod, APP_URL: "" })).toContain("boot.app_url_missing");
    expect(bootWarnings({ ...prod, APP_URL: "   " })).toContain("boot.app_url_missing");
  });

  it("warns when APP_URL is explicitly a localhost address in production", () => {
    expect(bootWarnings({ ...prod, APP_URL: "http://localhost:3000" })).toContain("boot.app_url_missing");
    expect(bootWarnings({ ...prod, APP_URL: "http://127.0.0.1:3000/" })).toContain("boot.app_url_missing");
  });

  it("is quiet for a real public URL", () => {
    expect(bootWarnings({ ...prod, APP_URL: "https://workspace.zakiai.io", ENCRYPTION_KEY: "x".repeat(32) })).toEqual([]);
  });

  it("is quiet outside production (local development uses localhost on purpose)", () => {
    expect(bootWarnings({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toEqual([]);
    expect(bootWarnings({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("reminds the operator that secrets at rest still depend on AUTH_SECRET until ENCRYPTION_KEY is set", () => {
    const w = bootWarnings({ ...prod, APP_URL: "https://workspace.zakiai.io" });
    expect(w).toContain("boot.encryption_key_missing");
    expect(bootWarnings({ ...prod, APP_URL: "https://workspace.zakiai.io", ENCRYPTION_KEY: "k".repeat(40) })).not.toContain(
      "boot.encryption_key_missing",
    );
  });
});

describe("log level", () => {
  const saved = process.env["LOG_LEVEL"];
  afterEach(() => {
    if (saved === undefined) delete process.env["LOG_LEVEL"];
    else process.env["LOG_LEVEL"] = saved;
    vi.restoreAllMocks();
  });

  it("is case-insensitive (boot accepts LOG_LEVEL=WARN, so the logger must honour it)", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env["LOG_LEVEL"] = "WARN";
    log.info("should.be.silent");
    log.warn("should.show");
    expect(out).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to info for an unknown value instead of logging everything or nothing", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.env["LOG_LEVEL"] = "loud";
    log.debug("hidden");
    log.info("shown");
    expect(out).toHaveBeenCalledTimes(1);
  });
});
