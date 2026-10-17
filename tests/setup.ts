// Deterministic unit tests. No database required for these suites
// (integration suites that need Postgres are gated in CI; see README).
process.env["AUTH_SECRET"] = "test-secret-at-least-16-chars";
process.env["DATABASE_URL"] = "postgresql://test:test@localhost:5432/test";
