import { describe, expect, it, vi } from "vitest";

// the policy module loads the DB client at import; these tests only use its pure functions
vi.mock("@/server/db", () => ({ db: {} }));

import { canModerate, canPin, canPost, type ConversationFacts, type OrgFacts } from "@/server/policy/conversation";
import { menuFor, menuOpen, messageMenuItems, type MessageMenuContext, type MessageMenuId } from "@/components/chat/message/message-menu-registry";

/**
 * The menu against the server: for every kind of person in every kind of conversation, on their own
 * message and on somebody else's, the menu offers exactly what the server's rules allow (the same pure
 * policy functions the routes call). The owner in silent oversight gets no menu at all (a reaction or a
 * pin is refused to him until he joins; a delete would put his name on the page).
 */

type Who = { name: string; role: OrgFacts["role"]; spaceRole: ConversationFacts["viewerSpaceRole"]; member: boolean };
const WHO: Who[] = [
  { name: "member", role: "MEMBER", spaceRole: "MEMBER", member: true },
  { name: "member without a row (an open topic)", role: "MEMBER", spaceRole: "MEMBER", member: false },
  { name: "space admin", role: "MEMBER", spaceRole: "ADMIN", member: true },
  { name: "org admin, space member", role: "ADMIN", spaceRole: "MEMBER", member: true },
  { name: "guest", role: "GUEST", spaceRole: "GUEST", member: true },
  { name: "owner, joined", role: "OWNER", spaceRole: null, member: true },
  { name: "owner, silent oversight", role: "OWNER", spaceRole: null, member: false },
];

const facts = (kind: ConversationFacts["kind"], w: Who, over: Partial<ConversationFacts> = {}): ConversationFacts => ({
  kind,
  orgId: "o1",
  spaceId: kind === "TOPIC" ? "s1" : null,
  restricted: false,
  closedAt: null,
  postingPolicy: "ALL",
  teamId: null,
  viewerInTeam: false,
  topicType: "DISCUSSION",
  viewerIsMember: w.member,
  viewerGroupRole: null,
  viewerSpaceRole: kind === "TOPIC" ? w.spaceRole : null,
  mutedUntil: null,
  dmOtherActive: true,
  memberIds: [],
  ...over,
});

/** What the server allows, rule by rule (messages.ts: editMessage, deleteMessage, togglePin, addNote; sendMessage for a reply). */
function serverAllows(f: ConversationFacts, org: OrgFacts, mine: boolean): Set<MessageMenuId> {
  const oversight = org.role === "OWNER" && !f.viewerIsMember;
  const out = new Set<MessageMenuId>(["forward", "copy"]);
  if (canPost(f, org, { ownerJoined: f.viewerIsMember })) out.add("reply");
  if (!oversight && canPin(f, org) && (f.kind === "DM" ? f.viewerIsMember : canModerate(f, org))) out.add("pin");
  if (mine) out.add("edit");
  if (mine || canModerate(f, org)) out.add("delete");
  if (canModerate(f, org)) out.add("note");
  return out;
}

const contextOf = (f: ConversationFacts, org: OrgFacts, mine: boolean): MessageMenuContext => ({
  mine,
  deleted: false,
  kind: "TEXT",
  hasText: true,
  pinned: false,
  conversationKind: f.kind,
  canPost: canPost(f, org, { ownerJoined: f.viewerIsMember }),
  canModerate: canModerate(f, org),
  oversight: org.role === "OWNER" && !f.viewerIsMember,
});

describe("the message menu offers exactly what the server allows", () => {
  for (const kind of ["TOPIC", "DM"] as const) {
    for (const w of WHO) {
      if (kind === "DM" && (w.role === "GUEST" || !w.member)) continue; // nobody else is in a DM
      for (const mine of [true, false]) {
        it(`${kind} · ${w.name} · ${mine ? "own" : "someone else's"} message`, () => {
          const f = facts(kind, w);
          const org: OrgFacts = { orgId: "o1", role: w.role, status: "ACTIVE" };
          const ctx = contextOf(f, org, mine);
          const offered = new Set(menuFor(ctx).map((a) => a.id));
          if (ctx.oversight) {
            expect(offered.size).toBe(0);
            return;
          }
          expect([...offered].sort()).toEqual([...serverAllows(f, org, mine)].sort());
        });
      }
    }
  }

  it("the cases the old buttons got wrong", () => {
    const admin = facts("TOPIC", WHO[2]!);
    const adminOrg: OrgFacts = { orgId: "o1", role: "MEMBER", status: "ACTIVE" };
    // a moderator never gets «تعديل» on somebody else's message (the server answers chat.e.not_author)
    expect(menuFor(contextOf(admin, adminOrg, false)).map((a) => a.id)).not.toContain("edit");
    // a member may not pin in a topic, though it is their own message
    const member = facts("TOPIC", WHO[0]!);
    expect(menuFor(contextOf(member, { orgId: "o1", role: "MEMBER", status: "ACTIVE" }, true)).map((a) => a.id)).not.toContain("pin");
    // both people of a DM may pin
    const dm = facts("DM", WHO[0]!);
    expect(menuFor(contextOf(dm, { orgId: "o1", role: "MEMBER", status: "ACTIVE" }, false)).map((a) => a.id)).toContain("pin");
  });

  it("nothing on a deleted message or a system line; no edit or copy on a voice note", () => {
    const ctx = contextOf(facts("TOPIC", WHO[2]!), { orgId: "o1", role: "MEMBER", status: "ACTIVE" }, true);
    expect(menuOpen({ ...ctx, deleted: true })).toBe(false);
    expect(menuOpen({ ...ctx, kind: "SYSTEM" })).toBe(false);
    const voice = menuFor({ ...ctx, kind: "VOICE", hasText: false }).map((a) => a.id);
    expect(voice).not.toContain("edit");
    expect(voice).not.toContain("copy");
  });

  it("every label is a dictionary key, in Arabic", async () => {
    const { AR } = await import("@/lib/i18n/dict");
    for (const item of messageMenuItems) {
      for (const pinned of [true, false]) {
        const key = item.labelKey({ pinned } as MessageMenuContext);
        expect(AR[key], key).toMatch(/[؀-ۿ]/);
      }
    }
  });
});
