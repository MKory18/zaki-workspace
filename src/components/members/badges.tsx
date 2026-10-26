"use client";

import { KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { ROLE_KEYS } from "@/lib/i18n/roles";
import { STATUS_KEYS, type MemberStatusName, type OrgRoleName } from "@/lib/members-ui";
import { PILL, RANK_BADGE, STATUS_BADGE } from "./badge-styles";

/** The person's rank in Arabic (مالك، شريك، مشرف، قائد فريق، عضو، زائر): an OWNER who is not the primary owner is a partner. */
export function RankBadge({ role, primaryOwner }: { role: OrgRoleName; primaryOwner?: boolean }) {
  const { t } = useI18n();
  const key = role === "OWNER" && primaryOwner === false ? "role.partner" : (ROLE_KEYS[role] ?? "role.member");
  return <span className={cn(PILL, RANK_BADGE[role])}>{t(key)}</span>;
}

/** فعّال / موقوف / مُخرَج. */
export function StatusBadge({ status }: { status: MemberStatusName }) {
  const { t } = useI18n();
  return <span className={cn(PILL, STATUS_BADGE[status])}>{t(STATUS_KEYS[status])}</span>;
}

/** The temporary password has not been changed yet: a risk worth seeing on the card. */
export function PendingPasswordBadge() {
  const { t } = useI18n();
  return (
    <span className={cn(PILL, "bg-warn/10 text-warn")}>
      <KeyRound className="size-3" aria-hidden="true" />
      {t("members.pw_pending")}
    </span>
  );
}
