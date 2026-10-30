"use client";

import React from "react";
import { REPEATS, type Repeat } from "@/lib/reminders/recurrence";
import { defaultWhenText, errorKeyOf, rt } from "@/lib/reminders/client";
import { enumLabel } from "@/lib/i18n/enums";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * The form of one reminder: what, when (the COMPANY's wall clock: the box says so and the server reads it that
 * way, never the browser's zone), and how often. It writes `POST /api/reminders`; the server decides again (the person
 * must be able to read the task or message it points at). No provider is needed: it runs in the chat, on the task
 * page and on the Today card alike.
 */
export function ReminderForm({
  defaultTitle = "",
  taskId = null,
  messageId = null,
  timeZone,
  onSaved,
  onCancel,
}: {
  defaultTitle?: string;
  taskId?: string | null;
  messageId?: string | null;
  /** The company's zone; without it the form asks the server (the list answers with it). */
  timeZone?: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [zone, setZone] = React.useState(timeZone ?? "");
  const [title, setTitle] = React.useState(defaultTitle);
  const [when, setWhen] = React.useState(timeZone ? defaultWhenText(new Date(), timeZone) : "");
  const [repeat, setRepeat] = React.useState<Repeat>("NONE");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (timeZone) return;
    let alive = true;
    void fetch("/api/reminders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { timeZone?: string } | null) => {
        if (!alive || !body?.timeZone) return;
        setZone(body.timeZone);
        setWhen((current) => current || defaultWhenText(new Date(), body.timeZone as string));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [timeZone]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !title.trim() || !when) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueAt: when, repeat, taskId, messageId }),
      });
      if (!res.ok) {
        setError(errorKeyOf(await res.json().catch(() => null)));
        return;
      }
      onSaved();
    } catch {
      setError("reminder.failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <Label>{rt("reminder.field.title")}</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus aria-label={rt("reminder.field.title")} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>{rt("reminder.field.when")}</Label>
          <Input type="datetime-local" dir="ltr" value={when} onChange={(e) => setWhen(e.target.value)} aria-label={rt("reminder.field.when")} />
          {zone ? <span className="mt-1 block text-xs text-fg-muted">{rt("reminder.field.zone", { zone })}</span> : null}
        </div>
        <div>
          <Label>{rt("reminder.field.repeat")}</Label>
          <Select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} aria-label={rt("reminder.field.repeat")}>
            {REPEATS.map((r) => (
              <option key={r} value={r}>
                {enumLabel("ReminderRepeat", r)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {rt(error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {rt("reminder.cancel")}
        </Button>
        <Button type="submit" disabled={busy || !title.trim() || !when}>
          {rt("reminder.save")}
        </Button>
      </div>
    </form>
  );
}
