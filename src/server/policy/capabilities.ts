import type { OrgRole } from "@prisma/client";

/**
 * Capabilities: what a person may do ON TOP of their rank. The rank gives a sensible default set;
 * the owner switches single capabilities on or off for a person instead of inventing new ranks.
 * Stored per member in `capabilities` (extra) and `revokedCapabilities` (taken away).
 */
export const CAPABILITIES = [
  "spaces.create", // open a new space and choose its people
  "users.manage", // create accounts, suspend, offboard, reset passwords
  "directory.view", // see the staff directory (names, titles, e-mail)
  "crm.view", // read customers and opportunities
  "crm.edit", // create/edit/delete customers and opportunities
  "prices.view", // see price data
  "integrations.manage", // n8n, Telegram, Google Drive
  "announce.send", // company-wide announcements
  "escalation.configure", // the escalation thresholds
  "cash.view", // the cash custody card (data comes from the OMS)
  "penalties.view", // everybody's penalties and rewards (data comes from the OMS)
  "archive.view", // the owner's archive and "all of the company" chat view: never grantable
  // the sections, each with «يشوف» (view), «يضيف ويعدّل» (edit) and «يحذف» (delete): the per-person grid
  "ideas.view",
  "ideas.edit",
  "ideas.delete",
  "goals.view",
  "goals.edit",
  "goals.delete",
  "production.view",
  "production.edit",
  "production.delete",
  "reports.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

export type SectionAction = "view" | "edit" | "delete";

/**
 * The sections of the per-person grid (the owner's decision, 2026-10-26: «يشوف / يضيف ويعدّل / يحذف» for every
 * section, by person). Each row lists the actions the section has; a section's capability is `<section>.<action>`.
 * Only wired sections are here: a box that does nothing is a lie on the screen, so each later phase adds its own.
 */
export const SECTIONS = [
  { id: "ideas", actions: ["view", "edit", "delete"] },
  { id: "goals", actions: ["view", "edit", "delete"] },
  { id: "production", actions: ["view", "edit", "delete"] },
  { id: "reports", actions: ["view"] },
] as const satisfies readonly { id: string; actions: readonly SectionAction[] }[];

export type SectionId = (typeof SECTIONS)[number]["id"];

export function sectionCapability(section: SectionId, action: SectionAction): Capability | null {
  const capability = `${section}.${action}`;
  return isCapability(capability) ? capability : null;
}

/** The boxes of the section grid (each wired): the people screen shows them as the grid, never as switches. */
export const SECTION_CAPABILITIES: readonly Capability[] = SECTIONS.flatMap((section) =>
  section.actions.map((action) => `${section.id}.${action}` as Capability),
);

/**
 * A grid section's add/edit and delete need its view: whoever can not see a section can not change it either. Only the
 * grid's sections: the customers' `crm.view` / `crm.edit` keep their own meaning until they join the grid.
 */
function dropWithoutView(caps: Set<Capability>): Set<Capability> {
  for (const section of SECTIONS) {
    const view = sectionCapability(section.id, "view");
    if (view && caps.has(view)) continue;
    for (const action of ["edit", "delete"] as const) {
      const c = sectionCapability(section.id, action);
      if (c) caps.delete(c);
    }
  }
  return caps;
}

/**
 * The switches that change something TODAY. The rest are in the catalogue so that stored values and
 * later phases stay valid, but a switch that does nothing is a lie on the people screen, so only
 * these are offered there (each later phase adds its own: announcements, escalation, cash,
 * penalties and prices come with the phases that use them).
 */
export const WIRED_CAPABILITIES: readonly Capability[] = [
  "spaces.create",
  "users.manage",
  "directory.view",
  "crm.view",
  "crm.edit",
  "integrations.manage",
  ...SECTION_CAPABILITIES,
];

/**
 * What each rank can do without anyone switching anything on. The OWNER can do everything.
 *
 * `spaces.create` is the owner's and the admins' by default (the owner's decision, 2026-10-25: «المالك
 * والمديرين بس بيفتحوا مساحات»): a lead or a member opens a space only if the owner switches it on for
 * them by name (a per-person extra in `capabilities`, which this change leaves untouched).
 *
 * The sections give each rank exactly what it could do before the grid existed, so nothing changes until the owner
 * flips a box: ideas are everyone's; goals and production routines are seen by all staff and managed by the
 * admins; the reports are a lead's and up.
 */
export const RANK_DEFAULTS: Record<OrgRole, readonly Capability[]> = {
  OWNER: CAPABILITIES,
  ADMIN: [
    "spaces.create",
    "users.manage",
    "directory.view",
    "crm.view",
    "crm.edit",
    "prices.view",
    "integrations.manage",
    "announce.send",
    "escalation.configure",
    "ideas.view",
    "ideas.edit",
    "ideas.delete",
    "goals.view",
    "goals.edit",
    "goals.delete",
    "production.view",
    "production.edit",
    "production.delete",
    "reports.view",
  ],
  LEAD: [
    "directory.view",
    "crm.view",
    "crm.edit",
    "prices.view",
    "ideas.view",
    "ideas.edit",
    "ideas.delete",
    "goals.view",
    "production.view",
    "reports.view",
  ],
  MEMBER: ["directory.view", "crm.view", "crm.edit", "ideas.view", "ideas.edit", "ideas.delete", "goals.view", "production.view"],
  GUEST: [],
};

/**
 * An external partner (GUEST) can never hold any capability, even if one is stored: they must
 * never see prices or the staff directory, and never run anything. Enforced here AND when granting.
 */
export const EXTERNAL_FORBIDDEN: readonly Capability[] = CAPABILITIES;

/** Only the OWNER has these, and they can not be handed to anyone. */
export const OWNER_ONLY: readonly Capability[] = ["archive.view"];

export interface CapabilitySource {
  role: OrgRole;
  capabilities?: readonly string[] | null;
  revokedCapabilities?: readonly string[] | null;
  /** OWNER rows: false for a partner («شريك»), whose permissions the primary owner may take away one by one. */
  primaryOwner?: boolean | null;
}

/** An OWNER who is not the primary owner: a partner. */
export function isPartner(member: Pick<CapabilitySource, "role" | "primaryOwner">): boolean {
  return member.role === "OWNER" && member.primaryOwner === false;
}

/**
 * rank defaults + extras - revoked, then the hard limits (guests none, owner-only capabilities, no add/edit or delete
 * in a section one can not see). The primary owner holds everything; a partner everything but what the primary owner
 * took away from him.
 */
export function effectiveCapabilities(member: CapabilitySource): Set<Capability> {
  if (isPartner(member)) {
    const caps = new Set<Capability>(CAPABILITIES);
    for (const c of member.revokedCapabilities ?? []) if (isCapability(c)) caps.delete(c);
    return dropWithoutView(caps);
  }
  if (member.role === "OWNER") return new Set(CAPABILITIES);
  if (member.role === "GUEST") return new Set();
  const caps = new Set<Capability>(RANK_DEFAULTS[member.role]);
  for (const c of member.capabilities ?? []) if (isCapability(c)) caps.add(c);
  for (const c of member.revokedCapabilities ?? []) if (isCapability(c)) caps.delete(c);
  for (const c of OWNER_ONLY) caps.delete(c);
  return dropWithoutView(caps);
}

export function can(source: CapabilitySource, capability: Capability): boolean {
  return effectiveCapabilities(source).has(capability);
}

export type GrantProblem = "unknown_capability" | "owner_only" | "not_for_guests" | "owner_has_all";

/**
 * Why this capability may not be switched on for a person with this role (null = fine). A partner (`partner`: an OWNER
 * who is not the primary owner) can hold or lose any capability, the owner-only ones included.
 */
export function grantProblem(role: OrgRole, capability: string, partner = false): GrantProblem | null {
  if (!isCapability(capability)) return "unknown_capability";
  if (role === "OWNER") return partner ? null : "owner_has_all";
  if (OWNER_ONLY.includes(capability)) return "owner_only";
  if (role === "GUEST") return "not_for_guests";
  return null;
}
