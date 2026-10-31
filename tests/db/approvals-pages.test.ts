import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// The pages call redirect()/notFound() and their client parts call useRouter(); no running Next app is needed here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/approvals",
}));

import ApprovalsPage from "@/app/(app)/approvals/page";
import ApprovalPage from "@/app/(app)/approvals/[id]/page";
import ApprovalFormsPage from "@/app/(app)/approvals/forms/page";
import { getServerT } from "@/lib/i18n/server";
import { buildNav } from "@/lib/nav/places";
import { featuresOff } from "@/lib/features";
import { requireActor } from "@/server/policy/actor";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { db, loginAs } from "./helpers";
import { html } from "./pages-access-helpers";
import { resolveServerTree } from "./today-helpers";
import { approvalOf, approvalsWorld, archiveForm, ask, createForm, decide, fill, flip, jar, leaveForm, listForms, type AWorld } from "./approvals-helpers";

/**
 * The pages of «الموافقات» as every kind of person: who gets the list, the request, the forms; the guest and the stranger get nothing
 * (not even a number); the owner reads everything and is shown that he is only reading; switched off, the pages are «not found» and
 * the tab is not on the map. The amount appears only where the person may read the request, in the markup AND in the data the page
 * hands to its client parts.
 */
const { t } = getServerT();
const SECRET_TITLE = "عنوان-سري-للطلب";
const SECRET_DETAILS = "تفاصيل-سرية-للطلب";

type Outcome = { kind: "rendered"; markup: string; props: string } | { kind: "redirect"; to: string } | { kind: "not-found" };

function textsOf(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "bigint") return [String(value)];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (value instanceof Date) return [value.toISOString()];
  return Object.values(value).flatMap((inner) => textsOf(inner, seen));
}

async function open(page: () => Promise<ReactElement> | ReactElement): Promise<Outcome> {
  let tree: ReactNode;
  try {
    tree = await resolveServerTree(await page());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const to = /^NEXT_REDIRECT:(.*)$/.exec(message)?.[1];
    if (to !== undefined) return { kind: "redirect", to };
    if (message === "NEXT_NOT_FOUND") return { kind: "not-found" };
    throw err;
  }
  return { kind: "rendered", markup: await html(tree as ReactElement), props: textsOf(tree).join("\n") };
}

const rendered = (o: Outcome) => {
  if (o.kind !== "rendered") throw new Error(`expected a page, got ${o.kind}`);
  return o;
};

async function world() {
  const w = await approvalsWorld();
  const id = await ask(w, w.member, [w.lead.id, w.admin.id], { title: SECRET_TITLE, details: SECRET_DETAILS, amount: "250", currency: "USD" });
  return { ...w, id };
}
type W = AWorld & { id: string };

const list = (w: W, query: Record<string, string> = {}) => open(() => ApprovalsPage({ searchParams: query }));
const one = (id: string) => open(() => ApprovalPage({ params: { id } }));
const forms = (query: Record<string, string> = {}) => open(() => ApprovalFormsPage({ searchParams: query }));

describe("«الموافقات» — the list page", () => {
  it("«طلباتي» (the default): the requester's own request, with the amount in Arabic; «بانتظاري» for the approver; «كل الطلبات» only where it is offered", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const mine = rendered(await list(w));
    expect(mine.markup).toContain(SECRET_TITLE);
    expect(mine.markup).toContain("250 دولار");
    expect(mine.markup).toContain(t("approvals.view.mine"));
    expect(mine.markup).not.toContain(t("approvals.view.all")); // a member has no «كل الطلبات»
    expect(mine.markup).toContain(`/approvals/${w.id}`);

    await loginAs(w.lead.id);
    const waiting = rendered(await list(w, { v: "waiting" }));
    expect(waiting.markup).toContain(SECRET_TITLE);
    expect(waiting.markup).toContain("(1)");
    // the second approver's turn has not come
    await loginAs(w.admin.id);
    const early = rendered(await list(w, { v: "waiting" }));
    expect(early.markup).not.toContain(SECRET_TITLE);
    expect(early.markup).toContain(t("approvals.empty.waiting.title"));
    // the member asked for «كل الطلبات» by hand: they get their own list (the server never serves it to them)
    await loginAs(w.member2.id);
    const denied = rendered(await list(w, { v: "all" }));
    expect(denied.markup).not.toContain(SECRET_TITLE);
    expect(denied.markup).toContain(t("approvals.empty.mine.title"));
  });

  it("the owner and a space admin get «كل الطلبات»: every request, with the line that says it is read-only and silent", async () => {
    const w = await world();
    for (const who of [w.owner, w.admin]) {
      await loginAs(who.id);
      const all = rendered(await list(w, { v: "all" }));
      expect(all.markup, who.name).toContain(SECRET_TITLE);
      expect(all.markup, who.name).toContain("data-approvals-oversight");
      expect(all.markup, who.name).toContain(t("approvals.view.all"));
    }
    await loginAs(w.owner.id);
    expect(rendered(await list(w, { v: "all" })).markup).toContain(t("approvals.all.owner_hint"));
    // opening the list left no trace
    expect(await db.notification.count({ where: { userId: w.owner.id } })).toBe(0);
  });

  it("a guest gets the notice and nothing else: no title, no details, no amount, no name — in the markup or in the page's data", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    for (const query of [{}, { v: "waiting" }, { v: "all" }, { new: "1" }] as Record<string, string>[]) {
      const o = rendered(await list(w, query));
      expect(o.markup).toContain(t("guest.no_access"));
      for (const secret of [SECRET_TITLE, SECRET_DETAILS, "250", "USD", "دولار", "Member", "Lead", "Admin"]) {
        expect(o.markup, secret).not.toContain(secret);
        expect(o.props, secret).not.toContain(secret);
      }
    }
    const request = rendered(await one(w.id));
    expect(request.markup).toContain(t("guest.no_access"));
    expect(request.markup + request.props).not.toMatch(/250|دولار|عنوان-سري/);
    const formsPage = rendered(await forms());
    expect(formsPage.markup).toContain(t("guest.no_access"));
  });

  it("the new-request form lists the people of the space, never the asker, a guest or a stranger; a link in the address is offered", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const o = rendered(await list(w, { new: "1", link: "TASK:abc123" }));
    expect(o.markup).toContain("data-request-form");
    expect(o.markup).toContain(t("approvals.new.title"));
    expect(o.markup).toContain(">Lead ");
    expect(o.markup).toContain(">Admin ");
    expect(o.markup).toContain(">Member2 ");
    expect(o.markup).toContain(">Owner ");
    for (const who of ["Member ·", "Guest", "Outsider"]) expect(o.markup, who).not.toContain(`>${who}`);
    expect(o.markup).toContain("data-request-link");
    expect(rendered(await list(w, { new: "1", link: "NOPE:abc" })).markup).not.toContain("data-request-link");
  });

  it("a form to fill: its boxes and its chain; another space's form, an archived form and a missing one are not found", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const family = ((await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id, w.admin.id]) })).json?.["form"] as { familyId: string }).familyId;
    const elsewhere = ((await createForm({ workspaceId: w.other.id, ...leaveForm([w.outsider.id], { name: "في الأخرى" }) })).json?.["form"] as { familyId: string }).familyId;
    await loginAs(w.member.id);
    const o = rendered(await list(w, { fill: family }));
    expect(o.markup).toContain("data-form-filler");
    for (const label of ["نوع الإجازة", "من تاريخ", "عدد الأيام", "السبب", "سلّمت عملي", "رقم للتواصل"]) expect(o.markup).toContain(label);
    expect(o.markup).toContain("Lead ← Admin");
    expect((await list(w, { fill: elsewhere })).kind).toBe("not-found");
    expect((await list(w, { fill: "ghost" })).kind).toBe("not-found");
    await loginAs(w.owner.id);
    await archiveForm(family, true);
    await loginAs(w.member.id);
    expect((await list(w, { fill: family })).kind).toBe("not-found");
  });
});

describe("«طلب موافقة» — the request page", () => {
  it("the requester, the people named, the space's admin and the owner read it, each with what they may do; a stranger gets not-found", async () => {
    const w = await world();
    const expectations: [string, { id: string }, string[], string[]][] = [
      ["requester", w.member, ["data-approval-detail", "250 دولار", t("approvals.cancel.button")], ["data-decision-panel", "data-approval-oversight"]],
      ["first approver", w.lead, ["data-decision-panel", "250 دولار"], ["data-approval-oversight", t("approvals.cancel.button")]],
      ["second approver (not his turn)", w.admin, ["250 دولار", t("approvals.chain.sequential")], ["data-decision-panel"]],
      ["owner reading", w.owner, ["250 دولار", "data-approval-oversight"], ["data-decision-panel", t("approvals.cancel.button")]],
    ];
    for (const [label, who, has, hasNot] of expectations) {
      await loginAs(who.id);
      const o = rendered(await one(w.id));
      for (const needle of has) expect(o.markup, `${label}: ${needle}`).toContain(needle);
      for (const needle of hasNot) expect(o.markup, `${label}: not ${needle}`).not.toContain(needle);
      expect(o.markup, label).toContain(SECRET_TITLE);
      expect(o.markup, label).toContain(SECRET_DETAILS);
    }
    // somebody of the space who is not involved, somebody who works elsewhere, another company, nobody: the page does not exist for them
    for (const who of [w.member2, w.outsider, w.foreign.member]) {
      await loginAs(who.id);
      expect((await one(w.id)).kind, who.name).toBe("not-found");
    }
    await loginAs(w.owner.id);
    expect((await one("ghost")).kind).toBe("not-found");
  });

  it("the owner reads a request of a space he is not in without opening a row, a notification or an audit line", async () => {
    const w = await world();
    const before = { rows: await db.workspaceMember.count({ where: { userId: w.owner.id } }), bell: await db.notification.count(), audit: await db.auditLog.count() };
    await loginAs(w.owner.id);
    rendered(await one(w.id));
    rendered(await list(w, { v: "all" }));
    expect({ rows: await db.workspaceMember.count({ where: { userId: w.owner.id } }), bell: await db.notification.count(), audit: await db.auditLog.count() }).toEqual(before);
  });

  it("a request of another space of the person's opens that space first; one they cannot open is not found", async () => {
    const w = await world();
    // the lead's current space is `other` (they are in both): the request lives in `ws`
    await db.workspaceMember.create({ data: { workspaceId: w.other.id, userId: w.lead.id } });
    await loginAs(w.lead.id);
    jar().set(SPACE_COOKIE, w.other.id);
    const o = await one(w.id);
    expect(o.kind).toBe("redirect");
    expect(o.kind === "redirect" ? o.to : "").toContain(w.ws.id);
    jar().set(SPACE_COOKIE, w.ws.id);
  });

  it("a request sent back shows its requester the form to edit it, with the approver's reason; the history lists version 1", async () => {
    const w = await world();
    await loginAs(w.lead.id);
    expect((await decide(w.id, "CHANGES", "أضف عرض سعر ثانٍ")).status).toBe(200);
    await loginAs(w.member.id);
    const o = rendered(await one(w.id));
    expect(o.markup).toContain("data-resubmit-panel");
    expect(o.markup).toContain("أضف عرض سعر ثانٍ");
    expect(o.markup).toContain(t("approvals.status.CHANGES_REQUESTED"));
    await loginAs(w.lead.id);
    expect(rendered(await one(w.id)).markup).not.toContain("data-resubmit-panel");
  });

  it("a request made from a form, once sent back, shows the requester the boxes with their answers", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const family = ((await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) })).json?.["form"] as { familyId: string }).familyId;
    await loginAs(w.member.id);
    const made = approvalOf(await fill(family, { answers: { f1: "سنوية", f2: "2031-03-20", f3: 5 } }));
    await loginAs(w.lead.id);
    await decide(made["id"], "CHANGES", "غيّر المدة");
    await loginAs(w.member.id);
    const o = rendered(await one(made["id"]));
    expect(o.markup).toContain("data-form-filler");
    expect(o.markup).toContain('value="2031-03-20"');
    expect(o.markup).toContain('value="5"');
  });
});

describe("«النماذج» — the forms page", () => {
  it("everybody who works in the space sees the forms and may fill one; only the owner and the space admin get «نموذج جديد», edit and archive", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id]) });
    for (const [who, manager] of [[w.owner, true], [w.admin, true], [w.member, false], [w.member2, false]] as const) {
      await loginAs(who.id);
      const o = rendered(await forms());
      expect(o.markup, who.name).toContain("طلب إجازة");
      expect(o.markup, who.name).toContain(t("approvals.forms.fill"));
      expect(o.markup.includes(t("approvals.forms.new")), who.name).toBe(manager);
      expect(o.markup.includes(t("common.edit")), who.name).toBe(manager);
    }
    // a manager opens the builder; a member who asks for it by hand gets the list
    await loginAs(w.admin.id);
    expect(rendered(await forms({ new: "1" })).markup).toContain("data-form-builder");
    await loginAs(w.member.id);
    expect(rendered(await forms({ new: "1" })).markup).not.toContain("data-form-builder");
  });

  it("⚠️ a form whose preset approver can no longer be asked says so with its fix", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await createForm({ workspaceId: w.ws.id, ...leaveForm([w.lead.id, w.member2.id]) });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.orgId, userId: w.member2.id } }, data: { status: "SUSPENDED" } });
    await loginAs(w.admin.id);
    const o = rendered(await forms());
    expect(o.markup).toContain("data-form-problem");
    expect(o.markup).toContain(t("approvals.forms.problem"));
    expect(o.markup).toContain(t("approvals.forms.problem_fix"));
    const actor = await requireActor();
    expect((await listForms(w.ws.id)).status).toBe(200);
    expect(actor.role).toBe("ADMIN");
  });
});

describe("«الميزات»: switched off, no tab and no page", () => {
  it("off: the three pages are not found for everybody (the owner included), the tab is not on the map; on again, everything is back", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await flip("approvals", false)).status).toBe(200);
    const off = featuresOff((await db.organization.findUniqueOrThrow({ where: { id: w.orgId } })).settings);
    expect(off).toContain("approvals");
    for (const who of [w.owner, w.admin, w.member, w.lead]) {
      await loginAs(who.id);
      expect((await list(w)).kind, who.name).toBe("not-found");
      expect((await one(w.id)).kind, who.name).toBe("not-found");
      expect((await forms()).kind, who.name).toBe("not-found");
      const actor = await requireActor();
      const tabs = buildNav({ role: actor.role, caps: [...actor.caps], off }).places.flatMap((p) => p.tabs.map((x) => x.key));
      expect(tabs, who.name).not.toContain("approvals");
    }
    // a guest is told it is not for them, as always (the guest notice names nothing of the feature)
    await loginAs(w.guest.id);
    expect(rendered(await list(w)).markup).toContain(t("guest.no_access"));

    await loginAs(w.owner.id);
    expect((await flip("approvals", true)).status).toBe(200);
    await loginAs(w.member.id);
    rendered(await list(w));
    const actor = await requireActor();
    expect(buildNav({ role: actor.role, caps: [...actor.caps], off: [] }).places.flatMap((p) => p.tabs.map((x) => x.key))).toContain("approvals");
  });
});
