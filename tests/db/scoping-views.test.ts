import { describe, expect, it } from "vitest";
import { listWorkspacePeople, queryTasksForView, resolveWorkspaceView } from "@/server/services/views";
import { loginAs, logout, makeUser, makeWorkspace } from "./helpers";
import { joinOrg, joinWorkspace, makeScopedOrg } from "./scoping-helpers";

async function ctxFor(userId: string, wanted?: string) {
  await loginAs(userId);
  const res = await resolveWorkspaceView(wanted);
  if (!("ctx" in res)) throw new Error(`expected a ctx, got ${JSON.stringify(res)}`);
  return res.ctx;
}

describe("resolveWorkspaceView: the selector and the chosen workspace are limited to accessible workspaces", () => {
  it("anonymous callers are sent to login", async () => {
    logout();
    expect(await resolveWorkspaceView()).toEqual({ pageRedirect: true });
  });

  it("a plain MEMBER only gets the workspaces they belong to", async () => {
    const f = await makeScopedOrg();
    const ctx = await ctxFor(f.member.id);
    expect(ctx.workspaces.map((w) => w.id)).toEqual([f.wsIn.id]);
    expect(ctx.workspaceId).toBe(f.wsIn.id);
    expect(ctx.orgId).toBe(f.org.id);
    expect(ctx.denied).toBe(false);
    expect(ctx.editable).toBe(true);
  });

  it("asking for a workspace the MEMBER is not in falls back to one they can open, never the one asked for", async () => {
    const f = await makeScopedOrg();
    const ctx = await ctxFor(f.member.id, f.wsOut.id);
    expect(ctx.workspaceId).toBe(f.wsIn.id);
    expect(ctx.workspaceName).toBe(f.wsIn.name);
    expect(ctx.workspaces.map((w) => w.id)).not.toContain(f.wsOut.id);
  });

  it("a MEMBER who belongs to no workspace gets { none: true } (no fallback to someone else's workspace)", async () => {
    const f = await makeScopedOrg();
    const loner = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await loginAs(loner.id);
    expect(await resolveWorkspaceView()).toEqual({ none: true });
    expect(await resolveWorkspaceView(f.wsOut.id)).toEqual({ none: true });
  });

  it("a GUEST outside every workspace gets { none: true }; once put in one, only that one", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.guest.id);
    expect(await resolveWorkspaceView()).toEqual({ none: true });
    await joinWorkspace(f.guest.id, f.wsIn.id, "GUEST");
    const ctx = await ctxFor(f.guest.id, f.wsOut.id);
    expect(ctx.workspaces.map((w) => w.id)).toEqual([f.wsIn.id]);
    expect(ctx.workspaceId).toBe(f.wsIn.id);
    expect(ctx.role).toBe("GUEST");
    expect(ctx.editable).toBe(false);
  });

  it("an ADMIN and the OWNER inherit every workspace of the org and can pick any of them", async () => {
    const f = await makeScopedOrg();
    for (const user of [f.admin, f.owner]) {
      const ctx = await ctxFor(user.id, f.wsOut.id);
      expect(ctx.workspaces.map((w) => w.id).sort()).toEqual([f.wsIn.id, f.wsOut.id].sort());
      expect(ctx.workspaceId).toBe(f.wsOut.id);
      expect(ctx.orgId).toBe(f.org.id);
      expect(ctx.editable).toBe(true);
    }
  });

  it("the selector is sorted by name", async () => {
    const f = await makeScopedOrg();
    const a = await makeWorkspace(f.org.id, [], "AAA first");
    const z = await makeWorkspace(f.org.id, [], "zzz last");
    const ctx = await ctxFor(f.admin.id);
    expect(ctx.workspaces.map((w) => w.name)).toEqual(["AAA first", f.wsIn.name, f.wsOut.name, "zzz last"]);
    expect(ctx.workspaces[0]?.id).toBe(a.id);
    expect(ctx.workspaces.at(-1)?.id).toBe(z.id);
    expect(ctx.workspaceId).toBe(a.id); // the fallback is the first one in the list
  });

  it("covers several organizations: each accessible workspace with its own org, none of the inaccessible ones", async () => {
    const a = await makeScopedOrg();
    const b = await makeScopedOrg();
    const multi = await makeUser({ orgId: a.org.id, role: "MEMBER" });
    await joinWorkspace(multi.id, a.wsIn.id);
    await joinOrg(multi.id, b.org.id, "ADMIN");

    const ctxB = await ctxFor(multi.id, b.wsOut.id);
    // ADMIN of B inherits both B workspaces; MEMBER of A only has A's wsIn
    expect(ctxB.workspaces.map((w) => w.id).sort()).toEqual([a.wsIn.id, b.wsIn.id, b.wsOut.id].sort());
    expect(ctxB.workspaces.map((w) => w.id)).not.toContain(a.wsOut.id);
    expect(ctxB.workspaceId).toBe(b.wsOut.id);
    expect(ctxB.orgId).toBe(b.org.id);

    const ctxA = await ctxFor(multi.id, a.wsOut.id); // not accessible: falls back, never A.wsOut
    expect(ctxA.workspaceId).not.toBe(a.wsOut.id);
    expect(ctxA.workspaces.map((w) => w.id)).not.toContain(a.wsOut.id);
  });

  it("a workspace member's explicit role wins over the org role", async () => {
    const f = await makeScopedOrg();
    const ws = await makeWorkspace(f.org.id, [{ userId: f.member.id, role: "GUEST" }], "Read only");
    const ctx = await ctxFor(f.member.id, ws.id);
    expect(ctx.workspaceId).toBe(ws.id);
    expect(ctx.role).toBe("GUEST");
    expect(ctx.editable).toBe(false);
  });
});

describe("queryTasksForView: an explicit workspace allow-list", () => {
  it("returns only tasks of the listed workspaces; an empty list returns nothing (never 'no filter')", async () => {
    const f = await makeScopedOrg();
    const all = await queryTasksForView({ orgId: f.org.id, search: f.token });
    expect(all.map((t) => t.id).sort()).toEqual([f.inside.task.id, f.outside.task.id].sort());

    const onlyIn = await queryTasksForView({ orgId: f.org.id, search: f.token, workspaceIds: [f.wsIn.id] });
    expect(onlyIn.map((t) => t.id)).toEqual([f.inside.task.id]);

    const none = await queryTasksForView({ orgId: f.org.id, search: f.token, workspaceIds: [] });
    expect(none).toEqual([]);
  });

  it("a single workspaceId outside the allow-list matches nothing; inside it, just that workspace", async () => {
    const f = await makeScopedOrg();
    const outside = await queryTasksForView({
      orgId: f.org.id,
      search: f.token,
      workspaceId: f.wsOut.id,
      workspaceIds: [f.wsIn.id],
    });
    expect(outside).toEqual([]);

    const inside = await queryTasksForView({
      orgId: f.org.id,
      search: f.token,
      workspaceId: f.wsIn.id,
      workspaceIds: [f.wsIn.id, f.wsOut.id],
    });
    expect(inside.map((t) => t.id)).toEqual([f.inside.task.id]);
  });

  it("stays org-scoped even when the allow-list names a workspace of another org", async () => {
    const a = await makeScopedOrg();
    const b = await makeScopedOrg();
    const rows = await queryTasksForView({ orgId: a.org.id, workspaceIds: [b.wsIn.id, b.wsOut.id] });
    expect(rows).toEqual([]);
  });
});

describe("listWorkspacePeople: who the List page offers in its assignee filter", () => {
  async function world() {
    const f = await makeScopedOrg();
    const mate = await makeUser({ orgId: f.org.id, role: "MEMBER", name: "Workspace mate" });
    const elsewhere = await makeUser({ orgId: f.org.id, role: "MEMBER", name: "Elsewhere" });
    await joinWorkspace(mate.id, f.wsIn.id);
    await joinWorkspace(f.guest.id, f.wsIn.id, "GUEST");
    await joinWorkspace(elsewhere.id, f.wsOut.id);
    return { ...f, mate, elsewhere };
  }
  const names = (people: { name: string }[]) => people.map((p) => p.name).sort();

  it("an org member gets the organization's people, as before", async () => {
    const w = await world();
    const ctx = await ctxFor(w.member.id, w.wsIn.id);
    expect(ctx.orgRole).toBe("MEMBER");
    const people = await listWorkspacePeople(ctx);
    expect(names(people)).toEqual(
      ["Admin", "Elsewhere", "Guest", "Member", "Owner", "Workspace mate"].sort(),
    );
    expect(Object.keys(people[0]!).sort()).toEqual(["id", "name"]); // names only, never an email
  });

  it("an ADMIN gets the organization's people as well", async () => {
    const w = await world();
    const ctx = await ctxFor(w.admin.id, w.wsOut.id);
    expect(names(await listWorkspacePeople(ctx))).toContain("Elsewhere");
    expect(names(await listWorkspacePeople(ctx))).toContain("Owner");
  });

  it("an org GUEST only gets the people who share the workspace with them", async () => {
    const w = await world();
    const ctx = await ctxFor(w.guest.id, w.wsIn.id);
    expect(ctx.orgRole).toBe("GUEST");
    const people = await listWorkspacePeople(ctx);
    expect(names(people)).toEqual(["Guest", "Member", "Workspace mate"].sort());
    for (const hidden of ["Owner", "Admin", "Elsewhere"]) expect(names(people)).not.toContain(hidden);
    expect(Object.keys(people[0]!).sort()).toEqual(["id", "name"]);
  });
});
