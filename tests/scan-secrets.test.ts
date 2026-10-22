import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * scripts/scan-secrets.mjs, run as a real process over throw-away directories.
 *
 * Every secret below is assembled at run time ("AKIA" + "...") so this file
 * contains no contiguous credential: the repository scan runs over it too.
 */

vi.setConfig({ testTimeout: 30_000 });

const SCRIPT = resolve(__dirname, "../scripts/scan-secrets.mjs");

function scan(files: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "zaki-scan-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
    }
    const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DEMO_PASSWORD = ["owner", "1234"].join("");
const REAL_LOOKING = "k3Jd9sLq0Zx8vB2nM5tR7yU1wE4pA6hG"; // 32 mixed characters, nothing fake about it

const vendorSecrets: Array<{ rule: string; value: string }> = [
  { rule: "Private key block", value: "-----BEGIN " + "RSA PRIVATE KEY-----" },
  { rule: "AWS access key id", value: "AKIA" + "QWERTYUIOPASDFGH" },
  { rule: "GitHub token", value: "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8" },
  { rule: "GitHub fine-grained token", value: "github_pat_" + "11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcd" },
  { rule: "Slack token", value: "xoxb-" + "123456789012-abcdefghijklmnop" },
  { rule: "Telegram bot token", value: "123456789:" + "AAH8x3Kq9Z0aBcDeFgHiJkLmNoPqRsTuVwX" },
  { rule: "Known demo password", value: DEMO_PASSWORD },
];

describe("scan-secrets: what it catches", () => {
  it.each(vendorSecrets)("catches $rule, names file:line and never prints the value", ({ rule, value }) => {
    const r = scan({ "src/config.ts": `// line one\nconst thing = "${value}";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`SECRET?? ${rule} at src/config.ts:2`);
    expect(r.stderr).not.toContain(value);
    expect(r.stdout).not.toContain(value);
  });

  it("catches vendor-shaped secrets in test files too (they run on every file)", () => {
    const r = scan({ "tests/aws.test.ts": `const key = "${"AKIA" + "QWERTYUIOPASDFGH"}";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("AWS access key id at tests/aws.test.ts:1");
  });

  it("catches the known demo password in prose (README, docs)", () => {
    const r = scan({ "README.md": `# App\n\nLogin: someone@example.org / ${DEMO_PASSWORD}\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Known demo password at README.md:3");
  });

  it("catches a long generated value assigned to a secret-like name in source", () => {
    const r = scan({ "src/server/keys.ts": `export const authSecret = "${REAL_LOOKING}";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("High-entropy secret assignment at src/server/keys.ts:1");
    expect(r.stderr).not.toContain(REAL_LOOKING);
  });

  it("catches a human-chosen password literal in source", () => {
    const r = scan({ "src/seed.ts": `const adminPassword = "Summer2026!x";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Hard-coded secret literal at src/seed.ts:1");
  });

  it("catches a real value typed into .env.example (the file is scanned, not exempt)", () => {
    const r = scan({ ".env.example": `DATABASE_URL=""\nAUTH_SECRET=${REAL_LOOKING}\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unquoted secret assignment at .env.example:2");
    expect(r.stderr).not.toContain(REAL_LOOKING);
  });

  it("catches an unquoted secret in compose / yaml files", () => {
    const r = scan({ "deploy/stack.yml": `services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: ${REAL_LOOKING}\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unquoted secret assignment at deploy/stack.yml:4");
  });

  it("catches a hard-coded fallback next to an environment read", () => {
    const r = scan({ "src/server/keys.ts": `export const authSecret = process.env.AUTH_SECRET ?? "${REAL_LOOKING}";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Hard-coded fallback for a secret at src/server/keys.ts:1");
    expect(r.stderr).not.toContain(REAL_LOOKING);
  });

  it("catches a secret baked into a Dockerfile or a shell script", () => {
    const docker = scan({ Dockerfile: `FROM node:22\nENV SESSION_SECRET=${REAL_LOOKING}\nENV UPLOAD_DIR=/app/storage/uploads\n` });
    expect(docker.status).toBe(1);
    expect(docker.stderr).toContain("Unquoted secret assignment at Dockerfile:2");
    expect(docker.stderr).not.toContain("Dockerfile:3");
    const sh = scan({ "scripts/deploy.sh": `#!/bin/sh\nexport API_TOKEN=${REAL_LOOKING}\n` });
    expect(sh.status).toBe(1);
    expect(sh.stderr).toContain("Unquoted secret assignment at scripts/deploy.sh:2");
  });

  it("flags any committed .env file, whatever it holds", () => {
    const r = scan({ ".env": "FOO=bar\n" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Committed .env file at .env:1");
    const nested = scan({ "apps/web/.env.production": "FOO=bar\n" });
    expect(nested.status).toBe(1);
    expect(nested.stderr).toContain("Committed .env file at apps/web/.env.production:1");
  });

  it("catches a connection string that carries a real password to a remote host", () => {
    const url = "postgresql://app:" + "s3cr3tValue99" + "@pg.internal-company-hosting.net:5432/app";
    const r = scan({ "src/db.ts": `const url = "${url}";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Connection string with credentials at src/db.ts:1");
    expect(r.stderr).not.toContain("s3cr3tValue99");
  });

  it("reads files with a UTF-8 byte-order mark and CRLF line endings", () => {
    const r = scan({ "src/win.ts": `﻿const a = 1;\r\nconst authSecret = "${REAL_LOOKING}";\r\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("src/win.ts:2");
  });

  it("scans lock files for vendor-shaped secrets but not for shape guesses", () => {
    const lock = scan({
      "package-lock.json": `{"integrity": "sha512-${"A1b2C3d4E5f6".repeat(8)}==", "password": "${REAL_LOOKING}"}\n`,
    });
    expect(lock.status).toBe(0);
    const leaked = scan({ "package-lock.json": `{"resolved": "https://x:${"ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"}@registry.example.org/a.tgz"}\n` });
    expect(leaked.status).toBe(1);
    expect(leaked.stderr).toContain("GitHub token at package-lock.json:1");
  });

  it("reports every file with a finding, one line each, and the total", () => {
    const r = scan({
      "a.ts": `const x = "${"AKIA" + "QWERTYUIOPASDFGH"}";\n`,
      "docs/b.md": `${DEMO_PASSWORD}\n`,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("a.ts:1");
    expect(r.stderr).toContain("docs/b.md:1");
    expect(r.stderr).toMatch(/2 potential secret\(s\) in 2 file\(s\)/);
  });
});

describe("scan-secrets: what it leaves alone", () => {
  it("passes a clean tree and says how many files it read", () => {
    const r = scan({
      "src/a.ts": "export const answer = 42;\n",
      "docs/readme.md": "Nothing to see here.\n",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Secret scan clean - 2 files");
    expect(r.stderr).toBe("");
  });

  it("passes a .env.example made of empty values and obvious placeholders", () => {
    const r = scan({
      ".env.example": [
        '# Zaki Workspace - copy to .env and fill in',
        'DATABASE_URL="postgresql://user:password@host:5432/database"',
        'AUTH_SECRET=""',
        'ENCRYPTION_KEY=',
        "SESSION_TTL_HOURS=168",
        'APP_URL="https://your-domain.com"',
        "# GOOGLE_CLIENT_SECRET=",
        'TELEGRAM_BOT_TOKEN="<paste the token from BotFather>"',
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("lets .env templates through whatever they are called, but not the real files", () => {
    expect(scan({ ".env.local.example": "FOO=bar\n", ".env.production.sample": "FOO=bar\n" }).status).toBe(0);
    expect(scan({ ".env.local": "FOO=bar\n" }).status).toBe(1);
  });

  it("does not take an error key or a translation key for a secret fallback", () => {
    const r = scan({
      "src/google.ts": [
        'const message = json?.error_description ?? json?.error ?? "google.token_failed";',
        'const secret = process.env.AUTH_SECRET ?? "";',
        'const tokenLabel = row.token ?? "settings.integrations.token_missing";',
        'const rule = { password: "password.min8", token: "auth.token_expired2" };',
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("passes code and config that READ secrets instead of defining them", () => {
    const r = scan({
      "src/env.ts": 'export const authSecret = process.env.AUTH_SECRET ?? "";\nconst k = process.env["ENCRYPTION_KEY"];\n',
      "docker-compose.yml": [
        "services:",
        "  db:",
        "    environment:",
        "      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-zaki_local}",
        "  app:",
        "    environment:",
        "      AUTH_SECRET: ${AUTH_SECRET:?set AUTH_SECRET in .env}",
        "      ENCRYPTION_KEY: ${ENCRYPTION_KEY:-}",
        "",
      ].join("\n"),
      "scripts/gen.sh": "AUTH_SECRET=$(openssl rand -hex 32)\n",
    });
    expect(r.status).toBe(0);
  });

  it("passes values that say they are fake, and local development URLs", () => {
    const r = scan({
      "src/seed.ts": [
        'const demoPassword = "test-password-123";',
        'const apiKey = "dummy-api-key-for-the-build";',
        'const token = "placeholder-token-value";',
        'const url = "postgresql://zaki:zaki_local@localhost:5433/postgres";',
        'const compose = "postgresql://zaki:zaki_local@db:5432/zaki_workspace";',
        "",
      ].join("\n"),
      ".github/workflows/ci.yml": ["env:", "  POSTGRES_PASSWORD: ci-test-password-not-used-anywhere", ""].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("passes connection strings to documentation hosts (RFC 2606) and with placeholder passwords", () => {
    const r = scan({
      "docs/db.md": [
        "postgresql://app:" + "Sup3rSecret99" + "@db.internal.example.net:5432/app",
        "postgresql://u:p@10.0.0.5:5432/app",
        "postgresql://user:password@prod-db.company-hosting.net:5432/app",
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("passes the AWS documentation's own sample key (it says EXAMPLE)", () => {
    const r = scan({ "docs/aws.md": `The docs use ${"AKIAIOSFODNN7" + "EXAMPLE"} as a sample.\n` });
    expect(r.status).toBe(0);
  });

  it("does not judge test files by shape guesses (hashes, fixture passwords)", () => {
    const r = scan({
      "tests/auth.test.ts": [
        'const secret = "test-secret-at-least-16-chars";',
        `const password = "Passw0rd-test";`,
        `const token = "${REAL_LOOKING}";`,
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("honours the scan-secrets:ignore marker on one line, and only on that line", () => {
    const r = scan({
      "src/a.ts": `export const sample = "${REAL_LOOKING}"; // scan-secrets:ignore\n`,
      "src/b.ts": `export const authSecret = "${REAL_LOOKING}";\n`,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("src/b.ts:1");
    expect(r.stderr).not.toContain("src/a.ts");
  });

  it("skips node_modules, .git and binary files when walking a directory", () => {
    const r = scan({
      "node_modules/pkg/index.js": `const authSecret = "${REAL_LOOKING}";\n`,
      ".git/config": `${DEMO_PASSWORD}\n`,
      "logo.png": `${DEMO_PASSWORD}\n`,
      "src/ok.ts": "export {};\n",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 files");
  });
});

describe("scan-secrets: inside the real repository", () => {
  it("runs over git's file list without crashing on a deleted-but-tracked file", () => {
    // No arguments = git ls-files. The exit code depends on the tree (CI is the judge);
    // what must hold here is that it terminates normally and reports in its own format.
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd: resolve(__dirname, "..") });
    expect([0, 1]).toContain(r.status);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Secret scan clean|potential secret/);
  });
});
