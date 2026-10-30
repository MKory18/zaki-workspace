"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { errorKeyOf, rt, whenLabel } from "@/lib/reminders/client";
import { enumLabel } from "@/lib/i18n/enums";
import { RECURRENCE_MODES, ruleToInput, type RecurrenceKind, type RecurrenceModeKey, type RuleInput } from "@/lib/task-recurrence";
import type { RecurrenceDto } from "@/server/services/task-recurrence";
import { cn } from "@/lib/utils";

/** The week as an Arabic calendar lays it out, the weekend first (the numbers are those of the JavaScript Date). */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

type Pick = "NONE" | RecurrenceKind;
const PICKS: readonly Pick[] = ["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

/** «تتكرر كل أسبوع: السبت، الإثنين», in words: what the task page says under the button. */
export function recurrenceSummary(r: RecurrenceDto): string {
  const rule = r.rule;
  switch (rule.kind) {
    case "DAILY":
      return rt("recurring.summary.DAILY");
    case "WEEKLY":
      return rt("recurring.summary.WEEKLY", { days: WEEK_ORDER.filter((d) => rule.days.includes(d)).map((d) => rt(`recurring.day.${d}`)).join("، ") });
    case "MONTHLY":
      return rt("recurring.summary.MONTHLY", { day: rule.day });
    case "YEARLY":
      return rt("recurring.summary.YEARLY");
  }
}

/** «المهمة التالية: …», in the company's zone (only for a series that runs on a schedule). */
export function nextLine(r: RecurrenceDto, timeZone: string): string | null {
  if (!r.active) return null;
  if (r.mode === "ON_COMPLETE") return rt("recurring.next_on_complete");
  return r.nextDueAt ? rt("recurring.next", { when: whenLabel(r.nextDueAt, timeZone) }) : null;
}

/**
 * The form of a task's recurrence: how often (none, daily, weekly on chosen days, monthly on a day, yearly), when it ends
 * (optional) and the mode («عند الإنجاز» or «حسب الجدول»). It writes `PUT /api/tasks/[id]/recurrence` (and `DELETE` for
 * «بدون تكرار»); the server decides again. The risk and its fix are shown together: ⚠️ new tasks are made on their own,
 * 🔧 stop it any time and what was made stays.
 */
export function RecurrenceForm({
  taskId,
  initial,
  timeZone,
  onSaved,
  onCancel,
}: {
  taskId: string;
  initial: RecurrenceDto | null;
  timeZone: string;
  onSaved: (next: RecurrenceDto | null) => void;
  onCancel: () => void;
}) {
  const first: RuleInput | null = initial?.active ? ruleToInput(initial.rule) : null;
  const [pick, setPick] = React.useState<Pick>(first?.kind ?? "NONE");
  const [days, setDays] = React.useState<number[]>(first?.kind === "WEEKLY" ? first.days : []);
  const [day, setDay] = React.useState<number>(first?.kind === "MONTHLY" && first.day ? first.day : 1);
  const [endsOn, setEndsOn] = React.useState(initial?.active ? (initial.endsOn ?? "") : "");
  const [mode, setMode] = React.useState<RecurrenceModeKey>(initial?.mode ?? "ON_COMPLETE");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const url = `/api/tasks/${encodeURIComponent(taskId)}/recurrence`;

  function toggle(d: number) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  const needsDays = pick === "WEEKLY" && days.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || needsDays) return;
    if (pick === "NONE" && !initial?.active) {
      onCancel();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const rule: RuleInput | null =
        pick === "NONE" ? null : pick === "WEEKLY" ? { kind: "WEEKLY", days } : pick === "MONTHLY" ? { kind: "MONTHLY", day } : { kind: pick };
      const res = await fetch(url, {
        method: rule ? "PUT" : "DELETE",
        headers: { "content-type": "application/json" },
        body: rule ? JSON.stringify({ rule, mode, endsOn: endsOn || null }) : undefined,
      });
      if (!res.ok) {
        setError(errorKeyOf(await res.json().catch(() => null), "recurring.failed"));
        return;
      }
      const body = (await res.json().catch(() => null)) as { recurrence?: RecurrenceDto | null } | null;
      onSaved(body?.recurrence ?? null);
    } catch {
      setError("recurring.failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-recurrence-form>
      <div>
        <Label>{rt("recurring.field.kind")}</Label>
        <Select value={pick} onChange={(e) => setPick(e.target.value as Pick)} aria-label={rt("recurring.field.kind")}>
          {PICKS.map((p) => (
            <option key={p} value={p}>
              {rt(`recurring.kind.${p}`)}
            </option>
          ))}
        </Select>
      </div>

      {pick === "WEEKLY" ? (
        <div>
          <Label>{rt("recurring.field.days")}</Label>
          <div role="group" aria-label={rt("recurring.field.days")} className="flex flex-wrap gap-1.5">
            {WEEK_ORDER.map((d) => {
              const on = days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  data-weekday={d}
                  onClick={() => toggle(d)}
                  className={cn(
                    "h-9 rounded-lg border px-3 text-sm transition-colors",
                    on ? "border-accent bg-accent/10 font-medium text-fg" : "border-border bg-surface text-fg-muted hover:bg-surface-2",
                  )}
                >
                  {rt(`recurring.day.${d}`)}
                </button>
              );
            })}
          </div>
          {needsDays ? (
            <p role="alert" className="mt-1 text-xs text-danger">
              {rt("recurrence.days_required")}
            </p>
          ) : null}
        </div>
      ) : null}

      {pick === "MONTHLY" ? (
        <div>
          <Label>{rt("recurring.field.day")}</Label>
          <Input type="number" dir="ltr" min={1} max={31} value={day} onChange={(e) => setDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} aria-label={rt("recurring.field.day")} />
          <span className="mt-1 block text-xs text-fg-muted">{rt("recurring.last_day_hint")}</span>
        </div>
      ) : null}

      {pick !== "NONE" ? (
        <>
          <div>
            <Label>{rt("recurring.field.end")}</Label>
            <Input type="date" dir="ltr" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} aria-label={rt("recurring.field.end")} />
            <span className="mt-1 block text-xs text-fg-muted">{rt("recurring.zone", { zone: timeZone })}</span>
          </div>
          <div>
            <Label>{rt("recurring.field.mode")}</Label>
            <Select value={mode} onChange={(e) => setMode(e.target.value as RecurrenceModeKey)} aria-label={rt("recurring.field.mode")}>
              {RECURRENCE_MODES.map((m) => (
                <option key={m} value={m}>
                  {enumLabel("RecurrenceMode", m)}
                </option>
              ))}
            </Select>
            <span className="mt-1 block text-xs text-fg-muted">{rt(`recurring.mode_hint.${mode}`)}</span>
          </div>
          <div className="space-y-1 rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs text-fg" data-recurrence-warning>
            <p>
              <span aria-hidden="true">⚠️ </span>
              {rt("recurring.warn_auto")}
            </p>
            <p className="text-fg-muted">
              <span aria-hidden="true">🔧 </span>
              {rt("recurring.fix_auto")}
            </p>
            <p>
              <span aria-hidden="true">⚠️ </span>
              {rt("recurring.warn_assign")}
            </p>
            <p className="text-fg-muted">
              <span aria-hidden="true">🔧 </span>
              {rt("recurring.fix_assign")}
            </p>
          </div>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {rt(error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {rt("recurring.cancel")}
        </Button>
        <Button type="submit" disabled={busy || needsDays}>
          {pick === "NONE" && initial?.active ? rt("recurring.stop") : rt("recurring.save")}
        </Button>
      </div>
    </form>
  );
}
