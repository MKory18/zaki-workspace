import { describe, expect, it } from "vitest";
import { composerBarOf } from "../src/components/chat/conversation/conversation-screen";

const me = (over: Partial<{ canPost: boolean; canModerate: boolean; muted: boolean; oversight: boolean; canJoin: boolean }> = {}) => ({
  canPost: false,
  canModerate: false,
  muted: false,
  oversight: false,
  canJoin: false,
  ...over,
});
const topic = { closed: false, topicType: "DISCUSSION" as const };

describe("the bar under the messages", () => {
  it("the composer whenever the server says I may post, even in the announcements (a space admin)", () => {
    expect(composerBarOf(me({ canPost: true }), { closed: false, topicType: "ANNOUNCEMENTS" })).toBe("composer");
  });

  it("the owner in oversight gets «شارك بالمحادثة» where he may join, the read-only line elsewhere", () => {
    expect(composerBarOf(me({ oversight: true, canJoin: true }), topic)).toBe("join");
    expect(composerBarOf(me({ oversight: true }), { closed: true, topicType: "DISCUSSION" })).toBe("oversight");
  });

  it("otherwise the one reason: closed, muted, announcements, or not allowed", () => {
    expect(composerBarOf(me(), { closed: true, topicType: "DISCUSSION" })).toBe("closed");
    expect(composerBarOf(me({ muted: true }), topic)).toBe("muted");
    expect(composerBarOf(me(), { closed: false, topicType: "ANNOUNCEMENTS" })).toBe("announcements");
    expect(composerBarOf(me(), topic)).toBe("denied");
  });
});
