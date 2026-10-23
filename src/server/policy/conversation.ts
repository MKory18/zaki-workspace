import { db } from "@/server/db";

/**
 * The chat policy: pure `can*` functions over a facts object, plus the DB loaders that
 * collect the facts. Every chat service and route decides here — never inline.
 *
 * Decisions in force (design + coordinator):
 *  - a topic's audience is every ACTIVE member of its space (a WorkspaceMember row; guests
 *    included as GUEST) unless the topic is `restricted`, then only the ConversationMember rows;
 *  - a DM's audience is its two ACTIVE people;
 *  - the OWNER reads everything silently, without being in any row; he may WRITE only where he
 *    has joined (a ConversationMember row of his own) and never in somebody else's DM;
 *  - a GUEST reads the topics of the spaces they are in, never DMs, never HQ;
 *  - a suspended or offboarded person is nobody: rows they left behind do not count.
 */

export type ConversationFacts = {
  kind: "DM" | "GROUP" | "TOPIC";
  orgId: string;
  spaceId: string | null;
  restricted: boolean;
  closedAt: Date | null;
  postingPolicy: string; // ALL | ADMINS
  topicType: string; // DISCUSSION | ANNOUNCEMENTS | ...
  /** of the viewer's ConversationMember row, when one exists */
  viewerIsMember: boolean;
  /** role of the viewer's group row, when this is a GROUP */
  viewerGroupRole: string | null;
  /** the space member row of the viewer (topics), with the moderators' mute */
  viewerSpaceRole: "ADMIN" | "MEMBER" | "GUEST" | null;
  mutedUntil: Date | null;
  /** the DM's other person is ACTIVE (DM audience only) */
  dmOtherActive: boolean;
  /** ids of the audience members that have a ConversationMember row (restricted topics / DMs) */
  memberIds: string[];
};

export type OrgFacts = {
  /** the organization these facts were loaded for: a viewer's rank counts only in THAT org */
  orgId: string;
  role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST";
  status: "ACTIVE" | "SUSPENDED" | "OFFBOARDED";
};

export const isSpaceAdmin = (role: string | null): boolean => role === "ADMIN";

/** An ACTIVE person of the organization. A suspended or offboarded person is nobody. */
export function isActiveOf(org: OrgFacts | null): boolean {
  return !!org && org.status === "ACTIVE";
}

export function isOwnerOf(org: OrgFacts | null): boolean {
  return isActiveOf(org) && org!.role === "OWNER";
}

export function isOrgAdminOf(org: OrgFacts | null): boolean {
  return isActiveOf(org) && org!.role === "ADMIN";
}

/**
 * The viewer's org facts are of the conversation's own org. A rank held in another company
 * (an OWNER there included) never reaches this conversation: every `can*` below starts here.
 */
export function isOrgOf(facts: ConversationFacts | null, org: OrgFacts | null): boolean {
  return !!facts && !!org && facts.orgId === org.orgId;
}

/** May the viewer READ the conversation (they exist in the audience, or the OWNER silently)? */
export function canRead(facts: ConversationFacts | null, org: OrgFacts | null): boolean {
  if (!facts || !isActiveOf(org) || !isOrgOf(facts, org)) return false;
  if (isOwnerOf(org)) return true; // the owner's silent eye reads everything
  if (facts.kind === "DM") return facts.viewerIsMember && facts.dmOtherActive;
  if (facts.kind === "GROUP") return facts.viewerIsMember && org!.role !== "GUEST";
  if (!facts.viewerSpaceRole) return false; // not in the space, not in the topic
  if (!facts.restricted) return true; // the space's people are the audience
  return facts.viewerIsMember; // a restricted topic takes its own rows
}

/** May the viewer POST here right now? Reading comes first, always. */
export function canPost(
  facts: ConversationFacts,
  org: OrgFacts,
  opts: { ownerJoined: boolean } = { ownerJoined: false },
): boolean {
  if (!canRead(facts, org)) return false;
  if (facts.kind === "DM") return facts.viewerIsMember && facts.dmOtherActive;
  if (facts.kind === "GROUP") return facts.viewerIsMember && org!.role !== "GUEST";
  if (facts.closedAt) return false; // a closed topic takes no messages until an admin reopens it
  const role = org!.role;
  if (role === "OWNER") return opts.ownerJoined; // the owner posts only where he joined
  if (isSpaceAdmin(facts.viewerSpaceRole)) return true; // the mute never binds the space's admins
  if (facts.mutedUntil && facts.mutedUntil > new Date()) return false; // muted in the space
  if (facts.postingPolicy === "ADMINS") return false; // only space admins (or the owner) post
  if (role === "GUEST" && facts.topicType === "ANNOUNCEMENTS") return false; // guests read announcements
  return true;
}

/** May the viewer moderate this conversation (mute, delete others, pin, close, settings, notes)? */
export function canModerate(facts: ConversationFacts | null, org: OrgFacts | null): boolean {
  if (!facts || !isActiveOf(org) || !isOrgOf(facts, org)) return false;
  if (isOwnerOf(org)) return true;
  if (facts.kind === "GROUP") return facts.viewerIsMember && facts.viewerGroupRole === "admin";
  if (org!.role === "ADMIN") return facts.kind !== "DM"; // org admins moderate topics, never DMs
  return isSpaceAdmin(facts.viewerSpaceRole) && facts.kind !== "DM";
}

/** May the viewer PIN this message's conversation? Topics: moderators; DMs: either participant. */
export function canPin(facts: ConversationFacts | null, org: OrgFacts | null): boolean {
  if (!facts || !isActiveOf(org) || !isOrgOf(facts, org)) return false;
  if (facts.kind === "DM") return facts.viewerIsMember && (isOwnerOf(org) || org!.role !== "GUEST");
  return canModerate(facts, org);
}

/** May the viewer EDIT or DELETE this message? Own messages always; others need moderation. */
export function canModifyMessage(opts: {
  authorId: string;
  viewerId: string;
  facts: ConversationFacts | null;
  org: OrgFacts | null;
}): boolean {
  if (!opts.facts || !isActiveOf(opts.org) || !isOrgOf(opts.facts, opts.org)) return false;
  if (opts.authorId === opts.viewerId) return canRead(opts.facts, opts.org);
  return canModerate(opts.facts, opts.org);
}

/** May the viewer read the archive (the owner's archive + oversight)? `archive.view`, OWNER only. */
export function canArchive(role: string | null | undefined): boolean {
  return role === "OWNER";
}

/**
 * May the viewer (a MODERATOR muting) act on the target? Nobody mutes the OWNER, nobody mutes
 * somebody of equal or higher standing (an ADMIN cannot mute an ADMIN; the OWNER can mute anybody).
 */
export function canModerateTarget(actor: { role: string; spaceRole?: string | null }, target: { role: string; spaceRole?: string | null }): boolean {
  if (actor.role === "OWNER") return target.role !== "OWNER";
  const standing = (r: string, s?: string | null): number => {
    if (r === "ADMIN") return s === "ADMIN" ? 3 : 2;
    if (r === "LEAD") return 2;
    return 1;
  };
  return standing(actor.role, actor.spaceRole) > standing(target.role, target.spaceRole);
}

// ---------- DB loaders ----------

/** The viewer's organization facts for the conversation's org (or null: not a member there). */
export async function loadOrgFacts(userId: string, orgId: string): Promise<OrgFacts | null> {
  const m = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    select: { role: true, status: true },
  });
  return m ? { orgId, role: m.role, status: m.status } : null;
}

/**
 * Everything the pure functions need about one conversation for one viewer, in ONE query round.
 * Returns null when the conversation does not exist (read: 404).
 */
export async function loadConversationFacts(userId: string, conversationId: string): Promise<ConversationFacts | null> {
  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    select: {
      orgId: true,
      kind: true,
      spaceId: true,
      restricted: true,
      closedAt: true,
      postingPolicy: true,
      topicType: true,
      members: { select: { userId: true } },
    },
  });
  if (!conv) return null;

  let dmOtherActive = false;
  if (conv.kind === "DM") {
    const otherId = conv.members.map((m) => m.userId).find((id) => id !== userId);
    if (otherId) {
      const other = await db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: conv.orgId, userId: otherId } },
        select: { status: true },
      });
      dmOtherActive = other?.status === "ACTIVE";
    }
  }

  const [org, spaceRow, convRow] = await Promise.all([
    loadOrgFacts(userId, conv.orgId),
    conv.spaceId
      ? db.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: conv.spaceId, userId } },
          select: { role: true, mutedUntil: true },
        })
      : Promise.resolve(null),
    db.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { userId: true, role: true },
    }),
  ]);

  return {
    kind: conv.kind as "DM" | "GROUP" | "TOPIC",
    orgId: conv.orgId,
    spaceId: conv.spaceId,
    restricted: conv.restricted,
    closedAt: conv.closedAt,
    postingPolicy: conv.postingPolicy,
    topicType: conv.topicType,
    viewerIsMember: !!convRow,
    viewerGroupRole: convRow?.role ?? null,
    viewerSpaceRole: spaceRow?.role ?? null,
    mutedUntil: spaceRow?.mutedUntil ?? null,
    dmOtherActive,
    memberIds: conv.members.map((m) => m.userId),
  };
}

/** The shared contract: true for the audience AND for the OWNER (silent oversight). */
export async function canReadConversation(userId: string, conversationId: string): Promise<boolean> {
  const [facts, org] = await Promise.all([
    loadConversationFacts(userId, conversationId),
    db.conversation.findUnique({ where: { id: conversationId }, select: { orgId: true } }).then((c) =>
      c ? loadOrgFacts(userId, c.orgId) : null,
    ),
  ]);
  return canRead(facts, org);
}

/** May the viewer post in this conversation? (Routes call this before a write.) */
export async function canPostInConversation(userId: string, conversationId: string): Promise<boolean> {
  const facts = await loadConversationFacts(userId, conversationId);
  if (!facts) return false;
  const org = await loadOrgFacts(userId, facts.orgId);
  if (!org) return false;
  return canPost(facts, org, { ownerJoined: facts.viewerIsMember });
}

/** May the viewer moderate this conversation? */
export async function canModerateConversation(userId: string, conversationId: string): Promise<boolean> {
  const facts = await loadConversationFacts(userId, conversationId);
  if (!facts) return false;
  const org = await loadOrgFacts(userId, facts.orgId);
  return canModerate(facts, org);
}
