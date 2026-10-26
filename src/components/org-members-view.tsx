"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  creatableRoles,
  memberErrorMessage,
  type ActorInfo,
  type ContractMember,
  type MembersResponse,
  type OrgRoleName,
} from "@/lib/members-ui";
import { AddMemberSheet } from "@/components/members/add-member-sheet";
import { membersApi } from "@/components/members/api";
import { MemberSheet } from "@/components/members/member-sheet";
import { MembersList, type ListFilter } from "@/components/members/members-list";
import { useNewIntent } from "@/lib/nav/use-new-intent";

/** A clock for "last sign-in: 3 hours ago" that moves on by itself, once a minute. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * الأعضاء والصلاحيات: where the owner (or whoever holds `users.manage`) creates and manages the team.
 * A list of cards with search and a status filter, a button that adds a person in one short form,
 * and a panel per person for rank, capabilities, password, suspend, offboard and reactivate.
 *
 * It talks to the account API (`/api/organizations/[id]/members`). Every rule it applies about who
 * may do what is only about what to OFFER: the server decides again on every request.
 */
export function OrgMembersView({
  orgId,
  actorId,
  actorRole,
  actorCaps,
}: {
  orgId: string;
  /** The signed-in person: nobody acts on themselves from this screen. */
  actorId: string;
  actorRole: OrgRoleName;
  /** The capabilities the signed-in person holds: they can only hand out what they hold. */
  actorCaps: readonly string[];
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["org-members", orgId], queryFn: () => membersApi.list(orgId) });
  const [filter, setFilter] = useState<ListFilter>({ query: "", status: "ALL" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const now = useNow();

  const members = query.data?.members ?? [];
  const spaces = query.data?.spaces ?? [];
  const actor: ActorInfo = {
    id: actorId,
    role: actorRole,
    caps: actorCaps,
    primaryOwner: query.data?.actorPrimaryOwner === true,
    sectionGrid: query.data?.sectionGrid !== false,
  };
  const opened = openId ? (members.find((m) => m.id === openId) ?? null) : null;
  // «جديد» → «عضو» lands here with ?new=person; like the button, the form waits for the list
  useNewIntent("person", () => setAdding(true), query.isSuccess && creatableRoles(actorRole).length > 0);

  /** Show a change that the server accepted at once, without waiting for the list to be fetched again. */
  const patchMember = useCallback(
    (userId: string, patch: Partial<ContractMember>) => {
      qc.setQueryData<MembersResponse>(["org-members", orgId], (old) =>
        old ? { ...old, members: old.members.map((m) => (m.id === userId ? { ...m, ...patch } : m)) } : old,
      );
    },
    [qc, orgId],
  );

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["org-members", orgId] });
  }, [qc, orgId]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
            <Users className="size-5 text-accent" aria-hidden="true" />
            {t("orgm.title")}
          </h1>
          <p className="mt-1 text-xs leading-5 text-fg-muted">{t("members.subtitle")}</p>
        </div>
        {creatableRoles(actorRole).length > 0 ? (
          // the form needs the spaces and the people from the list: it opens once they are there
          <Button
            type="button"
            aria-disabled={!query.isSuccess || undefined}
            onClick={() => {
              if (query.isSuccess) setAdding(true);
            }}
            className={cn("h-11 w-full sm:w-auto", !query.isSuccess && "cursor-not-allowed opacity-60")}
          >
            <UserPlus className="size-4" aria-hidden="true" />
            {t("members.add")}
          </Button>
        ) : null}
      </header>

      <MembersList
        members={members}
        actorId={actorId}
        now={now}
        filter={filter}
        onFilterChange={setFilter}
        onOpen={setOpenId}
        loading={query.isLoading}
        errorMessage={query.isError ? memberErrorMessage(query.error, t) : null}
        onRetry={() => void query.refetch()}
      />

      {adding ? (
        <AddMemberSheet
          orgId={orgId}
          actor={actor}
          members={members}
          spaces={spaces}
          onClose={() => setAdding(false)}
          onCreated={refresh}
        />
      ) : null}

      {opened ? (
        <MemberSheet
          key={opened.id}
          orgId={orgId}
          member={opened}
          members={members}
          actor={actor}
          now={now}
          onClose={() => setOpenId(null)}
          onPatch={patchMember}
          onChanged={refresh}
        />
      ) : null}
    </div>
  );
}
