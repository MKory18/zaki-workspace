import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { apiError, withApi } from "@/server/api";
import * as validation from "@/server/validation";
import { registerSchema, passwordChangeSchema } from "@/server/validation";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("register validation contract", () => {
  it("bootstrap mode requires orgName; a body with a joinCode is still recognised (the route answers 410)", () => {
    const ok = registerSchema.safeParse({
      email: "A@B.co",
      name: "س",
      password: "abcd1234",
      orgName: "مؤسستي",
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.mode).toBe("create");

    const join = registerSchema.safeParse({
      email: "x@y.co",
      name: "n",
      password: "abcd1234",
      joinCode: "ab12cd34",
    });
    expect(join.success).toBe(true);
    if (join.success) expect(join.data.mode).toBe("join");
  });

  it("rejects weak passwords and missing orgName (bootstrap)", () => {
    const weak = registerSchema.safeParse({ email: "a@b.co", name: "n", password: "short1", orgName: "o" });
    expect(weak.success).toBe(false);
    const noOrg = registerSchema.safeParse({ email: "a@b.co", name: "n", password: "abcd1234" });
    expect(noOrg.success).toBe(false);
  });
});

describe("login validation contract", () => {
  const loginSchema = (validation as Record<string, unknown>)["loginSchema"] as
    | { safeParse: (v: unknown) => { success: boolean; data?: { identifier: string; password: string } } }
    | undefined;

  it("takes a username or an e-mail as `identifier`, trimmed and lower-cased", () => {
    expect(loginSchema?.safeParse({ identifier: "  Ali.Hassan ", password: "x" }).data).toEqual({ identifier: "ali.hassan", password: "x" });
    expect(loginSchema?.safeParse({ identifier: "Boss@Example.ORG", password: "x" }).data).toEqual({ identifier: "boss@example.org", password: "x" });
  });

  it("still accepts the old { email, password } body", () => {
    expect(loginSchema?.safeParse({ email: "Old@Client.io", password: "x" }).data).toEqual({ identifier: "old@client.io", password: "x" });
  });

  it("refuses an empty identifier or password", () => {
    for (const body of [{ identifier: "   ", password: "x" }, { identifier: "ali", password: "" }, { password: "x" }, {}]) {
      expect(loginSchema?.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("own password change contract", () => {
  it("the new password must differ from the current one", () => {
    const same = passwordChangeSchema.safeParse({ currentPassword: "Abcd1234", newPassword: "Abcd1234" });
    expect(same.success).toBe(false);
    if (!same.success) expect(same.error.issues.map((i) => i.message)).toContain("onboarding.err_same");
    expect(passwordChangeSchema.safeParse({ currentPassword: "Abcd1234", newPassword: "Efgh5678" }).success).toBe(true);
  });
});

describe("withApi prisma handling (P1 regression — no internal leaks)", () => {
  it("maps P2002 on email to conflict with email.taken key, without the Prisma text", async () => {
    const res = await withApi(async () => {
      const err = new Error("Invalid `prisma.user.create()` invocation:\n\ndetail text");
      (err as unknown as { code: string; meta: { target: string[] } }).code = "P2002";
      (err as unknown as { meta: { target: string[] } }).meta = { target: ["User_email_key"] };
      throw err;
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message?: string };
    expect(body.message).toBe("email.taken");
    expect(JSON.stringify(body)).not.toContain("prisma");
    expect(JSON.stringify(body)).not.toContain("invocation");
  });

  it("maps other P-codes to a bare conflict (no leaked message)", async () => {
    const res = await withApi(async () => {
      const err = new Error("secret table text");
      (err as unknown as { code: string }).code = "P2021";
      throw err;
    });
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).not.toContain("secret table text");
    expect(text).not.toContain("invocation");
  });

  it("apiError is still the shape the client reads", async () => {
    const res = apiError("forbidden", "auth.registration_closed");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden", message: "auth.registration_closed" });
  });
});

describe("registration robustness contract (root-cause regressions)", () => {
  const orgs = read("src", "server", "services", "orgs.ts");
  const boot = orgs.slice(orgs.indexOf("export async function registerOrganization"), orgs.indexOf("/** Generates a code"));

  it("audit failure after user creation must not fail the registration", () => {
    expect(boot).toContain("audit.write_failed");
    // the audit call is wrapped in its own try/catch inside the create flow
    const auditIdx = boot.indexOf("audit.write_failed");
    const tryIdx = boot.lastIndexOf("try", auditIdx);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(tryIdx).toBeLessThan(auditIdx);
  });

  it("P2002 during user creation is translated to email.taken (race-safe)", () => {
    expect(boot).toContain("P2002");
    expect(boot).toContain("email.taken");
  });

  it("self-serve joining with a code is gone from the service (accounts are created by the owner)", () => {
    expect(orgs).not.toMatch(/export async function joinByCode/);
    expect(orgs).not.toMatch(/export async function regenerateJoinCode/);
  });
});

describe("boot-time env validation (root cause: lazy env on prod)", () => {
  it("instrumentation.ts exists and validates env eagerly at boot", () => {
    const inst = read("src", "instrumentation.ts");
    expect(inst).toContain("export async function register");
    expect(inst).toContain("NEXT_RUNTIME");
    expect(inst).toContain("boot.env_invalid");
    // never logs secret values
    expect(inst).not.toMatch(/AUTH_SECRET.*\$\{e\.AUTH_SECRET\}|password.*\$\{/);
  });

  it("next.config enables the instrumentation hook", () => {
    const cfg = read("next.config.mjs");
    expect(cfg).toContain("instrumentationHook: true");
  });

  it("production container applies migrations before serving", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("prisma migrate deploy && exec npm start");
    // secrets are only read from the environment, never baked in
    expect(dockerfile).not.toMatch(/ENV AUTH_SECRET|ENV DATABASE_URL|ARG AUTH_SECRET|ARG DATABASE_URL/);
  });
});

describe("frontend register error surfacing", () => {
  it("auth-form maps server messageKeys instead of swallowing them", () => {
    const form = read("src", "components", "auth-form.tsx");
    expect(form).toContain("err.messageKey");
    // WP-ARABIC2 (c): withApi puts "validation.failed" in the ENVELOPE's message, which arrives as
    // messageKey — so branching on err.code was dead code and the field hints never showed.
    expect(form).toContain('err.messageKey === "validation.failed"');
    expect(form).not.toContain('err.code === "validation.failed"');
  });

  it("arabic strings exist for every failure the sign-in, onboarding and registration can answer", () => {
    // ar.json plus the per-feature fragments, merged the way the app merges them
    const dir = join(root, "src", "lib", "i18n");
    const ar: Record<string, string> = Object.assign(
      {},
      ...readdirSync(dir)
        .filter((f) => /^ar(\.[a-z]+)?\.json$/.test(f))
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, string>),
    );
    for (const key of [
      "email.taken",
      "auth.validationHint",
      "auth.too_many_attempts",
      "invalid_credentials",
      "auth.account_suspended",
      "auth.registration_closed",
      "auth.registration_link_invalid",
      "auth.registration_busy",
      "auth.registration_unavailable",
      "auth.onboarding_required",
      "onboarding.err_same",
      "origin.mismatch",
      "password.wrong_current",
    ]) {
      expect(ar[key], key).toBeTruthy();
    }
  });
});
