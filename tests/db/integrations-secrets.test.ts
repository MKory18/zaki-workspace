import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationType } from "@prisma/client";
import * as n8nRoute from "@/app/api/integrations/n8n/route";
import * as inboundRoute from "@/app/api/integrations/n8n/inbound/route";
import * as telegramRoute from "@/app/api/integrations/telegram/route";
import * as telegramSendRoute from "@/app/api/integrations/telegram/send/route";
import { decryptSecrets, encryptSecrets, isV2Ciphertext } from "@/server/crypto";
import { emitOutbound, upsertIntegration } from "@/server/services/integrations";
import { reencryptSecrets, runCli } from "../../scripts/reencrypt-secrets";
import { call, db, loginAs, makeOrg, makeTeam } from "./helpers";
import {
  BOT_TOKEN,
  HOOK_URL,
  N8N_SECRET,
  connectN8nDirect,
  connectTelegramDirect,
  n8nRow,
  postRaw,
  resolveEverythingPublic,
  signBody,
  stubFetch,
  telegramRow,
} from "./integrations-helpers";

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: dns.lookup, default: { lookup: dns.lookup } }));

const KEY = "9f2b7c41d8e65a03b1c4f7e2a9d60853c1e4b7a2f9d0c3e6b5a8d1f4e7c0a3b6";
const OTHER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const ROTATED_AUTH_SECRET = "rotated-auth-secret-0123456789abcdef";

beforeEach(() => {
  resolveEverythingPublic(dns);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Encrypts the way a deployment WITHOUT ENCRYPTION_KEY does (legacy format), whatever the test env is. */
function legacyBlob(payload: unknown): string {
  const saved = process.env["ENCRYPTION_KEY"];
  delete process.env["ENCRYPTION_KEY"];
  try {
    return encryptSecrets(payload);
  } finally {
    if (saved === undefined) delete process.env["ENCRYPTION_KEY"];
    else process.env["ENCRYPTION_KEY"] = saved;
  }
}

async function insertRow(orgId: string, type: IntegrationType, secretEnc: string | null) {
  return db.integration.create({ data: { orgId, type, connected: true, secretEnc, config: {} } });
}

const secretOf = async (id: string) => (await db.integration.findUniqueOrThrow({ where: { id } })).secretEnc;

// ---------------------------------------------------------------------------
// disconnecting really drops the secret
// ---------------------------------------------------------------------------

describe("disconnect drops the stored secret", () => {
  it("n8n: DELETE clears the secret, and connecting again mints a NEW one (the old one is gone for good)", async () => {
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const first = await call(n8nRoute.POST, { url: "http://localhost/api/integrations/n8n", body: { webhookUrl: HOOK_URL, events: [] } });
    const s1 = first.json?.["generatedSecret"] as string;
    expect(s1).toBeTruthy();

    expect((await call(n8nRoute.DELETE, { method: "DELETE", url: "http://localhost/api/integrations/n8n" })).status).toBe(200);
    const removed = await n8nRow(org.id);
    expect(removed?.connected).toBe(false);
    expect(removed?.secretEnc).toBeNull();

    const again = await call(n8nRoute.POST, { url: "http://localhost/api/integrations/n8n", body: { webhookUrl: HOOK_URL, events: [] } });
    const s2 = again.json?.["generatedSecret"] as string;
    expect(s2).toMatch(/^[0-9a-f]{64}$/);
    expect(s2).not.toBe(s1);
  });

  it("telegram: DELETE clears the token but keeps the conversation history", async () => {
    const { org, owner } = await makeTeam();
    const { integration, chatId } = await connectTelegramDirect(org.id);
    await db.telegramMessage.create({
      data: { orgId: org.id, integrationId: integration.id, chatId, messageId: 1, fromName: "Salma", text: "hello", sentAt: new Date() },
    });
    await loginAs(owner.id);
    expect((await call(telegramRoute.DELETE, { method: "DELETE", url: "http://localhost/api/integrations/telegram" })).status).toBe(200);

    const row = await telegramRow(org.id);
    expect(row?.connected).toBe(false);
    expect(row?.secretEnc).toBeNull();
    expect(await db.telegramMessage.count({ where: { integrationId: integration.id } })).toBe(1);
    expect(await db.telegramChat.count({ where: { integrationId: integration.id } })).toBe(1);
  });

  it("upsertIntegration: secrets:null drops the secret; leaving secrets out keeps it", async () => {
    const org = await makeOrg();
    await upsertIntegration(org.id, "GOOGLE_DRIVE", { connected: true, secrets: { refreshToken: "r", accessToken: "a" } });
    const stored = (await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: org.id, type: "GOOGLE_DRIVE" } } })).secretEnc;
    expect(stored).toBeTruthy();

    await upsertIntegration(org.id, "GOOGLE_DRIVE", { connected: true, lastSyncAt: new Date() });
    expect((await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: org.id, type: "GOOGLE_DRIVE" } } })).secretEnc).toBe(stored);

    await upsertIntegration(org.id, "GOOGLE_DRIVE", { connected: false, secrets: null });
    const after = await db.integration.findUniqueOrThrow({ where: { orgId_type: { orgId: org.id, type: "GOOGLE_DRIVE" } } });
    expect(after.connected).toBe(false);
    expect(after.secretEnc).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ENCRYPTION_KEY, end to end
// ---------------------------------------------------------------------------

describe("ENCRYPTION_KEY end to end", () => {
  it("a new n8n connection is stored as v2 and keeps working after AUTH_SECRET is rotated", async () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY);
    const { org, owner } = await makeTeam();
    await loginAs(owner.id);
    const res = await call(n8nRoute.POST, { url: "http://localhost/api/integrations/n8n", body: { webhookUrl: HOOK_URL, events: [] } });
    const secret = res.json?.["generatedSecret"] as string;
    expect(isV2Ciphertext((await n8nRow(org.id))?.secretEnc)).toBe(true);

    vi.stubEnv("AUTH_SECRET", ROTATED_AUTH_SECRET);
    const { calls } = stubFetch();
    await emitOutbound(org.id, "task.created", { taskId: "t-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers["x-zaki-signature"]).toBe(signBody(secret, calls[0]!.headers["x-zaki-timestamp"]!, calls[0]!.body));

    const ping = JSON.stringify({ action: "ping" });
    expect((await postRaw(inboundRoute.POST, "http://localhost/api/integrations/n8n/inbound", ping, { "x-zaki-org": org.id, "x-zaki-token": secret })).status).toBe(200);
  });

  it("a connection stored before ENCRYPTION_KEY existed keeps working once it is set (nothing to migrate at deploy)", async () => {
    const { org } = await makeTeam();
    await connectN8nDirect(org.id); // legacy, written without ENCRYPTION_KEY
    const before = (await n8nRow(org.id))?.secretEnc;
    expect(isV2Ciphertext(before)).toBe(false);

    vi.stubEnv("ENCRYPTION_KEY", KEY);
    const { calls } = stubFetch();
    await emitOutbound(org.id, "task.created", {});
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers["x-zaki-signature"]).toBe(signBody(N8N_SECRET, calls[0]!.headers["x-zaki-timestamp"]!, calls[0]!.body));
    const ping = JSON.stringify({ action: "ping" });
    expect((await postRaw(inboundRoute.POST, "http://localhost/api/integrations/n8n/inbound", ping, { "x-zaki-org": org.id, "x-zaki-token": N8N_SECRET })).status).toBe(200);
    expect((await n8nRow(org.id))?.secretEnc).toBe(before); // reading never rewrites
  });

  it("a connected bot's token is stored as v2 and still sends after AUTH_SECRET is rotated", async () => {
    vi.stubEnv("ENCRYPTION_KEY", KEY);
    const { org, owner, member } = await makeTeam();
    stubFetch((c) =>
      new Response(
        JSON.stringify(
          c.url.endsWith("/getMe")
            ? { ok: true, result: { id: 123456789, is_bot: true, username: "zaki_test_bot" } }
            : { ok: true, result: { message_id: 12, date: 1790000000 } },
        ),
        { status: 200 },
      ),
    );
    await loginAs(owner.id);
    const connect = await call(telegramRoute.POST, { url: "http://localhost/api/integrations/telegram", body: { token: BOT_TOKEN } });
    expect(connect.status).toBe(200);
    const row = await telegramRow(org.id);
    expect(isV2Ciphertext(row?.secretEnc)).toBe(true);
    expect(row?.secretEnc).not.toContain("AAfake_bot_token");

    await db.telegramChat.create({ data: { orgId: org.id, integrationId: row!.id, chatId: "555001", title: "Ops", type: "group" } });
    vi.stubEnv("AUTH_SECRET", ROTATED_AUTH_SECRET);
    await loginAs(member.id);
    const sent = await call(telegramSendRoute.POST, { url: "http://localhost/api/integrations/telegram/send", body: { chatId: "555001", text: "after rotation" } });
    expect(sent.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// scripts/reencrypt-secrets.ts
// ---------------------------------------------------------------------------

describe("scripts/reencrypt-secrets", () => {
  const N8N_PLAIN = { sharedSecret: "plain-n8n-secret-aaaaaaaaaaaaaaaaaaaa" };
  const TG_PLAIN = { botToken: "987654321:fake-plain-bot-token-bbbbbbbbbbbbbbbbbbbbbbbbbbb" };
  const GOOGLE_PLAIN = { refreshToken: "plain-refresh-ccccccccccccccc", accessToken: "plain-access-ddddddddddddd" };

  /** An org holding two legacy rows and one row that is already v2. */
  async function mixedOrg() {
    const org = await makeOrg();
    const n8n = await insertRow(org.id, "N8N", legacyBlob(N8N_PLAIN));
    const tg = await insertRow(org.id, "TELEGRAM", legacyBlob(TG_PLAIN));
    vi.stubEnv("ENCRYPTION_KEY", KEY);
    const google = await insertRow(org.id, "GOOGLE_DRIVE", encryptSecrets(GOOGLE_PLAIN));
    return { org, n8n, tg, google };
  }

  it("a dry run (the default) says what it would do and writes nothing", async () => {
    const { org, n8n, tg, google } = await mixedOrg();
    const before = [await secretOf(n8n.id), await secretOf(tg.id), await secretOf(google.id)];

    const summary = await reencryptSecrets({ apply: false, orgId: org.id });

    expect(summary).toEqual({ scanned: 3, legacy: 2, migrated: 0, alreadyV2: 1, unreadable: 0, skipped: 0 });
    expect([await secretOf(n8n.id), await secretOf(tg.id), await secretOf(google.id)]).toEqual(before);
  });

  it("--apply rewrites every legacy row as v2 and the secrets read back identically", async () => {
    const { org, n8n, tg, google } = await mixedOrg();
    const googleBefore = await secretOf(google.id);

    const summary = await reencryptSecrets({ apply: true, orgId: org.id });

    expect(summary).toEqual({ scanned: 3, legacy: 2, migrated: 2, alreadyV2: 1, unreadable: 0, skipped: 0 });
    expect(isV2Ciphertext(await secretOf(n8n.id))).toBe(true);
    expect(isV2Ciphertext(await secretOf(tg.id))).toBe(true);
    expect(decryptSecrets(await secretOf(n8n.id))).toEqual(N8N_PLAIN);
    expect(decryptSecrets(await secretOf(tg.id))).toEqual(TG_PLAIN);
    expect(await secretOf(google.id)).toBe(googleBefore); // already v2: not touched
  });

  it("afterwards the rows no longer depend on AUTH_SECRET", async () => {
    const { org, n8n, tg } = await mixedOrg();
    await reencryptSecrets({ apply: true, orgId: org.id });
    vi.stubEnv("AUTH_SECRET", ROTATED_AUTH_SECRET);
    expect(decryptSecrets(await secretOf(n8n.id))).toEqual(N8N_PLAIN);
    expect(decryptSecrets(await secretOf(tg.id))).toEqual(TG_PLAIN);
  });

  it("running it again changes nothing", async () => {
    const { org } = await mixedOrg();
    await reencryptSecrets({ apply: true, orgId: org.id });
    const rows = await db.integration.findMany({ where: { orgId: org.id }, orderBy: { type: "asc" } });
    const again = await reencryptSecrets({ apply: true, orgId: org.id });
    expect(again).toEqual({ scanned: 3, legacy: 0, migrated: 0, alreadyV2: 3, unreadable: 0, skipped: 0 });
    expect((await db.integration.findMany({ where: { orgId: org.id }, orderBy: { type: "asc" } })).map((r) => r.secretEnc)).toEqual(rows.map((r) => r.secretEnc));
  });

  it("rows it cannot read are counted and left exactly as they were", async () => {
    const org = await makeOrg();
    const garbage = await insertRow(org.id, "N8N", "not-a-ciphertext");
    vi.stubEnv("AUTH_SECRET", "some-other-auth-secret-0123456789ab");
    const wrongAuthKey = await insertRow(org.id, "TELEGRAM", encryptSecrets(TG_PLAIN)); // v1 under another AUTH_SECRET
    vi.unstubAllEnvs();
    vi.stubEnv("ENCRYPTION_KEY", OTHER_KEY);
    const wrongV2Key = await insertRow(org.id, "GOOGLE_DRIVE", encryptSecrets(GOOGLE_PLAIN)); // v2 under another key
    vi.stubEnv("ENCRYPTION_KEY", KEY);
    const before = [await secretOf(garbage.id), await secretOf(wrongAuthKey.id), await secretOf(wrongV2Key.id)];

    const summary = await reencryptSecrets({ apply: true, orgId: org.id });

    expect(summary).toEqual({ scanned: 3, legacy: 0, migrated: 0, alreadyV2: 0, unreadable: 3, skipped: 0 });
    expect([await secretOf(garbage.id), await secretOf(wrongAuthKey.id), await secretOf(wrongV2Key.id)]).toEqual(before);
  });

  it("rows without a secret are not touched", async () => {
    const org = await makeOrg();
    const bare = await insertRow(org.id, "N8N", null);
    vi.stubEnv("ENCRYPTION_KEY", KEY);
    const summary = await reencryptSecrets({ apply: true, orgId: org.id });
    expect(summary.scanned).toBe(0);
    expect(await secretOf(bare.id)).toBeNull();
  });

  it("a row that changed between reading and writing is skipped, never overwritten", async () => {
    const org = await makeOrg();
    const row = await insertRow(org.id, "N8N", legacyBlob(N8N_PLAIN));
    vi.stubEnv("ENCRYPTION_KEY", KEY);
    const concurrent = encryptSecrets({ sharedSecret: "written-by-someone-else" });

    const summary = await reencryptSecrets({
      apply: true,
      orgId: org.id,
      // a writer (say, a Google token refresh) slips in after the script read the row
      beforeWrite: async (id) => {
        await db.integration.update({ where: { id }, data: { secretEnc: concurrent } });
      },
    });

    expect(summary).toMatchObject({ legacy: 1, migrated: 0, skipped: 1 });
    expect(await secretOf(row.id)).toBe(concurrent);
  });

  it("refuses to run without ENCRYPTION_KEY - there is nothing to migrate to - and writes nothing", async () => {
    const org = await makeOrg();
    const row = await insertRow(org.id, "N8N", legacyBlob(N8N_PLAIN));
    const before = await secretOf(row.id);
    vi.stubEnv("ENCRYPTION_KEY", "");

    await expect(reencryptSecrets({ apply: true, orgId: org.id })).rejects.toThrow(/ENCRYPTION_KEY/);
    expect(await secretOf(row.id)).toBe(before);

    const lines: string[] = [];
    expect(await runCli(["--apply", `--org=${org.id}`], (l) => lines.push(l))).toBe(1);
    expect(lines.join("\n")).toMatch(/ENCRYPTION_KEY/);
    expect(await secretOf(row.id)).toBe(before);
  });

  describe("command line", () => {
    it("is a dry run unless --apply is given, and the exit code is 0 when every row was readable", async () => {
      const { org, n8n } = await mixedOrg();
      const before = await secretOf(n8n.id);
      const lines: string[] = [];
      expect(await runCli([`--org=${org.id}`], (l) => lines.push(l))).toBe(0);
      expect(lines.join("\n")).toMatch(/dry run/i);
      expect(await secretOf(n8n.id)).toBe(before);

      lines.length = 0;
      expect(await runCli(["--apply", `--org=${org.id}`], (l) => lines.push(l))).toBe(0);
      expect(lines.join("\n")).not.toMatch(/dry run/i);
      expect(isV2Ciphertext(await secretOf(n8n.id))).toBe(true);
    });

    it("exits with 2 when some rows could not be read, so a script notices", async () => {
      const org = await makeOrg();
      await insertRow(org.id, "N8N", "not-a-ciphertext");
      vi.stubEnv("ENCRYPTION_KEY", KEY);
      expect(await runCli([`--org=${org.id}`], () => undefined)).toBe(2);
    });

    it("rejects an option it does not know instead of silently ignoring it", async () => {
      const lines: string[] = [];
      vi.stubEnv("ENCRYPTION_KEY", KEY);
      expect(await runCli(["--aply"], (l) => lines.push(l))).toBe(1);
      expect(lines.join("\n")).toContain("--aply");
    });

    it("prints counts only: never a secret, a ciphertext, a key or a database credential", async () => {
      const { org, n8n, tg } = await mixedOrg();
      const printed: string[] = [];
      const oldBlobs = [await secretOf(n8n.id), await secretOf(tg.id)];

      await runCli(["--apply", `--org=${org.id}`], (l) => printed.push(l));
      const newBlobs = [await secretOf(n8n.id), await secretOf(tg.id)];

      const out = printed.join("\n");
      const forbidden = [
        ...Object.values(N8N_PLAIN),
        ...Object.values(TG_PLAIN),
        ...Object.values(GOOGLE_PLAIN),
        ...oldBlobs,
        ...newBlobs,
        KEY,
        process.env["AUTH_SECRET"] ?? "",
        org.id,
      ];
      for (const s of forbidden.filter(Boolean)) expect(out, `leaked ${s!.slice(0, 12)}...`).not.toContain(s!);
      const password = new URL(process.env["DATABASE_URL"]!).password;
      if (password) expect(out).not.toContain(password);
      expect(out).toMatch(/\d/); // it does report counts
      expect(printed.length).toBeLessThan(20);
    });
  });
});
