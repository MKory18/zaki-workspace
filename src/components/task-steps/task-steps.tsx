"use client";

import React from "react";
import { ArrowDown, ArrowUp, Check, ListChecks, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorKeyOf, rt } from "@/lib/reminders/client";
import { MAX_STEP_TITLE, progressOf, type StepDto } from "@/lib/task-steps";
import { cn } from "@/lib/utils";

/**
 * «الخطوات» — the short checklist inside a task, on the task's own page: «3 من 5» with a bar, one row per step
 * (tick, rename, move up or down, delete) and one box to add. Every change is sent at once and the list is read back
 * from the server's answer, so what is drawn is what is stored.
 *
 * `canEdit` is what the page worked out (who may edit the task; never a guest; never the owner reading silently): the
 * server decides again on every write. Without it the rows are plain and nothing can be touched.
 */
export function TaskSteps({ taskId, initial, canEdit }: { taskId: string; initial: StepDto[]; canEdit: boolean }) {
  const [steps, setSteps] = React.useState<StepDto[]>(initial);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const base = `/api/tasks/${encodeURIComponent(taskId)}/steps`;
  const progress = progressOf(steps);

  /** One request; the list is re-read afterwards (a move, a delete or another tab's change all end the same way). */
  async function send(url: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      if (!res.ok) {
        setError(errorKeyOf(await res.json().catch(() => null), "steps.failed"));
        return false;
      }
      return true;
    } catch {
      setError("steps.failed");
      return false;
    } finally {
      const fresh = await fetch(base, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (fresh?.steps) setSteps(fresh.steps as StepDto[]);
      setBusy(false);
    }
  }

  const patch = (id: string, body: Record<string, unknown>) => send(`${base}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title || busy) return;
    if (await send(base, { method: "POST", body: JSON.stringify({ title }) })) setDraft("");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-fg">
            <ListChecks className="h-4 w-4" aria-hidden="true" /> {rt("steps.title")}
          </p>
          {progress.total > 0 ? (
            <span data-step-progress className="text-xs font-medium text-fg-muted" aria-label={rt("steps.progress_aria", { done: progress.done, total: progress.total })}>
              {rt("steps.progress", { done: progress.done, total: progress.total })}
            </span>
          ) : null}
        </div>
        {progress.total > 0 ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
        ) : (
          <p className="mt-0.5 text-xs text-fg-muted">{rt("steps.hint")}</p>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        {steps.length === 0 ? <p className="text-xs text-muted">{rt("steps.empty")}</p> : null}
        <ol className="space-y-1">
          {steps.map((step, i) => (
            <li key={step.id} data-step={step.id} className="group flex items-center gap-2 rounded-lg border border-border bg-surface-2/50 px-2 py-1.5">
              <button
                type="button"
                role="checkbox"
                aria-checked={step.done}
                disabled={!canEdit || busy}
                aria-label={rt(step.done ? "steps.untick_aria" : "steps.tick_aria", { title: step.title })}
                onClick={() => void patch(step.id, { done: !step.done })}
                className={cn(
                  "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
                  step.done ? "border-ok bg-ok text-ok-fg" : "border-muted/50 hover:border-ok",
                  (!canEdit || busy) && "opacity-60",
                )}
              >
                {step.done ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
              </button>
              {canEdit ? (
                <input
                  defaultValue={step.title}
                  key={`${step.id}:${step.title}`}
                  maxLength={MAX_STEP_TITLE}
                  aria-label={rt("steps.name_aria")}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next && next !== step.title) void patch(step.id, { title: next });
                    else e.target.value = step.title;
                  }}
                  className={cn("min-w-0 flex-1 border-0 bg-transparent text-sm focus:outline-none", step.done ? "text-muted line-through" : "text-fg")}
                />
              ) : (
                <span className={cn("min-w-0 flex-1 text-sm", step.done ? "text-muted line-through" : "text-fg")}>{step.title}</span>
              )}
              {canEdit ? (
                <span className="flex shrink-0 items-center">
                  <button
                    type="button"
                    aria-label={rt("steps.up")}
                    disabled={busy || i === 0}
                    onClick={() => void patch(step.id, { afterId: steps[i - 2]?.id ?? null })}
                    className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30"
                  >
                    <ArrowUp className="size-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={rt("steps.down")}
                    disabled={busy || i === steps.length - 1}
                    onClick={() => void patch(step.id, { afterId: steps[i + 1]!.id })}
                    className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30"
                  >
                    <ArrowDown className="size-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={rt("steps.remove")}
                    disabled={busy}
                    onClick={() => void send(`${base}/${encodeURIComponent(step.id)}`, { method: "DELETE" })}
                    className="rounded p-1 text-muted hover:bg-surface-2 hover:text-danger disabled:opacity-30"
                  >
                    <Trash2 className="size-3" aria-hidden="true" />
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>

        {canEdit ? (
          <form onSubmit={add} className="flex gap-2 border-t border-border pt-3">
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={MAX_STEP_TITLE} placeholder={rt("steps.add_placeholder")} aria-label={rt("steps.add_placeholder")} />
            <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
              {rt("steps.add")}
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted">{rt("steps.readonly")}</p>
        )}
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {rt(error)}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
