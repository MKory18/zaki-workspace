import { CAPABILITIES, RANK_DEFAULTS, effectiveCapabilities } from "@/server/policy/capabilities";
import type { ActorInfo, ContractMember, ContractSpace, MembersResponse } from "@/lib/members-ui";

/** A fixed "now" so every relative time in a test is deterministic. */
export const NOW = Date.parse("2026-10-22T12:00:00Z");
export const ago = (seconds: number): string => new Date(NOW - seconds * 1000).toISOString();

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

/** One row of `GET /api/organizations/[id]/members`, with everything the contract promises. */
export function contractMember(over: Partial<ContractMember> & { id: string }): ContractMember {
  const role = over.role ?? "MEMBER";
  const capabilities = over.capabilities ?? [];
  const revokedCapabilities = over.revokedCapabilities ?? [];
  return {
    name: "شخص",
    username: null,
    email: null,
    jobTitle: null,
    role,
    status: "ACTIVE",
    managerId: null,
    managerName: null,
    capabilities,
    revokedCapabilities,
    effectiveCapabilities: [...effectiveCapabilities({ role, capabilities, revokedCapabilities })],
    lastLoginAt: null,
    mustChangePassword: false,
    openWork: 0,
    workspaces: [],
    ...over,
  };
}

const ws = (id: string, name: string) => ({ id, name, role: "MEMBER" });

export const SPACES: ContractSpace[] = [
  { id: "s1", name: "المقر" },
  { id: "s2", name: "المشتريات" },
  { id: "s3", name: "الشحن" },
];

export const OWNER = contractMember({
  id: "u-owner",
  name: "أحمد الكوري",
  username: "ahmad",
  email: "ahmad@example.test",
  jobTitle: "المدير العام",
  role: "OWNER",
  lastLoginAt: ago(5 * MIN),
});

export const ADMIN = contractMember({
  id: "u-admin",
  name: "عبد الله",
  username: "abdullah",
  jobTitle: "مدير المشتريات",
  role: "ADMIN",
  lastLoginAt: ago(3 * HOUR),
  workspaces: [ws("s1", "المقر"), ws("s2", "المشتريات")],
});

export const LEAD = contractMember({
  id: "u-lead",
  name: "منار",
  username: "manar",
  jobTitle: "قائدة فريق المودريتورز",
  role: "LEAD",
  managerId: "u-admin",
  managerName: "عبد الله",
  lastLoginAt: ago(2 * DAY),
  workspaces: [ws("s1", "المقر"), ws("s3", "الشحن"), ws("s4", "المودريتورز"), ws("s5", "الأفكار"), ws("s6", "الدعم")],
});

export const MEMBER = contractMember({
  id: "u-member",
  name: "قبس",
  username: "qabas",
  role: "MEMBER",
  mustChangePassword: true,
  lastLoginAt: null,
  workspaces: [ws("s1", "المقر")],
});

export const SUSPENDED = contractMember({
  id: "u-sus",
  name: "حسن",
  username: "hassan",
  role: "MEMBER",
  status: "SUSPENDED",
  lastLoginAt: ago(40 * DAY),
  openWork: 2,
  workspaces: [ws("s1", "المقر")],
});

export const OFFBOARDED = contractMember({
  id: "u-gone",
  name: "راما",
  username: "rama",
  role: "MEMBER",
  status: "OFFBOARDED",
  lastLoginAt: ago(90 * DAY),
});

export const GUEST = contractMember({
  id: "u-guest",
  name: "أبو نزار",
  username: "abunizar",
  role: "GUEST",
  lastLoginAt: ago(HOUR),
  workspaces: [ws("s7", "المصنع")],
});

/** The seven people, in the order the server answers (ACTIVE first). */
export const SAMPLE: MembersResponse = {
  members: [OWNER, ADMIN, LEAD, MEMBER, GUEST, SUSPENDED, OFFBOARDED],
  actorRole: "OWNER",
  spaces: SPACES,
};

/** Who is looking, for the flows that compute local state from the actor's own capabilities. */
export const OWNER_ACTOR: ActorInfo = { id: "u-owner", role: "OWNER", caps: [...CAPABILITIES] };
export const ADMIN_ACTOR: ActorInfo = { id: "u-admin", role: "ADMIN", caps: [...RANK_DEFAULTS.ADMIN] };
