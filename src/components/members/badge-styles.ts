import type { MemberStatusName, OrgRoleName } from "@/lib/members-ui";

/**
 * The colours of the rank and status pills. Plain data, so a server page can use it too (a value
 * exported by a "use client" file cannot be read on the server).
 */
export const PILL = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold";

export const RANK_BADGE: Record<OrgRoleName, string> = {
  OWNER: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ADMIN: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  LEAD: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
  MEMBER: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  GUEST: "bg-gray-500/10 text-gray-700 dark:text-gray-300",
};

export const STATUS_BADGE: Record<MemberStatusName, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  SUSPENDED: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  OFFBOARDED: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
};
