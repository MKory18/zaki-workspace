import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as n8nRoute from "@/app/api/integrations/n8n/route";
import * as testRoute from "@/app/api/integrations/n8n/test/route";
import * as inboundRoute from "@/app/api/integrations/n8n/inbound/route";
import { emitOutbound } from "@/server/services/integrations";
import { decryptSecrets } from "@/server/crypto";
import { call, db, loginAs, makeProject, makeTeam, makeWorkspace } from "./helpers";
import {
  HOOK_URL,
  N8N_SECRET,
  UUID_RE,
  connectN8nDirect,
  n8nRow,
  nowSec,
  postRaw,
  resolveEverythingPublic,
  resolveHosts,
  signBody,
  stubFetch,
} from "./integrations-helpers";

/** The only DNS the suite ever sees: every name resolves to a public address unless a test says otherwise. */
const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: dns.lookup, default: { lookup: dns.lookup } }));

const CONFIG_URL = "http://localhost/api/integrations/n8n";
const INBOUND_URL = "http://localhost/api/integrations/n8n/inbound";

beforeEach(() => {
  resolveEverythingPublic(dns);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function configure(userId: string, body: Record<string, unknown>) {
  await loginAs(userId);
  return call(n8nRoute.POST, { url: CONFIG_URL, body });
}

const issues = (res: { json: Record<string, unknown> | null }) =>
  (res.json?.["details"] as Array<{ path: string; message: string }> | undefined) ?? [];

// ---------------------------------------------------------------------------
// 3. the URL an admin saves (SSRF)
// ---------------------------------------------------------------------------

describe("n8n webhook URL: what an OWNER/ADMIN may save", () => {
  it("accepts a public https URL; the secret is shown once and is 256 random bits", async () => {
    const { org, owner } = await makeTeam();
    const res = await configure(owner.id, { webhookUrl: HOOK_URL, events: ["task.created"] });
    expect(res.status).toBe(200);
    expect(res.json?.["connected"]).toBe(true);
    const secret = res.json?.["generatedSecret"] as string;
    expect(secret).toMatch(/^[0-9a-f]{64}$/);

    const row = await n8nRow(org.id);
    expect(row?.connected).toBe(true);
    expect((row?.config as { webhookUrl: string }).webhookUrl).toBe(HOOK_URL);
    expect(row?.secretEnc).not.toContain(secret);
    expect(decryptSecrets<{ sharedSecret: string }>(row?.secretEnc)?.sharedSecret).toBe(secret);
  });

  it("a second save keeps the secret (nothing to copy again); rotating mints a new one", async () => {
    const { org, owner } = await makeTeam();
    const first = await configure(owner.id, { webhookUrl: HOOK_URL, events: [] });
    const again = await configure(owner.id, { webhookUrl: HOOK_URL, events: ["task.moved"] });
    expect(again.status).toBe(200);
    expect(again.json?.["generatedSecret"]).toBeUndefined();
    const rotated = await configure(owner.id, { webhookUrl: HOOK_URL, events: [], rotateSecret: true });
    expect(rotated.json?.["generatedSecret"]).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated.json?.["generatedSecret"]).not.toBe(first.json?.["generatedSecret"]);
    expect(decryptSecrets<{ sharedSecret: string }>((await n8nRow(org.id))?.secretEnc)?.sharedSecret).toBe(rotated.json?.["generatedSecret"]);
  });

  it("an ADMIN may configure; a MEMBER and a GUEST may not (403) and nothing is stored", async () => {
    const { org, admin, member, guest } = await makeTeam();
    expect((await configure(member.id, { webhookUrl: HOOK_URL, events: [] })).status).toBe(403);
    expect((await configure(guest.id, { webhookUrl: HOOK_URL, events: [] })).status).toBe(403);
    expect(await n8nRow(org.id)).toBeNull();
    expect((await configure(admin.id, { webhookUrl: HOOK_URL, events: [] })).status).toBe(200);
  });

  describe("refused (production rules)", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
    });

    const CASES: Array<{ url: string; key: string; dns?: Record<string, string[] | "ENOTFOUND"> }> = [
      { url: "http://hooks.example.com/webhook/zaki", key: "n8n.url_https_only" },
      { url: "ftp://hooks.example.com/webhook/zaki", key: "n8n.url_invalid" },
      { url: "https://user:secret@hooks.example.com/webhook/zaki", key: "n8n.url_credentials" },
      { url: "https://127.0.0.1/webhook/zaki", key: "n8n.url_private" },
      { url: "https://2130706433/webhook/zaki", key: "n8n.url_private" },
      { url: "https://10.0.0.5/webhook/zaki", key: "n8n.url_private" },
      { url: "https://192.168.1.10:5678/webhook/zaki", key: "n8n.url_private" },
      { url: "https://169.254.169.254/latest/meta-data/", key: "n8n.url_private" },
      { url: "https://100.64.0.10/x", key: "n8n.url_private" },
      { url: "https://[::1]/webhook/zaki", key: "n8n.url_private" },
      { url: "https://[::ffff:7f00:1]/webhook/zaki", key: "n8n.url_private" },
      { url: "https://localhost/webhook/zaki", key: "n8n.url_private" },
      { url: "https://db/webhook/zaki", key: "n8n.url_private" },
      { url: "https://internal.example.com/hook", key: "n8n.url_private", dns: { "internal.example.com": ["10.0.0.7"] } },
      { url: "https://rebind.example.com/hook", key: "n8n.url_private", dns: { "rebind.example.com": [ "93.184.216.34", "127.0.0.1"] } },
      { url: "https://v6.example.com/hook", key: "n8n.url_private", dns: { "v6.example.com": ["fd00::5"] } },
      { url: "https://ghost.example.com/hook", key: "n8n.url_unresolvable", dns: { "ghost.example.com": "ENOTFOUND" } },
    ];

    it.each(CASES)("422 $key for $url, and nothing is stored", async ({ url, key, dns: table }) => {
      const { org, owner } = await makeTeam();
      resolveHosts(dns, table ?? {});
      const res = await configure(owner.id, { webhookUrl: url, events: ["task.created"] });
      expect(res.status).toBe(422);
      expect(res.json?.["error"]).toBe("validation.failed");
      expect(issues(res)).toContainEqual({ path: "webhookUrl", message: key });
      expect(await n8nRow(org.id)).toBeNull();
    });

    it("a refused update leaves the working configuration and its secret untouched, even when rotating", async () => {
      const { org, owner } = await makeTeam();
      expect((await configure(owner.id, { webhookUrl: HOOK_URL, events: ["task.created"] })).status).toBe(200);
      const before = await n8nRow(org.id);

      for (const body of [
        { webhookUrl: "https://10.0.0.5/x", events: [] },
        { webhookUrl: "http://hooks.example.com/x", events: [], rotateSecret: true },
      ]) {
        expect((await configure(owner.id, body)).status).toBe(422);
      }
      const after = await n8nRow(org.id);
      expect(after?.config).toEqual(before?.config);
      expect(after?.secretEnc).toBe(before?.secretEnc);
    });

    it("does not allow the development loopback exemption", async () => {
      const { owner } = await makeTeam();
      for (const url of ["http://localhost:5678/webhook/zaki", "http://127.0.0.1:5678/webhook/zaki"]) {
        expect((await configure(owner.id, { webhookUrl: url, events: [] })).status).toBe(422);
      }
    });
  });

  it("outside production a local n8n is allowed over http (development convenience), but no other private host", async () => {
    vi.stubEnv("NODE_ENV", "development"); // pinned: do not depend on how the suite was started
    const { owner } = await makeTeam();
    expect((await configure(owner.id, { webhookUrl: "http://localhost:5678/webhook/zaki", events: [] })).status).toBe(200);
    expect((await configure(owner.id, { webhookUrl: "http://127.0.0.1:5678/webhook/zaki", events: [] })).status).toBe(200);
    expect((await configure(owner.id, { webhookUrl: "http://192.168.1.5:5678/webhook/zaki", events: [] })).status).toBe(422);
    expect((await configure(owner.id, { webhookUrl: "https://10.0.0.5:5678/webhook/zaki", events: [] })).status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// 1. outbound: signed delivery, no secret on the wire
// ---------------------------------------------------------------------------

describe("n8n outbound delivery", () => {
  it("follows the ecosystem's signed-delivery contract and never puts the secret on the wire", async () => {
    const { org } = await makeTeam();
    await connectN8nDirect(org.id);
    const { calls } = stubFetch();

    await emitOutbound(org.id, "task.created", { taskId: "t-1", title: "Order boxes" });

    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe(HOOK_URL);
    expect(c.init.method).toBe("POST");
    expect(c.init.redirect).toBe("manual");

    const h = c.headers;
    expect(h["content-type"]).toBe("application/json");
    expect(h["x-zaki-event"]).toBe("task.created");
    expect(h["x-zaki-delivery"]).toMatch(UUID_RE);
    expect(h["x-zaki-timestamp"]).toMatch(/^\d{10}$/); // unix SECONDS
    expect(Math.abs(Number(h["x-zaki-timestamp"]) - nowSec())).toBeLessThanOrEqual(5);
    // sha256=HMAC(secret, "<timestamp>.<raw body>") - recomputed here with node:crypto only
    expect(h["x-zaki-signature"]).toBe(signBody(N8N_SECRET, h["x-zaki-timestamp"]!, c.body));
    // routing id stays (it is not a secret and is also in the body)
    expect(h["x-zaki-org"]).toBe(org.id);

    // the secret never travels: not as a token header, not in any header value, not in the body
    expect(h["x-zaki-token"]).toBeUndefined();
    for (const [name, value] of Object.entries(h)) expect(value, name).not.toContain(N8N_SECRET);
    expect(c.body).not.toContain(N8N_SECRET);

    expect(JSON.parse(c.body)).toMatchObject({ event: "task.created", orgId: org.id, payload: { taskId: "t-1", title: "Order boxes" } });
    const log = await db.integrationEvent.findFirst({ where: { orgId: org.id, direction: "OUT", type: "task.created" } });
    expect(log?.status).toBe("OK");
  });

  it("the signature changes with the clock, so a captured delivery cannot be replayed later", async () => {
    const { org } = await makeTeam();
    await connectN8nDirect(org.id);
    const { calls } = stubFetch();
    const realNow = Date.now();
    // fake only Date: timers (and so the database driver) keep running for real
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(realNow);
      await emitOutbound(org.id, "task.created", { taskId: "t-1" });
      vi.setSystemTime(realNow + 10_000);
      await emitOutbound(org.id, "task.created", { taskId: "t-1" });
    } finally {
      vi.useRealTimers();
    }
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers["x-zaki-timestamp"]).not.toBe(calls[1]!.headers["x-zaki-timestamp"]);
    expect(calls[0]!.headers["x-zaki-signature"]).not.toBe(calls[1]!.headers["x-zaki-signature"]);
  });

  it("every delivery has its own X-Zaki-Delivery id", async () => {
    const { org } = await makeTeam();
    await connectN8nDirect(org.id);
    const { calls } = stubFetch();
    await emitOutbound(org.id, "task.created", { n: 1 });
    await emitOutbound(org.id, "task.created", { n: 2 });
    const ids = calls.map((c) => c.headers["x-zaki-delivery"]);
    expect(new Set(ids).size).toBe(2);
    ids.forEach((id) => expect(id).toMatch(UUID_RE));
  });

  it("only sends what the org asked for, and nothing once disconnected", async () => {
    const { org } = await makeTeam();
    await connectN8nDirect(org.id, { events: ["task.completed"] });
    const { calls } = stubFetch();
    await emitOutbound(org.id, "task.created", {});
    expect(calls).toHaveLength(0);
    await emitOutbound(org.id, "task.completed", {});
    expect(calls).toHaveLength(1);
    await connectN8nDirect(org.id, { events: [], connected: false });
    await emitOutbound(org.id, "task.completed", {});
    expect(calls).toHaveLength(1);
  });

  it("does not follow a redirect: a 302 is recorded as a failed delivery and nothing else is fetched", async () => {
    const { org } = await makeTeam();
    await connectN8nDirect(org.id);
    const { calls } = stubFetch(() => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }));
    await emitOutbound(org.id, "task.created", {});
    expect(calls).toHaveLength(1);
    const log = await db.integrationEvent.findFirst({ where: { orgId: org.id, direction: "OUT" } });
    expect(log?.status).toBe("FAILED");
    expect(log?.detail).toContain("302");
  });

  it("records a receiver error and a network failure as FAILED without throwing", async () => {
    const { org } = await makeTeam();
    await connectN8nDirect(org.id);
    stubFetch(() => new Response("nope", { status: 500 }));
    await expect(emitOutbound(org.id, "task.created", {})).resolves.toBeUndefined();
    stubFetch(() => {
      throw new Error("connect ECONNREFUSED");
    });
    await expect(emitOutbound(org.id, "task.created", {})).resolves.toBeUndefined();
    const logs = await db.integrationEvent.findMany({ where: { orgId: org.id, direction: "OUT" }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.status)).toEqual(["FAILED", "FAILED"]);
    expect(logs[0]?.detail).toBe("HTTP 500");
    expect(logs[1]?.detail).toContain("ECONNREFUSED");
  });

  describe("the URL is checked again at send time", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
    });

    it.each([
      { url: "http://hooks.example.com/webhook/zaki", key: "n8n.url_https_only" }, // saved before the rule existed
      { url: "https://10.0.0.5/webhook/zaki", key: "n8n.url_private" },
      { url: "https://169.254.169.254/latest/meta-data/", key: "n8n.url_private" },
      { url: "https://user:pw@hooks.example.com/webhook/zaki", key: "n8n.url_credentials" },
    ])("a stored $url is never fetched: FAILED with $key", async ({ url, key }) => {
      const { org } = await makeTeam();
      await connectN8nDirect(org.id, { url });
      const { calls } = stubFetch();
      await emitOutbound(org.id, "task.created", {});
      expect(calls).toHaveLength(0);
      const log = await db.integrationEvent.findFirst({ where: { orgId: org.id, direction: "OUT" } });
      expect(log?.status).toBe("FAILED");
      expect(log?.detail).toBe(key);
    });

    it("a host that was public when saved but resolves to a private address now is not fetched (DNS changed)", async () => {
      const { org, owner } = await makeTeam();
      expect((await configure(owner.id, { webhookUrl: HOOK_URL, events: [] })).status).toBe(200);
      resolveHosts(dns, { "hooks.example.com": ["10.0.0.7"] });
      const { calls } = stubFetch();
      await emitOutbound(org.id, "task.created", {});
      expect(calls).toHaveLength(0);
      const log = await db.integrationEvent.findFirst({ where: { orgId: org.id, direction: "OUT" } });
      expect(log?.detail).toBe("n8n.url_private");
    });

    it("an unresolvable host is a failed delivery, not a crash", async () => {
      const { org } = await makeTeam();
      await connectN8nDirect(org.id);
      resolveHosts(dns, { "hooks.example.com": "ENOTFOUND" });
      const { calls } = stubFetch();
      await expect(emitOutbound(org.id, "task.created", {})).resolves.toBeUndefined();
      expect(calls).toHaveLength(0);
      const log = await db.integrationEvent.findFirst({ where: { orgId: org.id, direction: "OUT" } });
      expect(log?.detail).toBe("n8n.url_unresolvable");
    });
  });
});

describe("n8n test button (POST /api/integrations/n8n/test)", () => {
  async function pressTest(userId: string) {
    await loginAs(userId);
    return call(testRoute.POST, { method: "POST", url: `${CONFIG_URL}/test` });
  }

  it("delivers through the production path: signed, no secret, and says so", async () => {
    const { org, owner } = await makeTeam();
    await connectN8nDirect(org.id);
    const { calls } = stubFetch();
    const res = await pressTest(owner.id);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ delivered: true });
    const c = calls[0]!;
    expect(c.headers["x-zaki-event"]).toBe("n8n.test");
    expect(c.headers["x-zaki-signature"]).toBe(signBody(N8N_SECRET, c.headers["x-zaki-timestamp"]!, c.body));
    expect(c.headers["x-zaki-token"]).toBeUndefined();
    expect(c.init.redirect).toBe("manual");
  });

  it("reports the receiver's answer when it fails", async () => {
    const { org, owner } = await makeTeam();
    await connectN8nDirect(org.id);
    stubFetch(() => new Response("boom", { status: 500 }));
    const res = await pressTest(owner.id);
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ delivered: false, detail: "HTTP 500" });
  });

  it("refuses a stored URL that is no longer allowed, without sending anything", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { org, owner } = await makeTeam();
    await connectN8nDirect(org.id, { url: "https://10.0.0.5/webhook/zaki" });
    const { calls } = stubFetch();
    const res = await pressTest(owner.id);
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ delivered: false, detail: "n8n.url_private" });
    expect(calls).toHaveLength(0);
  });

  it("is for OWNER/ADMIN only", async () => {
    const { org, member, guest } = await makeTeam();
    await connectN8nDirect(org.id);
    const { calls } = stubFetch();
    expect((await pressTest(member.id)).status).toBe(403);
    expect((await pressTest(guest.id)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 1. inbound: signed form + legacy token
// ---------------------------------------------------------------------------

async function inboundFixture() {
  const t = await makeTeam();
  const ws = await makeWorkspace(t.org.id, [{ userId: t.owner.id, role: "ADMIN" }]);
  const { project, board } = await makeProject(ws.id);
  await connectN8nDirect(t.org.id);
  const task = (title: string) => ({ action: "createTask", title, workspaceId: ws.id, projectId: project.id, boardId: board.id });
  const tasksTitled = (title: string) => db.task.findMany({ where: { orgId: t.org.id, title } });
  return { ...t, ws, project, board, task, tasksTitled };
}

/** A signed request exactly as the contract describes it. */
function signedHeaders(orgId: string, rawBody: string, opts: { ts?: string; secret?: string; signature?: string } = {}) {
  const ts = opts.ts ?? String(nowSec());
  return {
    "x-zaki-org": orgId,
    "x-zaki-timestamp": ts,
    "x-zaki-signature": opts.signature ?? signBody(opts.secret ?? N8N_SECRET, ts, rawBody),
  };
}

describe("n8n inbound: the signed form (X-Zaki-Timestamp + X-Zaki-Signature)", () => {
  it("accepts a fresh signed request and creates the task as the org OWNER", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify(f.task("Signed task"));
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(f.org.id, raw));
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ ok: true, action: "createTask" });
    const [task] = await f.tasksTitled("Signed task");
    expect(task?.creatorId).toBe(f.owner.id);
    expect(task?.orgId).toBe(f.org.id);
  });

  it("accepts the timestamp in milliseconds too (the OMS way) and the signature without the sha256= prefix", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify(f.task("Millis task"));
    const ts = String(Date.now());
    const prefixed = signBody(N8N_SECRET, ts, raw);
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(f.org.id, raw, { ts, signature: prefixed.slice("sha256=".length) }));
    expect(res.status).toBe(201);
  });

  it("refuses a request older than five minutes even though its signature is valid (replay)", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify(f.task("Replayed"));
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(f.org.id, raw, { ts: String(nowSec() - 301) }));
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ ok: false, error: "n8n.unauthorized", reason: "stale_timestamp" });
    expect(await f.tasksTitled("Replayed")).toHaveLength(0);
  });

  it("refuses a request dated more than five minutes in the future", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify(f.task("From the future"));
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(f.org.id, raw, { ts: String(nowSec() + 301) }));
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ reason: "stale_timestamp" });
    expect(await f.tasksTitled("From the future")).toHaveLength(0);
  });

  it("tolerates ordinary clock skew (inside the five minutes)", async () => {
    const f = await inboundFixture();
    for (const [title, skew] of [["Skew behind", -240], ["Skew ahead", 240]] as const) {
      const raw = JSON.stringify(f.task(title));
      const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(f.org.id, raw, { ts: String(nowSec() + skew) }));
      expect(res.status, title).toBe(201);
    }
  });

  it("the signature covers the timestamp and the body: re-dating or editing a captured request fails", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify(f.task("Original"));
    const headers = signedHeaders(f.org.id, raw);
    const edited = JSON.stringify(f.task("Edited"));
    const tamperedBody = await postRaw(inboundRoute.POST, INBOUND_URL, edited, headers);
    expect(tamperedBody.status).toBe(401);
    expect(tamperedBody.json).toMatchObject({ reason: "bad_signature" });
    const redated = await postRaw(inboundRoute.POST, INBOUND_URL, raw, { ...headers, "x-zaki-timestamp": String(nowSec() + 1) });
    expect(redated.status).toBe(401);
    expect(await f.tasksTitled("Edited")).toHaveLength(0);
    expect(await f.tasksTitled("Original")).toHaveLength(0);
  });

  it("refuses the old body-only signature (the replayable scheme) and a wrong secret", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify(f.task("Old scheme"));
    const { createHmac } = await import("node:crypto");
    const bodyOnly = `sha256=${createHmac("sha256", N8N_SECRET).update(raw).digest("hex")}`;
    const old = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(f.org.id, raw, { signature: bodyOnly }));
    expect(old.status).toBe(401);
    const wrong = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(f.org.id, raw, { secret: "not-the-secret" }));
    expect(wrong.status).toBe(401);
    expect(await f.tasksTitled("Old scheme")).toHaveLength(0);
  });

  it("a signature without its timestamp is refused", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify(f.task("No timestamp"));
    const headers = signedHeaders(f.org.id, raw);
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, { "x-zaki-org": f.org.id, "x-zaki-signature": headers["x-zaki-signature"] });
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ reason: "missing_headers" });
  });

  it("a bad signature is not rescued by a valid legacy token sent alongside it", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify(f.task("Both headers"));
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, {
      ...signedHeaders(f.org.id, raw, { signature: `sha256=${"0".repeat(64)}` }),
      "x-zaki-token": N8N_SECRET,
    });
    expect(res.status).toBe(401);
    expect(await f.tasksTitled("Both headers")).toHaveLength(0);
  });

  it("an unknown org and an org without n8n look exactly like a wrong signature", async () => {
    const f = await inboundFixture();
    const other = await makeTeam();
    const raw = JSON.stringify(f.task("Nobody home"));
    const unknownOrg = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders("org_does_not_exist", raw));
    const noN8n = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(other.org.id, raw));
    const wrong = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(f.org.id, raw, { secret: "x" }));
    for (const res of [unknownOrg, noN8n, wrong]) {
      expect(res.status).toBe(401);
      expect(res.json).toEqual({ ok: false, error: "n8n.unauthorized", reason: "bad_signature" });
    }
  });

  it("a signature made with another org's secret does not open this org", async () => {
    const a = await inboundFixture();
    const b = await makeTeam();
    await connectN8nDirect(b.org.id, { secret: "the-other-orgs-secret" });
    const raw = JSON.stringify(a.task("Cross org"));
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(a.org.id, raw, { secret: "the-other-orgs-secret" }));
    expect(res.status).toBe(401);
  });

  it("unknown actions are acknowledged and ignored; a malformed payload is a 400 (after authentication)", async () => {
    const f = await inboundFixture();
    const ping = JSON.stringify({ action: "ping" });
    const ignored = await postRaw(inboundRoute.POST, INBOUND_URL, ping, signedHeaders(f.org.id, ping));
    expect(ignored.status).toBe(200);
    expect(ignored.json).toMatchObject({ ok: true, action: "ping", ignored: true });

    const notJson = "this is not json";
    const bad = await postRaw(inboundRoute.POST, INBOUND_URL, notJson, signedHeaders(f.org.id, notJson));
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ error: "n8n.invalid_payload" });

    const unsigned = await postRaw(inboundRoute.POST, INBOUND_URL, notJson, { "x-zaki-org": f.org.id });
    expect(unsigned.status).toBe(401);
  });

  it("createTask without its fields is a 400, not a task", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify({ action: "createTask", title: "Half a task" });
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(f.org.id, raw));
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: "n8n.create_task_requires_fields" });
  });

  it("without x-zaki-org there is nothing to authenticate against (400)", async () => {
    const raw = JSON.stringify({ action: "ping" });
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, { "x-zaki-timestamp": String(nowSec()), "x-zaki-signature": signBody(N8N_SECRET, String(nowSec()), raw) });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: "n8n.org_header_required" });
  });

  it("a delivery Zaki itself sends is accepted back by its own inbound webhook (the loop used in live checks)", async () => {
    const f = await inboundFixture();
    const { calls } = stubFetch();
    await emitOutbound(f.org.id, "task.created", { taskId: "t-1" });
    const c = calls[0]!;
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, c.body, {
      "x-zaki-org": c.headers["x-zaki-org"]!,
      "x-zaki-timestamp": c.headers["x-zaki-timestamp"]!,
      "x-zaki-signature": c.headers["x-zaki-signature"]!,
    });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, ignored: true });
  });
});

describe("n8n inbound: the legacy x-zaki-token header (backwards compatible)", () => {
  it("still accepts the shared secret in x-zaki-token", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify(f.task("Legacy task"));
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, { "x-zaki-org": f.org.id, "x-zaki-token": N8N_SECRET });
    expect(res.status).toBe(201);
    expect((await f.tasksTitled("Legacy task"))[0]?.creatorId).toBe(f.owner.id);
  });

  it("refuses a wrong, a near-miss and a missing token", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify(f.task("Should not exist"));
    const attempts: Array<Record<string, string>> = [
      { "x-zaki-org": f.org.id, "x-zaki-token": "wrong" },
      { "x-zaki-org": f.org.id, "x-zaki-token": N8N_SECRET.slice(0, -1) },
      { "x-zaki-org": f.org.id, "x-zaki-token": `${N8N_SECRET}x` },
      { "x-zaki-org": f.org.id, "x-zaki-token": "" },
      { "x-zaki-org": f.org.id },
    ];
    for (const headers of attempts) {
      const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, headers);
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(res.json).toMatchObject({ ok: false, error: "n8n.unauthorized" });
    }
    expect(await f.tasksTitled("Should not exist")).toHaveLength(0);
  });

  it("a token for org A does not open org B", async () => {
    const a = await inboundFixture();
    const b = await makeTeam();
    await connectN8nDirect(b.org.id, { secret: "org-b-secret-0123456789abcdef" });
    const raw = JSON.stringify(a.task("Cross org token"));
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, { "x-zaki-org": b.org.id, "x-zaki-token": N8N_SECRET });
    expect(res.status).toBe(401);
  });
});

describe("n8n inbound: only while the connection exists", () => {
  it("stops working the moment the OWNER removes the connection (token AND signed form)", async () => {
    const f = await inboundFixture();
    const raw = JSON.stringify(f.task("After removal"));
    await loginAs(f.owner.id);
    expect((await call(n8nRoute.DELETE, { method: "DELETE", url: CONFIG_URL })).status).toBe(200);

    const byToken = await postRaw(inboundRoute.POST, INBOUND_URL, raw, { "x-zaki-org": f.org.id, "x-zaki-token": N8N_SECRET });
    const bySignature = await postRaw(inboundRoute.POST, INBOUND_URL, raw, signedHeaders(f.org.id, raw));
    expect(byToken.status).toBe(401);
    expect(bySignature.status).toBe(401);
    expect(await f.tasksTitled("After removal")).toHaveLength(0);
  });

  it("a row flagged disconnected does not authenticate even though a secret is still stored", async () => {
    const f = await inboundFixture();
    await connectN8nDirect(f.org.id, { connected: false });
    const raw = JSON.stringify(f.task("Disconnected"));
    const res = await postRaw(inboundRoute.POST, INBOUND_URL, raw, { "x-zaki-org": f.org.id, "x-zaki-token": N8N_SECRET });
    expect(res.status).toBe(401);
  });

  it("the secret shown on connect is the one that works, and rotating retires the old one", async () => {
    const { org, owner } = await makeTeam();
    const first = await configure(owner.id, { webhookUrl: HOOK_URL, events: [] });
    const s1 = first.json?.["generatedSecret"] as string;
    const ping = JSON.stringify({ action: "ping" });

    expect((await postRaw(inboundRoute.POST, INBOUND_URL, ping, { "x-zaki-org": org.id, "x-zaki-token": s1 })).status).toBe(200);
    expect((await postRaw(inboundRoute.POST, INBOUND_URL, ping, signedHeaders(org.id, ping, { secret: s1 }))).status).toBe(200);

    const rotated = await configure(owner.id, { webhookUrl: HOOK_URL, events: [], rotateSecret: true });
    const s2 = rotated.json?.["generatedSecret"] as string;
    expect(s2).not.toBe(s1);
    expect((await postRaw(inboundRoute.POST, INBOUND_URL, ping, { "x-zaki-org": org.id, "x-zaki-token": s1 })).status).toBe(401);
    expect((await postRaw(inboundRoute.POST, INBOUND_URL, ping, signedHeaders(org.id, ping, { secret: s1 }))).status).toBe(401);
    expect((await postRaw(inboundRoute.POST, INBOUND_URL, ping, { "x-zaki-org": org.id, "x-zaki-token": s2 })).status).toBe(200);
  });
});
