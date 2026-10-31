"use client";

import React from "react";
import { MAX_QUESTIONS, MAX_QUESTION_LENGTH } from "@/lib/checkins";
import { ck, errorKeyOf } from "@/lib/checkins-client";
import { weekdayLong } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { PeopleMulti } from "@/components/ui/people-multi";
import type { CheckinConfigDto, PersonDto } from "@/server/services/checkins";

/** The week as the company counts it: الأحد first. */
const WEEK = [0, 1, 2, 3, 4, 5, 6] as const;

export interface ConfigDraft {
  active: boolean;
  questions: string[];
  timeOfDay: string;
  weekdays: number[];
  participantsMode: "ALL" | "LIST";
  participantIds: string[];
}

export const draftOf = (config: CheckinConfigDto): ConfigDraft => ({
  active: config.active,
  questions: [...config.questions],
  timeOfDay: config.timeOfDay,
  weekdays: [...config.weekdays],
  participantsMode: config.participantsMode,
  participantIds: [...config.participantIds],
});

/**
 * The form of a space's check-in: on or off, up to five questions, the time (the company's clock: the box says so and the server
 * reads it that way), the weekdays and who takes part. For the space's ADMIN and the owner; the server checks the person and every
 * value again. ⚠️ The ADMIN and the owner read all answers, and the screen says so next to the form. 🔧 Past rounds keep the questions
 * they had: changing them rewrites nothing.
 */
export function SettingsForm({
  initial,
  candidates,
  timeZone,
  busy = false,
  error = "",
  onSave,
  onCancel,
}: {
  initial: ConfigDraft;
  candidates: PersonDto[];
  timeZone: string;
  busy?: boolean;
  error?: string;
  onSave?: (draft: ConfigDraft) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = React.useState<ConfigDraft>(initial);
  const set = (patch: Partial<ConfigDraft>) => setDraft((cur) => ({ ...cur, ...patch }));
  const blank = draft.questions.some((q) => q.trim() === "") || draft.questions.length === 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || blank || draft.weekdays.length === 0) return;
    onSave?.({ ...draft, questions: draft.questions.map((q) => q.trim()) });
  }

  return (
    <form onSubmit={submit} data-checkin-settings className="space-y-4">
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-fg">
        <input type="checkbox" className="size-5 accent-accent" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />
        {ck("checkins.settings.active")}
      </label>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-fg-muted">{ck("checkins.settings.questions", { max: MAX_QUESTIONS })}</legend>
        {draft.questions.map((question, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={question}
              maxLength={MAX_QUESTION_LENGTH}
              onChange={(e) => set({ questions: draft.questions.map((q, j) => (j === i ? e.target.value : q)) })}
              aria-label={ck("checkins.settings.question_n", { n: i + 1 })}
            />
            {draft.questions.length > 1 ? (
              <Button type="button" variant="ghost" size="sm" aria-label={ck("checkins.settings.remove_question", { n: i + 1 })} onClick={() => set({ questions: draft.questions.filter((_, j) => j !== i) })}>
                ✕
              </Button>
            ) : null}
          </div>
        ))}
        {draft.questions.length < MAX_QUESTIONS ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => set({ questions: [...draft.questions, ""] })}>
            {ck("checkins.settings.add_question")}
          </Button>
        ) : null}
      </fieldset>

      <div>
        <Label>{ck("checkins.settings.time", { zone: timeZone })}</Label>
        <Input type="time" dir="ltr" value={draft.timeOfDay} onChange={(e) => set({ timeOfDay: e.target.value })} aria-label={ck("checkins.settings.time", { zone: timeZone })} className="max-w-32" />
      </div>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-fg-muted">{ck("checkins.settings.weekdays")}</legend>
        <ul className="flex flex-wrap gap-1.5">
          {WEEK.map((day) => {
            const on = draft.weekdays.includes(day);
            return (
              <li key={day}>
                <label className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent/10 text-fg" : "border-border bg-surface-1 text-fg-muted"}`}>
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={on}
                    onChange={() => set({ weekdays: on ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day].sort((a, b) => a - b) })}
                  />
                  {weekdayLong(day)}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-fg-muted">{ck("checkins.settings.participants")}</legend>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="radio" name="checkin-mode" className="size-4 accent-accent" checked={draft.participantsMode === "ALL"} onChange={() => set({ participantsMode: "ALL" })} />
          {ck("checkins.settings.participants_all")}
        </label>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="radio" name="checkin-mode" className="size-4 accent-accent" checked={draft.participantsMode === "LIST"} onChange={() => set({ participantsMode: "LIST" })} />
          {ck("checkins.settings.participants_list")}
        </label>
        {draft.participantsMode === "LIST" ? (
          <PeopleMulti
            people={candidates}
            value={draft.participantIds}
            onChange={(participantIds) => set({ participantIds })}
            label={ck("checkins.settings.participants_pick")}
            emptyText={ck("checkins.settings.participants_none")}
          />
        ) : null}
      </fieldset>

      <div className="space-y-0.5 border-t border-border pt-2 text-xs text-fg-muted">
        <p>{ck("checkins.settings.warn")}</p>
        <p>{ck("checkins.settings.fix")}</p>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {ck(error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => onCancel?.()}>
          {ck("checkins.settings.cancel")}
        </Button>
        <Button type="submit" disabled={busy || blank || draft.weekdays.length === 0 || (draft.participantsMode === "LIST" && draft.participantIds.length === 0)}>
          {ck("checkins.settings.save")}
        </Button>
      </div>
    </form>
  );
}

/** The «إعدادات التسجيل» button and its dialog; the configuration is read when it opens (the server decides who may). */
export function SettingsDialog({ workspaceId, timeZone, onSaved }: { workspaceId: string; timeZone: string; onSaved: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState<{ config: CheckinConfigDto; candidates: PersonDto[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setError("");
    void fetch(`/api/checkins/config?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) setError(errorKeyOf(await res.json().catch(() => null)));
        else setLoaded((await res.json()) as { config: CheckinConfigDto; candidates: PersonDto[] });
      })
      .catch(() => alive && setError("checkins.e.failed"));
    return () => {
      alive = false;
    };
  }, [open, workspaceId]);

  async function save(draft: ConfigDraft) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/checkins/config", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, ...draft }) });
      if (!res.ok) {
        setError(errorKeyOf(await res.json().catch(() => null)));
        return;
      }
      setOpen(false);
      onSaved();
    } catch {
      setError("checkins.e.failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)} data-checkin-settings-open>
        {ck("checkins.settings.open")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-label={ck("checkins.settings.title")} size="lg">
          <DialogHeader>
            <DialogTitle>{ck("checkins.settings.title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {loaded ? (
              <SettingsForm initial={draftOf(loaded.config)} candidates={loaded.candidates} timeZone={timeZone} busy={busy} error={error} onSave={(d) => void save(d)} onCancel={() => setOpen(false)} />
            ) : error ? (
              <p role="alert" className="text-xs text-danger">
                {ck(error)}
              </p>
            ) : (
              <p className="text-sm text-fg-muted">{ck("checkins.loading")}</p>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
