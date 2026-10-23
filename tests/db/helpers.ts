import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { OrgRole, WorkspaceRole, TaskPriority } from "@prisma/client";
import { db } from "@/server/db";
import { COOKIE_NAME, createSessionToken } from "@/server/session";

export { db };

/** Random short id, safe inside slugs / emails / key prefixes. */
export function uid(): string {
  return randomBytes(5).toString("hex");
}

/** Every fixture user shares this password (hashed once, with a cheap cost). */
export const TEST_PASSWORD = "Passw0rd-test";
const PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);

// ---------- sign-in ----------

function jar(): Map<string, string> {
  const j = (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar;
  if (!j) throw new Error("tests/db/setup.ts did not run — is this file under tests/db and run with `npm run test:db`?");
  return j;
}

/**
 * Sign in as this user for every following route/service call, with a token carrying their
 * CURRENT session version (so a later suspend/offboard/reset makes it stop working, as in production).
 * `claims` lets a test pretend the token still says "must change password" / "notice pending".
 */
export async function loginAs(userId: string, claims: { mcp?: boolean; tp?: boolean } = {}): Promise<void> {
  const { tokenVersion } = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } });
  jar().set(COOKIE_NAME, await createSessionToken({ userId, tv: tokenVersion, ...claims }));
}

/** Drop the session cookie (anonymous caller). */
export function logout(): void {
  jar().delete(COOKIE_NAME);
}

// ---------- fixtures ----------

export async function makeOrg(opts: { name?: string } = {}) {
  const id = uid();
  return db.organization.create({
    data: {
      name: opts.name ?? `Org ${id}`,
      slug: `org-${id}`,
      keyPrefix: `T${id}`.toUpperCase(),
      joinCode: `J${id}`.toUpperCase(),
    },
  });
}

export async function makeUser(opts: { orgId?: string; role?: OrgRole; name?: string; email?: string; username?: string } = {}) {
  const id = uid();
  const user = await db.user.create({
    data: {
      email: opts.email ?? `u-${id}@test.local`,
      ...(opts.username ? { username: opts.username } : {}),
      name: opts.name ?? `User ${id}`,
      passwordHash: PASSWORD_HASH,
      // fixture users are fully onboarded: nothing to change, notice accepted
      transparencyVersion: 1,
      transparencyAcceptedAt: new Date(),
      ...(opts.orgId ? { memberships: { create: { organizationId: opts.orgId, role: opts.role ?? "MEMBER" } } } : {}),
    },
  });
  // fixtures always have an e-mail, so tests can use it as a plain string
  return { ...user, email: user.email as string };
}

/** An org with one user per org role: owner, admin, member, guest. */
export async function makeTeam() {
  const org = await makeOrg();
  const owner = await makeUser({ orgId: org.id, role: "OWNER", name: "Owner" });
  const admin = await makeUser({ orgId: org.id, role: "ADMIN", name: "Admin" });
  const member = await makeUser({ orgId: org.id, role: "MEMBER", name: "Member" });
  const guest = await makeUser({ orgId: org.id, role: "GUEST", name: "Guest" });
  return { org, owner, admin, member, guest };
}

export async function makeWorkspace(
  orgId: string,
  members: { userId: string; role?: WorkspaceRole }[] = [],
  name?: string,
) {
  const id = uid();
  return db.workspace.create({
    data: {
      organizationId: orgId,
      name: name ?? `Workspace ${id}`,
      slug: `ws-${id}`,
      members: { create: members.map((m) => ({ userId: m.userId, role: m.role ?? "MEMBER" })) },
    },
  });
}

/** Project + one board with a "todo" and a "done" column. */
export async function makeProject(workspaceId: string, name?: string) {
  const project = await db.project.create({ data: { workspaceId, name: name ?? `Project ${uid()}` } });
  const board = await db.board.create({ data: { projectId: project.id, name: "Board" } });
  const todo = await db.boardColumn.create({ data: { boardId: board.id, name: "todo", position: 0 } });
  const done = await db.boardColumn.create({ data: { boardId: board.id, name: "done", position: 1, done: true } });
  return { project, board, todo, done };
}

export async function makeTask(opts: {
  orgId: string;
  workspaceId: string;
  projectId: string;
  boardId: string;
  columnId: string;
  creatorId: string;
  assigneeId?: string | null;
  title?: string;
  priority?: TaskPriority;
  dueDate?: Date | null;
  completedAt?: Date | null;
}) {
  return db.$transaction(async (tx) => {
    const counter = await tx.taskCounter.upsert({
      where: { organizationId: opts.orgId },
      create: { organizationId: opts.orgId, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return tx.task.create({
      data: {
        number: counter.lastNumber,
        orgId: opts.orgId,
        workspaceId: opts.workspaceId,
        projectId: opts.projectId,
        boardId: opts.boardId,
        columnId: opts.columnId,
        creatorId: opts.creatorId,
        assigneeId: opts.assigneeId ?? null,
        title: opts.title ?? `Task ${uid()}`,
        priority: opts.priority ?? "NORMAL",
        dueDate: opts.dueDate ?? null,
        completedAt: opts.completedAt ?? null,
        position: 1000,
      },
    });
  });
}

// ---------- calling route handlers like HTTP ----------

type RouteHandler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

export interface CallInit {
  method?: string;
  url?: string;
  body?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

/** Calls an exported route handler (GET/POST/…) with a real Request. */
export async function call(handler: unknown, init: CallInit = {}) {
  const hasBody = init.body !== undefined;
  const req = new Request(init.url ?? "http://localhost/api/test", {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...init.headers },
    ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
  });
  const res = await (handler as RouteHandler)(req, { params: init.params ?? {} });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json: json as Record<string, unknown> | null, text, headers: res.headers };
}
