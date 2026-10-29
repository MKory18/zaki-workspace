import { describe, expect, it } from "vitest";
import * as bellRoute from "@/app/api/notifications/route";
import * as readRoute from "@/app/api/notifications/read/route";
import * as membersRoute from "@/app/api/organizations/[id]/members/route";
import { pushNotification } from "@/server/notify";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * B7 (Phase B review, fixed in Phase E): a notification belongs to ONE company.
 *
 * A person may be an ACTIVE member of two companies. Their personal notices (a welcome, a changed rank, a
 * ticket with no space) carried no company, and the bell showed every such row in the bell of BOTH — so the
 * screen said, in company «أ», «مرحباً بك في الشركة ب».
 *
 * The company that writes a notice now writes it down (`Notification.organizationId`), and the bell narrows
 * the personal rows to the company the person is working in. A row from before the column existed
 * (`organizationId: null`) is still shown, so nothing disappears on the day of the change.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
type Bell = { items: Array<{ id: string; type: string; title: string }>; unreadCount: number };
const bell = async () => (await call(bellRoute.GET)).json as Bell;

/** One person, two companies, a space in each. The first company made is the one `requireActor` picks. */
async function twoCompanies() {
  const first = await makeTeam();
  const second = await makeTeam();
  const person = await makeUser({ orgId: second.org.id, role: "MEMBER", name: `Dual ${uid()}` });
  await db.organizationMember.create({ data: { organizationId: first.org.id, userId: person.id, role: "MEMBER" } });
  const inFirst = await makeWorkspace(first.org.id, [{ userId: person.id }], `أ ${uid()}`);
  const inSecond = await makeWorkspace(second.org.id, [{ userId: person.id }], `ب ${uid()}`);
  return { first, second, person, inFirst, inSecond };
}

describe("the bell of a company shows its own company's personal notices only", () => {
  it("the welcome of company ب does not ring in the bell of company أ (the finding itself)", async () => {
    const w = await twoCompanies();
    // a person joins ب through the People screen: the welcome notice is written by that company
    await loginAs(w.second.owner.id);
    const made = await call(membersRoute.POST, {
      params: { id: w.second.org.id },
      body: { username: `new-${uid()}`, name: `New ${uid()}`, role: "MEMBER" },
    });
    expect(made.status).toBe(201);
    const { userId } = made.json as { userId: string };
    const welcome = await db.notification.findFirstOrThrow({ where: { userId, type: "welcome" }, select: { id: true, organizationId: true } });
    expect(welcome.organizationId).toBe(w.second.org.id);
    // and the bell of أ does not show it: that is the query the route uses
    const { bellWhere } = await import("@/server/services/current-space");
    expect(await db.notification.count({ where: { AND: [{ id: welcome.id }, bellWhere(userId, w.inFirst.id, w.first.org.id)] } })).toBe(0);
    // the old query did show it — this is the finding, kept as a complaint so a fix cannot quietly regress
    expect(await db.notification.count({ where: { AND: [{ id: welcome.id }, { userId, OR: [{ workspaceId: w.inFirst.id }, { workspaceId: null }] }] } })).toBe(1);
  });

  it("«read all» in one company leaves the other company's notices unread", async () => {
    const w = await twoCompanies();
    await pushNotification({ userId: w.person.id, type: "x", title: "أ", organizationId: w.first.org.id });
    await pushNotification({ userId: w.person.id, type: "x", title: "ب", organizationId: w.second.org.id });
    await loginAs(w.person.id);
    const { bellWhere } = await import("@/server/services/current-space");
    // the company `requireActor` picks for this person (the oldest ACTIVE membership)
    const company = (await db.organizationMember.findFirstOrThrow({ where: { userId: w.person.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { organizationId: true } })).organizationId;
    const inFirstCompany = company === w.first.org.id;
    const spaceOf = inFirstCompany ? w.inFirst : w.inSecond;
    enter(spaceOf.id);
    expect((await call(readRoute.POST, { body: { all: true } })).status).toBe(200);
    // what the route asked the bell's query with: everything of that company is read
    const unread = await db.notification.findMany({ where: { ...bellWhere(w.person.id, spaceOf.id, company), readAt: null }, select: { title: true } });
    expect(unread).toEqual([]);
    // and the other company's notice was not touched: it waits for its own company's bell
    const other = await db.notification.findMany({ where: { userId: w.person.id, organizationId: company === w.first.org.id ? w.second.org.id : w.first.org.id }, select: { title: true, readAt: true } });
    expect(other).toEqual([{ title: inFirstCompany ? "ب" : "أ", readAt: null }]);
  });

  it("a notice of a space takes that space's company, without anyone naming it", async () => {
    const w = await twoCompanies();
    await pushNotification({ userId: w.person.id, type: "x", title: "في مساحة ب", workspaceId: w.inSecond.id });
    const row = await db.notification.findFirstOrThrow({ where: { userId: w.person.id, title: "في مساحة ب" }, select: { organizationId: true } });
    expect(row.organizationId).toBe(w.second.org.id);
  });

  it("a notice from before the column existed is still shown (nothing disappears on the day of the change)", async () => {
    const w = await twoCompanies();
    // a space of the person's OWN company, written before notices carried one
    await pushNotification({ userId: w.person.id, type: "x", title: "قديمة", workspaceId: w.inFirst.id });
    const old = await db.notification.findFirstOrThrow({ where: { userId: w.person.id, title: "قديمة" }, select: { id: true } });
    await db.notification.update({ where: { id: old.id }, data: { organizationId: null } });
    const { bellWhere } = await import("@/server/services/current-space");
    // what the old query asked: the space's, and every personal row of any company
    expect(await db.notification.count({ where: { userId: w.person.id, OR: [{ workspaceId: w.inFirst.id }, { workspaceId: null }] } })).toBe(1);
    // the new one still shows it
    expect(await db.notification.count({ where: bellWhere(w.person.id, w.inFirst.id, w.first.org.id) })).toBe(1);
  });
});
