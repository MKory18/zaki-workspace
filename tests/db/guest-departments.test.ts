import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import * as departmentsRoute from "@/app/api/departments/route";
import * as departmentRoute from "@/app/api/departments/[id]/route";
import * as membersRoute from "@/app/api/departments/[id]/members/route";
import * as departmentTicketsRoute from "@/app/api/departments/[id]/tickets/route";
import * as departmentCampaignsRoute from "@/app/api/departments/[id]/campaigns/route";
import DepartmentsPage from "@/app/(app)/departments/page";
import { DepartmentsView } from "@/components/departments-view";
import { getServerT } from "@/lib/i18n/server";
import { call, db, loginAs, logout, makeTeam } from "./helpers";
import { makeDepartment, makeMember, setProfile } from "./guest-helpers";

// The page is TSX; under vitest its JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const { t } = getServerT();

/** The staff directory data a guest must never get out of the departments area. */
const SECRETS = ["Head of IT", "Chief engineer", "Dept developer", "Backend developer"];

async function departmentWorld() {
  const team = await makeTeam();
  const lead = await makeMember(team.org.id, "Head of IT");
  const dev = await makeMember(team.org.id, "Dept developer");
  const outsider = await makeMember(team.org.id, "Not in the department");
  await setProfile(lead.id, { jobTitle: "Chief engineer" });
  await setProfile(dev.id, { jobTitle: "Backend developer" });
  const dept = await makeDepartment(team.org.id, { memberIds: [lead.id, dev.id], leadId: lead.id, name: "IT desk" });
  return { ...team, lead, dev, outsider, dept };
}

function expectNoStaffData(text: string) {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

describe("departments: closed to a GUEST", () => {
  it("the list is 403 and carries no member names or job titles", async () => {
    const w = await departmentWorld();
    await loginAs(w.guest.id);
    const res = await call(departmentsRoute.GET);
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("guest.no_access");
    expect(res.json?.["departments"]).toBeUndefined();
    expect(res.text).not.toContain("IT desk");
    expectNoStaffData(res.text);
  });

  it("a single department is 403 too (members and projects)", async () => {
    const w = await departmentWorld();
    await loginAs(w.guest.id);
    const res = await call(departmentRoute.GET, { params: { id: w.dept.id } });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("guest.no_access");
    expect(res.json?.["members"]).toBeUndefined();
    expectNoStaffData(res.text);
  });

  it("cannot add or remove members, and nobody is notified", async () => {
    const w = await departmentWorld();
    await loginAs(w.guest.id);

    const add = await call(membersRoute.POST, { params: { id: w.dept.id }, body: { addUserIds: [w.outsider.id] } });
    expect(add.status).toBe(403);
    expect(add.json?.["message"]).toBe("guest.no_access");
    const remove = await call(membersRoute.POST, { params: { id: w.dept.id }, body: { removeUserIds: [w.dev.id] } });
    expect(remove.status).toBe(403);
    expect(remove.json?.["message"]).toBe("guest.no_access");

    const members = await db.departmentMember.findMany({ where: { departmentId: w.dept.id } });
    expect(members.map((m) => m.userId).sort()).toEqual([w.lead.id, w.dev.id].sort());
    expect(await db.notification.count({ where: { userId: w.outsider.id } })).toBe(0);
  });

  it("cannot create, rename or delete a department", async () => {
    const w = await departmentWorld();
    await loginAs(w.guest.id);

    const create = await call(departmentsRoute.POST, { body: { name: "Planted department" } });
    expect(create.status).toBe(403);
    expect(create.json?.["message"]).toBe("guest.no_access");
    const rename = await call(departmentRoute.PATCH, {
      method: "PATCH",
      params: { id: w.dept.id },
      body: { name: "Renamed by guest" },
    });
    expect(rename.status).toBe(403);
    expect(rename.json?.["message"]).toBe("guest.no_access");
    const del = await call(departmentRoute.DELETE, { method: "DELETE", params: { id: w.dept.id } });
    expect(del.status).toBe(403);
    expect(del.json?.["message"]).toBe("guest.no_access");

    expect(await db.department.count({ where: { orgId: w.org.id } })).toBe(1);
    expect((await db.department.findUniqueOrThrow({ where: { id: w.dept.id } })).name).toBe("IT desk");
  });

  it("the ticket and campaign sub-routes stay readable (their own guest rules apply)", async () => {
    const w = await departmentWorld();
    await loginAs(w.guest.id);
    expect((await call(departmentTicketsRoute.GET, { params: { id: w.dept.id } })).status).toBe(200);
    expect((await call(departmentCampaignsRoute.GET, { params: { id: w.dept.id } })).status).toBe(200);
  });

  it("an anonymous caller still gets 401, not 403", async () => {
    const w = await departmentWorld();
    logout();
    expect((await call(departmentsRoute.GET)).status).toBe(401);
    expect((await call(departmentRoute.GET, { params: { id: w.dept.id } })).status).toBe(401);
  });
});

describe("departments: everyone else keeps what they had", () => {
  for (const role of ["member", "admin", "owner"] as const) {
    it(`${role.toUpperCase()} can read the list and a single department, with member names and titles`, async () => {
      const w = await departmentWorld();
      await loginAs(w[role].id);

      const list = await call(departmentsRoute.GET);
      expect(list.status).toBe(200);
      const departments = list.json?.["departments"] as { name: string; members: { name: string; jobTitle: string | null }[] }[];
      expect(departments.map((d) => d.name)).toEqual(["IT desk"]);
      expect(departments[0]?.members.find((m) => m.name === "Dept developer")?.jobTitle).toBe("Backend developer");

      const one = await call(departmentRoute.GET, { params: { id: w.dept.id } });
      expect(one.status).toBe(200);
      expect(one.json).toMatchObject({ id: w.dept.id, name: "IT desk", leadId: w.lead.id });
      expect((one.json?.["members"] as unknown[]).length).toBe(2);
    });
  }

  it("a MEMBER still cannot manage departments or their members", async () => {
    const w = await departmentWorld();
    await loginAs(w.member.id);
    const create = await call(departmentsRoute.POST, { body: { name: "Member department" } });
    expect(create.status).toBe(403);
    expect(create.json?.["message"]).toBe("dept.admin_only");
    const add = await call(membersRoute.POST, { params: { id: w.dept.id }, body: { addUserIds: [w.outsider.id] } });
    expect(add.status).toBe(403);
    expect(add.json?.["message"]).toBe("dept.admin_only");
    expect(await db.department.count({ where: { orgId: w.org.id } })).toBe(1);
  });

  it("an ADMIN still creates, edits, staffs and deletes departments, and the new member is notified", async () => {
    const w = await departmentWorld();
    await loginAs(w.admin.id);

    const created = await call(departmentsRoute.POST, { body: { name: "Design desk", memberIds: [w.dev.id] } });
    expect(created.status).toBe(201);
    const id = (created.json as { id: string }).id;

    expect(
      (await call(departmentRoute.PATCH, { method: "PATCH", params: { id }, body: { name: "Design studio" } })).status,
    ).toBe(200);
    expect((await db.department.findUniqueOrThrow({ where: { id } })).name).toBe("Design studio");

    const add = await call(membersRoute.POST, { params: { id }, body: { addUserIds: [w.outsider.id] } });
    expect(add.status).toBe(200);
    expect(await db.departmentMember.count({ where: { departmentId: id, userId: w.outsider.id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: w.outsider.id, type: "dept_member_added" } })).toBe(1);

    expect((await call(membersRoute.POST, { params: { id }, body: { removeUserIds: [w.outsider.id] } })).status).toBe(200);
    expect(await db.departmentMember.count({ where: { departmentId: id, userId: w.outsider.id } })).toBe(0);

    expect((await call(departmentRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(200);
    expect(await db.department.findUnique({ where: { id } })).toBeNull();
  });
});

describe("the /departments page", () => {
  it("shows a GUEST only the 'not available to guests' notice - no department view, no staff data", async () => {
    const w = await departmentWorld();
    await loginAs(w.guest.id);
    const element = (await DepartmentsPage()) as React.ReactElement;
    expect(element.type).not.toBe(DepartmentsView);

    const html = renderToStaticMarkup(element);
    expect(t("guest.no_access")).not.toBe("guest.no_access"); // a real translation, not a raw key
    expect(html).toContain(t("guest.no_access"));
    expect(html).not.toContain("IT desk");
    expectNoStaffData(html);
  });

  it("still gives everyone else the departments view, told who they are", async () => {
    const w = await departmentWorld();
    for (const [user, role] of [
      [w.member, "MEMBER"],
      [w.admin, "ADMIN"],
      [w.owner, "OWNER"],
    ] as const) {
      await loginAs(user.id);
      const element = (await DepartmentsPage()) as React.ReactElement<{ me: { role: string; id: string } }>;
      expect(element.type).toBe(DepartmentsView);
      expect(element.props.me).toEqual({ role, id: user.id });
    }
  });
});
