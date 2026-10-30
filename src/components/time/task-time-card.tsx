"use client";

import React from "react";
import Link from "next/link";
import { Clock, Pencil, Play, Square, Trash2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOptionalToast } from "@/components/ui/toast";
import { enumLabel } from "@/lib/i18n/enums";
import { bothText, dayLabel, errorKeyOf, tt } from "@/lib/time-client";
import { MAX_NOTE, dayKey, formatClock, formatDecimal, formatHM, runningSeconds } from "@/lib/time-tracking";
import type { EntryDto, StartResult, TaskTimeCard as CardData } from "@/server/services/time-tracking";

/**
 * «الوقت» — the time card of a task: «ابدأ» / «وقّف» with a live clock, the total, the entries (edit and delete for
 * whoever may) and «إضافة وقت يدوي».
 *
 * ⚠️ The live clock is DRAWN from the server's `startedAt` and `serverNow`, plus the seconds this browser has counted
 * since it received them: the browser's own date is never a reading, so a wrong laptop clock changes nothing. Every
 * duration that is stored comes from the server's clock. ⚠️ A timer left running past 12 hours is closed by the server
 * at the 12th hour and marked. 🔧 The card says so, and the marked entry has «تعديل».
 *
 * `initial` is what the page read (who the viewer is, what they may do); the server decides again on every write and the
 * list is read back after each one, so what is drawn is what is stored.
 */

const TICK_MS = 1000;

/** The live clock of a running entry. Same output on the server and on the first browser render (no extra seconds yet). */
export function RunningClock({ entry, serverNow, receivedAt, nowMs }: { entry: Pick<EntryDto, "startedAt">; serverNow: string; receivedAt: number; nowMs: number }) {
  const seconds = runningSeconds(entry.startedAt, serverNow, receivedAt, nowMs);
  return (
    <span data-running-clock dir="ltr" className="font-mono text-2xl font-semibold tabular-nums text-ok" role="timer" aria-label={tt("tt.clock_aria", { clock: formatClock(seconds) })}>
      {formatClock(seconds)}
    </span>
  );
}

/** One row of the list: the day, how long, who (for a manager), the note, and the marks. Plain text; the buttons are the card's. */
export function EntryLine({ entry, viewerId, showPerson }: { entry: EntryDto; viewerId: string; showPerson: boolean }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-fg">{dayLabel(entry.day)}</span>
        {entry.running ? (
          <span className="rounded bg-ok/10 px-1.5 py-0.5 text-xs font-medium text-ok">{tt("tt.running")}</span>
        ) : (
          <span data-entry-duration className="text-sm tabular-nums text-fg" aria-label={tt("tt.report.hm_aria", { hm: formatHM(entry.seconds), decimal: formatDecimal(entry.seconds) })}>
            {bothText(entry.seconds)}
          </span>
        )}
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted">{enumLabel("TimeEntrySource", entry.source)}</span>
        {showPerson && entry.userId !== viewerId ? <span className="text-xs text-fg-muted">{tt("tt.by", { name: entry.userName })}</span> : null}
      </div>
      {entry.autoStopped ? (
        <p data-auto-stopped className="mt-0.5 text-xs text-warn">
          <span aria-hidden="true">⚠️ </span>
          {tt("tt.auto_stopped")}
          <span className="block text-fg-muted">
            <span aria-hidden="true">🔧 </span>
            {tt("tt.fix")}
          </span>
        </p>
      ) : null}
      {entry.note ? <p className="mt-0.5 whitespace-pre-line break-words text-xs text-fg-muted">{entry.note}</p> : null}
    </div>
  );
}

/** The two number boxes, hours and minutes (whole numbers). */
function DurationFields({ hours, minutes, onHours, onMinutes }: { hours: string; minutes: string; onHours: (v: string) => void; onMinutes: (v: string) => void }) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        {tt("tt.field.hours")}
        <Input type="number" inputMode="numeric" min={0} max={24} step={1} value={hours} onChange={(e) => onHours(e.target.value)} className="w-20" dir="ltr" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        {tt("tt.field.minutes")}
        <Input type="number" inputMode="numeric" min={0} max={59} step={1} value={minutes} onChange={(e) => onMinutes(e.target.value)} className="w-20" dir="ltr" />
      </label>
    </>
  );
}

export function TaskTimeCard({ taskId, initial, viewerId }: { taskId: string; initial: CardData; viewerId: string }) {
  const toast = useOptionalToast();
  const [data, setData] = React.useState<CardData>(initial);
  // the instant THIS browser received `data`; the live clock adds only the seconds counted after it
  const [receivedAt, setReceivedAt] = React.useState(0);
  const [nowMs, setNowMs] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [note, setNote] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const base = `/api/tasks/${encodeURIComponent(taskId)}/time`;

  const runningHere = data.running !== null && data.running.taskId === taskId;
  const elsewhere = data.running !== null && data.running.taskId !== taskId ? data.running : null;

  // the live clock: one tick a second, only while a timer runs
  React.useEffect(() => {
    const now = Date.now();
    setReceivedAt(now);
    setNowMs(now);
  }, [data]);
  React.useEffect(() => {
    if (!data.running) return;
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [data.running]);

  const reload = React.useCallback(async () => {
    const fresh = await fetch(base, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<CardData>) : null)).catch(() => null);
    if (fresh) setData(fresh);
  }, [base]);

  /** One request; the card is re-read afterwards, so what is drawn is what is stored. */
  async function send(url: string, init: RequestInit, done: string | null): Promise<unknown> {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(errorKeyOf(body));
        return null;
      }
      if (done) {
        setNote(done);
        toast?.toast(tt(done), "success");
      }
      return body ?? {};
    } catch {
      setError("tt.failed");
      return null;
    } finally {
      await reload();
      setBusy(false);
    }
  }

  async function start() {
    const body = (await send(`${base}/start`, { method: "POST" }, null)) as StartResult | null;
    if (!body) return;
    if (body.stopped) {
      const message = tt("tt.toast.stopped_other", { title: body.stopped.taskTitle, hm: formatHM(body.stopped.seconds) });
      setNote(message);
      toast?.toast(message, "info");
    } else if (!body.already) {
      setNote("tt.toast.started");
      toast?.toast(tt("tt.toast.started"), "success");
    }
  }

  async function stop() {
    const body = (await send("/api/time/stop", { method: "POST" }, null)) as { entry?: EntryDto } | null;
    if (body?.entry) {
      const message = tt("tt.toast.stopped", { hm: formatHM(body.entry.seconds) });
      setNote(message);
      toast?.toast(message, "success");
    }
  }

  async function remove(entry: EntryDto) {
    if (typeof window !== "undefined" && !window.confirm(tt("tt.confirm_delete"))) return;
    await send(`/api/time/${encodeURIComponent(entry.id)}`, { method: "DELETE" }, "tt.toast.deleted");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold text-fg">
            <Clock className="h-4 w-4" aria-hidden="true" /> {tt("tt.title")}
          </p>
          <span data-time-total className="text-xs font-medium tabular-nums text-fg-muted" aria-label={tt("tt.total_aria", { hm: formatHM(data.totalSeconds) })}>
            {tt("tt.total")}: {bothText(data.totalSeconds)}
          </span>
          <Link href={`/time?taskId=${encodeURIComponent(taskId)}`} className="text-xs text-accent underline-offset-2 hover:underline">
            {tt("tt.report_link")}
          </Link>
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">{tt("tt.hint")}</p>
      </CardHeader>
      <CardBody className="space-y-3">
        {data.canTrack ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
            {runningHere && data.running ? (
              <>
                <RunningClock entry={data.running} serverNow={data.serverNow} receivedAt={receivedAt} nowMs={nowMs} />
                <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void stop()}>
                  <Square className="h-3.5 w-3.5" aria-hidden="true" /> {tt("tt.stop")}
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" disabled={busy} onClick={() => void start()}>
                <Play className="h-3.5 w-3.5" aria-hidden="true" /> {tt("tt.start")}
              </Button>
            )}
            {elsewhere ? <p className="min-w-0 flex-1 text-xs text-fg-muted">{tt("tt.running_elsewhere", { title: elsewhere.taskTitle })}</p> : null}
            <Button type="button" variant="secondary" size="sm" className="ms-auto" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
              {tt("tt.manual_add")}
            </Button>
          </div>
        ) : data.manager ? (
          <p className="text-xs text-fg-muted">{tt("tt.oversight")}</p>
        ) : null}

        {adding && data.canTrack ? (
          <ManualForm
            zone={data.timeZone}
            today={dayKey(new Date(initial.serverNow), data.timeZone)}
            busy={busy}
            onCancel={() => setAdding(false)}
            onSubmit={async (v) => {
              const ok = await send(`${base}/manual`, { method: "POST", body: JSON.stringify(v) }, "tt.toast.saved");
              if (ok) setAdding(false);
            }}
          />
        ) : null}

        {data.entries.length === 0 ? <p className="text-xs text-muted">{tt("tt.empty")}</p> : null}
        <ul className="space-y-1">
          {data.entries.map((entry) => (
            <li key={entry.id} data-time-entry={entry.id} className="rounded-lg border border-border bg-surface-2/50 px-3 py-2">
              {editing === entry.id ? (
                <EditForm
                  entry={entry}
                  zone={data.timeZone}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (patch) => {
                    const ok = await send(`/api/time/${encodeURIComponent(entry.id)}`, { method: "PATCH", body: JSON.stringify(patch) }, "tt.toast.saved");
                    if (ok) setEditing(null);
                  }}
                />
              ) : (
                <div className="flex items-start gap-2">
                  <EntryLine entry={entry} viewerId={viewerId} showPerson={data.manager} />
                  {entry.canEdit ? (
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={tt("tt.edit_aria", { what: dayLabel(entry.day) })} onClick={() => setEditing(entry.id)}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={tt("tt.delete_aria", { what: dayLabel(entry.day) })} onClick={() => void remove(entry)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>

        {note ? (
          <p role="status" className="text-xs text-ok">
            {tt(note)}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {tt(error)}
          </p>
        ) : null}
        <div className="space-y-0.5 border-t border-border pt-2 text-xs text-fg-muted">
          <p>
            <span aria-hidden="true">⚠️ </span>
            {tt("tt.warn")}
          </p>
          <p>
            <span aria-hidden="true">🔧 </span>
            {tt("tt.fix")}
          </p>
          <p>{tt("tt.window_note")}</p>
        </div>
      </CardBody>
    </Card>
  );
}

function intOrNaN(text: string): number {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN;
}

function ManualForm({
  zone,
  today,
  busy,
  onCancel,
  onSubmit,
}: {
  zone: string;
  today: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (value: { date: string; hours: number; minutes: number; note: string }) => void | Promise<void>;
}) {
  const [date, setDate] = React.useState(today);
  const [hours, setHours] = React.useState("1");
  const [minutes, setMinutes] = React.useState("0");
  const [text, setText] = React.useState("");
  return (
    <form
      data-manual-form
      className="space-y-2 rounded-lg border border-border bg-surface-2/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({ date, hours: intOrNaN(hours), minutes: intOrNaN(minutes), note: text });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {tt("tt.field.date")}
          <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} dir="ltr" />
        </label>
        <DurationFields hours={hours} minutes={minutes} onHours={setHours} onMinutes={setMinutes} />
      </div>
      <p className="text-xs text-fg-muted">{tt("tt.field.date_hint", { zone })}</p>
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        {tt("tt.field.note")}
        <Input value={text} maxLength={MAX_NOTE} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {tt("tt.manual_save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {tt("tt.cancel")}
        </Button>
      </div>
    </form>
  );
}

function EditForm({
  entry,
  zone,
  busy,
  onCancel,
  onSubmit,
}: {
  entry: EntryDto;
  zone: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (patch: { note: string; date?: string; hours?: number; minutes?: number }) => void | Promise<void>;
}) {
  const total = entry.seconds;
  const [date, setDate] = React.useState(entry.day);
  const [hours, setHours] = React.useState(String(Math.floor(total / 3600)));
  const [minutes, setMinutes] = React.useState(String(Math.floor((total % 3600) / 60)));
  const [text, setText] = React.useState(entry.note);
  // a running timer changes its note only; a timer entry keeps its day
  const timeLocked = entry.running;
  return (
    <form
      data-edit-form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const patch: { note: string; date?: string; hours?: number; minutes?: number } = { note: text };
        if (!timeLocked) {
          patch.hours = intOrNaN(hours);
          patch.minutes = intOrNaN(minutes);
          if (entry.source === "MANUAL" && date !== entry.day) patch.date = date;
        }
        void onSubmit(patch);
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        {!timeLocked && entry.source === "MANUAL" ? (
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {tt("tt.field.date")}
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
          </label>
        ) : null}
        {!timeLocked ? <DurationFields hours={hours} minutes={minutes} onHours={setHours} onMinutes={setMinutes} /> : null}
      </div>
      {!timeLocked && entry.source === "MANUAL" ? <p className="text-xs text-fg-muted">{tt("tt.field.date_hint", { zone })}</p> : null}
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        {tt("tt.field.note")}
        <Input value={text} maxLength={MAX_NOTE} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {tt("tt.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {tt("tt.cancel")}
        </Button>
      </div>
    </form>
  );
}
