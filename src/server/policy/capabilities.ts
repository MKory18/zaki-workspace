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
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
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
];

/** What each rank can do without anyone switching anything on. The OWNER can do everything. */
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
  ],
  LEAD: ["spaces.create", "directory.view", "crm.view", "crm.edit", "prices.view"],
  MEMBER: ["spaces.create", "directory.view", "crm.view", "crm.edit"],
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
}

/** rank defaults + extras - revoked, then the hard limits (guests none, owner-only capabilities). */
export function effectiveCapabilities(member: CapabilitySource): Set<Capability> {
  if (member.role === "OWNER") return new Set(CAPABILITIES);
  if (member.role === "GUEST") return new Set();
  const caps = new Set<Capability>(RANK_DEFAULTS[member.role]);
  for (const c of member.capabilities ?? []) if (isCapability(c)) caps.add(c);
  for (const c of member.revokedCapabilities ?? []) if (isCapability(c)) caps.delete(c);
  for (const c of OWNER_ONLY) caps.delete(c);
  return caps;
}

export function can(source: CapabilitySource, capability: Capability): boolean {
  return effectiveCapabilities(source).has(capability);
}

export type GrantProblem = "unknown_capability" | "owner_only" | "not_for_guests" | "owner_has_all";

/** Why this capability may not be switched on for a person with this role (null = fine). */
export function grantProblem(role: OrgRole, capability: string): GrantProblem | null {
  if (!isCapability(capability)) return "unknown_capability";
  if (role === "OWNER") return "owner_has_all";
  if (OWNER_ONLY.includes(capability)) return "owner_only";
  if (role === "GUEST") return "not_for_guests";
  return null;
}
