"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2, Trash2 } from "lucide-react";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";

/** What `GET /api/tasks/[id]/links` answers (src/server/services/task-links.ts). */
export interface TaskLinkDto {
  id: string;
  kind: "BLOCKS" | "BLOCKED_BY" | "DUPLICATES";
  task: { id: string; number: number; title: string; key: string };
}

export interface TaskLinksDto {
  out: TaskLinkDto[];
  in: TaskLinkDto[];
}

export interface LinkCandidate {
  id: string;
  key: string;
  title: string;
}

const KINDS = ["BLOCKS", "BLOCKED_BY", "DUPLICATES"] as const;

/**
 * «التبعيات» — the links between two tasks, on the task's own page.
 *
 * Two lists, because a link reads in two directions: what this task points at, and the tasks that
 * point at it. Both are the same table (src/server/services/task-links.ts), so a link added here
 * appears on the other task's page under «مهام بتشير لهالمهمة» with nothing else to do.
 *
 * The row is information, never a lock: nothing on this card stops a move, a close or a count. The
 * card is only drawn when the company's «تبعيات المهام» switch is on.
 */
export function TaskLinks({
  taskId,
  canEdit,
  candidates,
}: {
  taskId: string;
  canEdit: boolean;
  /** The other tasks of the same space, for the picker. */
  candidates: LinkCandidate[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();
  const [kind, setKind] = useState<(typeof KINDS)[number]>("BLOCKS");
  const [otherId, setOtherId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["task-links", taskId],
    queryFn: () => apiGet<TaskLinksDto>(`/api/tasks/${taskId}/links`),
  });

  const add = useMutation({
    mutationFn: () => apiPost(`/api/tasks/${taskId}/links`, { dependsOnId: otherId, kind }),
    onSuccess: () => {
      setOtherId("");
      setError(null);
      toast(t("link.added"), "success");
      router.refresh();
      void query.refetch();
    },
    onError: (err) => {
      // the server names which refusal it is, so the screen says the same thing
      const key = err instanceof ApiError && err.messageKey ? err.messageKey : "common.error";
      setError(key);
      toast(t(key), "error");
    },
  });

  const remove = useMutation({
    mutationFn: (linkId: string) => apiDelete(`/api/tasks/${taskId}/links/${linkId}`),
    onSuccess: () => {
      toast(t("link.removed"), "success");
      router.refresh();
      void query.refetch();
    },
    onError: () => toast(t("common.error"), "error"),
  });

  const links = query.data;
  const empty = links ? links.out.length === 0 && links.in.length === 0 : false;

  return (
    <Card>
      <CardHeader>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Link2 className="h-4 w-4" /> {t("link.title")}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">{t("link.hint")}</p>
      </CardHeader>
      <CardBody className="space-y-3">
        {query.isLoading ? <p className="text-xs text-muted">{t("common.loading")}</p> : null}

        {links ? (
          <>
            <div>
              <p className="mb-1 text-xs font-semibold text-fg-muted">{t("link.out")}</p>
              {links.out.length === 0 ? (
                <p className="text-xs text-muted">{t("link.empty")}</p>
              ) : (
                <ul className="space-y-1">
                  {links.out.map((link) => (
                    <li key={link.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-2 py-1.5">
                      <span className="text-xs font-semibold text-fg-muted">{t(`link.kind.${link.kind}`)}</span>
                      <a href={`/tasks/${link.task.id}`} className="min-w-0 flex-1 truncate text-sm text-fg underline-offset-2 hover:underline">
                        <span dir="ltr" className="me-1 font-mono text-xs text-muted">{link.task.key}</span>
                        {link.task.title}
                      </a>
                      {canEdit ? (
                        <button
                          type="button"
                          aria-label={t("link.remove")}
                          onClick={() => remove.mutate(link.id)}
                          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {links.in.length ? (
              <div>
                <p className="mb-1 text-xs font-semibold text-fg-muted">{t("link.in")}</p>
                <ul className="space-y-1">
                  {links.in.map((link) => (
                    <li key={link.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-2 py-1.5">
                      <span className="text-xs font-semibold text-fg-muted">{t(`link.kind.${link.kind}`)}</span>
                      <a href={`/tasks/${link.task.id}`} className="min-w-0 flex-1 truncate text-sm text-fg underline-offset-2 hover:underline">
                        <span dir="ltr" className="me-1 font-mono text-xs text-muted">{link.task.key}</span>
                        {link.task.title}
                      </a>
                      {canEdit ? (
                        <button
                          type="button"
                          aria-label={t("link.remove")}
                          onClick={() => remove.mutate(link.id)}
                          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {empty ? <p className="text-xs text-muted">{t("link.empty")}</p> : null}
          </>
        ) : null}

        {canEdit ? (
          candidates.length ? (
            <form
              className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (otherId) add.mutate();
              }}
            >
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs text-fg-muted" htmlFor="link-kind">
                  {t("link.kind")}
                </label>
                <Select id="link-kind" value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} className="h-8">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`link.kind.${k}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="min-w-0 flex-[2]">
                <label className="mb-1 block text-xs text-fg-muted" htmlFor="link-other">
                  {t("link.other")}
                </label>
                <Select id="link-other" value={otherId} onChange={(e) => setOtherId(e.target.value)} className="h-8">
                  <option value="">{t("link.choose")}</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.key} — {c.title}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" size="sm" disabled={!otherId || add.isPending}>
                {t("link.add")}
              </Button>
            </form>
          ) : (
            <p className="text-xs text-muted">{t("link.none")}</p>
          )
        ) : (
          <p className="text-xs text-muted">{t("link.readOnly")}</p>
        )}

        {error ? <p className="text-xs text-danger">{t(error)}</p> : null}
      </CardBody>
    </Card>
  );
}
