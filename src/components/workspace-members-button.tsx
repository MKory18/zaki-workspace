"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Minus, ShieldCheck, Users } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

interface MemberRow {
  id: string;
  name: string;
  email?: string; // absent for an external partner (guest) viewer
  role?: string; // ADMIN | MEMBER | GUEST | org:OWNER | org:ADMIN — absent for a guest viewer
}
interface DirectoryPerson {
  userId: string;
  user: { id: string; name: string };
}

function errText(err: unknown, t: (k: string) => string) {
  if (err instanceof ApiError && err.messageKey) {
    const x = t(err.messageKey);
    return x !== err.messageKey ? x : t("common.error");
  }
  return t("common.error");
}

/** "أعضاء المساحة" — list/add/remove/promote, per-workspace isolation door. */
export function WorkspaceMembersButton({ workspaceId }: { workspaceId: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const members = useQuery({
    queryKey: ["ws-members", workspaceId],
    queryFn: () => apiGet<{ members: MemberRow[] }>(`/api/workspaces/${workspaceId}/members`),
    enabled: open,
  });

  const directory = useQuery({
    queryKey: ["ws-directory"],
    queryFn: () => apiGet<{ people: DirectoryPerson[] }>("/api/chat/directory"),
    enabled: open,
  });

  const manage = useMutation({
    mutationFn: (payload: Record<string, string[]>) =>
      apiPost(`/api/workspaces/${workspaceId}/members`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-members", workspaceId] }),
    onError: (err) => toast(errText(err, t), "error"),
  });

  // A guest viewer gets rows without a role (names only): treat that as "no role", never crash.
  const rows = (members.data?.members ?? []).map((m) => ({ ...m, role: m.role ?? "" }));
  const real = rows.filter((m) => !m.role.startsWith("org:"));
  const inherited = rows.filter((m) => m.role.startsWith("org:"));
  const memberIds = new Set([...real.map((m) => m.id), ...inherited.map((m) => m.id)]);
  const addable = (directory.data?.people ?? []).filter((p) => !memberIds.has(p.userId));

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Users className="size-4 text-accent" />
        {t("ws.members")}
      </Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title={t("ws.members_title")}>
          <div className="space-y-3">
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {[...real, ...inherited].map((m) => {
                const isInherited = m.role.startsWith("org:");
                const roleKey = m.role.replace("org:", "");
                return (
                  <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-fg">{m.name}</span>
                    {isInherited ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">
                        <ShieldCheck className="size-3" />
                        {t("ws.inherited")}
                      </span>
                    ) : m.role ? (
                      <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted">
                        {t(roleKey === "ADMIN" ? "ws.role_admin" : roleKey === "GUEST" ? "ws.role_guest" : "ws.role_member")}
                      </span>
                    ) : null}
                    {!isInherited && m.role === "MEMBER" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("ws.promote")}
                        disabled={manage.isPending}
                        onClick={() => manage.mutate({ promoteUserIds: [m.id] })}
                      >
                        <Crown className="size-3.5 text-amber-500" />
                      </Button>
                    ) : null}
                    {!isInherited && m.role === "ADMIN" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("ws.demote")}
                        disabled={manage.isPending}
                        onClick={() => manage.mutate({ demoteUserIds: [m.id] })}
                      >
                        <Crown className="size-3.5 text-slate-400" />
                      </Button>
                    ) : null}
                    {!isInherited ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("ws.removeMember")}
                        className="text-red-500"
                        disabled={manage.isPending}
                        onClick={() => manage.mutate({ removeUserIds: [m.id] })}
                      >
                        <Minus className="size-3.5" />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
              {members.isLoading ? <li className="px-3 py-3 text-xs text-muted">…</li> : null}
            </ul>
            <div>
              <p className="mb-1 text-xs font-medium text-fg-muted">{t("ws.addMembers")}</p>
              <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {addable.map((p) => (
                  <li key={p.userId} className="flex items-center gap-2 px-3 py-1.5">
                    <button
                      type="button"
                      className="text-[11px] font-medium text-accent hover:underline disabled:opacity-40"
                      disabled={manage.isPending}
                      onClick={() => manage.mutate({ addUserIds: [p.userId] })}
                    >
                      + {t("ws.add")}
                    </button>
                    <span className="truncate text-[10px] text-muted">{p.user.name}</span>
                  </li>
                ))}
                {members.data && addable.length === 0 ? (
                  <li className="px-3 py-2 text-[10px] text-muted">{t("ws.everyoneIn")}</li>
                ) : null}
              </ul>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
