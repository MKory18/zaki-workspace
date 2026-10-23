import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The guard behind "nobody who was suspended or removed still counts".
 *
 * A suspended or offboarded member keeps their OrganizationMember row (history, authorship), so any
 * query that reads membership rows and forgets `status` quietly treats them as present again: they
 * show up in a picker, can be assigned work, pass a role check. This test walks `src/**` and fails
 * for every such read that neither mentions `status` nor carries the marker
 *
 *     // all-statuses: <why every status is wanted here>
 *
 * on the line of the call (or the line above it). It reports `file:line` and never fixes anything.
 *
 * What it looks at (the TypeScript syntax tree, so comments and strings are never mistaken for code):
 *  - `<anything>.organizationMember.<findMany|findFirst|findUnique|count|groupBy|aggregate|...>(...)`
 *  - a `memberships` key (the `User -> OrganizationMember` relation) used as a filter or selection,
 *    for example `user: { memberships: { some: { organizationId } } }` or `select: { memberships: ... }`
 *  - an `organization: { members: ... }` selection (the `Organization -> OrganizationMember` relation)
 * and it leaves alone: writes (`create`, `connect`, ...), and `Department.memberships`, which is the
 * department roster (DepartmentMember) and has no status of its own.
 * A call "mentions status" when the identifier `status` appears anywhere inside it (a `where` on it, or
 * a `select` of it that the code then checks, as `requireOrgMember` does) - or inside a `where` /
 * `select` / `include` object that was built beforehand and handed over by name (`{ where, select }`).
 */

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

const READS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "groupBy",
  "aggregate",
]);

/** Keys that only structure a Prisma query; they do not name a relation. */
const STRUCTURAL = new Set([
  "select",
  "include",
  "where",
  "some",
  "every",
  "none",
  "is",
  "isNot",
  "AND",
  "OR",
  "NOT",
  "orderBy",
  "take",
  "skip",
  "cursor",
  "distinct",
  "data",
  "create",
  "createMany",
  "connect",
  "connectOrCreate",
  "update",
  "updateMany",
  "upsert",
]);

/** A relation object whose keys are all of these is a write, not a read. */
const WRITES = new Set(["create", "createMany", "connect", "connectOrCreate", "set", "update", "updateMany", "upsert", "delete", "deleteMany", "disconnect"]);

const MARKER = "all-statuses:";

export interface Offender {
  file: string;
  line: number;
  what: string;
}

function keyOf(node: ts.PropertyAssignment): string | null {
  const n = node.name;
  return ts.isIdentifier(n) || ts.isStringLiteral(n) ? n.text : null;
}

/** The keys of a Prisma call whose value is often built beforehand and passed by name. */
const ARGUMENT_KEYS = new Set(["where", "select", "include"]);

/** The initializer of every variable a file declares, by name (to read a `where` object built beforehand). */
function declaredValues(source: ts.SourceFile): Map<string, ts.Expression[]> {
  const values = new Map<string, ts.Expression[]>();
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      values.set(n.name.text, [...(values.get(n.name.text) ?? []), n.initializer]);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return values;
}

/** `{ where }`, `{ where: filter }` or `findMany(args)`: an object handed over by name rather than written inline. */
function isHandedOverByName(n: ts.Identifier): boolean {
  const p = n.parent;
  if (ts.isShorthandPropertyAssignment(p)) return ARGUMENT_KEYS.has(p.name.text);
  if (ts.isPropertyAssignment(p) && p.initializer === n) return ARGUMENT_KEYS.has(keyOf(p) ?? "");
  if (ts.isCallExpression(p)) return p.arguments.includes(n);
  return false;
}

function mentionsStatus(node: ts.Node, values: Map<string, ts.Expression[]>, seen = new Set<ts.Node>()): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && n.text === "status") {
      found = true;
      return;
    }
    if (ts.isIdentifier(n) && isHandedOverByName(n)) {
      for (const built of values.get(n.text) ?? []) {
        if (seen.has(built)) continue;
        seen.add(built);
        if (mentionsStatus(built, values, seen)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** The nearest enclosing key that names a relation (`user`, `department`, `organization`, ...), if any. */
function relationOwner(node: ts.Node): string | null {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) return null;
    if (ts.isPropertyAssignment(p)) {
      const key = keyOf(p);
      if (key && !STRUCTURAL.has(key)) return key;
    }
  }
  return null;
}

/** The model a Prisma call is made on: `db.department.findMany(...)` -> "department". */
function rootModel(node: ts.Node): string | null {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)) {
      const target = p.expression.expression;
      if (ts.isPropertyAccessExpression(target)) return target.name.text;
    }
  }
  return null;
}

export function scanSource(file: string, text: string): Offender[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const lines = text.split(/\r?\n/);
  const values = declaredValues(source);
  const offenders: Offender[] = [];

  const hasMarker = (node: ts.Node): boolean => {
    const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    const last = source.getLineAndCharacterOfPosition(node.getEnd()).line;
    for (let i = Math.max(0, first - 1); i <= last; i += 1) if ((lines[i] ?? "").includes(MARKER)) return true;
    return false;
  };

  const report = (node: ts.Node, what: string): void => {
    if (mentionsStatus(node, values) || hasMarker(node)) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    offenders.push({ file, line, what });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const target = node.expression.expression;
      if (READS.has(method) && ts.isPropertyAccessExpression(target) && target.name.text === "organizationMember") {
        report(node, `organizationMember.${method}`);
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const key = keyOf(node);
      if (key === "memberships" || key === "members") {
        const value = node.initializer;
        const isWrite =
          ts.isObjectLiteralExpression(value) &&
          value.properties.length > 0 &&
          value.properties.every((p) => ts.isPropertyAssignment(p) && WRITES.has(keyOf(p) ?? ""));
        const isRead = ts.isObjectLiteralExpression(value) || value.kind === ts.SyntaxKind.TrueKeyword;
        const owner = relationOwner(node) ?? rootModel(node);
        const ofOrganizationMember = key === "memberships" ? owner !== "department" : owner === "organization";
        if (isRead && !isWrite && ofOrganizationMember) report(node, `${key} relation`);
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return offenders;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const scan = (code: string, file = "sample.ts") => scanSource(file, code).map((o) => o.line);

describe("the scanner itself", () => {
  it("flags a membership read that says nothing about status, with its line", () => {
    const code = [
      "const rows = await db.organizationMember.findMany({",
      "  where: { organizationId: orgId },",
      "});",
    ].join("\n");
    expect(scan(code)).toEqual([1]);
    expect(scan("await tx.organizationMember.findFirst({ where: { userId } });")).toEqual([1]);
    for (const method of ["findUnique", "findUniqueOrThrow", "findFirstOrThrow", "count", "groupBy", "aggregate"]) {
      expect(scan(`await db.organizationMember.${method}({ where: { userId } });`), method).toEqual([1]);
    }
  });

  it("accepts a read that filters on status, or selects it to check it", () => {
    expect(scan('await db.organizationMember.findMany({ where: { organizationId, status: "ACTIVE" } });')).toEqual([]);
    expect(scan("const m = await db.organizationMember.findUnique({ where, select: { role: true, status: true } });")).toEqual([]);
  });

  it("reads a `where` that was built beforehand and handed over by name", () => {
    const filtered = [
      'const where = { organizationId: orgId, status: "ACTIVE" as const };',
      "const rows = await db.organizationMember.findMany({ where, orderBy, select: { userId: true } });",
    ].join("\n");
    expect(scan(filtered)).toEqual([]);
    expect(scan(filtered.replace("where, orderBy", "where: where, orderBy"))).toEqual([]);

    const unfiltered = [
      "const where = { organizationId: orgId };",
      "const rows = await db.organizationMember.findMany({ where, orderBy, select: { userId: true } });",
    ].join("\n");
    expect(scan(unfiltered)).toEqual([2]);

    // only the arguments of the call count: an unrelated variable that happens to mention status does not
    const unrelated = [
      "const open = tickets.filter((t) => t.status === 'OPEN');",
      "const rows = await db.organizationMember.findMany({ where: { userId: { in: open } } });",
    ].join("\n");
    expect(scan(unrelated)).toEqual([2]);

    // and so does the whole argument object handed over as one
    expect(scan(['const args = { where: { organizationId, status: "ACTIVE" } };', "await db.organizationMember.count(args);"].join("\n"))).toEqual([]);
  });

  it("accepts the all-statuses marker on the line of the call or the line above, and nowhere else", () => {
    expect(scan("await db.organizationMember.findMany({ where: { orgId } }); // all-statuses: the members page lists everybody")).toEqual([]);
    expect(scan(["// all-statuses: history of who ever belonged", "await db.organizationMember.findMany({ where: { orgId } });"].join("\n"))).toEqual([]);
    expect(
      scan(["await db.organizationMember.findMany({ // all-statuses: audit view", "  where: { orgId },", "});"].join("\n")),
    ).toEqual([]);
    // two lines away is not "on the line"
    expect(scan(["// all-statuses: too far", "", "await db.organizationMember.findMany({ where: { orgId } });"].join("\n"))).toEqual([3]);
  });

  it("flags the User -> OrganizationMember relation used as a filter or a selection", () => {
    expect(scan("await db.user.findMany({ where: { memberships: { some: { organizationId } } } });")).toEqual([1]);
    expect(scan("await db.workspaceMember.findMany({ where: { user: { memberships: { some: { organizationId: orgId } } } } });")).toEqual([1]);
    expect(scan("await db.user.findUnique({ where: { id }, select: { memberships: { select: { role: true } } } });")).toEqual([1]);
    expect(scan("await db.user.findUnique({ where: { id }, include: { memberships: true } });")).toEqual([1]);
    expect(scan('await db.user.findMany({ where: { memberships: { some: { organizationId, status: "ACTIVE" } } } });')).toEqual([]);
    expect(scan('await db.user.findUnique({ where: { id }, select: { memberships: { where: { status: "ACTIVE" }, take: 1 } } });')).toEqual([]);
  });

  it("flags an organization's members selected through the Organization relation", () => {
    expect(scan("await db.workspace.findUnique({ where: { id }, select: { organization: { select: { members: { select: { role: true } } } } } });")).toEqual([1]);
    expect(scan("await db.organization.findUnique({ where: { id }, include: { members: true } });")).toEqual([1]);
    expect(scan('await db.organization.findUnique({ where: { id }, include: { members: { where: { status: "ACTIVE" } } } });')).toEqual([]);
  });

  it("leaves department rosters, conversation and workspace members, and writes alone", () => {
    expect(scan("await db.department.findMany({ include: { memberships: { select: { userId: true } } } });")).toEqual([]);
    expect(scan("await db.ticket.findFirst({ select: { department: { select: { memberships: { select: { userId: true } } } } } });")).toEqual([]);
    expect(scan("await db.conversation.findMany({ where: { members: { some: { userId } } } });")).toEqual([]);
    expect(scan("await db.workspace.create({ data: { members: { create: { userId, role: 'ADMIN' } } } });")).toEqual([]);
    expect(scan("await db.user.create({ data: { memberships: { create: { organizationId, role: 'MEMBER' } } } });")).toEqual([]);
  });

  it("does not mistake comments or strings for queries", () => {
    expect(scan("// db.organizationMember.findMany({ where: { orgId } })\nconst s = 'db.organizationMember.findMany()';")).toEqual([]);
    expect(scan("const memberships = rows.filter((m) => m.role !== 'GUEST'); const x = { memberships: rows.length };")).toEqual([]);
  });

  it("reads TSX as well", () => {
    const code = "export default async function Page() { const m = await db.organizationMember.findFirst({ where: { userId } }); return <div>{m?.role}</div>; }";
    expect(scan(code, "page.tsx")).toEqual([1]);
  });
});

describe("every membership read in src/ says which statuses it wants", () => {
  it("has no read that ignores the status of a member (fix it, or mark it `// all-statuses: <reason>`)", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC).sort()) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      for (const o of scanSource(rel, readFileSync(file, "utf8"))) offenders.push(`${o.file}:${o.line}  ${o.what}`);
    }
    expect(offenders).toEqual([]);
  });
});
