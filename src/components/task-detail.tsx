"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CalendarDays, Pencil, Trash2, User, Flag, Type as TypeIcon, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiDelete, apiPost, apiPatch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardBody, CardHeader, Badge } from "@/components/ui/card";
import { fmtDMY, fmtDateTime } from "@/lib/format";
import { columnLabel, enumLabel, enumOptions } from "@/lib/i18n/enums";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";

export interface TaskDetailData {
  id: string;
  number: number;
  key: string;
  title: string;
  description: string | null;
  priority: string;
  type: string;
  /** The name of the board column the task is in (a column's name is whatever the board was given). */
  status: string;
  boardId: string;
  boardName: string;
  dueDate: string | null;
  creatorName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** «المعلم» the task points at, if any (null when the feature is off or the task has none). */
  milestoneId?: string | null;
  milestoneName?: string | null;
  labelIds: string[];
  comments: { id: string; author: string; authorId: string; body: string; createdAt: string }[];
}

export function TaskDetail({
  task,
  canEdit,
  currentUserId,
  members,
  labels,
  milestones,
}: {
  task: TaskDetailData;
  /** Whether the API would let this person change the task (see canWriteInWorkspace). */
  canEdit: boolean;
  currentUserId: string;
  members: { id: string; name: string }[];
  labels: { id: string; name: string; color: string }[];
  /** The milestones of this task's project, or `null` when the company's «المعالم» switch is off. */
  milestones?: { id: string; name: string }[] | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate?.slice(0, 10) ?? "");
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [milestoneId, setMilestoneId] = useState(task.milestoneId ?? "");
  const [selectedLabels, setSelectedLabels] = useState<string[]>(task.labelIds);
  const [commentBody, setCommentBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiPatch<{ task: unknown }>(`/api/tasks/${task.id}`, data),
    onSuccess: () => {
      setError(null);
      toast(t("task.updated"), "success");
      router.refresh();
    },
    onError: () => {
      toast(t("common.error"), "error");
      setError("common.error");
    },
  });

  const comment = useMutation({
    mutationFn: (body: string) =>
      apiPost<{ comment: unknown }>(`/api/tasks/${task.id}/comments`, { body }),
    onSuccess: () => {
      setCommentBody("");
      setError(null);
      router.refresh();
    },
    onError: () => {
      toast(t("common.error"), "error");
      setError("common.error");
    },
  });

  const commentEdit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiPatch(`/api/tasks/${task.id}/comments/${id}`, { body }),
    onSuccess: () => {
      setEditingComment(null);
      toast(t("task.updated"), "success");
      router.refresh();
    },
    onError: () => toast(t("common.error"), "error"),
  });

  const commentDelete = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/tasks/${task.id}/comments/${id}`),
    onSuccess: () => {
      toast(t("comment.deleted"), "success");
      router.refresh();
    },
    onError: () => toast(t("common.error"), "error"),
  });

  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");

  function saveIfChanged() {
    const patch: Record<string, unknown> = {};
    if (title !== task.title && title.trim()) patch.title = title.trim();
    if (description !== (task.description ?? "")) patch.description = description || null;
    if (priority !== task.priority) patch.priority = priority;
    if (dueDate !== (task.dueDate?.slice(0, 10) ?? "")) patch.dueDate = dueDate || null;
    if (assigneeId !== (task.assigneeId ?? "")) patch.assigneeId = assigneeId || null;
    if (milestoneId !== (task.milestoneId ?? "")) patch.milestoneId = milestoneId || null;
    if (JSON.stringify(selectedLabels) !== JSON.stringify(task.labelIds))
      patch.labelIds = selectedLabels;
    if (Object.keys(patch).length) save.mutate(patch);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-2">
        <span dir="ltr" className="font-mono text-xs text-muted">{task.key}</span>
        <Badge>{columnLabel(task.status)}</Badge>
        <span className="text-xs text-fg-muted">{t("task.inBoard", { name: task.boardName })}</span>
        {canEdit ? null : <span className="ms-auto text-xs text-muted">{t("task.readOnly")}</span>}
      </header>

      <Card>
        <CardBody className="space-y-4">
          {canEdit ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveIfChanged}
              className="w-full border-0 bg-transparent text-lg font-semibold text-fg focus:outline-none"
              maxLength={280}
              aria-label={t("task.title")}
            />
          ) : (
            <h1 className="text-lg font-semibold text-fg">{task.title}</h1>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <span className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
                <User className="h-3 w-3" /> {t("task.assignee")}
              </span>
              {canEdit ? (
                <Select
                  value={assigneeId}
                  onChange={(e) => {
                    setAssigneeId(e.target.value);
                    save.mutate({ assigneeId: e.target.value || null });
                  }}
                  className="h-8"
                >
                  <option value="">{t("list.unassigned")}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-fg">{task.assigneeName ?? t("list.unassigned")}</p>
              )}
            </div>
            <div>
              <span className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
                <Flag className="h-3 w-3" /> {t("task.priority")}
              </span>
              {canEdit ? (
                <Select
                  value={priority}
                  onChange={(e) => {
                    setPriority(e.target.value);
                    save.mutate({ priority: e.target.value });
                  }}
                  className="h-8"
                >
                  {enumOptions("TaskPriority").map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-fg">{enumLabel("TaskPriority", task.priority)}</p>
              )}
            </div>
            <div>
              <span className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
                <CalendarDays className="h-3 w-3" /> {t("task.due")}
              </span>
              {canEdit ? (
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  onBlur={saveIfChanged}
                  className="h-8"
                />
              ) : (
                <p className="text-sm text-fg">{task.dueDate ? fmtDMY(task.dueDate) : "—"}</p>
              )}
            </div>
            {milestones && milestones.length > 0 ? (
              <div>
                <span className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
                  <Flag className="h-3 w-3" /> {t("task.milestone")}
                </span>
                {canEdit ? (
                  <Select
                    value={milestoneId}
                    onChange={(e) => {
                      setMilestoneId(e.target.value);
                      save.mutate({ milestoneId: e.target.value || null });
                    }}
                    className="h-8"
                  >
                    <option value="">{t("task.noMilestone")}</option>
                    {milestones.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-sm text-fg">{task.milestoneName ?? t("task.noMilestone")}</p>
                )}
              </div>
            ) : null}
            <div>
              <span className="mb-1 block text-xs text-fg-muted">{t("task.labels")}</span>
              {canEdit ? (
                <div className="flex flex-wrap gap-1">
                  {labels.map((l) => {
                    const active = selectedLabels.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          const next = active
                            ? selectedLabels.filter((id) => id !== l.id)
                            : [...selectedLabels, l.id];
                          setSelectedLabels(next);
                          save.mutate({ labelIds: next });
                        }}
                        className={cn(
                          "rounded-md border px-1.5 py-0.5 text-xs transition-colors",
                          active
                            ? "border-accent/60 bg-accent/10 text-fg"
                            : "border-border text-fg-muted hover:border-accent/40",
                        )}
                      >
                        <span
                          aria-hidden
                          className="me-1 inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: l.color }}
                        />
                        {l.name}
                      </button>
                    );
                  })}
                  {labels.length === 0 ? (
                    <p className="text-xs text-muted">{t("task.noLabels")}</p>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {labels
                    .filter((l) => task.labelIds.includes(l.id))
                    .map((l) => (
                      <Badge key={l.id} color={l.color}>
                        {l.name}
                      </Badge>
                    ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <span className="mb-1 flex items-center gap-1 text-xs text-fg-muted">
              <TypeIcon className="h-3 w-3" /> {t("task.description")}
            </span>
            {canEdit ? (
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={saveIfChanged}
                rows={4}
                placeholder={t("task.descriptionPlaceholder")}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-fg">{description}</p>
            )}
          </div>

          {error ? <p className="text-xs text-danger">{t(error)}</p> : null}
          {save.isPending ? <p className="text-xs text-muted">{t("common.saving")}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <p className="text-sm font-semibold text-fg">{t("task.commentsCount", { n: task.comments.length })}</p>
        </CardHeader>
        <CardBody className="space-y-3">
          {task.comments.map((c) => {
            const mine = c.authorId === currentUserId;
            return (
              <div key={c.id} className="rounded-lg border border-border bg-surface-2/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-fg">{c.author}</p>
                  <div className="flex items-center gap-1">
                    <p className="text-xs text-muted">{fmtDateTime(c.createdAt)}</p>
                    {mine && canEdit ? (
                      <>
                        <button
                          type="button"
                          aria-label={t("comment.edit")}
                          onClick={() => {
                            setEditingComment(c.id);
                            setEditingBody(c.body);
                          }}
                          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={t("comment.delete")}
                          onClick={() => {
                            if (confirm(t("comment.deleteConfirm"))) commentDelete.mutate(c.id);
                          }}
                          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                {editingComment === c.id ? (
                  <form
                    className="mt-2 flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editingBody.trim()) commentEdit.mutate({ id: c.id, body: editingBody.trim() });
                    }}
                  >
                    <Textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      rows={2}
                    />
                    <Button type="submit" size="sm" disabled={commentEdit.isPending || !editingBody.trim()}>
                      {t("common.save")}
                    </Button>
                  </form>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{c.body}</p>
                )}
              </div>
            );
          })}
          {task.comments.length === 0 ? (
            <p className="text-xs text-muted">{t("tkAct.noComments")}</p>
          ) : null}

          {canEdit ? (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (commentBody.trim()) comment.mutate(commentBody.trim());
              }}
            >
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                rows={2}
                placeholder={t("comment.placeholder")}
              />
              <Button type="submit" size="icon" aria-label={t("comment.submit")} disabled={!commentBody.trim()}>
                <Send className="h-4 w-4 rtl:-scale-x-100" />
              </Button>
            </form>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
