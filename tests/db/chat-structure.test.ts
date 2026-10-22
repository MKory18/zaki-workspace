import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyseSql, sqlStatements } from "../../scripts/lint-migrations.mjs";
import { db, makeOrg, makeUser, uid } from "./helpers";

/**
 * Phase 3, wave A (data): the STRUCTURE of the chat, proven against the real migrations applied to an
 * empty database (tests/db/global-setup.ts). Raw SQL on purpose: the Prisma client of the working tree
 * is regenerated between waves, and what is under test here is the database, not the client.
 *
 * What it pins, in the order of the plan (PHASE3-DESIGN.md "Data model" + the coordinator's additions):
 *   - every new column exists with its type, nullability and default (so the previous release keeps working);
 *   - the unique rules that make the chat safe: one DM per pair per company, an idempotent send
 *     (author + clientId), one HQ per company, one space per department, one system topic per space;
 *   - a space that has topics can never be deleted; deleting a message takes its revisions, notes and
 *     attachment links with it and nothing else;
 *   - the realtime trigger on RealtimeEvent exists and notifies with the row id.
 * The data move is proven separately, on realistic pre-move data (chat-data-move.test.ts).
 */

const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");
const FOLDERS = ["20261024090000_chat_structure", "20261024091000_chat_data_move", "20261024092000_chat_realtime_trigger"] as const;

const q = <T = Record<string, unknown>>(sql: string, ...values: unknown[]) => db.$queryRawUnsafe<T[]>(sql, ...values);
const x = (sql: string, ...values: unknown[]) => db.$executeRawUnsafe(sql, ...values);

/** The message of the database error a statement raises (the test fails if it does not raise one). */
async function failure(statement: Promise<unknown>): Promise<string> {
  try {
    await statement;
  } catch (err) {
    return String((err as Error).message);
  }
  throw new Error("expected the database to refuse this statement, but it succeeded");
}

/**
 * A unique violation as Prisma reports a raw query: the code 23505 and the columns of the key
 * (`Key ("orgId", "dmKey")=(...) already exists`) - the name of the index is not printed. Postgres quotes a
 * column name only when it needs to (`slug` is not, `orgId` is), hence the optional quotes.
 */
function expectUnique(message: string, ...columns: string[]): void {
  expect(message).toContain("23505");
  expect(message).toMatch(new RegExp(`Key \\(${columns.map((c) => `"?${c}"?`).join(", ")}\\)=`));
}

// ---------- small fixtures (old-style inserts: only the columns the previous release knew) ----------

async function space(orgId: string, extra: { slug?: string; kind?: string; systemKey?: string | null; departmentId?: string | null } = {}) {
  const id = `ws_${uid()}`;
  await x(
    `INSERT INTO "Workspace" ("id","organizationId","name","slug","kind","systemKey","departmentId","updatedAt")
     VALUES ($1,$2,$3,$4,$5::"WorkspaceKind",$6,$7,now())`,
    id,
    orgId,
    `Space ${id}`,
    extra.slug ?? `s-${id}`,
    extra.kind ?? "STANDARD",
    extra.systemKey ?? null,
    extra.departmentId ?? null,
  );
  return id;
}

async function conversation(
  orgId: string,
  extra: { kind?: string; spaceId?: string | null; systemKey?: string | null; dmKey?: string | null } = {},
) {
  const id = `cv_${uid()}`;
  await x(
    `INSERT INTO "Conversation" ("id","orgId","kind","spaceId","systemKey","dmKey","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,now())`,
    id,
    orgId,
    extra.kind ?? "TOPIC",
    extra.spaceId ?? null,
    extra.systemKey ?? null,
    extra.dmKey ?? null,
  );
  return id;
}

async function message(orgId: string, conversationId: string, authorId: string, extra: { clientId?: string | null; forwardedFromId?: string | null; deletedById?: string | null } = {}) {
  const id = `m_${uid()}`;
  await x(
    `INSERT INTO "ChatMessage" ("id","orgId","conversationId","authorId","body","clientId","forwardedFromId","deletedById") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    id,
    orgId,
    conversationId,
    authorId,
    "نص",
    extra.clientId ?? null,
    extra.forwardedFromId ?? null,
    extra.deletedById ?? null,
  );
  return id;
}

async function storedFile(orgId: string, uploaderId: string) {
  const id = `f_${uid()}`;
  await x(
    `INSERT INTO "StoredFile" ("id","orgId","uploaderId","familyId","name","path","mimeType","size") VALUES ($1,$2,$3,$1,$4,$5,$6,$7)`,
    id,
    orgId,
    uploaderId,
    "x.bin",
    `chat/${id}`,
    "application/octet-stream",
    10,
  );
  return id;
}

async function oneOrg() {
  const org = await makeOrg();
  const a = await makeUser({ orgId: org.id });
  const b = await makeUser({ orgId: org.id });
  return { org, a, b };
}

// ---------- the migrations themselves ----------

describe("the three chat migrations", () => {
  it("exist, in this order, and are additive-only according to the migration linter (UTF-8, no BOM)", () => {
    for (const name of FOLDERS) {
      const bytes = readFileSync(path.join(MIGRATIONS, name, "migration.sql"));
      expect(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, `${name} must have no byte-order mark`).toBe(false);
      const sql = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      expect(analyseSql(sql), `${name} needs a decision from the owner`).toEqual([]);
    }
    expect([...FOLDERS]).toEqual([...FOLDERS].sort());
  });
});

// ---------- columns ----------

type ColumnSpec = [table: string, column: string, type: string, nullable: boolean, defaultPattern: RegExp | null];

const COLUMNS: ColumnSpec[] = [
  ["Workspace", "kind", "WorkspaceKind", false, /^'STANDARD'::"WorkspaceKind"$/],
  ["Workspace", "emoji", "text", true, null],
  ["Workspace", "systemKey", "text", true, null],
  ["Workspace", "departmentId", "text", true, null],
  ["WorkspaceMember", "mutedUntil", "timestamp", true, null],
  ["Conversation", "spaceId", "text", true, null],
  ["Conversation", "topicType", "text", false, /^'DISCUSSION'::text$/],
  ["Conversation", "postingPolicy", "text", false, /^'ALL'::text$/],
  ["Conversation", "restricted", "bool", false, /^false$/],
  ["Conversation", "closedAt", "timestamp", true, null],
  ["Conversation", "position", "int4", false, /^0$/],
  ["Conversation", "systemKey", "text", true, null],
  ["Conversation", "dmKey", "text", true, null],
  ["ConversationMember", "lastDeliveredAt", "timestamp", true, null],
  ["ConversationMember", "mutedUntil", "timestamp", true, null],
  ["ChatMessage", "kind", "text", false, /^'TEXT'::text$/],
  ["ChatMessage", "deletedById", "text", true, null],
  ["ChatMessage", "forwardedFromId", "text", true, null],
  ["ChatMessage", "mentions", "_text", true, /ARRAY\[\]::text\[\]|'\{\}'::text\[\]/],
  ["ChatMessage", "clientId", "text", true, null],
  ["StoredFile", "purpose", "text", false, /^'LIBRARY'::text$/],
  ["User", "lastSeenAt", "timestamp", true, null],
  ["AuditLog", "workspaceId", "text", true, null],
  ["AuditLog", "conversationId", "text", true, null],

  ["MessageRevision", "id", "text", false, null],
  ["MessageRevision", "messageId", "text", false, null],
  ["MessageRevision", "body", "text", false, null],
  ["MessageRevision", "editorId", "text", false, null],
  ["MessageRevision", "createdAt", "timestamp", false, /CURRENT_TIMESTAMP|now\(\)/i],

  ["MessageNote", "id", "text", false, null],
  ["MessageNote", "messageId", "text", false, null],
  ["MessageNote", "authorId", "text", false, null],
  ["MessageNote", "body", "text", false, null],
  ["MessageNote", "createdAt", "timestamp", false, /CURRENT_TIMESTAMP|now\(\)/i],

  ["MessageAttachment", "id", "text", false, null],
  // null while the upload waits to be claimed by a message (see the report of wave 3A)
  ["MessageAttachment", "messageId", "text", true, null],
  ["MessageAttachment", "fileId", "text", false, null],
  ["MessageAttachment", "kind", "text", false, null],
  ["MessageAttachment", "name", "text", true, null],
  ["MessageAttachment", "width", "int4", true, null],
  ["MessageAttachment", "height", "int4", true, null],
  ["MessageAttachment", "durationMs", "int4", true, null],
  ["MessageAttachment", "peaks", "jsonb", true, null],
  ["MessageAttachment", "position", "int4", false, /^0$/],
  ["MessageAttachment", "createdAt", "timestamp", false, /CURRENT_TIMESTAMP|now\(\)/i],

  ["RealtimeEvent", "id", "int8", false, /^nextval\('"?RealtimeEvent_id_seq"?'::regclass\)$/],
  ["RealtimeEvent", "orgId", "text", false, null],
  ["RealtimeEvent", "kind", "text", false, null],
  ["RealtimeEvent", "ids", "jsonb", false, /^'\{\}'::jsonb$/],
  ["RealtimeEvent", "createdAt", "timestamp", false, /CURRENT_TIMESTAMP|now\(\)/i],
];

describe("every new column has its type, nullability and default", () => {
  it("matches the plan, so the previous release (which knows none of them) keeps working", async () => {
    const rows = await q<{ table_name: string; column_name: string; udt_name: string; is_nullable: string; column_default: string | null }>(
      `SELECT table_name, column_name, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name IN ('Workspace','WorkspaceMember','Conversation','ConversationMember','ChatMessage','StoredFile','User','AuditLog',
                            'MessageRevision','MessageNote','MessageAttachment','RealtimeEvent')`,
    );
    const byKey = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r]));
    for (const [table, column, type, nullable, defaultPattern] of COLUMNS) {
      const col = byKey.get(`${table}.${column}`);
      expect(col, `${table}.${column} exists`).toBeDefined();
      expect(col?.udt_name, `${table}.${column} type`).toBe(type);
      expect(col?.is_nullable === "YES", `${table}.${column} nullable`).toBe(nullable);
      if (defaultPattern) expect(col?.column_default ?? "", `${table}.${column} default`).toMatch(defaultPattern);
      else if (nullable) expect(col?.column_default ?? null, `${table}.${column} has no default`).toBeNull();
    }
  });

  it("WorkspaceKind is exactly STANDARD, DEPARTMENT, HQ", async () => {
    const labels = await q<{ label: string }>(`SELECT unnest(enum_range(NULL::"WorkspaceKind"))::text AS label`);
    expect(labels.map((l) => l.label).sort()).toEqual(["DEPARTMENT", "HQ", "STANDARD"]);
  });

  it("an insert written for the previous release still works, and every new column takes its default", async () => {
    const { org, a, b } = await oneOrg();
    // workspace + member
    const ws = await space(org.id);
    await x(`INSERT INTO "WorkspaceMember" ("id","workspaceId","userId") VALUES ($1,$2,$3)`, `wm_${uid()}`, ws, a.id);
    const w = (await q<Record<string, unknown>>(`SELECT "kind"::text AS kind,"emoji","systemKey","departmentId" FROM "Workspace" WHERE "id"=$1`, ws))[0];
    expect(w).toEqual({ kind: "STANDARD", emoji: null, systemKey: null, departmentId: null });
    const wm = (await q<Record<string, unknown>>(`SELECT "mutedUntil" FROM "WorkspaceMember" WHERE "workspaceId"=$1`, ws))[0];
    expect(wm).toEqual({ mutedUntil: null });

    // conversation (a legacy group written the old way), its member and a message
    const cv = `cv_${uid()}`;
    await x(`INSERT INTO "Conversation" ("id","orgId","kind","title","updatedAt") VALUES ($1,$2,'GROUP','Old group',now())`, cv, org.id);
    await x(`INSERT INTO "ConversationMember" ("id","conversationId","userId") VALUES ($1,$2,$3)`, `cm_${uid()}`, cv, a.id);
    const m = `m_${uid()}`;
    await x(`INSERT INTO "ChatMessage" ("id","orgId","conversationId","authorId","body") VALUES ($1,$2,$3,$4,'hi')`, m, org.id, cv, a.id);
    expect((await q(`SELECT "spaceId","topicType","postingPolicy","restricted","closedAt","position","systemKey","dmKey" FROM "Conversation" WHERE "id"=$1`, cv))[0]).toEqual({
      spaceId: null,
      topicType: "DISCUSSION",
      postingPolicy: "ALL",
      restricted: false,
      closedAt: null,
      position: 0,
      systemKey: null,
      dmKey: null,
    });
    expect((await q(`SELECT "lastDeliveredAt","mutedUntil" FROM "ConversationMember" WHERE "conversationId"=$1`, cv))[0]).toEqual({ lastDeliveredAt: null, mutedUntil: null });
    expect((await q(`SELECT "kind","mentions","deletedById","forwardedFromId","clientId" FROM "ChatMessage" WHERE "id"=$1`, m))[0]).toEqual({
      kind: "TEXT",
      mentions: [],
      deletedById: null,
      forwardedFromId: null,
      clientId: null,
    });

    // file, user, audit row
    const f = await storedFile(org.id, b.id);
    expect((await q(`SELECT "purpose" FROM "StoredFile" WHERE "id"=$1`, f))[0]).toEqual({ purpose: "LIBRARY" });
    expect((await q(`SELECT "lastSeenAt" FROM "User" WHERE "id"=$1`, a.id))[0]).toEqual({ lastSeenAt: null });
    const audit = `al_${uid()}`;
    await x(`INSERT INTO "AuditLog" ("id","action") VALUES ($1,'x.test')`, audit);
    expect((await q(`SELECT "workspaceId","conversationId" FROM "AuditLog" WHERE "id"=$1`, audit))[0]).toEqual({ workspaceId: null, conversationId: null });
  });

  it("RealtimeEvent: the id counts up on its own, ids default to an empty object, the time is set", async () => {
    const { org } = await oneOrg();
    await x(`INSERT INTO "RealtimeEvent" ("orgId","kind") VALUES ($1,'message.created')`, org.id);
    await x(`INSERT INTO "RealtimeEvent" ("orgId","kind","ids") VALUES ($1,'message.created','{"conversationId":"c1","messageId":"m1"}'::jsonb)`, org.id);
    const rows = await q<{ id: bigint; ids: unknown; createdAt: Date }>(`SELECT "id","ids","createdAt" FROM "RealtimeEvent" WHERE "orgId"=$1 ORDER BY "id"`, org.id);
    expect(rows).toHaveLength(2);
    expect(typeof rows[0]!.id).toBe("bigint");
    expect(rows[1]!.id > rows[0]!.id).toBe(true);
    expect(rows[0]!.ids).toEqual({});
    expect(rows[1]!.ids).toEqual({ conversationId: "c1", messageId: "m1" });
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
  });
});

// ---------- unique rules ----------

describe("unique rules", () => {
  it("one DM per pair per company: the same dmKey twice in one company is refused, in another company it is fine, and NULLs never collide", async () => {
    const one = await oneOrg();
    const two = await oneOrg();
    const key = `${one.a.id}|${one.b.id}`;
    await conversation(one.org.id, { kind: "DM", dmKey: key });
    expectUnique(await failure(conversation(one.org.id, { kind: "DM", dmKey: key })), "orgId", "dmKey");
    // a person can be in two companies: the same pair has one DM in each
    await conversation(two.org.id, { kind: "DM", dmKey: key });
    // many conversations without a key (groups, topics, the duplicate DMs of old data)
    await conversation(one.org.id, { kind: "DM" });
    await conversation(one.org.id, { kind: "DM" });
    await conversation(one.org.id, { kind: "GROUP" });
  });

  it("sending is idempotent: the same author cannot use a clientId twice; another author can; NULL is free", async () => {
    const { org, a, b } = await oneOrg();
    const cv = await conversation(org.id);
    const cid = `client-${uid()}`;
    await message(org.id, cv, a.id, { clientId: cid });
    expectUnique(await failure(message(org.id, cv, a.id, { clientId: cid })), "authorId", "clientId");
    // even in another conversation: the key is (author, clientId)
    const other = await conversation(org.id);
    expectUnique(await failure(message(org.id, other, a.id, { clientId: cid })), "authorId", "clientId");
    await message(org.id, cv, b.id, { clientId: cid });
    await message(org.id, cv, a.id);
    await message(org.id, cv, a.id);
  });

  it("one HQ per company (systemKey), many spaces without a key, and the same key in another company", async () => {
    const one = await oneOrg();
    const two = await oneOrg();
    await space(one.org.id, { kind: "HQ", systemKey: "hq" });
    expectUnique(await failure(space(one.org.id, { kind: "HQ", systemKey: "hq" })), "organizationId", "systemKey");
    await space(two.org.id, { kind: "HQ", systemKey: "hq" });
    await space(one.org.id);
    await space(one.org.id);
  });

  it("a slug is still unique per company", async () => {
    const { org } = await oneOrg();
    await space(org.id, { slug: "same" });
    expectUnique(await failure(space(org.id, { slug: "same" })), "organizationId", "slug");
  });

  it("a department has at most one space", async () => {
    const { org } = await oneOrg();
    const dept = `d_${uid()}`;
    await x(`INSERT INTO "Department" ("id","orgId","name") VALUES ($1,$2,'Design')`, dept, org.id);
    await space(org.id, { kind: "DEPARTMENT", departmentId: dept });
    expectUnique(await failure(space(org.id, { kind: "DEPARTMENT", departmentId: dept })), "departmentId");
  });

  it("a space has at most one topic per system key (announcements, general, ...), and none is needed", async () => {
    const { org } = await oneOrg();
    const ws = await space(org.id);
    const other = await space(org.id);
    await conversation(org.id, { spaceId: ws, systemKey: "general" });
    expectUnique(await failure(conversation(org.id, { spaceId: ws, systemKey: "general" })), "spaceId", "systemKey");
    await conversation(org.id, { spaceId: other, systemKey: "general" });
    await conversation(org.id, { spaceId: ws });
    await conversation(org.id, { spaceId: ws });
  });
});

// ---------- keys and actions ----------

describe("a space with chat history can never be deleted", () => {
  it("is refused while it has a topic, allowed once the topics are gone", async () => {
    const { org } = await oneOrg();
    const ws = await space(org.id);
    const topic = await conversation(org.id, { spaceId: ws });
    expect(await failure(x(`DELETE FROM "Workspace" WHERE "id"=$1`, ws))).toContain("Conversation_spaceId_fkey");
    expect(await q(`SELECT 1 AS one FROM "Workspace" WHERE "id"=$1`, ws)).toHaveLength(1);
    await x(`DELETE FROM "Conversation" WHERE "id"=$1`, topic);
    await x(`DELETE FROM "Workspace" WHERE "id"=$1`, ws);
    expect(await q(`SELECT 1 AS one FROM "Workspace" WHERE "id"=$1`, ws)).toHaveLength(0);
  });

  it("a topic must point at a real space", async () => {
    const { org } = await oneOrg();
    expect(await failure(conversation(org.id, { spaceId: "no-such-space" }))).toContain("Conversation_spaceId_fkey");
  });

  it("deleting a department keeps its space (the link is cleared)", async () => {
    const { org } = await oneOrg();
    const dept = `d_${uid()}`;
    await x(`INSERT INTO "Department" ("id","orgId","name") VALUES ($1,$2,'Dev')`, dept, org.id);
    const ws = await space(org.id, { kind: "DEPARTMENT", departmentId: dept });
    await x(`DELETE FROM "Department" WHERE "id"=$1`, dept);
    expect((await q(`SELECT "kind"::text AS kind,"departmentId" FROM "Workspace" WHERE "id"=$1`, ws))[0]).toEqual({ kind: "DEPARTMENT", departmentId: null });
  });
});

describe("what goes with a message, and what stays", () => {
  it("deleting a message removes its revisions, notes and attachment links - and not the stored file", async () => {
    const { org, a, b } = await oneOrg();
    const cv = await conversation(org.id);
    const m = await message(org.id, cv, a.id);
    const file = await storedFile(org.id, a.id);
    await x(`INSERT INTO "MessageRevision" ("id","messageId","body","editorId") VALUES ($1,$2,'before the edit',$3)`, `r_${uid()}`, m, a.id);
    await x(`INSERT INTO "MessageNote" ("id","messageId","authorId","body") VALUES ($1,$2,$3,'internal')`, `n_${uid()}`, m, b.id);
    await x(`INSERT INTO "MessageAttachment" ("id","messageId","fileId","kind") VALUES ($1,$2,$3,'FILE')`, `at_${uid()}`, m, file);
    const counts = () =>
      q<{ r: bigint; n: bigint; a: bigint }>(
        `SELECT (SELECT count(*) FROM "MessageRevision" WHERE "messageId"=$1) AS r,
                (SELECT count(*) FROM "MessageNote" WHERE "messageId"=$1) AS n,
                (SELECT count(*) FROM "MessageAttachment" WHERE "messageId"=$1) AS a`,
        m,
      ).then((rows) => rows[0]);
    expect(await counts()).toEqual({ r: 1n, n: 1n, a: 1n });
    await x(`DELETE FROM "ChatMessage" WHERE "id"=$1`, m);
    expect(await counts()).toEqual({ r: 0n, n: 0n, a: 0n });
    expect(await q(`SELECT 1 AS one FROM "StoredFile" WHERE "id"=$1`, file)).toHaveLength(1);
  });

  it("revisions, notes and attachments must belong to a real message", async () => {
    const { org, a } = await oneOrg();
    const file = await storedFile(org.id, a.id);
    expect(await failure(x(`INSERT INTO "MessageRevision" ("id","messageId","body","editorId") VALUES ($1,'nope','b',$2)`, `r_${uid()}`, a.id))).toContain("MessageRevision_messageId_fkey");
    expect(await failure(x(`INSERT INTO "MessageNote" ("id","messageId","authorId","body") VALUES ($1,'nope',$2,'b')`, `n_${uid()}`, a.id))).toContain("MessageNote_messageId_fkey");
    expect(await failure(x(`INSERT INTO "MessageAttachment" ("id","messageId","fileId","kind") VALUES ($1,'nope',$2,'FILE')`, `at_${uid()}`, file))).toContain("MessageAttachment_messageId_fkey");
  });

  it("a stored file that a message links to cannot be deleted from under it (RESTRICT)", async () => {
    const { org, a } = await oneOrg();
    const cv = await conversation(org.id);
    const m = await message(org.id, cv, a.id);
    const file = await storedFile(org.id, a.id);
    const link = `at_${uid()}`;
    await x(`INSERT INTO "MessageAttachment" ("id","messageId","fileId","kind") VALUES ($1,$2,$3,'IMAGE')`, link, m, file);
    expect(await failure(x(`DELETE FROM "StoredFile" WHERE "id"=$1`, file))).toContain("MessageAttachment_fileId_fkey");
    await x(`DELETE FROM "MessageAttachment" WHERE "id"=$1`, link);
    await x(`DELETE FROM "StoredFile" WHERE "id"=$1`, file);
  });

  it("an upload waiting for its message is an attachment without a message, and its file is protected too", async () => {
    const { org, a } = await oneOrg();
    const file = await storedFile(org.id, a.id);
    const link = `at_${uid()}`;
    await x(
      `INSERT INTO "MessageAttachment" ("id","fileId","kind","name","durationMs","peaks") VALUES ($1,$2,'AUDIO','voice.webm',4200,'[3,40,90,12]'::jsonb)`,
      link,
      file,
    );
    const row = (await q<Record<string, unknown>>(`SELECT "messageId","position","peaks","durationMs","createdAt" FROM "MessageAttachment" WHERE "id"=$1`, link))[0]!;
    expect(row["messageId"]).toBeNull();
    expect(row["position"]).toBe(0);
    expect(row["peaks"]).toEqual([3, 40, 90, 12]);
    expect(row["durationMs"]).toBe(4200);
    expect(row["createdAt"]).toBeInstanceOf(Date);
    expect(await failure(x(`DELETE FROM "StoredFile" WHERE "id"=$1`, file))).toContain("MessageAttachment_fileId_fkey");
  });

  it("deleting the person who deleted a message, or the original of a forward, keeps the message and clears the link", async () => {
    const { org, a, b } = await oneOrg();
    const cv = await conversation(org.id);
    const original = await message(org.id, cv, a.id);
    const forwarded = await message(org.id, cv, a.id, { forwardedFromId: original });
    const removed = await message(org.id, cv, a.id, { deletedById: b.id });
    await x(`DELETE FROM "ChatMessage" WHERE "id"=$1`, original);
    expect((await q(`SELECT "forwardedFromId" FROM "ChatMessage" WHERE "id"=$1`, forwarded))[0]).toEqual({ forwardedFromId: null });
    await x(`DELETE FROM "User" WHERE "id"=$1`, b.id);
    expect((await q(`SELECT "deletedById" FROM "ChatMessage" WHERE "id"=$1`, removed))[0]).toEqual({ deletedById: null });
  });
});

// ---------- indexes ----------

describe("indexes", () => {
  it("every access path of the design has one (and the unique ones are unique)", async () => {
    const rows = await q<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema()`,
    );
    const def = new Map(rows.map((r) => [r.indexname, r.indexdef]));
    const unique = [
      "Workspace_organizationId_systemKey_key",
      "Workspace_departmentId_key",
      "Conversation_orgId_dmKey_key",
      "Conversation_spaceId_systemKey_key",
      "ChatMessage_authorId_clientId_key",
    ];
    const plain = [
      "Conversation_spaceId_position_idx",
      "MessageRevision_messageId_createdAt_idx",
      "MessageNote_messageId_createdAt_idx",
      "MessageAttachment_messageId_position_idx",
      "MessageAttachment_fileId_idx",
      "RealtimeEvent_createdAt_idx",
      "RealtimeEvent_orgId_id_idx",
      "StoredFile_orgId_purpose_idx",
      "AuditLog_conversationId_createdAt_idx",
      "AuditLog_workspaceId_createdAt_idx",
    ];
    for (const name of unique) expect(def.get(name), name).toMatch(/CREATE UNIQUE INDEX/);
    for (const name of plain) expect(def.get(name), name).toMatch(/CREATE INDEX/);
  });
});

// ---------- the realtime trigger ----------

describe("the realtime trigger", () => {
  const triggers = () =>
    q<{ tgname: string; tgtype: number; proname: string; prosrc: string }>(
      `SELECT t.tgname, t.tgtype::int AS tgtype, p.proname, p.prosrc
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE c.relname = 'RealtimeEvent' AND NOT t.tgisinternal`,
    );

  it("is one AFTER INSERT ... FOR EACH ROW trigger whose function calls pg_notify('zaki_rt', <row id>)", async () => {
    const rows = await triggers();
    expect(rows).toHaveLength(1);
    const t = rows[0]!;
    expect(t.tgtype & 1, "row level").toBe(1);
    expect(t.tgtype & 2, "AFTER, not BEFORE").toBe(0);
    expect(t.tgtype & 4, "on INSERT").toBe(4);
    expect(t.tgtype & (8 | 16 | 32), "not on DELETE / UPDATE / TRUNCATE").toBe(0);
    expect(t.prosrc).toMatch(/pg_notify\(\s*'zaki_rt'\s*,\s*NEW\."id"::text\s*\)/);
  });

  it("does not stop an insert (the notification carries the id, nothing else)", async () => {
    const { org } = await oneOrg();
    await x(`INSERT INTO "RealtimeEvent" ("orgId","kind","ids") VALUES ($1,'conversation.changed','{"conversationId":"c"}'::jsonb)`, org.id);
    expect(await q(`SELECT 1 AS one FROM "RealtimeEvent" WHERE "orgId"=$1`, org.id)).toHaveLength(1);
  });

  it("running the migration a second time changes nothing (one trigger, still)", async () => {
    const sql = readFileSync(path.join(MIGRATIONS, FOLDERS[2], "migration.sql"), "utf8");
    for (const statement of sqlStatements(sql)) {
      const code = statement.code.trim();
      if (code) await x(code);
    }
    expect(await triggers()).toHaveLength(1);
  });
});
