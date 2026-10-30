import { createElement } from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ChatHome } from "@/components/chat/home/chat-home";
import { SpaceTopics } from "@/components/chat/home/space-topics";
import { DmList } from "@/components/chat/home/dm-list";
import { render } from "./ui-render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }), usePathname: () => "/chat" }));

const topic = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, title, emoji: "💬", topicType: "DISCUSSION" as const, unread: 0, mentions: 0, closed: false, restricted: false, teamId: null, pinned: false, archived: false, canPost: true, lastMessage: null, ...over });
const space = (over: Record<string, unknown> = {}) => ({ id: "s", name: "مساحة", emoji: "🌿", kind: "STANDARD", hasExternal: false, canModerate: false, canCreateTopic: false, sections: [], unread: 0, topics: [topic("a", "الأول"), topic("b", "الثاني"), topic("c", "الثالث")], ...over });
const dm = (id: string, name: string) => ({ id, peer: { id: `p-${id}`, name }, unread: 0, lastMessage: null });
const controls = (over: Record<string, unknown> = {}) => ({ on: true, onSave: () => undefined, onReset: () => undefined, hasOrder: () => false, ...over });
const grips = (html: string) => [...html.matchAll(/data-arrange-grip=""/g)].length;

describe("the «ترتيب» mode of the chat home", () => {
  it("offers a toggle that is off by default and shows no grips and no drag at all", () => {
    const html = render(createElement(ChatHome, { guest: false, home: { canOversee: false, spaces: [space()], dms: [] } }));
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>ترتيب<\/button>/);
    expect(grips(html)).toBe(0);
    expect(html).not.toContain("data-arranging");
    expect(html).toContain('href="/chat/a"'); // the rows are plain links: scrolling and taps open them
  });

  it("has no toggle when there is nothing to put in order (one topic, no chats)", () => {
    const html = render(createElement(ChatHome, { guest: false, home: { canOversee: false, spaces: [space({ topics: [topic("a", "الأول")] })], dms: [] } }));
    expect(html).not.toContain(">ترتيب<");
  });

  it("gives a guest the toggle for the topics of the space, never for chats", () => {
    const html = render(createElement(ChatHome, { guest: true, home: { canOversee: false, spaces: [space()], dms: [] } }));
    expect(html).toContain(">ترتيب<");
    expect(html).not.toContain("رسالة جديدة");
  });

  it("while arranging every live topic has a grip handle with a name, and is not a link", () => {
    const html = render(createElement(SpaceTopics, { space: space(), arrange: controls() }));
    expect(grips(html)).toBe(3);
    expect(html).toContain('aria-label="مقبض ترتيب «الأول»"');
    expect(html).toContain('aria-roledescription="عنصر قابل للترتيب"');
    expect(html).not.toContain('href="/chat/a"');
    // the handle points at the screen-reader instructions (they are put into the page by the browser, so they are not in this markup)
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    // the order of the rows is the order given
    expect(html.indexOf("الأول")).toBeLessThan(html.indexOf("الثاني"));
    expect(html.indexOf("الثاني")).toBeLessThan(html.indexOf("الثالث"));
  });

  it("the grip is a real button, reachable by keyboard", () => {
    const html = render(createElement(SpaceTopics, { space: space(), arrange: controls() }));
    const first = /<button[^>]*data-arrange-grip=""[^>]*>/.exec(html)![0];
    expect(first).toContain('type="button"');
    expect(first).toContain('tabindex="0"');
    expect(first).toContain('role="button"');
    expect(first).toMatch(/aria-describedby="[^"]+"/);
  });

  it("not arranging: no grips, rows open the topic", () => {
    const html = render(createElement(SpaceTopics, { space: space(), arrange: controls({ on: false }) }));
    expect(grips(html)).toBe(0);
    expect(html).toContain('href="/chat/a"');
  });

  it("«رجّع الترتيب الأصلي» shows only while arranging a list that has an order of its own", () => {
    expect(render(createElement(SpaceTopics, { space: space(), arrange: controls({ hasOrder: () => true }) }))).toContain("رجّع الترتيب الأصلي");
    expect(render(createElement(SpaceTopics, { space: space(), arrange: controls({ hasOrder: () => false }) }))).not.toContain("رجّع الترتيب الأصلي");
    expect(render(createElement(SpaceTopics, { space: space(), arrange: controls({ on: false, hasOrder: () => true }) }))).not.toContain("رجّع الترتيب الأصلي");
  });

  it("drags inside a «مقطع» too: its topics have grips under its name, and the archived ones do not", () => {
    const home = space({
      sections: [{ id: "x", name: "التصميم" }],
      topics: [topic("a", "الأول"), topic("t1", "شغل", { teamId: "x" }), topic("t2", "شغل ٢", { teamId: "x" }), topic("old", "قديم", { archived: true })],
    });
    const html = render(createElement(SpaceTopics, { space: home, arrange: controls() }));
    expect(grips(html)).toBe(3); // a, t1, t2: the archived list stays as it was
    expect(html.indexOf("مقطع التصميم")).toBeLessThan(html.indexOf("شغل"));
    expect(html).toContain('href="/chat/old"');
  });

  it("keeps the pinned and the unpinned topics in their groups on screen", () => {
    const html = render(createElement(SpaceTopics, { space: space({ topics: [topic("p", "مثبت", { pinned: true }), topic("a", "الأول"), topic("b", "الثاني")] }), arrange: controls() }));
    expect(html.indexOf("مثبت")).toBeLessThan(html.indexOf("الأول"));
    expect(grips(html)).toBe(3);
  });

  it("the private chats get grips too, named by the person", () => {
    const html = render(createElement(DmList, { dms: [dm("1", "سارة"), dm("2", "خالد")], onChanged: () => undefined, arrange: { scope: "dm", onSave: () => undefined } }));
    expect(grips(html)).toBe(2);
    expect(html).toContain('aria-label="مقبض ترتيب «سارة»"');
    expect(html).not.toContain("href=");
    const plain = render(createElement(DmList, { dms: [dm("1", "سارة")], onChanged: () => undefined }));
    expect(plain).toContain('href="/chat/1"');
    expect(grips(plain)).toBe(0);
  });
});

describe("how a drag may start (pinned in the source: a browser test cannot run here)", () => {
  const src = readFileSync("src/components/chat/home/arrange-list.tsx", "utf8");

  it("only from the handle: the pointer and keyboard listeners are on the grip button, never on the row", () => {
    const grip = /<button[\s\S]*?data-arrange-grip/.exec(src)![0];
    expect(grip).toContain("{...listeners}");
    expect(grip).toContain("setActivatorNodeRef");
    const row = /<li[\s\S]*?>\s*<button/.exec(src)![0];
    expect(row).not.toContain("listeners");
    expect(src).toContain("touch-none"); // a finger on the handle drags; a finger on the row scrolls
  });

  it("a short press moves nothing: the pointer needs a few pixels, the keyboard is space, arrows, space", () => {
    expect(src).toMatch(/PointerSensor, \{ activationConstraint: \{ distance: \d+ \} \}/);
    expect(src).toContain("KeyboardSensor");
    expect(src).toContain("sortableKeyboardCoordinates");
    expect(src).not.toContain("TouchSensor"); // the handle's own touch-action covers touch
  });

  it("respects prefers-reduced-motion: no sliding rows and no flying drop", () => {
    expect(src).toContain("prefers-reduced-motion: reduce");
    expect(src).toMatch(/transition: reduced \? null/);
    expect(src).toMatch(/dropAnimation=\{reduced \? null/);
  });

  it("announces in Arabic through the dictionary, never with English text", () => {
    for (const key of ["chato.ann.start", "chato.ann.over", "chato.ann.end", "chato.ann.cancel", "chato.ann.blocked", "chato.instructions", "chato.role", "chato.grip"]) {
      expect(src).toContain(key);
    }
    expect(src).toContain("screenReaderInstructions");
    expect(src).not.toMatch(/Picked up|Moved|Dropped/);
  });
});
