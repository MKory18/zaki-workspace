"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { DepartmentTickets } from "@/components/department-tickets";

interface DeptRow {
  id: string;
  name: string;
  emoji: string | null;
  color: string | null;
  leadId: string | null;
  members: { id: string; name: string; jobTitle: string | null; role: string }[];
  projectsCount: number;
  openTasks: number;
  overdueTasks: number;
  openTickets: number;
}

interface DeptDetail extends DeptRow {
  projects: { id: string; name: string; status: string; workspace: string; openTasks: number; doneTasks: number }[];
}

interface Person {
  userId: string;
  role: string;
  user: { id: string; name: string; jobTitle: string | null };
}

const COLORS = ["sky", "emerald", "amber", "fuchsia", "indigo", "rose"] as const;
const CHIP: Record<string, string> = {
  sky: "bg-sky-500/15 text-sky-500",
  emerald: "bg-emerald-500/15 text-emerald-500",
  amber: "bg-amber-500/15 text-amber-500",
  fuchsia: "bg-fuchsia-500/15 text-fuchsia-500",
  indigo: "bg-indigo-500/15 text-indigo-500",
  rose: "bg-rose-500/15 text-rose-500",
};
const EMOJIS = ["ًںژ¨", "ًں’»", "ًں–¥ï¸ڈ", "ًں’¼", "ًں“£", "âڑ™ï¸ڈ", "ًں‘”", "ًںڑ€"];

export function DepartmentsView({ me }: { me: { role: string; id: string } }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const manage = me.role === "OWNER" || me.role === "ADMIN";

  const list = useQuery({
    queryKey: ["departments", "list"],
    queryFn: () => apiGet<{ departments: DeptRow[] }>("/api/departments"),
  });

  const [editing, setEditing] = useState<"new" | DeptDetail | null>(null);
  const [membersOf, setMembersOf] = useState<DeptRow | null>(null);

  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/departments/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["departments"] });
      toast(t("dept.deleted"), "success");
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const rows = list.data?.departments ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Building2 className="size-5 text-accent" />
            {t("dept.title")}
          </h1>
          <p className="text-xs text-muted">{t("dept.subtitle")}</p>
        </div>
        {manage && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            {t("dept.new")}
          </Button>
        )}
      </header>

      {!manage && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">{t("dept.admin_only")}</p>}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface-1 px-4 py-6 text-center text-sm text-muted">
          {t("dept.noProjects")}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((d) => {
            const color = d.color && CHIP[d.color] ? d.color : "indigo";
            return (
              <li key={d.id} className="rounded-xl border border-border bg-surface-1 p-4">
                <div className="flex items-start gap-3">
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl text-lg", CHIP[color])}>
                    {d.emoji ?? "ًںڈ¢"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-sm font-semibold">{d.name}</h2>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", CHIP[color])}>
                        {d.members.length} {t("dept.members")}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted">
                      <span>{d.projectsCount} {t("dept.projects")}</span>
                      <span>{d.openTasks} {t("dept.open")}</span>
                      {d.overdueTasks > 0 && <span className="text-red-500">{d.overdueTasks} {t("dept.overdue")}</span>}
                      {d.openTickets > 0 && <span className="text-rose-500">{d.openTickets} {t("dept.ticketsOpen")}</span>}
                    </div>
                    <div className="mt-2 flex -space-x-1.5" title={d.members.map((m) => m.name).join(", ")}>
                      {d.members.slice(0, 6).map((m) => (
                        <span
                          key={m.id}
                          className="grid size-6 place-items-center rounded-full border border-surface-1 bg-surface-2 text-[9px] font-semibold"
                        >
                          {m.name.slice(0, 1)}
                        </span>
                      ))}
                      {d.members.length > 6 && <span className="text-[10px] text-muted">+{d.members.length - 6}</span>}
                    </div>
                    <div className="mt-3">
                      <DepartmentTickets
                        deptId={d.id}
                        deptName={d.name}
                        emoji={d.emoji}
                        currentUserId={me.id}
                        canAssign={manage || d.members.some((m) => m.id === me.id)}
                      />
                    </div>
                  </div>
                  {manage && (
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setMembersOf(d)} aria-label={t("dept.addMembers")}>
                        <Users className="size-4" />
                      </Button>
                      <DeleteDepRefetcher d={d} onOpen={() => del.mutate(d.id)} label={t("common.delete")} />
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("dept.editTitle")}
                        onClick={async () => {
                          const detail = await apiGet<DeptDetail>(`/api/departments/${d.id}`).catch(() => null);
                          if (detail) setEditing(detail);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <DeptModal
          value={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["departments"] });
            toast(t("dept.saved"), "success");
          }}
        />
      )}
      {membersOf && (
        <DeptMembersModal
          dept={membersOf}
          canManage={manage}
          onClose={() => setMembersOf(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ["departments"] })}
        />
      )}
    </div>
  );
}

function DeleteDepRefetcher({ d: _d, onOpen, label }: { d: DeptRow; onOpen: () => void; label: string }) {
  const { t } = useI18n();
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={label}
      onClick={() => {
        if (confirm(t("dept.deleteAsk"))) onOpen();
      }}
    >
      <Trash2 className="size-4 text-red-500" />
    </Button>
  );
}

function DeptModal({
  value,
  onClose,
  onSaved,
}: {
  value: null | DeptRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [name, setName] = useState(value?.name ?? "");
  const [emoji, setEmoji] = useState(value?.emoji ?? "ًںژ¨");
  const [color, setColor] = useState<string>(value?.color ?? "indigo");
  const [leadId, setLeadId] = useState<string>(value?.leadId ?? "");

  const dir = useQuery({ queryKey: ["dept", "directory"], queryFn: () => apiGet<{ people: Person[] }>("/api/chat/directory") });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        emoji,
        color,
        leadId: leadId || null,
      };
      return value
        ? apiPatch(`/api/departments/${value.id}`, payload)
        : apiPost<{ id: string }>("/api/departments", payload);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const valid = name.trim().length >= 2;

  return (
    <Modal open onClose={onClose} title={value ? t("dept.editTitle") : t("dept.newTitle")}>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("dept.name")} maxLength={40} />
        <div className="flex items-center gap-2">
          <select
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            className="w-14 rounded-lg border border-border bg-surface-1 px-1 text-center text-sm"
            aria-label={t("dept.emoji")}
          >
            {EMOJIS.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
          <div className="flex gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn("size-6 rounded-full", CHIP[c]?.split(" ")[0] ?? "bg-indigo-500/15", color === c && "ring-2 ring-accent")}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        <select
          value={leadId}
          onChange={(e) => setLeadId(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface-1 px-2 py-2 text-sm"
          aria-label={t("dept.lead")}
        >
          <option value="">{t("dept.noLead")}</option>
          {(dir.data?.people ?? []).map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.user.name}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            <Check className="size-4" />
            {t("common.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeptMembersModal({
  dept,
  canManage,
  onClose,
  onChanged,
}: {
  dept: DeptRow;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const detail = useQuery({
    queryKey: ["departments", "detail", dept.id],
    queryFn: () => apiGet<DeptDetail>(`/api/departments/${dept.id}`),
  });

  const change = useMutation({
    mutationFn: (input: { addUserIds?: string[]; removeUserIds?: string[] }) =>
      apiPost(`/api/departments/${dept.id}/members`, input),
    onSuccess: () => onChanged(),
    onError: (err) => toast(errText(err, t), "error"),
  });

  const allMembers = useQuery({
    queryKey: ["dept", "directory"],
    queryFn: () => apiGet<{ people: Person[] }>("/api/chat/directory"),
  });

  const inDept = new Set((detail.data?.members ?? []).map((m) => m.id));
  const addable = (allMembers.data?.people ?? []).filter((p) => !inDept.has(p.userId));

  return (
    <Modal open onClose={onClose} title={`${dept.emoji ?? "ًںڈ¢"} ${dept.name} â€” ${t("dept.members")}`}>
      <div className="space-y-3">
        <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {(detail.data?.members ?? []).map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="text-[10px] text-muted">{m.jobTitle ?? ""}</span>
              {canManage && (
                <button
                  type="button"
                  className="p-1 text-red-500 disabled:opacity-40"
                  disabled={change.isPending}
                  onClick={() => change.mutate({ removeUserIds: [m.id] })}
                  aria-label={t("dept.removeMember")}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
          {(detail.data?.members?.length ?? 0) === 0 && (
            <li className="px-3 py-3 text-xs text-muted">{t("dept.noMembers")}</li>
          )}
        </ul>
        {canManage && (
          <ul className="max-h-36 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {addable.map((p) => (
              <li key={p.userId} className="flex items-center gap-2 px-3 py-1.5">
                <button
                  type="button"
                  className="shrink-0 text-[11px] font-medium text-accent hover:underline"
                  onClick={() => change.mutate({ addUserIds: [p.userId] })}
                >
                  {t("dept.addMembers")}
                </button>
                <span className="truncate text-[10px] text-muted">{p.user.name}</span>
              </li>
            ))}
            {addable.length === 0 && <li className="px-3 py-2 text-[10px] text-muted">{t("dept.everyoneIn")}</li>}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function errText(err: unknown, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (err instanceof ApiError && err.messageKey) {
    const translated = t(err.messageKey);
    return translated !== err.messageKey ? translated : t("common.error");
  }
  if (err instanceof ApiError) {
    const translated = t(err.code);
    return translated !== err.code ? translated : t("common.error");
  }
  return t("common.error");
}
