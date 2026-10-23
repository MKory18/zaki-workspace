import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as prismaClient from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import {
  ENUM_KEYS,
  columnKind,
  columnLabel,
  enumLabel,
  enumNames,
  enumOptions,
  enumValues,
  eventDetailLabel,
  eventLabel,
  type EnumName,
} from "@/lib/i18n/enums";
import { DEFAULT_BOARD_COLUMNS } from "@/server/services/tasks";
import { PRIORITY_STYLES } from "@/lib/format";

const ROOT = path.resolve(__dirname, "..");
const ARABIC_LETTER = /[؀-ۿ]/;

/**
 * The only Latin words an enum label may carry: brand names the owner chose to keep in Latin.
 * (A label with any other Latin word would put English in front of an Arabic reader.)
 */
const BRANDS = ["n8n", "Google Drive"];
const withoutBrands = (text: string) => BRANDS.reduce((rest, brand) => rest.split(brand).join(""), text);

/**
 * Enums of the schema that can NOT reach a screen. Empty on purpose: every enum below shows up in a
 * badge, a select, a filter or an activity line (some only in later phases, but their labels are
 * written now so that nobody ever renders the raw key). A new enum in schema.prisma fails here until
 * it gets labels (src/lib/i18n/enums.ts + ar.enums.json) or is listed here with the reason.
 */
const NOT_ON_SCREEN: Record<string, string> = {};

/** Every enum the Prisma client exports: an object whose keys equal its values. */
function clientEnums(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(prismaClient)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0 && entries.every(([k, v]) => k === v)) out[name] = entries.map(([k]) => k);
  }
  return out;
}

/** The enums as written in prisma/schema.prisma (name -> values), read from the file. */
function schemaEnums(): Record<string, string[]> {
  const text = readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
  const out: Record<string, string[]> = {};
  for (const m of text.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const values = (m[2] ?? "")
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter(Boolean);
    out[m[1] as string] = values;
  }
  return out;
}

describe("the enums of the schema", () => {
  it("the Prisma client exports exactly the enums that schema.prisma declares (so the checks below are not vacuous)", () => {
    const fromClient = clientEnums();
    const fromSchema = schemaEnums();
    expect(Object.keys(fromSchema).length).toBeGreaterThanOrEqual(14);
    expect(Object.keys(fromClient).sort()).toEqual(Object.keys(fromSchema).sort());
    for (const [name, values] of Object.entries(fromSchema)) expect(fromClient[name], name).toEqual(values);
  });

  const labelled = Object.entries(clientEnums()).filter(([name]) => !(name in NOT_ON_SCREEN));

  it.each(labelled)("%s: every value has an Arabic label (never the raw key)", (name, values) => {
    for (const value of values) {
      const label = enumLabel(name as EnumName, value);
      expect(label, `${name}.${value}`).toBeTruthy();
      // a brand name alone (n8n, Google Drive) is fine; anything else in the label must be Arabic
      if (withoutBrands(label).trim()) expect(label, `${name}.${value} must be Arabic`).toMatch(ARABIC_LETTER);
      expect(label, `${name}.${value} is the raw value`).not.toBe(value);
      expect(withoutBrands(label), `${name}.${value} carries a Latin word: ${label}`).not.toMatch(/[A-Za-z]{2,}/);
    }
  });

  it.each(labelled)("%s: the registry lists exactly the values of the schema, in the schema's order", (name, values) => {
    expect(enumNames()).toContain(name);
    expect(enumValues(name as EnumName)).toEqual(values);
  });

  it("the enums that are excluded are named with a reason", () => {
    for (const [name, reason] of Object.entries(NOT_ON_SCREEN)) expect(reason.length, name).toBeGreaterThan(10);
  });

  it("every dictionary key the registry points to exists, and none of them is the key itself", () => {
    for (const name of enumNames()) {
      for (const [value, key] of Object.entries(ENUM_KEYS[name])) {
        expect(AR[key], `${name}.${value} -> ${key}`).toBeTruthy();
        expect(AR[key], `${name}.${value} -> ${key}`).not.toBe(key);
      }
    }
  });

  it("reuses the labels the dictionary already had instead of writing them twice", () => {
    expect(enumLabel("TaskPriority", "URGENT")).toBe(AR["priority.URGENT"]);
    expect(enumLabel("TicketStatus", "IN_PROGRESS")).toBe(AR["ticket.status_in_progress"]);
    expect(enumLabel("CampaignStatus", "CANCELLED")).toBe(AR["camp.status_cancelled"]);
    expect(enumLabel("IdeaStatus", "UNDER_REVIEW")).toBe(AR["ideas.status.UNDER_REVIEW"]);
    expect(enumLabel("OpportunityStage", "WON")).toBe(AR["crm.stage_won"]);
    expect(enumLabel("OrgRole", "LEAD")).toBe(AR["role.lead"]);
    expect(enumLabel("OrgRole", "ADMIN")).toBe("مشرف");
    expect(enumLabel("MemberStatus", "OFFBOARDED")).toBe(AR["members.status_offboarded"]);
  });

  it("the labels owners read most are the right words", () => {
    expect(enumLabel("ProjectStatus", "PLANNING")).toBe("قيد التخطيط");
    expect(enumLabel("ProjectStatus", "ACTIVE")).toBe("نشط");
    expect(enumLabel("ProjectStatus", "COMPLETED")).toBe("مكتمل");
    expect(enumLabel("TaskPriority", "NONE")).toBe("بلا أولوية");
    expect(enumLabel("GoalPeriod", "WEEKLY")).toBe("أسبوعي");
    expect(enumLabel("IntegrationType", "TELEGRAM")).toBe("تيليجرام");
  });

  it("an empty value shows a dash and an unknown one an Arabic 'unknown' - never the raw English", () => {
    expect(enumLabel("ProjectStatus", null)).toBe("—");
    expect(enumLabel("ProjectStatus", undefined)).toBe("—");
    expect(enumLabel("ProjectStatus", "")).toBe("—");
    const unknown = enumLabel("ProjectStatus", "SOMETHING_NEW");
    expect(unknown).toMatch(ARABIC_LETTER);
    expect(unknown).not.toContain("SOMETHING");
  });

  it("enumOptions gives the select options in the enum's order, labelled", () => {
    const options = enumOptions("TaskPriority");
    expect(options.map((o) => o.value)).toEqual(["URGENT", "HIGH", "NORMAL", "LOW", "NONE"]);
    expect(options.every((o) => o.label === enumLabel("TaskPriority", o.value))).toBe(true);
  });
});

describe("values that are strings in the schema but still reach the screen", () => {
  it("the direction and the verdict of an integration event, and the Telegram chat kind", () => {
    expect(enumLabel("IntegrationDirection", "OUT")).toMatch(ARABIC_LETTER);
    expect(enumLabel("IntegrationDirection", "IN")).toMatch(ARABIC_LETTER);
    expect(enumLabel("IntegrationDirection", "OUT")).not.toBe(enumLabel("IntegrationDirection", "IN"));
    expect(enumLabel("IntegrationEventStatus", "OK")).toMatch(ARABIC_LETTER);
    expect(enumLabel("IntegrationEventStatus", "FAILED")).toMatch(ARABIC_LETTER);
    for (const kind of ["private", "group", "supergroup", "channel"]) {
      expect(enumLabel("TelegramChatType", kind), kind).toMatch(ARABIC_LETTER);
    }
  });

  it("every event type the server logs has an Arabic name; an unknown one stays as the code it is", () => {
    const services = path.join(ROOT, "src", "server", "services");
    const types = new Set<string>();
    for (const file of readdirSync(services).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(path.join(services, file), "utf8");
      for (const m of text.matchAll(/\btype:\s*["']([a-z0-9_]+(?:\.[a-z0-9_]+)+)["']/g)) types.add(m[1] as string);
      for (const m of text.matchAll(/\blog(?:Chat|File)\(\s*[\w.]+\s*,\s*["']([a-z0-9_]+(?:\.[a-z0-9_]+)+)["']/g)) types.add(m[1] as string);
    }
    // the events n8n can be told about (src/server/services/n8n.ts)
    for (const type of ["task.created", "task.completed", "task.moved", "idea.created", "idea.accepted", "idea.rejected", "comment.created", "member.joined"]) types.add(type);
    expect(types.size).toBeGreaterThan(15); // the scan found the events (not vacuous)
    for (const type of types) {
      const label = eventLabel(type);
      expect(label, type).toMatch(ARABIC_LETTER);
      expect(withoutBrands(label), `${type}: ${label}`).not.toMatch(/[A-Za-z]{2,}/);
    }
    expect(eventLabel("n8n.inbound.createTask")).toBe(eventLabel("n8n.inbound"));
    expect(eventLabel("brand.new_event")).toBe("brand.new_event");
  });

  it("the detail the server writes in English is shown in Arabic; an unknown detail is kept as it is", () => {
    expect(eventDetailLabel("missing task fields")).toMatch(ARABIC_LETTER);
    expect(eventDetailLabel("task create failed")).toMatch(ARABIC_LETTER);
    expect(eventDetailLabel("network error")).toMatch(ARABIC_LETTER);
    expect(eventDetailLabel("HTTP 502")).toMatch(ARABIC_LETTER);
    expect(eventDetailLabel("HTTP 502")).toContain("502");
    expect(eventDetailLabel("HTTP 302 (redirect not followed)")).toContain("302");
    expect(eventDetailLabel("HTTP 302 (redirect not followed)")).not.toMatch(/redirect/);
    expect(eventDetailLabel("n8n.url_private")).toBe(AR["n8n.url_private"]);
    expect(eventDetailLabel("integration.not_connected")).toMatch(ARABIC_LETTER);
    expect(eventDetailLabel("some other failure")).toBe("some other failure");
  });
});

describe("board columns", () => {
  it("shows the well-known English defaults in Arabic, whatever the case", () => {
    const pairs: [string, string][] = [
      ["To do", "column.todo"],
      ["Todo", "column.todo"],
      ["todo", "column.todo"],
      ["TODO", "column.todo"],
      ["to-do", "column.todo"],
      ["Backlog", "column.backlog"],
      ["In progress", "column.in_progress"],
      ["In Progress", "column.in_progress"],
      ["Doing", "column.in_progress"],
      ["Review", "column.review"],
      ["In Review", "column.review"],
      ["Done", "column.done"],
      ["done", "column.done"],
      ["Blocked", "column.blocked"],
    ];
    for (const [english, key] of pairs) {
      expect(columnLabel(english), english).toBe(AR[key]);
      expect(columnLabel(english), english).toMatch(ARABIC_LETTER);
    }
  });

  it("ignores spaces around the name and between its words", () => {
    expect(columnLabel("  In   progress ")).toBe(AR["column.in_progress"]);
  });

  it("leaves a name the user typed exactly as typed (Arabic, other English, with its own case)", () => {
    for (const name of ["مراجعة العميل", "QA", "Ready for Shipping", "Waiting for client", "قيد التنفيذ ✅"]) {
      expect(columnLabel(name), name).toBe(name);
    }
  });

  it("is safe on a missing name and does not change an Arabic default a second time", () => {
    expect(columnLabel(null)).toBe("");
    expect(columnLabel(undefined)).toBe("");
    for (const english of ["Todo", "Done", "Blocked", "In Review"]) {
      expect(columnLabel(columnLabel(english))).toBe(columnLabel(english));
    }
  });

  it("columnKind sorts a name - English or the Arabic default - into the family it belongs to", () => {
    expect(columnKind("Todo")).toBe("todo");
    expect(columnKind(AR["column.todo"] as string)).toBe("todo");
    expect(columnKind("in progress")).toBe("in_progress");
    expect(columnKind(AR["column.in_progress"] as string)).toBe("in_progress");
    expect(columnKind("Done")).toBe("done");
    expect(columnKind(AR["column.done"] as string)).toBe("done");
    expect(columnKind("مراجعة العميل")).toBeNull();
    expect(columnKind(null)).toBeNull();
  });

  it("a new board starts with Arabic columns: the same five steps as before, the last one marks 'done'", () => {
    expect(DEFAULT_BOARD_COLUMNS.length).toBe(5);
    const names = DEFAULT_BOARD_COLUMNS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length); // (boardId, name) is unique in the database
    for (const name of names) {
      expect(name, name).toMatch(ARABIC_LETTER);
      expect(columnLabel(name), `${name} is shown as typed`).toBe(name);
      expect(columnKind(name), `${name} belongs to a known family`).not.toBeNull();
    }
    expect(DEFAULT_BOARD_COLUMNS.map((c) => c.done)).toEqual([false, false, false, false, true]);
    expect(columnKind(names[0] as string)).toBe("backlog");
    expect(columnKind(names[4] as string)).toBe("done");
    for (const column of DEFAULT_BOARD_COLUMNS) expect(column.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("POST /api/boards creates its columns from that list and carries no English column name of its own", () => {
    const route = readFileSync(path.join(ROOT, "src", "app", "api", "boards", "route.ts"), "utf8");
    expect(route).toContain("DEFAULT_BOARD_COLUMNS");
    for (const english of ["Backlog", "Todo", "In Progress", "In Review", "Done"]) {
      expect(route, english).not.toContain(`"${english}"`);
    }
  });
});

describe("priority colours keep their presentation tokens and now speak Arabic", () => {
  it("PRIORITY_STYLES labels are the dictionary's Arabic words", () => {
    for (const key of ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"]) {
      expect(PRIORITY_STYLES[key]?.label, key).toBe(enumLabel("TaskPriority", key));
      // a theme token, not a hex value: the dot follows the four themes
      expect(PRIORITY_STYLES[key]?.color, key).toMatch(/^rgb\(var\(--(danger|warn|info|muted|border)\)\)$/);
    }
  });
});

describe("the labels in the dictionary", () => {
  // the ar.enums.json fragment holds exactly the keys this feature added: enum.*, column.*, event.*, ...
  it("ar.enums.json is a flat object of non-empty strings", () => {
    const fragment = JSON.parse(readFileSync(path.join(ROOT, "src", "lib", "i18n", "ar.enums.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(fragment).length).toBeGreaterThan(40);
    for (const [key, value] of Object.entries(fragment)) {
      expect(typeof value, key).toBe("string");
      expect((value as string).trim().length, key).toBeGreaterThan(0);
    }
  });

  it("a label is written once: a value that reuses an older key has no enum.<Enum>.<VALUE> twin, and one that does not has its own", () => {
    for (const name of enumNames()) {
      for (const [value, key] of Object.entries(ENUM_KEYS[name])) {
        const own = `enum.${name}.${value}`;
        if (key === own) expect(AR[own], own).toBeTruthy();
        else expect(own in AR, `${own} writes again what ${key} already says`).toBe(false);
      }
    }
  });

  it("every enum.* key in the fragment belongs to a value the registry knows (no label for something that is gone)", () => {
    const fragment = JSON.parse(readFileSync(path.join(ROOT, "src", "lib", "i18n", "ar.enums.json"), "utf8")) as Record<string, string>;
    const known = new Set(enumNames().flatMap((name) => Object.keys(ENUM_KEYS[name]).map((value) => `enum.${name}.${value}`)));
    const stale = Object.keys(fragment).filter((key) => /^enum.[A-Z]/.test(key) && !known.has(key));
    expect(stale).toEqual([]);
  });
});
