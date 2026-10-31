import { describe, expect, it } from "vitest";
import { AR } from "@/lib/i18n/dict";
import {
  APPROVAL_LIMITS,
  APPROVAL_STATUSES,
  DECISIONS,
  STEP_STATUSES,
  amountText,
  chainProblem,
  decisionText,
  isDecision,
  isFinal,
  isOpen,
  outcomeOf,
  reasonProblem,
  readHistory,
  statusText,
  statusTone,
  tidyReason,
  viewOf,
} from "@/lib/approvals/shared";
import { FIELD_TYPES, FORM_LIMITS, answerText, blankSchema, isCalendarDay, nextFieldId, renderAnswers, renderedProblem, validateAnswers, validateSchema, type FormSchema } from "@/lib/approvals/forms";
import { amountOf, createBodySchema, decideBodySchema, resubmitBodySchema } from "@/server/services/approval-input";

/** The pure rules of «الموافقات» and «النماذج»: no database, no network. */

describe("the chain", () => {
  it("one to three approvers, each once, never the requester", () => {
    expect(chainProblem(["a"], "me")).toBeNull();
    expect(chainProblem(["a", "b", "c"], "me")).toBeNull();
    expect(chainProblem([], "me")).toBe("approvals.e.chain_empty");
    expect(chainProblem(["a", "b", "c", "d"], "me")).toBe("approvals.e.chain_long");
    expect(chainProblem(["a", "a"], "me")).toBe("approvals.e.chain_duplicate");
    expect(chainProblem(["a", "me"], "me")).toBe("approvals.e.own_request");
    expect(chainProblem([""], "me")).toBe("approvals.e.chain_invalid");
    expect(chainProblem([1 as unknown as string], "me")).toBe("approvals.e.chain_invalid");
    expect(chainProblem("a" as unknown as string[], "me")).toBe("approvals.e.chain_empty");
    expect(APPROVAL_LIMITS.approvers).toBe(3);
  });
});

describe("what a decision does to the chain", () => {
  it("an approval hands over to the next approver, and finishes the request at the last one", () => {
    expect(outcomeOf("APPROVE", 1, 3)).toEqual({ step: "APPROVED", request: "PENDING", next: 2, skipAfter: null });
    expect(outcomeOf("APPROVE", 2, 3)).toEqual({ step: "APPROVED", request: "PENDING", next: 3, skipAfter: null });
    expect(outcomeOf("APPROVE", 3, 3)).toEqual({ step: "APPROVED", request: "APPROVED", next: null, skipAfter: null });
    expect(outcomeOf("APPROVE", 1, 1)).toEqual({ step: "APPROVED", request: "APPROVED", next: null, skipAfter: null });
  });

  it("a rejection ends it at that step; «اطلب تعديل» sends it back; both skip the steps never reached", () => {
    expect(outcomeOf("REJECT", 2, 3)).toEqual({ step: "REJECTED", request: "REJECTED", next: null, skipAfter: 2 });
    expect(outcomeOf("CHANGES", 1, 2)).toEqual({ step: "CHANGES_REQUESTED", request: "CHANGES_REQUESTED", next: null, skipAfter: 1 });
  });

  it("the written reason: needed to reject and to ask for changes, optional on an approval, at most 1000 characters, white space tidied", () => {
    expect(reasonProblem("REJECT", "")).toBe("approvals.e.reason_required");
    expect(reasonProblem("REJECT", "   \n ")).toBe("approvals.e.reason_required");
    expect(reasonProblem("REJECT", null)).toBe("approvals.e.reason_required");
    expect(reasonProblem("CHANGES", " ")).toBe("approvals.e.changes_required");
    expect(reasonProblem("REJECT", "سبب")).toBeNull();
    expect(reasonProblem("APPROVE", undefined)).toBeNull();
    expect(reasonProblem("APPROVE", "x".repeat(1001))).toBe("approvals.e.reason_long");
    expect(reasonProblem("REJECT", "x".repeat(1001))).toBe("approvals.e.reason_long");
    expect(reasonProblem("REJECT", "x".repeat(1000))).toBeNull();
    expect(tidyReason("  لا   مانع \n هنا ")).toBe("لا مانع هنا");
  });

  it("the states and decisions are the closed lists; open and final partition the request states", () => {
    expect([...APPROVAL_STATUSES]).toEqual(["PENDING", "APPROVED", "REJECTED", "CANCELLED", "CHANGES_REQUESTED"]);
    expect([...STEP_STATUSES]).toEqual(["PENDING", "APPROVED", "REJECTED", "CHANGES_REQUESTED", "SKIPPED"]);
    expect([...DECISIONS]).toEqual(["APPROVE", "REJECT", "CHANGES"]);
    expect(isDecision("APPROVE")).toBe(true);
    expect(isDecision("DELETE")).toBe(false);
    expect(APPROVAL_STATUSES.filter(isOpen)).toEqual(["PENDING"]);
    expect(APPROVAL_STATUSES.filter(isFinal)).toEqual(["APPROVED", "REJECTED", "CANCELLED"]);
  });

  it("every state and decision has an Arabic name and a theme tone; an unknown one is never printed raw", () => {
    for (const s of [...APPROVAL_STATUSES, "SKIPPED"]) {
      expect(statusText(s), s).toMatch(/[؀-ۿ]/);
      expect(["warn", "ok", "danger", "info", "muted"]).toContain(statusTone(s));
    }
    for (const d of DECISIONS) expect(decisionText(d), d).toMatch(/[؀-ۿ]/);
    expect(statusText("WHATEVER")).toBe(AR["enum.unknown"]);
    expect(statusText(null)).toBe("—");
    expect(statusTone("PENDING")).toBe("warn");
    expect(statusTone("APPROVED")).toBe("ok");
    expect(statusTone("REJECTED")).toBe("danger");
    expect(statusTone("CHANGES_REQUESTED")).toBe("info");
  });

  it("the amount is shown with the one formatter (Western digits, Arabic currency), and not at all when there is none", () => {
    expect(amountText(1250, "JOD")).toBe("12.50 دينار");
    expect(amountText(15000, "USD")).toBe("150 دولار");
    expect(amountText(null, null)).toBe("");
    expect(amountText(0.5, "USD")).toBe("");
  });

  it("the stored history is read defensively; the views fall back to «طلباتي»", () => {
    expect(readHistory(null)).toEqual([]);
    expect(readHistory("x")).toEqual([]);
    expect(readHistory([{ nope: 1 }, null, 4, { version: 1, title: "أ", details: "ب", amountMinor: 5, currency: "USD", submittedAt: "2031-01-01T00:00:00.000Z" }])).toEqual([
      { version: 1, title: "أ", details: "ب", amountMinor: 5, currency: "USD", answers: null, submittedAt: "2031-01-01T00:00:00.000Z" },
    ]);
    expect(viewOf("waiting")).toBe("waiting");
    expect(viewOf("all")).toBe("all");
    expect(viewOf("bogus")).toBe("mine");
    expect(viewOf(undefined)).toBe("mine");
  });
});

describe("the request body", () => {
  it("a typed amount becomes integer minor units with integer arithmetic only; nothing typed is «no amount»; a bad one is refused with its key", () => {
    expect(amountOf({ amount: "12.5", currency: "JOD" })).toEqual({ present: true, amountMinor: 1250, currency: "JOD" });
    expect(amountOf({ amount: "٣٠٠", currency: "USD" })).toEqual({ present: true, amountMinor: 30000, currency: "USD" });
    expect(amountOf({ amount: 0.05 as unknown as string, currency: "USD" }).amountMinor).toBe(5);
    expect(amountOf({ amountMinor: 777, currency: "EUR" })).toEqual({ present: true, amountMinor: 777, currency: "EUR" });
    expect(amountOf({})).toEqual({ present: false, amountMinor: null, currency: null });
    expect(amountOf({ amount: null, currency: null })).toEqual({ present: true, amountMinor: null, currency: null });
    expect(amountOf({ amount: "   ", currency: "USD" })).toEqual({ present: true, amountMinor: null, currency: "USD" });
    for (const bad of ["abc", "1.234", "-3", "1e3"]) expect(() => amountOf({ amount: bad, currency: "USD" }), bad).toThrow();
    try {
      amountOf({ amount: "abc" });
    } catch (err) {
      expect((err as { issues: { message: string }[] }).issues[0]!.message).toBe("approvals.e.amount_invalid");
    }
  });

  it("the bodies are strict: an unknown key is refused, a decision must be one of the three", () => {
    const ok = { workspaceId: "w", title: "t", approverIds: ["a"] };
    expect(createBodySchema.safeParse(ok).success).toBe(true);
    expect(createBodySchema.safeParse({ ...ok, requesterId: "someone-else" }).success).toBe(false);
    expect(createBodySchema.safeParse({ ...ok, status: "APPROVED" }).success).toBe(false);
    expect(createBodySchema.safeParse({ ...ok, link: { kind: "TASK", id: "x" } }).success).toBe(true);
    expect(createBodySchema.safeParse({ ...ok, link: { kind: "FILE", id: "x" } }).success).toBe(false);
    expect(resubmitBodySchema.safeParse({ version: 9 }).success).toBe(false);
    expect(decideBodySchema.safeParse({ decision: "APPROVE" }).success).toBe(true);
    expect(decideBodySchema.safeParse({ decision: "DELETE" }).success).toBe(false);
    expect(decideBodySchema.safeParse({ decision: "APPROVE", stepId: "x" }).success).toBe(false);
  });
});

describe("the form template validator", () => {
  const field = (over: Record<string, unknown> = {}) => ({ id: "f1", type: "text", label: "الاسم", required: true, ...over });
  const schema = (fields: unknown[], approvers: unknown = ["a"]) => ({ fields, approvers });
  const issues = (raw: unknown) => {
    const r = validateSchema(raw);
    if (r.ok) throw new Error("expected a refusal");
    return r.issues;
  };

  it("accepts the six types, trims labels and options, and defaults «required» to false", () => {
    const r = validateSchema(
      schema(
        [
          field({ id: "name", label: "  الاسم   الكامل " }),
          { id: "bio", type: "textarea", label: "نبذة" },
          { id: "age", type: "number", label: "العمر", min: 0, max: 120 },
          { id: "day", type: "date", label: "التاريخ", required: false },
          { id: "kind", type: "choice", label: "النوع", options: [" أ ", "ب"] },
          { id: "ok", type: "yesno", label: "موافق" },
        ],
        ["a", "b"],
      ),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fields.map((f) => f.type)).toEqual(["text", "textarea", "number", "date", "choice", "yesno"]);
    expect(r.value.fields[0]!.label).toBe("الاسم الكامل");
    expect(r.value.fields[1]!.required).toBe(false);
    expect(r.value.fields[2]).toMatchObject({ min: 0, max: 120 });
    expect(r.value.fields[4]!.options).toEqual(["أ", "ب"]);
    expect(r.value.approvers).toEqual(["a", "b"]);
    expect([...FIELD_TYPES]).toEqual(["text", "textarea", "number", "date", "choice", "yesno"]);
  });

  it("at most twenty fields and twenty options; at least one field, two options and one approver, at most three", () => {
    expect(validateSchema(schema(Array.from({ length: 20 }, (_, i) => field({ id: `f${i + 1}` })))).ok).toBe(true);
    expect(issues(schema(Array.from({ length: 21 }, (_, i) => field({ id: `f${i + 1}` })))).map((i) => i.message)).toEqual(["approvals.f.fields_long"]);
    expect(issues(schema([])).map((i) => i.message)).toEqual(["approvals.f.fields_empty"]);
    expect(validateSchema(schema([field({ type: "choice", options: Array.from({ length: 20 }, (_, i) => `خيار ${i}`) })])).ok).toBe(true);
    expect(issues(schema([field({ type: "choice", options: Array.from({ length: 21 }, (_, i) => `خيار ${i}`) })])).map((i) => i.message)).toEqual(["approvals.f.options_long"]);
    expect(issues(schema([field({ type: "choice", options: ["أ"] })])).map((i) => i.message)).toEqual(["approvals.f.options_few"]);
    expect(issues(schema([field()], [])).map((i) => i.message)).toEqual(["approvals.e.chain_empty"]);
    expect(issues(schema([field()], ["a", "b", "c", "d"])).map((i) => i.message)).toEqual(["approvals.e.chain_long"]);
    expect(issues(schema([field()], ["a", "a"])).map((i) => i.message)).toEqual(["approvals.e.chain_duplicate"]);
    expect(issues(schema([field()], [1])).map((i) => i.message)).toEqual(["approvals.e.chain_invalid"]);
  });

  it("refuses anything that is not a field of its type: no script, no formula, no default, no file, no property of another type", () => {
    for (const extra of ["script", "formula", "default", "onChange", "accept", "pattern", "visibleIf"]) {
      const found = issues(schema([field({ [extra]: "x" })]));
      expect(found[0], extra).toEqual({ path: `fields.0.${extra}`, message: "approvals.f.unknown_property" });
    }
    expect(issues(schema([field({ type: "file" })]))[0]).toEqual({ path: "fields.0.type", message: "approvals.f.type_invalid" });
    expect(issues(schema([field({ type: "script" })]))[0]!.message).toBe("approvals.f.type_invalid");
    expect(issues(schema([field({ options: ["أ", "ب"] })]))[0]).toEqual({ path: "fields.0.options", message: "approvals.f.unknown_property" });
    expect(issues(schema([field({ type: "date", min: 1 })]))[0]!.message).toBe("approvals.f.unknown_property");
    expect(issues({ fields: [field()], approvers: ["a"], onSubmit: "x" })).toEqual([{ path: "onSubmit", message: "approvals.f.unknown_property" }]);
    for (const junk of [null, 5, "x", [], undefined]) expect(issues(junk).map((i) => i.message)).toEqual(["approvals.f.schema_invalid"]);
    expect(issues(schema(["nope"]))[0]!.message).toBe("approvals.f.field_invalid");
  });

  it("checks ids (unique, plain), labels, options and number bounds, naming the field", () => {
    expect(issues(schema([field({ id: "A" })]))[0]).toEqual({ path: "fields.0.id", message: "approvals.f.id_invalid" });
    expect(issues(schema([field({ id: "1x" })]))[0]!.message).toBe("approvals.f.id_invalid");
    expect(issues(schema([field({ id: "a".repeat(25) })]))[0]!.message).toBe("approvals.f.id_invalid");
    expect(issues(schema([field(), field()]))[0]).toEqual({ path: "fields.1.id", message: "approvals.f.id_duplicate" });
    expect(issues(schema([field({ label: "  " })]))[0]!.message).toBe("approvals.f.label_required");
    expect(issues(schema([field({ label: "ع".repeat(81) })]))[0]!.message).toBe("approvals.f.label_long");
    expect(issues(schema([field({ required: "yes" })]))[0]!.message).toBe("approvals.f.required_invalid");
    expect(issues(schema([field({ type: "choice", options: ["أ", " أ "] })]))[0]!.message).toBe("approvals.f.options_duplicate");
    expect(issues(schema([field({ type: "choice", options: ["أ", "ع".repeat(81)] })]))[0]!.message).toBe("approvals.f.option_invalid");
    expect(issues(schema([field({ type: "choice", options: "أ,ب" })]))[0]!.message).toBe("approvals.f.options_invalid");
    expect(issues(schema([field({ type: "number", min: 5, max: 1 })]))[0]!.message).toBe("approvals.f.bound_order");
    expect(issues(schema([field({ type: "number", max: Number.NaN })]))[0]!.message).toBe("approvals.f.bound_invalid");
    expect(issues(schema([field({ type: "number", min: "1" })]))[0]!.message).toBe("approvals.f.bound_invalid");
    expect(validateSchema(schema([field({ type: "number", min: 5, max: 5 })])).ok).toBe(true);
    // two problems in two fields are both reported
    expect(issues(schema([field({ label: "" }), field({ id: "f2", type: "choice", options: ["أ"] })])).map((i) => i.path)).toEqual(["fields.0.label", "fields.1.options"]);
  });

  it("the blank schema is one short-text field and no approver (the editor's start); field ids are f1, f2… and never reused", () => {
    expect(blankSchema().fields).toHaveLength(1);
    expect(blankSchema().approvers).toEqual([]);
    expect(nextFieldId([])).toBe("f1");
    expect(nextFieldId([{ id: "f1" }, { id: "f2" }])).toBe("f3");
    expect(nextFieldId([{ id: "f1" }, { id: "f3" }])).toBe("f2");
  });
});

describe("the answers are checked per field type", () => {
  const s: FormSchema = {
    approvers: ["a"],
    fields: [
      { id: "t", type: "text", label: "الاسم", required: true },
      { id: "l", type: "textarea", label: "الشرح", required: false },
      { id: "n", type: "number", label: "العدد", required: false, min: 1, max: 10 },
      { id: "d", type: "date", label: "اليوم", required: false },
      { id: "c", type: "choice", label: "اللون", required: false, options: ["أحمر", "أخضر"] },
      { id: "y", type: "yesno", label: "موافق", required: false },
    ],
  };
  const bad = (answers: unknown) => {
    const r = validateAnswers(s, answers);
    if (r.ok) throw new Error("expected a refusal");
    return r.issues;
  };

  it("keeps the checked answers, tidied; an empty optional answer is simply absent", () => {
    const r = validateAnswers(s, { t: "  أحمد   علي ", l: "سطر 1\r\nسطر 2 ", n: 3, d: "2031-03-20", c: "أحمر", y: false });
    expect(r).toEqual({ ok: true, value: { t: "أحمد علي", l: "سطر 1\nسطر 2", n: 3, d: "2031-03-20", c: "أحمر", y: false } });
    expect(validateAnswers(s, { t: "x", l: "  ", n: null, d: "", c: "   " })).toEqual({ ok: true, value: { t: "x" } });
  });

  it("text: required, at most 200 (short) or 1000 (long), a string only", () => {
    expect(bad({})).toEqual([{ path: "t", message: "approvals.f.answer_required" }]);
    expect(bad({ t: "   " })[0]!.message).toBe("approvals.f.answer_required");
    expect(bad({ t: "x".repeat(201) })).toEqual([{ path: "t", message: "approvals.f.answer_long" }]);
    expect(validateAnswers(s, { t: "x".repeat(200), l: "y".repeat(1000) }).ok).toBe(true);
    expect(bad({ t: "x", l: "y".repeat(1001) })).toEqual([{ path: "l", message: "approvals.f.answer_long" }]);
    expect(bad({ t: 5 })[0]!.message).toBe("approvals.f.answer_type");
    expect(bad({ t: "x", l: true })[0]!.message).toBe("approvals.f.answer_type");
  });

  it("number: a finite number only, inside its bounds (and the global bound)", () => {
    expect(bad({ t: "x", n: "5" })[0]!.message).toBe("approvals.f.answer_type");
    expect(bad({ t: "x", n: Number.NaN })[0]!.message).toBe("approvals.f.answer_type");
    expect(bad({ t: "x", n: Number.POSITIVE_INFINITY })[0]!.message).toBe("approvals.f.answer_type");
    expect(bad({ t: "x", n: 0 })[0]!.message).toBe("approvals.f.number_low");
    expect(bad({ t: "x", n: 11 })[0]!.message).toBe("approvals.f.number_high");
    for (const n of [1, 10, 2.5]) expect(validateAnswers(s, { t: "x", n }).ok, String(n)).toBe(true);
    const free: FormSchema = { approvers: ["a"], fields: [{ id: "n", type: "number", label: "n", required: true }] };
    const r = validateAnswers(free, { n: FORM_LIMITS.numberAbs * 2 });
    expect(r.ok).toBe(false);
    expect(validateAnswers(free, { n: -5 }).ok).toBe(true);
    expect(validateAnswers(free, { n: 0 }).ok).toBe(true); // zero is an answer, not an empty box
  });

  it("date: a real calendar day written YYYY-MM-DD", () => {
    for (const d of ["2031-02-31", "2031-13-01", "2031-1-1", "20/03/2031", "2031-03-20T10:00", "tomorrow", 20310320]) expect(bad({ t: "x", d })[0]!.message, String(d)).toBe("approvals.f.date_invalid");
    expect(validateAnswers(s, { t: "x", d: "2032-02-29" }).ok).toBe(true); // a leap year
    expect(isCalendarDay("2031-02-29")).toBe(false);
    expect(isCalendarDay("2000-02-29")).toBe(true);
    expect(isCalendarDay("1900-02-29")).toBe(false);
  });

  it("choice: one of the options, as written; yes/no: a boolean only", () => {
    expect(bad({ t: "x", c: "أزرق" })[0]!.message).toBe("approvals.f.choice_invalid");
    expect(bad({ t: "x", c: 1 })[0]!.message).toBe("approvals.f.choice_invalid");
    expect(validateAnswers(s, { t: "x", c: " أخضر " })).toMatchObject({ ok: true, value: { c: "أخضر" } });
    for (const y of ["yes", 1, "true", 0]) expect(bad({ t: "x", y })[0]!.message, String(y)).toBe("approvals.f.answer_type");
    expect(validateAnswers(s, { t: "x", y: true }).ok).toBe(true);
  });

  it("an answer for a field the form does not have, or answers that are not an object, are refused", () => {
    expect(bad({ t: "x", ghost: 1 })).toEqual([{ path: "ghost", message: "approvals.f.unknown_field" }]);
    for (const junk of [null, "x", 5, [], undefined]) expect(bad(junk)).toEqual([{ path: "answers", message: "approvals.f.answers_invalid" }]);
    // every problem is reported, field by field
    expect(bad({ n: 99, d: "nope" }).map((i) => i.path)).toEqual(["t", "n", "d"]);
  });

  it("writes the answers as labelled lines in the form's order: «نعم»/«لا», a day in Arabic, a long text under its label, and a gap says so", () => {
    const lines = renderAnswers(s, { t: "أحمد", l: "أ\nب", n: 3, d: "2031-03-20", c: "أحمر", y: true });
    expect(lines).toBe(["الاسم: أحمد", "الشرح:\nأ\nب", "العدد: 3", "اليوم: 20 آذار 2031", "اللون: أحمر", "موافق: نعم"].join("\n"));
    expect(renderAnswers(s, { t: "أحمد", y: false })).toBe(["الاسم: أحمد", "الشرح: لم تُملأ", "العدد: لم تُملأ", "اليوم: لم تُملأ", "اللون: لم تُملأ", "موافق: لا"].join("\n"));
    expect(answerText(s.fields[3]!, "2031-12-01")).toBe("1 كانون الأول 2031");
    expect(answerText(s.fields[0]!, undefined)).toBe("—");
    // the details are bounded like any request's
    expect(renderedProblem("x".repeat(4000))).toBeNull();
    expect(renderedProblem("x".repeat(4001))).toBe("approvals.f.details_long");
  });
});

describe("the dictionary", () => {
  it("every key the validators and the services can answer with has an Arabic sentence", () => {
    const keys = new Set<string>();
    for (const l of [chainProblem([], "x"), chainProblem(["a", "a"], "x"), chainProblem(["x"], "x"), chainProblem(["a", "b", "c", "d"], "x"), chainProblem([""], "x"), reasonProblem("REJECT", ""), reasonProblem("CHANGES", ""), reasonProblem("APPROVE", "x".repeat(1001))]) if (l) keys.add(l);
    for (const raw of [null, { fields: [], approvers: [] }, { fields: [{ id: "A", type: "file", label: "" }], approvers: [1], z: 1 }]) {
      const r = validateSchema(raw);
      if (!r.ok) for (const i of r.issues) keys.add(i.message);
    }
    expect(keys.size).toBeGreaterThan(8);
    for (const key of keys) expect(AR[key], key).toMatch(/[؀-ۿ]/);
  });
});
