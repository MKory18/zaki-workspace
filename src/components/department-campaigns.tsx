"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Megaphone, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { fmtShort } from "@/lib/format";
import { cn } from "@/lib/utils";

export function errText(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError && err.messageKey) {
    const x = t(err.messageKey);
    return x !== err.messageKey ? x : t("common.error");
  }
  return t("common.error");
}

interface CampaignRow {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: "DRAFT" | "SCHEDULED" | "RUNNING" | "DONE" | "CANCELLED";
  priority: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  owner: { id: string; name: string } | null;
  _count: { items: number };
}

const STATUS_CHIP: Record<string, string> = {
  DRAFT: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  SCHEDULED: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  RUNNING: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  DONE: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  CANCELLED: "bg-gray-500/10 text-gray-500",
};

const STATUSES = ["DRAFT", "SCHEDULED", "RUNNING", "DONE", "CANCELLED"] as const;

/** الحملات — marketing calendar for one department. */
export function DepartmentCampaigns({
  deptId,
  deptName,
  emoji,
  canManage,
  currentUserId,
}: {
  deptId: string;
  deptName: string;
  emoji: string | null;
  canManage: boolean;
  currentUserId: string;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const campaigns = useQuery({
    queryKey: ["campaigns", deptId],
    queryFn: () => apiGet<{ campaigns: CampaignRow[] }>(`/api/departments/${deptId}/campaigns`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["campaigns", deptId] });
  };

  const create = useMutation({
    mutationFn: () =>
      apiPost(`/api/departments/${deptId}/campaigns`, {
        title,
        description: description || null,
        priority,
        startDate,
        endDate,
      }),
    onSuccess: () => {
      setCreating(false);
      setTitle("");
      setDescription("");
      setStartDate("");
      setEndDate("");
      toast(t("camp.created"), "success");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiPatch(`/api/campaigns/${id}`, payload),
    onSuccess: () => invalidate(),
    onError: (err) => toast(errText(err, t), "error"),
  });

  const del = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/campaigns/${id}`),
    onSuccess: () => {
      toast(t("camp.deleted"), "success");
      invalidate();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });

  const rows = campaigns.data?.campaigns ?? [];
  const running = rows.filter((r) => r.status === "RUNNING" || r.status === "SCHEDULED").length;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
        <Megaphone className="size-4 text-violet-500" />
        {t("camp.new")}
      </Button>

      {creating ? (
        <Modal open onClose={() => setCreating(false)} title={`${emoji ?? "📣"} ${deptName} — ${t("camp.newTitle")}`}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim().length >= 3 && startDate && endDate) create.mutate();
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("camp.titlePlaceholder")} required minLength={3} maxLength={200} />
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder={t("camp.descPlaceholder")} />
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1">
                <span className="text-[10px] text-muted">{t("camp.start")}</span>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-muted">{t("camp.end")}</span>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-muted">{t("camp.priority")}</span>
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {["URGENT", "HIGH", "NORMAL", "LOW"].map((p) => (
                    <option key={p} value={p}>
                      {t(`priority.${p}`)}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={create.isPending}>
                <Plus className="size-4" />
                {t("camp.submit")}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-surface p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-fg-muted">
            <CalendarClock className="size-3.5 text-violet-500" />
            {t("camp.activeCount", { n: running })}
          </p>
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const mine = r.owner?.id === currentUserId;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="shrink-0 font-mono text-[10px] text-muted">C{r.number}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-fg">{r.title}</p>
                    <p className="truncate text-[10px] text-muted">
                      {fmtShort(r.startDate, "ar")} ← {fmtShort(r.endDate, "ar")}
                      {r.owner ? ` · ${r.owner.name}` : ""}
                      {` · ${r._count.items} ${t("camp.items")}`}
                    </p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold", STATUS_CHIP[r.status])}>
                    {t(`camp.status_${r.status.toLowerCase()}`)}
                  </span>
                  {canManage ? (
                    <Select
                      value={r.status}
                      onChange={(e) => update.mutate({ id: r.id, payload: { status: e.target.value } })}
                      className="h-7 w-28 text-[11px]"
                      aria-label={t("camp.statusLabel")}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(`camp.status_${s.toLowerCase()}`)}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("camp.delete")}
                      className="text-red-500"
                      disabled={del.isPending}
                      onClick={() => {
                        if (confirm(t("camp.deleteConfirm", { title: r.title }))) del.mutate(r.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}