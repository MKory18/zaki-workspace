"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CalendarCheck, Plus, Trash2 } from "lucide-react";
import { apiDelete, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { fmtDMY } from "@/lib/format";

/** What `GET /api/projects/[id]/milestones` answers (src/server/services/milestones.ts). */
export interface MilestoneDto {
  id: string;
  name: string;
  description: string | null;
  status: "OPEN" | "COMPLETED" | "OVERDUE";
  targetDate: string | null;
  overdue: boolean;
  openTasks: number;
}

/**
 * «المعالم» on a project's page.
 *
 * A milestone is a date the project is measured against, and the tasks of the project can point at it
 * (`Task.milestoneId`). It is information, never a lock: attaching a task does not freeze it, and a
 * milestone marked complete does not close anything by itself.
 *
 * `OVERDUE` is not stored — it is «open, and its day has passed in the company's zone» — so the badge
 * follows the date the moment somebody moves it.
 */
export function MilestonesCard({
  projectId,
  milestones,
  canEdit,
}: {
  projectId: string;
  milestones: MilestoneDto[];
  /** The server would accept a write (the project's space and team, plus «projects.edit»). */
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) =>
    setError(err instanceof ApiError && err.messageKey ? err.messageKey : "common.error");

  const create = useMutation({
    mutationFn: () => apiPost(`/api/projects/${projectId}/milestones`, { name, targetDate: target || null }),
    onSuccess: () => {
      setError(null);
      setName("");
      setTarget("");
      setAdding(false);
      toast(t("milestones.created"), "success");
      router.refresh();
    },
    onError: fail,
  });

  const setStatus = useMutation({
    mutationFn: (vars: { id: string; status: "OPEN" | "COMPLETED" }) =>
      apiPatch(`/api/milestones/${vars.id}`, { status: vars.status }),
    onSuccess: () => {
      setError(null);
      toast(t("milestones.updated"), "success");
      router.refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/milestones/${id}`),
    onSuccess: () => {
      setError(null);
      toast(t("milestones.deleted"), "success");
      router.refresh();
    },
    onError: fail,
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-sm font-semibold text-fg">
          <CalendarCheck className="size-4 text-accent" />
          {t("milestones.title")}
        </p>
        {canEdit && !adding ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            {t("milestones.new")}
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-3">
        {milestones.length === 0 && !adding ? (
          <p className="text-sm text-fg-muted">{t("milestones.empty")}</p>
        ) : null}

        {milestones.length > 0 ? (
          <ul className="divide-y divide-border">
            {milestones.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{m.name}</p>
                  <p className="text-xs text-fg-muted">
                    {[
                      m.targetDate ? fmtDMY(m.targetDate) : t("milestones.noDate"),
                      t("milestones.openTasks", { n: m.openTasks }),
                    ].join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={
                      m.status === "OVERDUE"
                        ? "rounded-md bg-danger/10 px-1.5 py-0.5 text-xs text-danger"
                        : m.status === "COMPLETED"
                          ? "rounded-md bg-ok/10 px-1.5 py-0.5 text-xs text-ok"
                          : "rounded-md bg-surface-1 px-1.5 py-0.5 text-xs text-fg-muted"
                    }
                  >
                    {t(
                      m.status === "OVERDUE"
                        ? "milestones.overdue"
                        : m.status === "COMPLETED"
                          ? "milestones.done"
                          : "milestones.open",
                    )}
                  </span>
                  {canEdit ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={setStatus.isPending}
                        onClick={() =>
                          setStatus.mutate({ id: m.id, status: m.status === "COMPLETED" ? "OPEN" : "COMPLETED" })
                        }
                      >
                        {m.status === "COMPLETED" ? t("milestones.markOpen") : t("milestones.markDone")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("milestones.delete")}
                        disabled={remove.isPending}
                        onClick={() => {
                          if (!window.confirm(t("milestones.deleteConfirm", { name: m.name }))) return;
                          remove.mutate(m.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {adding ? (
          <form
            className="space-y-2 rounded-lg border border-border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              create.mutate();
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("milestones.namePlaceholder")}
              aria-label={t("milestones.name")}
              maxLength={120}
              required
            />
            <Input
              type="date"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label={t("milestones.target")}
            />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={create.isPending || !name.trim()}>
                {t("milestones.create")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
              >
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        ) : null}

        {error ? <p className="text-xs text-danger">{t(error)}</p> : null}
      </CardBody>
    </Card>
  );
}
