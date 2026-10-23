import type { MemberStatusName, OrgRoleName } from "@/lib/members-ui";

/**
 * The colours of the rank and status pills. Plain data, so a server page can use it too (a value
 * exported by a "use client" file cannot be read on the server).
 */
export const PILL = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold";

export const RANK_BADGE: Record<OrgRoleName, string> = {
  OWNER: "bg-warn/10 text-warn",
  ADMIN: "bg-cat-1/10 text-cat-1",
  LEAD: "bg-cat-4/10 text-cat-4",
  MEMBER: "bg-info/10 text-info",
  GUEST: "bg-surface-2 text-fg-muted",
};

export const STATUS_BADGE: Record<MemberStatusName, string> = {
  ACTIVE: "bg-ok/10 text-ok",
  SUSPENDED: "bg-warn/10 text-warn",
  OFFBOARDED: "bg-surface-2 text-fg-muted",
};
