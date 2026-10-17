"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Minus, ShieldCheck, UserCog, UserPlus, Users } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input, Select } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { avatarHue } from "@/lib/format";

interface MemberRow {
  id: string;
  name: string;
  email: string;
  jobTitle: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER" | "GUEST";
  joinedAt: string;
}

function errText(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError && err.messageKey) {
    const x = t(err.messageKey);
    return x !== err.messageKey ? x : t("common.error");
  }
  return t("common.error");
}

const ROLE_BADGE: Record<string, string> = {
  OWNER: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  ADMIN: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  MEMBER: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  GUEST: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
};

/** الأعضاء — admin roster: add employees, grant roles, reset passwords, remove. */
export function OrgMembersView({ orgId, actorRole }: { orgId: string; actorRole: "OWNER" | "ADMIN" }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<MemberRow | null>(null);

  const query = useQuery({
    queryKey: ["org-members", orgId],
    queryFn: () => apiGet<{ members: MemberRow[]; actorRole: string }>(`/api/organizations/${orgId}/members`),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["org-members", orgId] });

  const addForm = useMutation({
    mutationFn: (payload: { name: string; email: string; password: string; role: string }) =>
      apiPost(`/api/organizations/${orgId}/members`, payload),
    onSuccess: () => {
      setAddOpen(false);
      toast(t("orgm.added"), "success");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const update = useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: { role?: string; password?: string } }) =>
      apiPatch(`/api/organizations/${orgId}/members/${userId}`, payload),
    onSuccess: () => {
      setEditing(null);
      toast(t("orgm.updated"), "success");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => apiDelete(`/api/organizations/${orgId}/members/${userId}`),
    onSuccess: () => {
      toast(t("orgm.removed"), "success");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const members = query.data?.members ?? [];
  const isOwner = actorRole === "OWNER";

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
            <Users className="size-5 text-accent" />
            {t("orgm.title")}
          </h1>
          <p className="text-xs text-fg-muted">{t("orgm.subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus className="size-4" />
          {t("orgm.add")}
        </Button>
      </header>

      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: `hsl(${avatarHue(m.name)} 55% 45%)` }}
            >
              {m.name.trim().charAt(0)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">
                {m.name}
                {m.role === "OWNER" ? <ShieldCheck className="ms-1.5 inline size-3.5 text-amber-500" /> : null}
              </p>
              <p className="truncate text-[11px] text-muted">{m.email}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_BADGE[m.role]}`}>
              {t(`orgm.role_${m.role.toLowerCase()}`)}
            </span>
            {m.role !== "OWNER" ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" aria-label={t("orgm.edit")} onClick={() => setEditing(m)}>
                  <UserCog className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("orgm.remove")}
                  className="text-red-500"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm(t("orgm.removeConfirm", { name: m.name }))) remove.mutate(m.id);
                  }}
                >
                  <Minus className="size-4" />
                </Button>
              </div>
            ) : null}
          </li>
        ))}
        {query.isLoading ? <li className="px-4 py-6 text-center text-xs text-muted">…</li> : null}
      </ul>

      {addOpen ? (
        <AddMemberModal
          open
          onClose={() => setAddOpen(false)}
          pending={addForm.isPending}
          isOwner={isOwner}
          onSubmit={(v) => addForm.mutate(v)}
        />
      ) : null}

      {editing ? (
        <EditMemberModal
          member={editing}
          isOwner={isOwner}
          pending={update.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(payload) => update.mutate({ userId: editing.id, payload })}
        />
      ) : null}
    </div>
  );
}

function AddMemberModal({
  open,
  onClose,
  pending,
  isOwner,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  pending: boolean;
  isOwner: boolean;
  onSubmit: (v: { name: string; email: string; password: string; role: string }) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("MEMBER");
  return (
    <Modal open={open} onClose={onClose} title={t("orgm.addTitle")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ name, email, password, role });
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("orgm.name")} required minLength={2} />
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("orgm.email")} required />
        <Input
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("orgm.password")}
          required
          minLength={8}
        />
        <p className="text-[10px] text-muted">{t("orgm.passwordHint")}</p>
        <Select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="MEMBER">{t("orgm.role_member")}</option>
          {isOwner ? <option value="GUEST">{t("orgm.role_guest")}</option> : null}
          {isOwner ? <option value="ADMIN">{t("orgm.role_admin")}</option> : null}
        </Select>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {t("orgm.add")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditMemberModal({
  member,
  isOwner,
  pending,
  onClose,
  onSubmit,
}: {
  member: MemberRow;
  isOwner: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: { role?: string; password?: string }) => void;
}) {
  const { t } = useI18n();
  const [role, setRole] = useState<string>(member.role);
  const [password, setPassword] = useState("");
  return (
    <Modal open onClose={onClose} title={`${t("orgm.editTitle")} — ${member.name}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const payload: { role?: string; password?: string } = {};
          if (role !== member.role) payload.role = role;
          if (password) payload.password = password;
          if (Object.keys(payload).length === 0) {
            onClose();
            return;
          }
          onSubmit(payload);
        }}
      >
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">{t("orgm.roleLabel")}</span>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="MEMBER">{t("orgm.role_member")}</option>
            {isOwner ? <option value="GUEST">{t("orgm.role_guest")}</option> : null}
            {isOwner ? <option value="ADMIN">{t("orgm.role_admin")}</option> : null}
          </Select>
        </label>
        <label className="block space-y-1">
          <span className="flex items-center gap-1 text-xs font-medium text-fg-muted">
            <KeyRound className="size-3.5" />
            {t("orgm.resetPassword")}
          </span>
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("orgm.passwordKeep")}
            minLength={8}
          />
          <span className="block text-[10px] text-muted">{t("orgm.passwordHint")}</span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
