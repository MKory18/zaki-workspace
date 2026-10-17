import { describe, expect, it } from "vitest";
import { isAllowedReaction, ALLOWED_REACTIONS, canModifyMessage, canPinMessage, dmMembersKey } from "../src/server/services/chat";

describe("chat reactions", () => {
  it("accepts exactly the six-palette emoji and nothing else", () => {
    for (const e of ALLOWED_REACTIONS) expect(isAllowedReaction(e)).toBe(true);
    expect(isAllowedReaction("😀")).toBe(false);
    expect(isAllowedReaction("")).toBe(false);
    expect(isAllowedReaction("<script>alert(1)</script>")).toBe(false);
  });
});

describe("chat message policy", () => {
  const base = { conversationKind: "GROUP" as const, isGroupAdmin: false, authorId: "a", viewerId: "v" };

  it("authors may modify their own messages everywhere", () => {
    expect(canModifyMessage({ ...base, authorId: "v" })).toBe(true);
  });

  it("group admins may moderate others; plain members may not", () => {
    expect(canModifyMessage({ ...base, isGroupAdmin: true })).toBe(true);
    expect(canModifyMessage(base)).toBe(false);
  });

  it("DM has no admin role that reaches across", () => {
    expect(canModifyMessage({ ...base, conversationKind: "DM", isGroupAdmin: false })).toBe(false);
  });

  it("pinning: DM both sides, GROUP admins only", () => {
    expect(canPinMessage({ ...base, conversationKind: "DM", isGroupAdmin: false })).toBe(true);
    expect(canPinMessage({ ...base, isGroupAdmin: false })).toBe(false);
    expect(canPinMessage({ ...base, isGroupAdmin: true })).toBe(true);
  });
});

describe("dm canonical ordering", () => {
  it("returns the same pair regardless of who initiates", () => {
    expect(dmMembersKey("b", "a")).toEqual(dmMembersKey("a", "b"));
    expect(dmMembersKey("b", "a")[0]).toBe("a");
  });
});
