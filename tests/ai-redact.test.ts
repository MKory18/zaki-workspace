import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_NAME_MARKER,
  ContextLeakError,
  MASK_MARKER,
  MAX_TASKS,
  MAX_TITLES,
  buildContext,
  capText,
  describeSent,
  maskKnownNames,
  normalizeDigits,
  redactText,
  redactTitle,
  refsInText,
  restoreRefs,
  verifyContext,
  type AssistantContext,
  type RawScope,
  type RawTask,
} from "@/server/ai/redact";
import { composeUserMessage, SYSTEM_PROMPT } from "@/server/ai/prompt";

/**
 * «مساعد المالك» — the privacy filter, pure. What may reach a model is decided by `redactText` (free text) and `buildContext`
 * (everything else); `verifyContext` is the last door and refuses on anything outside its list.
 */

// ───────────────────────────────────────── redactText ─────────────────────────────────────────

describe("redactText: what has a shape is masked", () => {
  const masked = (text: string) => redactText(text);

  it("phone numbers: any run of 7+ digits, with + - spaces . and brackets between them", () => {
    for (const phone of ["0791234567", "+962 79 123 4567", "00962-79-123-4567", "(079) 123.4567", "٠٧٩١٢٣٤٥٦٧", "۰۷۹۱۲۳۴۵۶۷", "+٩٦٢ ٧٩ ١٢٣ ٤٥٦٧", "1234567"]) {
      const r = masked(`كلّم العميل على ${phone} اليوم`);
      expect(r.text, phone).toBe(`كلّم العميل على ${MASK_MARKER.phone} اليوم`);
      expect(r.masked.phone, phone).toBe(1);
    }
  });

  it("six digits and a calendar day are NOT a phone number (a number the owner needs stays)", () => {
    expect(masked("اتأخرت 123456 ليرة").text).toBe("اتأخرت 123456 ليرة");
    expect(masked("من 2026-10-01 إلى 2026-10-30").text).toBe("من 2026-10-01 إلى 2026-10-30");
    expect(masked("3 مهام و 45 رسالة و 12.5 يوم").count).toBe(0);
  });

  it("e-mails, links, bare domains and @handles", () => {
    expect(masked("ايميله ahmad.k@example.com ضروري").text).toBe(`ايميله ${MASK_MARKER.email} ضروري`);
    expect(masked("شوف https://shop.example.com/orders/12?x=1 هلق").text).toBe(`شوف ${MASK_MARKER.url} هلق`);
    expect(masked("www.example.org/page").text).toBe(MASK_MARKER.url);
    expect(masked("مدونة zaki.io/blog").text).toBe(`مدونة ${MASK_MARKER.url}`);
    expect(masked("راسله @abu_ali أو @أحمد_م").text).toBe(`راسله ${MASK_MARKER.handle} أو ${MASK_MARKER.handle}`);
    // an address inside a link is part of the link, not an e-mail of its own
    const both = masked("https://a.com/?e=x@y.com");
    expect(both.masked.url).toBe(1);
    expect(both.masked.email).toBe(0);
  });

  it("identifiers and secrets: keys, tokens, JWTs, hex, UUIDs, cuids, long mixed tokens, «كلمة السر: …»", () => {
    const samples: [string, string][] = [
      ["sk-ant-api03-AbCdEfGh1234567890", "secret"], // scan-secrets:ignore
      ["ghp_abcdefghijklmnop1234567890", "secret"],
      ["Bearer abcdefghijklmnopqrstuvwxyz0123", "secret"],
      ["eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4fw", "secret"], // scan-secrets:ignore
      ["0123456789abcdef0123456789abcdef", "secret"],
      ["password: Zx9$kLmQ", "secret"],
      ["كلمة السر: abc123xyz", "secret"],
      ["c1234567890abcdefghijklmn", "id"],
      ["123e4567-e89b-12d3-a456-426614174000", "id"],
      ["AB12CD34EF56", "id"],
    ];
    for (const [sample, kind] of samples) {
      const r = masked(`الرمز ${sample} انتهى`);
      expect(r.text, sample).not.toContain(sample);
      expect(r.masked[kind as "secret" | "id"], sample).toBeGreaterThan(0);
    }
  });

  it("ordinary Arabic text, small numbers and Latin words pass untouched", () => {
    for (const text of ["حلّل أداء هالأسبوع", "مين متأخر وشو أسبابه؟", "ما نسبة الالتزام؟ 83% من 12 مهمة", "ask about COVID19 tasks", "الفريق A و B"]) {
      expect(redactText(text).text, text).toBe(text);
    }
  });

  it("is idempotent (a second pass finds nothing in what the first left) and never throws on odd input", () => {
    const once = redactText("0791234567 a@b.co https://x.io sk-ant-abcdefgh12345").text;
    expect(redactText(once).count).toBe(0);
    expect(redactText("").text).toBe("");
    expect(() => redactText(undefined as unknown as string)).not.toThrow();
    expect(redactText("   ").text).toBe("   ");
  });

  it("counts every kind and the total", () => {
    const r = redactText("0791234567 و a@b.co و https://x.io و @abu و sk-ant-abcdefgh12345 و AB12CD34EF56");
    expect(r.masked).toMatchObject({ phone: 1, email: 1, url: 1, handle: 1, secret: 1, id: 1 });
    expect(r.count).toBe(6);
  });
});

describe("normalizeDigits", () => {
  it("turns Arabic-Indic, Extended and full-width digits into 0-9, one character for one", () => {
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(normalizeDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
    expect(normalizeDigits("０１２")).toBe("012");
    expect(normalizeDigits("سنة ٢٠٢٦ م").length).toBe("سنة ٢٠٢٦ م".length);
  });
});

describe("titles: one line, redacted, at most 80 characters", () => {
  it("masks a number, removes line breaks and control characters, and cuts at 80", () => {
    expect(redactTitle("اتصل بالعميل\n0791234567\tضروري").text).toBe(`اتصل بالعميل ${MASK_MARKER.phone} ضروري`);
    const long = redactTitle("ب".repeat(200));
    expect([...long.text].length).toBe(80);
    expect(long.text.endsWith("…")).toBe(true);
    expect(capText("قصير", 80)).toBe("قصير");
  });
});

// ───────────────────────────────────────── names ─────────────────────────────────────────

describe("maskKnownNames: the owner's own question must not carry a real name", () => {
  const known = [
    { label: "موظف 1", names: ["أحمد خالد"] },
    { label: "موظف 2", names: ["سارة خالد"] },
    { label: "موظف 3", names: ["Omar Hadi"] },
    { label: "مساحة 1", names: ["التسويق"] },
  ];

  it("a full name is replaced, with or without vowel marks, hamza or ta-marbuta variants and any case", () => {
    expect(maskKnownNames("شو أنجز أحمد خالد؟", known).text).toBe("شو أنجز موظف 1؟");
    expect(maskKnownNames("شو أنجز احمد خالد؟", known).text).toBe("شو أنجز موظف 1؟");
    expect(maskKnownNames("شو أنجز أَحْمَد خالد؟", known).text).toBe("شو أنجز موظف 1؟");
    expect(maskKnownNames("what did omar hadi do", known).text).toBe("what did موظف 3 do");
  });

  it("a first name alone is replaced, inside Arabic prefixes too («لأحمد»), and a space name as well", () => {
    expect(maskKnownNames("وزّع المهمة لأحمد", known).text).toBe("وزّع المهمة لموظف 1");
    expect(maskKnownNames("مهام التسويق", known).text).toBe("مهام مساحة 1");
    expect(maskKnownNames("what about Omar?", known).text).toBe("what about موظف 3?");
  });

  it("a word shared by two people («خالد») is not guessed: it becomes a neutral marker", () => {
    const r = maskKnownNames("كلّم خالد", known);
    expect(r.text).toBe(`كلّم ${AMBIGUOUS_NAME_MARKER}`);
    expect(r.count).toBe(1);
  });

  it("nothing known, nothing changed; short words (under 3 letters) are never taken for a name", () => {
    expect(maskKnownNames("حلّل الأسبوع", known)).toEqual({ text: "حلّل الأسبوع", count: 0 });
    expect(maskKnownNames("مرحبا", [{ label: "موظف 9", names: ["عل"] }]).count).toBe(0);
  });
});

describe("references round trip (موظف 3 ↔ U3)", () => {
  const table = { U3: "user-3", T5: "task-5", S2: "space-2" } as Record<string, string>;
  const show = (ref: string) => ({ U3: "أحمد", T5: "#12 تجهيز العرض", S2: "التسويق" })[ref as "U3"];

  it("finds the references a text mentions, in both spellings, Arabic digits included", () => {
    expect(refsInText("موظف 3 تأخر وT5 وS2 و موظف ٣").sort()).toEqual(["S2", "T5", "U3"]);
    expect(refsInText("UTF8 و CT5X").length).toBe(0);
  });

  it("puts the real names back; an unknown reference stays as written", () => {
    expect(restoreRefs("موظف 3 تأخر في T5 ضمن S2 وموظف 9 أيضًا وU3", (ref) => (table[ref] ? show(ref) : undefined))).toBe("أحمد تأخر في #12 تجهيز العرض ضمن التسويق وموظف 9 أيضًا وأحمد");
    expect(restoreRefs("موظف 30", (ref) => (ref === "U3" ? "X" : undefined))).toBe("موظف 30");
  });
});

// ───────────────────────────────────────── buildContext ─────────────────────────────────────────

const SECRET_BODY = "السر: كلمة المرور هي Zx9-kLmQ-777 ورقم العميل 0791234567";
const CUSTOMER_TITLE = "اتصل بالعميل خالد الشمري على 0791234567 بخصوص الطلب";

function raw(over: Partial<RawScope> = {}): RawScope {
  const task = (n: number, over2: Partial<RawTask> = {}): RawTask => ({
    id: `task-${n}`,
    title: `مهمة ${n}`,
    assigneeId: n % 2 ? "user-b" : "user-a",
    coAssigneeIds: [],
    workspaceId: "space-1",
    projectId: "project-1",
    priority: "NORMAL",
    due: "2026-10-20",
    overdueDays: 10,
    ...over2,
  });
  return {
    window: { from: "2026-10-24", to: "2026-10-30", today: "2026-10-30" },
    spaceId: null,
    company: { completed: 9, open: 12, overdue: 4, late: 2, avgDays: 3.456, messages: 120, activePeople: 2, idlePeople: 0 },
    people: [
      { userId: "user-b", name: "سارة الأحمد", role: "MEMBER", status: "ACTIVE", completed: 4, openTasks: 3, overdue: 1, withDue: 4, onTime: 3, late: 1, onTimeRate: 75, avgDays: 2.25, steps: 6, messages: 40, lastActiveDay: "2026-10-30", perDay: [0, 1, 0, 2, 0, 1, 0] },
      { userId: "user-a", name: "أحمد خالد", role: "LEAD", status: "ACTIVE", completed: 5, openTasks: 2, overdue: 3, withDue: 5, onTime: 4, late: 1, onTimeRate: 80, avgDays: null, steps: 1, messages: 80, lastActiveDay: null, perDay: [1, 1, 1, 0, 0, 1, 1] },
    ],
    spaces: [{ id: "space-1", name: "مساحة عميل الشمري", open: 12, overdue: 4, projects: [{ id: "project-1", name: "مشروع الشمري 0791234567" }] }],
    tasks: [task(1, { title: CUSTOMER_TITLE }), task(2), task(3, { assigneeId: null, due: null, overdueDays: null })],
    openTasksTotal: 12,
    ...over,
  };
}

describe("buildContext: names, titles and what the model is given", () => {
  const off = { allowNames: false, allowTitles: false };
  const json = (c: AssistantContext) => JSON.stringify(c);

  it("names OFF, titles OFF (the defaults): staff are «موظف n», no name, no title, no space name, nothing else with words in it", () => {
    const { context, refs } = buildContext(raw(), off);
    const text = json(context);
    for (const leaked of ["سارة", "أحمد", "خالد", "الشمري", "الأحمد", "0791234567", "مهمة 1", "مساحة عميل", "مشروع الشمري"]) expect(text, leaked).not.toContain(leaked);
    expect(context.people.map((p) => p.label)).toEqual(["موظف 1", "موظف 2"]);
    expect(context.people.every((p) => p.name === undefined)).toBe(true);
    expect(context.tasks.every((t) => t.title === undefined)).toBe(true);
    expect(context.spaces[0]?.name).toBeUndefined();
    expect(context.spaces[0]?.projects[0]?.name).toBeUndefined();
    // the table the server keeps: pseudonym -> id
    expect(refs["U1"]).toBe("user-a");
    expect(refs["U2"]).toBe("user-b");
  });

  it("pseudonyms are assigned by id, never in the order of the names (the order would tell who is who)", () => {
    const a = buildContext(raw(), off).context.people.map((p) => p.ref);
    const reversed = buildContext(raw({ people: [...raw().people].reverse() }), off).context.people.map((p) => p.ref);
    expect(a).toEqual(reversed);
  });

  it("a person keeps their number for the whole conversation, and a newcomer takes the next one", () => {
    const first = buildContext(raw(), off);
    const people = [...raw().people, { ...raw().people[0]!, userId: "user-0" }];
    const second = buildContext(raw({ people }), { ...off, refs: first.refs });
    expect(second.refs["U1"]).toBe("user-a");
    expect(second.refs["U2"]).toBe("user-b");
    expect(second.refs["U3"]).toBe("user-0");
    expect(second.context.people.find((p) => p.ref === "U3")).toBeTruthy();
  });

  it("names ON: the real names are in the context (and only then)", () => {
    const { context } = buildContext(raw(), { allowNames: true, allowTitles: false });
    expect(context.people.map((p) => p.name).sort()).toEqual(["أحمد خالد", "سارة الأحمد"]);
    expect(json(context)).not.toContain("0791234567");
  });

  it("titles ON: titles are present, the phone number in one is GONE, they are one line and at most 80 characters", () => {
    const { context, masked } = buildContext(raw(), { allowNames: false, allowTitles: true });
    const t1 = context.tasks.find((t) => t.title?.includes("اتصل"));
    expect(t1?.title).toContain(MASK_MARKER.phone);
    expect(json(context)).not.toContain("0791234567");
    expect(masked).toBeGreaterThanOrEqual(2); // the task title and the project name
    expect(context.tasks.every((t) => (t.title ? [...t.title].length <= 80 : true))).toBe(true);
    // ⚠️ the customer's NAME is not a shape the filter can find: it is still there, which is why titles are off by default
    expect(t1?.title).toContain("خالد الشمري");
  });

  it("at most 50 titles in one request (tasks first), whatever the number of tasks", () => {
    const many: RawTask[] = Array.from({ length: 120 }, (_, i) => ({ id: `t-${i}`, title: `عنوان ${i}`, assigneeId: null, coAssigneeIds: [], workspaceId: "space-1", projectId: "project-1", priority: "LOW", due: "2026-10-01", overdueDays: 29 - (i % 3) }));
    const { context } = buildContext(raw({ tasks: many }), { allowNames: false, allowTitles: true });
    expect(context.tasks).toHaveLength(MAX_TASKS);
    const titles = context.tasks.filter((t) => t.title).length + context.spaces.filter((s) => s.name).length + context.spaces.flatMap((s) => s.projects).filter((p) => p.name).length;
    expect(titles).toBeLessThanOrEqual(MAX_TITLES);
    expect(context.tasks.filter((t) => t.title)).toHaveLength(50);
    expect(context.openTasksTotal).toBe(12);
    expect(context.tasksShown).toBe(MAX_TASKS);
  });

  it("the tasks are the most overdue first, then the nearest due day, then the most urgent", () => {
    const tasks: RawTask[] = [
      { id: "a", title: "a", assigneeId: null, coAssigneeIds: [], workspaceId: "s", projectId: "p", priority: "LOW", due: null, overdueDays: null },
      { id: "b", title: "b", assigneeId: null, coAssigneeIds: [], workspaceId: "s", projectId: "p", priority: "LOW", due: "2026-10-20", overdueDays: 10 },
      { id: "c", title: "c", assigneeId: null, coAssigneeIds: [], workspaceId: "s", projectId: "p", priority: "LOW", due: "2026-10-10", overdueDays: 20 },
      { id: "d", title: "d", assigneeId: null, coAssigneeIds: [], workspaceId: "s", projectId: "p", priority: "URGENT", due: "2026-11-05", overdueDays: null },
    ];
    const { context, refs } = buildContext(raw({ tasks }), off);
    expect(context.tasks.map((t) => refs[t.ref])).toEqual(["c", "b", "d", "a"]);
  });

  it("the numbers are the board's: counts, rates, per-day completions, the last active day, message COUNTS", () => {
    const { context } = buildContext(raw(), off);
    const p = context.people.find((x) => x.ref === "U2")!;
    expect(p).toMatchObject({ rank: "MEMBER", status: "ACTIVE", completed: 4, openTasks: 3, overdue: 1, onTimeRate: 75, avgDays: 2.3, steps: 6, messages: 40, lastActive: "2026-10-30", perDay: [0, 1, 0, 2, 0, 1, 0] });
    expect(context.company).toMatchObject({ completed: 9, avgDays: 3.456 });
    expect(context.window).toEqual({ from: "2026-10-24", to: "2026-10-30", today: "2026-10-30", days: 7 });
  });

  it("a fixture with a secret message body and a customer-looking title: the body is nowhere, and the title only as the switches allow", () => {
    // no field of the input can carry a body; this pins that even a body smuggled into a name or a title is caught
    const poisoned = raw({ tasks: [{ id: "t", title: SECRET_BODY, assigneeId: null, coAssigneeIds: [], workspaceId: "space-1", projectId: "project-1", priority: "NORMAL", due: null, overdueDays: null }] });
    const none = json(buildContext(poisoned, off).context);
    expect(none).not.toContain("كلمة المرور");
    expect(none).not.toContain("Zx9");
    const withTitles = json(buildContext(poisoned, { allowNames: false, allowTitles: true }).context);
    expect(withTitles).not.toContain("0791234567");
    expect(withTitles).not.toContain("Zx9-kLmQ-777");
  });

  it("is cut to the size limit: per-day lists first, then tasks, then the quietest people; and says so", () => {
    const people = Array.from({ length: 80 }, (_, i) => ({ ...raw().people[0]!, userId: `user-${String(i).padStart(3, "0")}`, completed: i }));
    const small = buildContext(raw({ people }), { ...off, maxChars: 9000 });
    expect(JSON.stringify(small.context).length).toBeLessThanOrEqual(9000);
    expect(small.context.truncated).toBe(true);
    expect(small.context.people.every((p) => p.perDay === undefined)).toBe(true);
    const roomy = buildContext(raw(), off);
    expect(roomy.context.truncated).toBe(false);
    expect(roomy.context.people[0]?.perDay).toBeDefined();
  });
});

describe("verifyContext: the last door refuses anything outside the list", () => {
  const good = () => buildContext(raw(), { allowNames: false, allowTitles: false }).context;

  it("a clean context passes", () => {
    expect(() => verifyContext(good(), { allowNames: false, allowTitles: false })).not.toThrow();
  });

  it("an unknown key anywhere throws (a body, a file name, an e-mail, a comment cannot ride along)", () => {
    for (const [mutate, where] of [
      [(c: AssistantContext) => ((c as unknown as Record<string, unknown>)["messageBody"] = "x"), "messageBody"],
      [(c: AssistantContext) => ((c.people[0] as unknown as Record<string, unknown>)["email"] = "a@b.co"), "people[0].email"],
      [(c: AssistantContext) => ((c.people[0] as unknown as Record<string, unknown>)["phone"] = "079"), "people[0].phone"],
      [(c: AssistantContext) => ((c.tasks[0] as unknown as Record<string, unknown>)["comment"] = "x"), "tasks[0].comment"],
      [(c: AssistantContext) => ((c.spaces[0] as unknown as Record<string, unknown>)["fileName"] = "x.pdf"), "spaces[0].fileName"],
    ] as [(c: AssistantContext) => void, string][]) {
      const c = good();
      mutate(c);
      expect(() => verifyContext(c, { allowNames: false, allowTitles: false }), where).toThrow(ContextLeakError);
    }
  });

  it("text where a number belongs, a bad reference, a bad day or a bad rank throws", () => {
    const cases: ((c: AssistantContext) => void)[] = [
      (c) => ((c.people[0] as unknown as Record<string, unknown>)["completed"] = "محمد"),
      (c) => (c.people[0]!.ref = "user-123"),
      (c) => (c.people[0]!.label = "أحمد"),
      (c) => (c.window.from = "الأسبوع الماضي"),
      (c) => (c.people[0]!.rank = "ملك"),
      (c) => (c.tasks[0]!.assignee = "أحمد"),
      (c) => (c.people[0]!.lastActive = "اليوم"),
    ];
    for (const mutate of cases) {
      const c = good();
      mutate(c);
      expect(() => verifyContext(c, { allowNames: false, allowTitles: false })).toThrow(ContextLeakError);
    }
  });

  it("a name without the owner's permission, a title without it, an over-long title, or a number left in one all throw", () => {
    const withName = good();
    withName.people[0]!.name = "أحمد";
    expect(() => verifyContext(withName, { allowNames: false, allowTitles: false })).toThrow(ContextLeakError);
    expect(() => verifyContext(withName, { allowNames: true, allowTitles: false })).not.toThrow();

    const withTitle = good();
    withTitle.tasks[0]!.title = "عنوان";
    expect(() => verifyContext(withTitle, { allowNames: false, allowTitles: false })).toThrow(ContextLeakError);
    expect(() => verifyContext(withTitle, { allowNames: false, allowTitles: true })).not.toThrow();

    withTitle.tasks[0]!.title = "ب".repeat(81);
    expect(() => verifyContext(withTitle, { allowNames: false, allowTitles: true })).toThrow(ContextLeakError);
    withTitle.tasks[0]!.title = "اتصل 0791234567";
    expect(() => verifyContext(withTitle, { allowNames: false, allowTitles: true })).toThrow(ContextLeakError);
    withTitle.tasks[0]!.title = "راسل a@b.co";
    expect(() => verifyContext(withTitle, { allowNames: false, allowTitles: true })).toThrow(ContextLeakError);
  });

  it("the error names the place and never the value", () => {
    const c = good();
    (c.people[0] as unknown as Record<string, unknown>)["email"] = "secret@private.example";
    try {
      verifyContext(c, { allowNames: false, allowTitles: false });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ContextLeakError);
      expect(String((err as Error).message)).not.toContain("secret@private.example");
      expect((err as ContextLeakError).path).toBe("people[0].email");
    }
  });

  it("no field of the context's TYPE could hold a message body or a person's contact details (the allowed keys, spelled out)", () => {
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
          keys.add(k);
          walk(v);
        }
      }
    };
    walk(buildContext(raw(), { allowNames: true, allowTitles: true }).context);
    expect([...keys].sort()).toEqual(
      [
        "activePeople", "assignee", "avgDays", "coAssignees", "company", "completed", "days", "due", "from", "idlePeople", "label", "lastActive", "late", "messages", "name", "onTime", "onTimeRate", "open", "openTasks",
        "openTasksTotal", "overdue", "overdueDays", "people", "perDay", "priority", "project", "projects", "rank", "ref", "space", "spaceFilter", "spaces", "status", "steps", "tasks", "tasksShown", "title", "to", "today", "truncated", "window", "withDue",
      ].sort(),
    );
  });
});

describe("describeSent: the exact request, readable", () => {
  it("is the whole request as JSON in a fixed key order, and the user message is composed from the same pieces", () => {
    const { context } = buildContext(raw(), { allowNames: false, allowTitles: false });
    const view = { model: "claude-sonnet-5-5", maxTokens: 1500, system: SYSTEM_PROMPT, tools: ["propose_action"], history: [{ role: "user" as const, content: "سؤال قديم" }], data: context, question: "حلّل الأسبوع" };
    const text = describeSent(view);
    const parsed = JSON.parse(text) as typeof view;
    expect(Object.keys(parsed)).toEqual(["model", "maxTokens", "system", "tools", "history", "data", "question"]);
    expect(parsed.data).toEqual(JSON.parse(JSON.stringify(context)));
    expect(parsed.system).toBe(SYSTEM_PROMPT);
    // the message that really leaves is built from `data` and `question` and nothing else
    const message = composeUserMessage(parsed.data, parsed.question);
    expect(message).toContain(JSON.stringify(context));
    expect(message.endsWith("حلّل الأسبوع")).toBe(true);
  });
});
