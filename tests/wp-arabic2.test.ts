import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AR as ar } from "@/lib/i18n/dict";
import { TIP_KEYS, tipForAudience, tipsFor } from "@/lib/tips";

/**
 * WP-ARABIC2 — the code parts of the Arabic review (`00-START-HERE.md` §4 step 6).
 *
 * Items (a)–(i) are pinned here, one describe each. The parts a database suite owns (the notification
 * rows that reach the bell) are checked again in `tests/db/ar-notifications.test.ts`; this file is the
 * unit-level floor: the interface may not show an English machine label, a dead key, or a silent refusal.
 */

const read = (p: string) => readFileSync(p, "utf8");

describe("(a) a notification stores its Arabic phrase as the title, the machine label in the body", () => {
  const notify = read("src/server/notify.ts");
  const tickets = read("src/server/services/tickets.ts");

  it("no stored title is a `${prefix}-${number}` template any more", () => {
    for (const src of [notify, tickets]) expect(src).not.toMatch(/title:\s*`\$\{/);
    // the five notification titles are the dictionary's phrases (the other `title:` lines are types and DTOs)
    const fromDict = [...notify.matchAll(/title:\s*AR\["notif\.type\.([a-z_]+)"\]/g)].map((m) => m[1]);
    const ticketDict = [...tickets.matchAll(/title:\s*AR\["notif\.type\.([a-z_]+)"\]/g)].map((m) => m[1]);
    expect(fromDict.sort()).toEqual(["comment", "task_assigned"]);
    expect(ticketDict.sort()).toEqual(["ticket_assigned", "ticket_assigned", "ticket_assigned", "ticket_comment", "ticket_status"]);
  });

  it("the task/ticket key rides in the body as «ZK-12 · …»", () => {
    expect(notify).toContain("${input.orgPrefix}-${input.taskNumber} · ${input.title}");
    expect(tickets).toContain("${org?.keyPrefix ?? \"ZK\"}-T${ticket.number} · ${ticket.title}");
  });

  it("a ticket status change is named in Arabic, from the enum table", () => {
    expect(tickets).toContain('enumLabel("TicketStatus", input.status)');
    expect(tickets).not.toContain("→ ${input.status}");
  });

  it("every key those titles use exists in the Arabic dictionary", () => {
    const keys = new Set<string>();
    for (const src of [notify, tickets]) for (const m of src.matchAll(/AR\["(notif\.type\.[a-z_]+)"\]/g)) if (m[1]) keys.add(m[1]);
    expect(keys.size).toBe(5);
    for (const k of keys) {
      expect(ar).toHaveProperty(k);
      // the title is read out by the bell: no Latin letter, no digits (WP-ARABIC1's rule)
      expect((ar as Record<string, string>)[k]).not.toMatch(/[A-Za-z0-9]/);
    }
  });
});

describe("(b) a refused column delete is not silent", () => {
  const board = read("src/components/board-view.tsx");

  it("the mutation has an onError that puts the server's message on the screen", () => {
    const block = /const deleteColumn = useMutation\(\{([\s\S]*?)\n  \}\);/.exec(board)?.[1] ?? "";
    expect(block).toContain("onError");
    expect(block).toContain("messageKey");
    expect(block).toContain('toast(t(key), "error")');
  });

  it("the 409 key it falls back to is Arabic and exists", () => {
    expect(ar).toHaveProperty("column.not_empty");
    expect((ar as Record<string, string>)["column.not_empty"]).not.toMatch(/[A-Za-z]/);
    expect(board).toContain('"common.error"');
  });
});

describe("(c) a failed form check shows the field hint, not a generic apology", () => {
  const form = read("src/components/auth-form.tsx");

  it("the validation branch is reachable: withApi always sends message: \"validation.failed\"", () => {
    expect(form).toContain('err.messageKey === "validation.failed"');
    expect(form).not.toContain('err.code === "validation.failed"');
    expect(form).toContain("auth.validationHint");
    expect(ar).toHaveProperty("auth.validationHint");
  });

  it("an unknown field message falls back to the hint, never to a bare key", () => {
    expect(form).toContain('msg = mapped && mapped !== first ? mapped : t("auth.validationHint")');
  });
});

describe("(d) the guest wording is wired where the brief lists it", () => {
  it("the page help asks the helper which line to read, so a guest gets the read-only one", () => {
    const btn = read("src/components/guide/page-help-button.tsx");
    expect(btn).toContain("helpWhatKey(help, audience)");
    expect(btn).not.toContain("t(help.whatKey)");
  });

  it("the loading screen never promises a guest the chat or the library", () => {
    const loading = read("src/app/(app)/loading.tsx");
    expect(loading).toContain('tipForAudience(tipSeed(Date.now()), "everyone")');
    const guestList = tipsFor("everyone");
    for (let seed = 0; seed < guestList.length * 3; seed++) {
      expect(guestList).toContain(tipForAudience(seed, "everyone"));
    }
    expect(guestList.length).toBe(TIP_KEYS.length - 2);
    // nobody is handed a tip that is not on their own list
    for (const seed of [0, 5, 11, 12345]) expect(guestList).toContain(tipForAudience(seed, "everyone"));
  });

  it("/members shows the guest notice to an external partner, not the team manager's title", () => {
    const page = read("src/app/(app)/members/page.tsx");
    const guestBlock = /if \(actor\.isExternal\) \{([\s\S]*?)\n  \}/.exec(page)?.[1] ?? "";
    expect(guestBlock).toContain('t("guest.no_access")');
    expect(guestBlock).not.toContain('t("orgm.title")');
  });

  it("/teams keeps the restricted subtitle for a guest", () => {
    const page = read("src/app/(app)/teams/page.tsx");
    expect(page).toContain('actor.isExternal ? "teams.subtitle_restricted" : "teams.subtitle"');
    expect(ar).toHaveProperty("teams.subtitle_restricted");
  });
});

describe("(e) the settings badges are named in Arabic", () => {
  const page = read("src/app/(app)/settings/page.tsx");

  it("no hard-coded English label is handed to a badge", () => {
    expect(page).not.toMatch(/label="[A-Za-z]/);
    expect(page).toContain('t("nav.telegram")');
    expect(page).toContain('t("nav.n8n")');
    expect(page).toContain('t("settings.google_drive")');
    for (const k of ["nav.telegram", "nav.n8n", "settings.google_drive"]) expect(ar).toHaveProperty(k);
  });
});

describe("(f) a role refusal says why, in its own words", () => {
  it("goals and the daily routines have their own key, not the membership one", () => {
    const goals = read("src/server/services/goals.ts");
    const production = read("src/server/services/production.ts");
    expect(goals).toContain('"goals.role_denied")');
    expect(goals).not.toContain('ForbiddenError("orgm.role_denied")');
    expect(production).toContain('"production.routines_role_denied")');
    expect(production).not.toContain('ForbiddenError("orgm.role_denied")');
    for (const k of ["goals.role_denied", "production.routines_role_denied"]) {
      expect(ar).toHaveProperty(k);
      expect((ar as Record<string, string>)[k]).not.toMatch(/[A-Za-z]/);
    }
  });
});

describe("(g) the shell is handed only what it draws", () => {
  it("the layout passes name, username and e-mail — never tv, locale or the onboarding flags", () => {
    const layout = read("src/app/(app)/layout.tsx");
    expect(layout).toContain("user={{ name: user.name, username: user.username, email: user.email }}");
    expect(layout).not.toMatch(/user=\{user\}/);
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toContain("user: AvatarUser;");
    expect(shell).not.toContain("CurrentUser");
  });
});

describe("(h) one <main> landmark per screen", () => {
  it("no page of the app and no component opens a second <main>: the shell owns it", async () => {
    // every file, not a hand-picked five (review C item 12 found four mains the old list missed); the
    // door shell is the one exception: it frames the sign-in and onboarding screens, outside the app shell
    const { readdirSync, statSync } = await import("node:fs");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = `${dir}/${name}`;
        return statSync(full).isDirectory() ? walk(full) : /\.tsx$/.test(name) ? [full] : [];
      });
    const files = [...walk("src/app/(app)"), ...walk("src/components")].filter(
      (f) => !f.endsWith("components/app-shell.tsx") && !f.endsWith("components/theme/door-shell.tsx"),
    );
    expect(files.length).toBeGreaterThan(50);
    const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(files.filter((f) => /<main[\s>]/.test(code(f)))).toEqual([]);
    expect(read("src/components/app-shell.tsx")).toContain('<main id="zk-main"');
  });
});

describe("(i) the dead home page keys and the coming-soon card are gone", () => {
  it("no home.* or coming.* key is left in the dictionary, and nothing reads one", () => {
    const dead = Object.keys(ar as Record<string, string>).filter((k) => k.startsWith("home.") || k.startsWith("coming."));
    expect(dead).toEqual([]);
  });

  it("the ComingSoon component is deleted", () => {
    expect(() => read("src/components/coming-soon.tsx")).toThrow();
  });
});
