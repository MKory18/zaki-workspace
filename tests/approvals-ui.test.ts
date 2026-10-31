import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/approvals",
}));

import { ApproverPicker } from "@/components/approvals/approver-picker";
import { Chain } from "@/components/approvals/chain";
import { DetailBody } from "@/components/approvals/detail-view";
import { DecisionPanel } from "@/components/approvals/decision-panel";
import { FormBuilder, blankField, editorOf, schemaOf } from "@/components/approvals/form-builder";
import { FormFields, answersOf, draftOf } from "@/components/approvals/form-filler";
import { FormPicker } from "@/components/approvals/form-picker";
import { RequestCard } from "@/components/approvals/request-card";
import { RequestForm } from "@/components/approvals/request-form";
import { StatusBadge } from "@/components/approvals/status-badge";
import { ToastProvider } from "@/components/ui/toast";
import type { FormSchema } from "@/lib/approvals/forms";
import { validateSchema } from "@/lib/approvals/forms";
import type { ApprovalDetail, ListItem, StepView } from "@/lib/approvals/view";
import { buildNav, canOpenTab, offeredToGuests } from "@/lib/nav/places";
import { FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** The rules every screen keeps: theme tokens only, logical (RTL-safe) directions, no Latin word on screen. */
function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
  expect(textOf(markup)).not.toMatch(/[A-Za-z]{2,}/);
}

const item = (over: Partial<ListItem> = {}): ListItem => ({
  id: "r1",
  workspaceId: "w1",
  workspaceName: "مساحة المبيعات",
  title: "شراء جهاز",
  status: "PENDING",
  version: 1,
  currentStep: 1,
  requester: { id: "u1", name: "سارة" },
  amount: { minor: 25000, currency: "USD" },
  createdAt: "2031-03-20T09:00:00.000Z",
  updatedAt: "2031-03-20T09:00:00.000Z",
  decidedAt: null,
  steps: [
    { position: 1, approver: { id: "u2", name: "خالد" }, status: "APPROVED" },
    { position: 2, approver: { id: "u3", name: "ليلى" }, status: "PENDING" },
  ],
  waitingOn: { id: "u3", name: "ليلى" },
  fromForm: false,
  ...over,
});

const step = (position: number, status: string, over: Partial<StepView> = {}): StepView => ({
  id: `s${position}`,
  version: 1,
  position,
  approver: { id: `u${position + 1}`, name: ["", "خالد", "ليلى", "مازن"][position] ?? "" },
  status,
  reason: null,
  notifiedAt: null,
  decidedAt: null,
  ...over,
});

describe("the status badge", () => {
  it("says the state in Arabic with the theme's tone", () => {
    const cases: [string, string, string][] = [
      ["PENDING", "بانتظار القرار", "text-warn"],
      ["APPROVED", "تمت الموافقة", "text-ok"],
      ["REJECTED", "مرفوض", "text-danger"],
      ["CHANGES_REQUESTED", "مطلوب تعديل", "text-info"],
      ["CANCELLED", "ملغى", "text-fg-muted"],
    ];
    for (const [status, text, tone] of cases) {
      const markup = render(createElement(StatusBadge, { status }));
      expect(textOf(markup), status).toBe(text);
      expect(classTokens(markup), status).toContain(tone);
      expect(markup).toContain(`data-approval-status="${status}"`);
      expectClean(markup);
    }
    expect(textOf(render(createElement(StatusBadge, { status: "WHATEVER" })))).toBe(AR["enum.unknown"]);
  });
});

describe("the request card", () => {
  it("is one link to the request: title, who asked, the state, who it waits on, the chain at a glance, the amount in Arabic", () => {
    const markup = render(createElement("ul", null, createElement(RequestCard, { item: item() })));
    expect(markup).toContain('href="/approvals/r1"');
    expect(markup).toContain("data-approval-card=\"r1\"");
    const text = textOf(markup);
    expect(text).toContain("شراء جهاز");
    expect(text).toContain("من سارة");
    expect(text).toContain("20 آذار 2031");
    expect(text).toContain("250 دولار");
    expect(text).toContain("بانتظار ليلى");
    expect(text).toContain("خالد ← ليلى");
    expect(text).toContain("بانتظار القرار");
    expect(text).not.toContain("مساحة المبيعات"); // the space shows only where lists cross spaces
    expectClean(markup);
  });

  it("shows the space where lists cross spaces, the version after a resubmit, and no amount when the server gave none", () => {
    const markup = render(createElement("ul", null, createElement(RequestCard, { item: item({ amount: null, version: 3 }), showSpace: true })));
    const text = textOf(markup);
    expect(text).toContain("مساحة المبيعات");
    expect(text).toContain("النسخة 3");
    expect(text).not.toMatch(/دولار|250/);
    expect(markup).not.toContain("data-approval-amount");
  });

  it("a finished request waits on nobody", () => {
    const markup = render(createElement("ul", null, createElement(RequestCard, { item: item({ status: "APPROVED", waitingOn: null }) })));
    expect(textOf(markup)).not.toContain("بانتظار ليلى");
    expect(textOf(markup)).toContain("تمت الموافقة");
  });
});

describe("the chain", () => {
  it("lists the approvers in order with their state, their reason and the time; the one whose turn it is is marked; the next is not told yet", () => {
    const steps = [step(1, "APPROVED", { reason: "لا مانع", decidedAt: "2031-03-21T10:30:00.000Z" }), step(2, "PENDING"), step(3, "PENDING")];
    const markup = render(createElement(Chain, { steps, status: "PENDING", currentStep: 2 }));
    expect(markup).toContain("data-approval-chain");
    expect([...markup.matchAll(/data-step="(\d)"/g)].map((m) => m[1])).toEqual(["1", "2", "3"]);
    const text = textOf(markup);
    expect(text).toContain("خالد");
    expect(text).toContain("السبب: لا مانع");
    expect(text).toContain("21 آذار 2031");
    expect(text).toContain("دوره الآن");
    expect(text).toContain(AR["approvals.chain.sequential"]!);
    expect(markup.match(/دوره الآن/g)).toHaveLength(1);
    expect(markup).toMatch(/data-step="2" data-step-status="PENDING"/);
    expectClean(markup);
  });

  it("no «دوره الآن» once it is over, and no sequential note when nothing waits behind", () => {
    const markup = render(createElement(Chain, { steps: [step(1, "REJECTED", { reason: "الميزانية" }), step(2, "SKIPPED")], status: "REJECTED", currentStep: 1 }));
    const text = textOf(markup);
    expect(text).not.toContain("دوره الآن");
    expect(text).not.toContain(AR["approvals.chain.sequential"]!);
    expect(text).toContain("مرفوض");
    expect(text).toContain("لم يصل دوره");
  });
});

const detail = (over: Partial<ApprovalDetail> = {}): ApprovalDetail => ({
  ...item(),
  details: "سطر أول\nسطر ثانٍ",
  linkedTo: { kind: "TASK", id: "t1", href: "/tasks/t1" },
  attachments: [{ id: "a1", fileId: "f1", name: "عرض سعر", mimeType: "application/pdf", size: 2048, version: 1, url: "/api/files/f1/raw" }],
  stepsDetail: [step(1, "APPROVED"), step(2, "PENDING")],
  previous: [],
  form: null,
  formFill: null,
  you: { requester: false, approver: false, canDecide: false, canCancel: false, canResubmit: false, oversight: false },
  ...over,
});

describe("the request page (its pure face)", () => {
  it("shows the content, the amount with the ⚠️ + 🔧 note, the link, the file and the chain", () => {
    const markup = render(createElement(DetailBody, { detail: detail() }));
    const text = textOf(markup);
    expect(text).toContain("شراء جهاز");
    expect(text).toContain("من سارة");
    expect(text).toContain("250 دولار");
    expect(text).toContain("⚠️");
    expect(text).toContain("🔧");
    expect(markup).toContain("data-approval-money-note");
    expect(markup).toContain("whitespace-pre-wrap");
    expect(markup).toContain('href="/tasks/t1"');
    expect(markup).toContain('href="/api/files/f1/raw?download=1"');
    expect(text).toContain("عرض سعر");
    expect(markup).toContain("data-approval-chain");
    expectClean(markup);
  });

  it("an amount the server did not hand over is nowhere on the page (not the figure, not the note, not the currency)", () => {
    const markup = render(createElement(DetailBody, { detail: detail({ amount: null }) }));
    expect(markup).not.toContain("data-approval-amount");
    expect(markup).not.toContain("data-approval-money-note");
    expect(textOf(markup)).not.toMatch(/250|دولار|⚠️/);
  });

  it("an earlier version is kept in a collapsed block with its content and its chain; the owner reading is told it is only reading", () => {
    const markup = render(
      createElement(DetailBody, {
        detail: detail({
          version: 2,
          previous: [{ version: 1, title: "العنوان القديم", details: "تفاصيل قديمة", amountMinor: 30000, currency: "USD", answers: null, submittedAt: "2031-03-01T00:00:00.000Z", steps: [step(1, "CHANGES_REQUESTED", { reason: "أضف عرضًا" })], attachments: [] }],
          you: { requester: false, approver: false, canDecide: false, canCancel: false, canResubmit: false, oversight: true },
        }),
      }),
    );
    expect(markup).toContain("<details");
    expect(markup).toContain('data-revision="1"');
    const text = textOf(markup);
    expect(text).toContain("العنوان القديم");
    expect(text).toContain("تفاصيل قديمة");
    expect(text).toContain("300 دولار");
    expect(text).toContain("السبب: أضف عرضًا");
    expect(markup).toContain("data-approval-oversight");
    expect(text).toContain(AR["approvals.detail.oversight"]!);
  });

  it("a link to something that is gone says so, and a request made from a form names it", () => {
    const markup = render(createElement(DetailBody, { detail: detail({ linkedTo: { kind: "CARD", id: "c1", href: null }, form: { id: "x", name: "طلب شراء", version: 2 } }) }));
    const text = textOf(markup);
    expect(text).toContain(AR["approvals.detail.link_gone"]!);
    expect(text).toContain("من نموذج «طلب شراء»");
    expect(markup).not.toContain('href="/cards/c1"');
  });
});

describe("the decision panel", () => {
  it("offers approve, ask for changes and reject, with the reason box and the rule that two of them need it", () => {
    const markup = render(createElement(DecisionPanel, { send: async () => undefined }));
    const text = textOf(markup);
    expect(markup).toContain("data-decision-panel");
    for (const label of ["وافق", "اطلب تعديل", "ارفض", "قرارك"]) expect(text).toContain(label);
    expect(text).toContain("السبب (إلزامي مع الرفض وطلب التعديل)");
    expect(markup).toContain("<textarea");
    expect(classTokens(markup)).toContain("bg-danger");
    expectClean(markup);
  });
});

const schema: FormSchema = {
  approvers: ["u2"],
  fields: [
    { id: "f1", type: "choice", label: "نوع الإجازة", required: true, options: ["سنوية", "مرضية"] },
    { id: "f2", type: "date", label: "من تاريخ", required: true },
    { id: "f3", type: "number", label: "عدد الأيام", required: false, min: 1, max: 30 },
    { id: "f4", type: "textarea", label: "السبب", required: false },
    { id: "f5", type: "yesno", label: "سلّمت عملي", required: false },
    { id: "f6", type: "text", label: "رقم للتواصل", required: false },
  ],
};

describe("the form filler", () => {
  it("draws one labelled box per field, of the right kind, in order, with a mark on the required ones", () => {
    const markup = render(createElement(FormFields, { schema, draft: draftOf(schema), onDraft: () => {}, idPrefix: "t" }));
    expect([...markup.matchAll(/data-field="(f\d)"/g)].map((m) => m[1])).toEqual(["f1", "f2", "f3", "f4", "f5", "f6"]);
    expect(markup).toMatch(/data-field="f1" data-field-type="choice"[\s\S]*?<select/);
    expect(markup).toMatch(/data-field="f2" data-field-type="date"[\s\S]*?type="date"/);
    expect(markup).toMatch(/data-field="f3" data-field-type="number"[\s\S]*?inputMode="decimal"/);
    expect(markup).toMatch(/data-field="f4" data-field-type="textarea"[\s\S]*?<textarea/);
    expect(markup).toMatch(/data-field="f5" data-field-type="yesno"[\s\S]*?<select/);
    expect(markup).toMatch(/data-field="f6" data-field-type="text"[\s\S]*?type="text"/);
    const text = textOf(markup);
    for (const label of ["نوع الإجازة", "من تاريخ", "عدد الأيام", "السبب", "سلّمت عملي", "رقم للتواصل"]) expect(text).toContain(label);
    expect(text).toContain("سنوية");
    expect(text).toContain("مرضية");
    expect(text).toContain("نعم");
    expect(markup.match(/aria-label="إلزامي"/g)).toHaveLength(2);
    // the label of every box is tied to it
    for (const id of ["t-f1", "t-f2", "t-f3"]) expect(markup).toContain(`for="${id}"`);
    expectClean(markup);
  });

  it("starts from the answers a request already has, and shows a refusal under the box it is about", () => {
    const draft = draftOf(schema, { f1: "مرضية", f2: "2031-03-20", f3: 5, f4: "سطر", f5: false, f6: "07" });
    expect(draft).toEqual({ f1: "مرضية", f2: "2031-03-20", f3: "5", f4: "سطر", f5: "no", f6: "07" });
    const markup = render(createElement(FormFields, { schema, draft, onDraft: () => {}, idPrefix: "t", errors: { f3: "الرقم أكبر من الحد الأقصى المسموح." } }));
    expect(markup).toContain('value="2031-03-20"');
    expect(markup).toContain('value="5"');
    expect(markup).toContain("الرقم أكبر من الحد الأقصى المسموح.");
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('role="alert"');
  });

  it("turns the boxes into the route's answers: empty left out, numbers as numbers (Arabic digits read), yes/no as booleans", () => {
    expect(answersOf(schema, { f1: "سنوية", f2: "2031-03-20", f3: "٧٫٥", f4: "  ", f5: "yes", f6: "" })).toEqual({ f1: "سنوية", f2: "2031-03-20", f3: 7.5, f5: true });
    expect(answersOf(schema, { f1: "x", f2: "", f3: "abc", f4: "", f5: "no", f6: "" })).toEqual({ f1: "x", f3: "abc", f5: false });
  });
});

describe("the form builder", () => {
  it("turns the editor's boxes into a schema the validator accepts, with only the properties of each type", () => {
    const fields = schema.fields.map(editorOf);
    const out = schemaOf(fields, ["u2", "u3"]);
    expect(validateSchema(out)).toMatchObject({ ok: true });
    const raw = out as { fields: Record<string, unknown>[] };
    expect(Object.keys(raw.fields[0]!).sort()).toEqual(["id", "label", "options", "required", "type"]);
    expect(Object.keys(raw.fields[2]!).sort()).toEqual(["id", "label", "max", "min", "required", "type"]);
    expect(Object.keys(raw.fields[5]!).sort()).toEqual(["id", "label", "required", "type"]);
    // a field changed to another type loses the properties of the old one
    const changed = [{ ...fields[0]!, type: "text" as const }];
    expect(Object.keys((schemaOf(changed, ["u2"]) as { fields: Record<string, unknown>[] }).fields[0]!).sort()).toEqual(["id", "label", "required", "type"]);
    // options one per line, blanks dropped; an unreadable bound is sent as typed so the server refuses it
    expect((schemaOf([{ ...fields[0]!, optionsText: " أ \n\n ب " }], ["u2"]) as { fields: { options: string[] }[] }).fields[0]!.options).toEqual(["أ", "ب"]);
    expect((schemaOf([{ ...fields[2]!, min: "ten" }], ["u2"]) as { fields: { min: unknown }[] }).fields[0]!.min).toBe("ten");
    expect(blankField([{ id: "f1" }, { id: "f2" }]).id).toBe("f3");
  });

  it("draws the editor: name, description, a row per field with its type menu (the six types, in Arabic), the chain picker and the save button", () => {
    const people = [{ id: "u2", name: "خالد", role: "LEAD" }];
    const markup = render(createElement(FormBuilder, { workspaceId: "w1", people }));
    const text = textOf(markup);
    expect(markup).toContain("data-form-builder");
    for (const label of ["اسم النموذج", "الحقول", "أضف حقلًا", "سلسلة المعتمدين", "أنشئ النموذج", "نص قصير", "نص طويل", "رقم", "تاريخ", "اختيار واحد", "نعم / لا"]) expect(text).toContain(label);
    expect(text).not.toContain("ملف"); // no file field type
    expectClean(markup);
    const editing = render(createElement(FormBuilder, { workspaceId: "w1", people, initial: { familyId: "x", version: 2, name: "طلب إجازة", description: null, schema } }));
    expect(textOf(editing)).toContain("احفظ كنسخة جديدة");
    expect(textOf(editing)).toContain("الحفظ بيعمل النسخة 3");
    expect(editing).toContain('value="طلب إجازة"');
  });
});

describe("the new-request form and the chain picker", () => {
  const people = [
    { id: "u2", name: "خالد", role: "LEAD" },
    { id: "u3", name: "ليلى", role: "OWNER" },
  ];
  it("asks for title, details, an optional amount with its currency, the approvers in order, files and (when given) the link", () => {
    const markup = render(createElement(ToastProvider, null, createElement(RequestForm, { workspaceId: "w1", people, mode: "create", link: { kind: "TASK", id: "t1" } })));
    const text = textOf(markup);
    for (const label of ["عنوان الطلب", "التفاصيل", "المبلغ (اختياري)", "العملة", "المعتمدون", "مرفقات (اختياري)", "أرسل الطلب", "اربط الطلب بالعنصر الذي فتحته منه (المهمة)"]) expect(text).toContain(label);
    expect(markup).toContain('data-request-form="create"');
    expect(markup).toContain("data-request-link");
    // the currencies are the picker's, in Arabic, never as codes
    for (const name of ["دولار", "دينار", "يورو"]) expect(text).toContain(name);
    expect(text).not.toMatch(/\b(USD|JOD|EUR)\b/);
    expect(markup).toContain("<textarea");
    expect(markup).toContain('dir="ltr"'); // the amount is read left to right
    expect(markup).not.toContain("data-approval-money-note"); // until an amount is typed
    expectClean(markup);
  });

  it("the resubmit form is the same form with its own button; the picker shows the chain in order, marks each with its rank, and the limit", () => {
    const markup = render(createElement(RequestForm, { workspaceId: "w1", people, mode: "resubmit", requestId: "r1", initial: { title: "شراء", details: "", amount: "12.5", currency: "JOD", approverIds: ["u3", "u2"], files: [{ id: "f", name: "ملف", size: 10 }] } }));
    expect(markup).toContain('data-request-form="resubmit"');
    expect(textOf(markup)).toContain("أعد الإرسال");
    expect([...markup.matchAll(/data-approver="(u\d)"/g)].map((m) => m[1])).toEqual(["u3", "u2"]);
    expect(textOf(markup)).toContain("ليلى مالك");
    expect(textOf(markup)).toContain("خالد قائد فريق");
    expect(textOf(markup)).toContain("ملف");
    const full = render(createElement(ApproverPicker, { people: [...people, { id: "u4", name: "مازن", role: "MEMBER" }, { id: "u5", name: "رنا", role: "MEMBER" }], value: ["u2", "u3", "u4"], onChange: () => {}, idPrefix: "p" }));
    expect(textOf(full)).toContain(AR["approvals.picker.full"]!);
    expect(full).not.toContain("<select");
    const empty = render(createElement(ApproverPicker, { people, value: [], onChange: () => {}, idPrefix: "p" }));
    expect(textOf(empty)).toContain(AR["approvals.picker.none"]!);
    expect(empty).toContain("<select");
  });

  it("the form picker links to each form's filler", () => {
    const markup = render(createElement(FormPicker, { forms: [{ id: "fam1", name: "طلب شراء", description: "للمشتريات" }] }));
    expect(markup).toContain('href="/approvals?fill=fam1"');
    expect(textOf(markup)).toContain("طلب شراء");
    expect(textOf(markup)).toContain("للمشتريات");
  });
});

describe("the tab and the switch", () => {
  const caps = (role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER") => [...effectiveCapabilities({ role })];
  const tabsOf = (subject: Parameters<typeof buildNav>[0]) => buildNav(subject).places.find((p) => p.key === "work")?.tabs.map((t) => t.key) ?? [];

  it("«الموافقات» is one tab of «الشغل», for every staff rank and never for a guest", () => {
    for (const role of ["OWNER", "ADMIN", "LEAD", "MEMBER"] as const) {
      expect(tabsOf({ role, caps: caps(role) }), role).toContain("approvals");
      expect(canOpenTab({ role, caps: caps(role) }, "approvals"), role).toBe(true);
    }
    expect(tabsOf({ role: "GUEST", caps: [] })).not.toContain("approvals");
    expect(offeredToGuests("approvals")).toBe(false);
    const tab = buildNav({ role: "MEMBER", caps: caps("MEMBER") }).places.find((p) => p.key === "work")!.tabs.find((t) => t.key === "approvals")!;
    expect(tab).toEqual({ key: "approvals", href: "/approvals", labelKey: "nav.approvals" });
    expect(AR["nav.approvals"]).toBe("الموافقات");
    // no other place got a tab
    expect(buildNav({ role: "OWNER", caps: caps("OWNER") }).places.filter((p) => p.tabs.some((t) => t.key === "approvals")).map((p) => p.key)).toEqual(["work"]);
  });

  it("switched off, the tab is gone for everybody and nothing else on the map moves", () => {
    for (const role of ["OWNER", "ADMIN", "LEAD", "MEMBER"] as const) {
      const on = tabsOf({ role, caps: caps(role) });
      const off = tabsOf({ role, caps: caps(role), off: ["approvals"] });
      expect(off, role).not.toContain("approvals");
      expect(off, role).toEqual(on.filter((k) => k !== "approvals"));
      expect(canOpenTab({ role, caps: caps(role), off: ["approvals"] }, "approvals"), role).toBe(false);
    }
  });

  it("the switch exists, is on by default, and has its name and hint in Arabic", () => {
    expect(FEATURES).toContain("approvals");
    expect(FEATURE_DEFAULTS.approvals).toBe(true);
    expect(AR["features.approvals.name"]).toBe("طلبات الموافقة والنماذج");
    expect(AR["features.approvals.hint"]).toMatch(/قرار مسجّل بس/);
  });
});

describe("the pages and the routes ask the switch and the gate", () => {
  const routes = [
    "src/app/api/approvals/route.ts",
    "src/app/api/approvals/approvers/route.ts",
    "src/app/api/approvals/[id]/route.ts",
    "src/app/api/approvals/[id]/decide/route.ts",
    "src/app/api/approvals/[id]/cancel/route.ts",
    "src/app/api/approvals/[id]/resubmit/route.ts",
    "src/app/api/approval-forms/route.ts",
    "src/app/api/approval-forms/[id]/route.ts",
    "src/app/api/approval-forms/[id]/submit/route.ts",
    "src/app/api/approval-forms/[id]/archive/route.ts",
  ];
  it("every route is wrapped in withApprovalsApi and reaches the switch through the service or the gate (the first line is the person, never the body)", () => {
    for (const file of routes) {
      const src = read(file);
      expect(src, file).toContain("withApprovalsApi");
      expect(src, file).toContain("requireActor()");
      // the cookie is never what decides: no role is read from the request
      expect(src, file).not.toMatch(/role\s*[:=]\s*(?:body|req)/);
    }
  });

  it("the pages refuse a guest with the notice and are «not found» while the switch is off", () => {
    for (const file of ["src/app/(app)/approvals/page.tsx", "src/app/(app)/approvals/[id]/page.tsx", "src/app/(app)/approvals/forms/page.tsx"]) {
      const src = read(file);
      expect(src, file).toContain('refusedToGuest(actor, "approvals")');
      expect(src, file).toContain("approvalsOn(actor.orgId)");
      expect(src, file).toContain("notFound()");
      expect(src, file).toContain("pageActor()");
    }
  });

  it("no screen of the feature draws a raw status or a palette colour, and none computes money with a float", () => {
    for (const file of ["status-badge", "chain", "request-card", "detail-view", "decision-panel", "form-filler", "form-builder", "request-form", "approver-picker", "attachments", "form-picker", "fill-bridge"]) {
      const src = read(`src/components/approvals/${file}.tsx`);
      expect(src, file).not.toMatch(/\b(?:bg|text|border|ring)-(?:red|green|blue|yellow|amber|gray|slate|zinc|emerald|rose)-\d/);
      expect(src, file).not.toMatch(/\/\s*100\b/); // minor units are never divided
      expect(src, file).not.toMatch(/parseFloat|toFixed/);
    }
  });

  it("the approval never moves money: no approvals source calls a payment, a transfer or a wallet", () => {
    for (const file of ["src/server/services/approvals.ts", "src/server/services/approval-forms.ts", "src/server/services/approval-access.ts", "src/server/services/approval-notify.ts"]) {
      expect(read(file), file).not.toMatch(/wallet|payout|transfer\(|settle|telegram/i);
    }
  });
});
