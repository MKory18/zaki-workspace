import { describe, expect, it, vi } from "vitest";

// the policy module loads the DB client at import; these tests only use pure functions
vi.mock("@/server/db", () => ({ db: {} }));

import { ALLOWED_REACTIONS, isAllowedReaction } from "../src/server/chat/reactions";
import { dmKeyOf } from "../src/server/chat/dm";
import { canModerateTarget, canModifyMessage, canPin, type ConversationFacts, type OrgFacts } from "../src/server/policy/conversation";

/**
 * The live chat's small rules (these cases were written against the retired services/chat.ts and
 * moved to the modules the routes use: reactions.ts, dm.ts and the conversation policy).
 */
describe("chat reactions", () => {
  it("accepts exactly the six-palette emoji and nothing else", () => {
    for (const e of ALLOWED_REACTIONS) expect(isAllowedReaction(e)).toBe(true);
    expect(isAllowedReaction("😀")).toBe(false);
    expect(isAllowedReaction("")).toBe(false);
    expect(isAllowedReaction("<script>alert(1)</script>")).toBe(false);
  });
});

describe("chat message policy", () => {
  const facts = (kind: ConversationFacts["kind"], over: Partial<ConversationFacts> = {}): ConversationFacts => ({
    kind,
    orgId: "o1",
    spaceId: null,
    restricted: false,
    closedAt: null,
    postingPolicy: "ALL",
    topicType: "DISCUSSION",
    viewerIsMember: true,
    viewerGroupRole: "member",
    viewerSpaceRole: null,
    mutedUntil: null,
    dmOtherActive: true,
    memberIds: [],
    ...over,
  });
  const member: OrgFacts = { orgId: "o1", role: "MEMBER", status: "ACTIVE" };

  it("authors may modify their own messages everywhere", () => {
    for (const kind of ["DM", "GROUP"] as const) expect(canModifyMessage({ authorId: "v", viewerId: "v", facts: facts(kind), org: member })).toBe(true);
  });

  it("group admins may moderate others; plain members may not", () => {
    expect(canModifyMessage({ authorId: "a", viewerId: "v", facts: facts("GROUP", { viewerGroupRole: "admin" }), org: member })).toBe(true);
    expect(canModifyMessage({ authorId: "a", viewerId: "v", facts: facts("GROUP"), org: member })).toBe(false);
  });

  it("DM has no admin role that reaches across", () => {
    expect(canModifyMessage({ authorId: "a", viewerId: "v", facts: facts("DM"), org: member })).toBe(false);
  });

  it("pinning: DM both sides, GROUP admins only", () => {
    expect(canPin(facts("DM"), member)).toBe(true);
    expect(canPin(facts("GROUP"), member)).toBe(false);
    expect(canPin(facts("GROUP", { viewerGroupRole: "admin" }), member)).toBe(true);
  });
});

describe("dm canonical ordering", () => {
  it("returns the same key regardless of who initiates", () => {
    expect(dmKeyOf("b", "a")).toBe(dmKeyOf("a", "b"));
    expect(dmKeyOf("b", "a").startsWith("a|")).toBe(true);
  });
});

describe("who may mute whom", () => {
  it("nobody mutes the owner, a space admin included (a space admin outranked him before the fix)", () => {
    expect(canModerateTarget({ role: "ADMIN", spaceRole: "ADMIN" }, { role: "OWNER", spaceRole: "ADMIN" })).toBe(false);
    expect(canModerateTarget({ role: "MEMBER", spaceRole: "ADMIN" }, { role: "OWNER", spaceRole: null })).toBe(false);
    expect(canModerateTarget({ role: "OWNER" }, { role: "OWNER" })).toBe(false);
  });

  it("the owner mutes anybody else; nobody mutes an equal", () => {
    expect(canModerateTarget({ role: "OWNER" }, { role: "ADMIN", spaceRole: "ADMIN" })).toBe(true);
    expect(canModerateTarget({ role: "ADMIN", spaceRole: "ADMIN" }, { role: "ADMIN", spaceRole: "ADMIN" })).toBe(false);
    expect(canModerateTarget({ role: "ADMIN", spaceRole: "ADMIN" }, { role: "MEMBER", spaceRole: "MEMBER" })).toBe(true);
  });
});
