import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { apiError, withApi } from "@/server/api";
import { registerSchema } from "@/server/validation";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

describe("register validation contract", () => {
  it("bootstrap mode requires orgName and normalizes joinCode", () => {
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
});

describe("registration robustness contract (root-cause regressions)", () => {
  const orgs = read("src", "server", "services", "orgs.ts");

  it("audit failure after user creation must not fail the registration", () => {
    const boot = orgs.slice(orgs.indexOf("registerOrganization"), orgs.indexOf("joinByCode"));
    expect(boot).toContain("audit.write_failed");
    // the audit call is wrapped in its own try/catch inside the create flow
    const auditIdx = boot.indexOf("audit.write_failed");
    const tryIdx = boot.lastIndexOf("try", auditIdx);
    expect(tryIdx).toBeGreaterThan(-1);
    expect(tryIdx).toBeLessThan(auditIdx);
  });

  it("P2002 during user creation is translated to email.taken (race-safe)", () => {
    const boot = orgs.slice(orgs.indexOf("registerOrganization"), orgs.indexOf("joinByCode"));
    expect(boot).toContain("P2002");
    expect(boot).toContain("email.taken");
  });

  it("joinByCode has the same protections", () => {
    const join = orgs.slice(orgs.indexOf("joinByCode"), orgs.indexOf("/** Generates a code"));
    expect(join).toContain("audit.write_failed");
    expect(join).toContain("P2002");
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
    expect(form).toContain("err.code === \"validation.failed\"");
  });

  it("arabic keys exist for the known failure modes", () => {
    const ar = JSON.parse(read("src", "lib", "i18n", "ar.json"));
    expect(ar["email.taken"]).toBeTruthy();
    expect(ar["joincode.invalid"]).toBeTruthy();
    expect(ar["auth.validationHint"]).toBeTruthy();
  });
});