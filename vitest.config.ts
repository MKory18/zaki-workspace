import { defineConfig } from "vitest/config";
import path from "node:path";

// Pin the machine's zone: production and CI run in UTC, so a test must never pass only because the
// laptop it runs on is UTC+3. Every zone-dependent test passes its own `now` and zone instead.
// `ZK_TEST_TZ` overrides the pin (the clock work ran the whole unit suite under Asia/Amman and
// America/Los_Angeles with it).
if (!process.env["ZK_TEST_TZ"]) process.env["TZ"] = "UTC";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The database suite has its own config (vitest.db.config.ts, `npm run test:db`).
    exclude: ["tests/db/**", "node_modules/**"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
