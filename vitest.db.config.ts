import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Database-backed suite (`npm run test:db`).
 *
 * Every run creates its own throw-away Postgres database, applies the real
 * migrations to it (`prisma migrate deploy`) and drops it afterwards, so a test
 * can never touch development or production data. Plain unit tests stay in
 * `npm test` and need no database.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    setupFiles: ["tests/db/setup.ts"],
    // One database, one process: files run one after another and share the
    // module cache, so there is a single Prisma client and a single cookie jar.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
