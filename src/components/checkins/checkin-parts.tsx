"use client";

import React from "react";
import Link from "next/link";
import { MAX_ANSWER_LENGTH } from "@/lib/checkins";
import { ck } from "@/lib/checkins-client";
import { fmtTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AnswerDto, RosterEntry, RosterStatus, TaskChip } from "@/server/services/checkins";

/**
 * The pieces of the «التسجيل اليومي» page, presentational: the form of today, the roster («مين سجّل ومين لا»), one person's
 * answer and the team's. They hold no data of their own beyond what the person is typing, so the page, the history and the tests
 * draw them the same way. Colours are theme tokens only; directions are logical (the interface is right to left).
 */

const STATUS_STYLE: Record<RosterStatus, string> = {
  answered: "bg-ok/10 text-ok",
  excused: "bg-info/10 text-info",
  pending: "bg-warn/10 text-warn",
  missed: "bg-danger/10 text-danger",
};

export function StatusPill({ status }: { status: RosterStatus }) {
  return (
    <span data-status={status} className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {ck(`checkins.status.${status}`)}
    </span>
  );
}

/** «سجّل 3 · إجازة 1 · لم يسجّل بعد 2»: the counts of a round, in words. */
export function CountsLine({ counts }: { counts: { answered: number; excused: number; pending: number; missed: number } }) {
  return <p className="text-xs text-fg-muted">{ck("checkins.roster.counts", counts)}</p>;
}

/** Who answered and who did not, for everybody of the space who may open the round (names and states only: never the texts). */
export function RosterSummary({ roster, counts }: { roster: RosterEntry[]; counts: { answered: number; excused: number; pending: number; missed: number } }) {
  return (
    <section aria-labelledby="checkins-roster-title" data-checkins-roster className="space-y-2">
      <h3 id="checkins-roster-title" className="text-sm font-semibold text-fg">
        {ck("checkins.roster.title")}
      </h3>
      {roster.length === 0 ? (
        <p className="text-sm text-fg-muted">{ck("checkins.roster.empty")}</p>
      ) : (
        <>
          <CountsLine counts={counts} />
          <ul className="divide-y divide-border/60 rounded-lg border border-border bg-surface-1">
            {roster.map((entry) => (
              <li key={entry.userId} data-person={entry.userId} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{entry.name}</span>
                <StatusPill status={entry.status} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** The tasks attached to an answer: read-only links to the task page (the server dropped the ones this reader may not open). */
export function TaskChips({ tasks }: { tasks: TaskChip[] }) {
  if (tasks.length === 0) return null;
  return (
    <ul aria-label={ck("checkins.team.tasks")} className="mt-2 flex flex-wrap gap-1.5">
      {tasks.map((task) => (
        <li key={task.id}>
          <Link href={`/tasks/${task.id}`} data-task-chip={task.id} className="inline-block max-w-56 truncate rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-fg hover:border-accent/60">
            {task.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One person's answers, each under its question. */
export function AnswerCard({ answer, questions }: { answer: AnswerDto; questions: string[] }) {
  return (
    <article data-answer-of={answer.userId} className="rounded-lg border border-border bg-surface-1 p-3">
      <header className="mb-2 flex items-center gap-2">
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{answer.userName}</h4>
        <span suppressHydrationWarning className="text-xs text-fg-muted">
          {fmtTime(answer.editedAt ?? answer.submittedAt)}
        </span>
        {answer.editedAt ? <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted">{ck("checkins.team.edited")}</span> : null}
      </header>
      <dl className="space-y-2">
        {questions.map((question, i) => (
          <div key={i}>
            <dt className="text-xs font-medium text-fg-muted">{question}</dt>
            <dd className="whitespace-pre-wrap break-words text-sm text-fg">{answer.answers[i] ? answer.answers[i] : <span className="text-fg-muted">—</span>}</dd>
          </div>
        ))}
      </dl>
      <TaskChips tasks={answer.tasks} />
    </article>
  );
}

/**
 * «أجوبة الفريق»: the teammates' answers, or — for somebody who has not submitted yet and does not manage the space — the
 * line that says they appear after they do. `silent` is the owner's and the space's ADMIN's reading: nothing is recorded.
 */
export function TeamAnswers({ team, questions, silent }: { team: AnswerDto[] | null; questions: string[]; silent: boolean }) {
  return (
    <section aria-labelledby="checkins-team-title" data-checkins-team className="space-y-2">
      <h3 id="checkins-team-title" className="text-sm font-semibold text-fg">
        {ck("checkins.team.title")}
      </h3>
      {team === null ? (
        <p data-team-locked className="rounded-lg border border-dashed border-border p-3 text-sm text-fg-muted">
          {ck("checkins.team.locked")}
        </p>
      ) : (
        <>
          {silent ? <p className="text-xs text-fg-muted">{ck("checkins.team.silent")}</p> : null}
          {team.length === 0 ? (
            <p className="text-sm text-fg-muted">{ck("checkins.team.empty")}</p>
          ) : (
            <div className="space-y-2">
              {team.map((answer) => (
                <AnswerCard key={answer.userId} answer={answer} questions={questions} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export interface FormValues {
  answers: string[];
  taskIds: string[];
}

/**
 * Today's form: one box per question (at most 1000 characters each), the person's open tasks to attach as chips, «إرسال»
 * (or «حفظ التعديل» once sent) and «إجازة اليوم». It holds only what is being typed; the page does the requests.
 */
export function CheckinForm({
  questions,
  initial,
  tasks,
  alreadySent,
  busy = false,
  error = "",
  note = "",
  onSubmit,
  onExcuse,
}: {
  questions: string[];
  initial: FormValues;
  tasks: TaskChip[];
  alreadySent: boolean;
  busy?: boolean;
  /** A dictionary key. */
  error?: string;
  /** A dictionary key (a success line). */
  note?: string;
  onSubmit?: (values: FormValues) => void;
  onExcuse?: () => void;
}) {
  const [answers, setAnswers] = React.useState<string[]>(() => questions.map((_, i) => initial.answers[i] ?? ""));
  const [taskIds, setTaskIds] = React.useState<string[]>(initial.taskIds);
  const empty = answers.every((a) => a.trim() === "");
  // a task attached before and finished since stays listed (it was the person's choice), so the chip does not vanish on an edit
  const offered = tasks;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || empty) return;
    onSubmit?.({ answers: answers.map((a) => a.trim()), taskIds });
  }

  return (
    <form onSubmit={submit} data-checkin-form className="space-y-4">
      <h3 className="text-sm font-semibold text-fg">{ck("checkins.form.title")}</h3>
      {questions.map((question, i) => {
        const id = `checkin-q-${i}`;
        const used = (answers[i] ?? "").length;
        return (
          <div key={i}>
            <label htmlFor={id}>
              <Label>{question}</Label>
            </label>
            <Textarea
              id={id}
              rows={3}
              maxLength={MAX_ANSWER_LENGTH}
              value={answers[i] ?? ""}
              onChange={(e) => setAnswers((cur) => cur.map((v, j) => (j === i ? e.target.value : v)))}
              aria-label={ck("checkins.form.answer_label", { question })}
            />
            <span className="mt-0.5 block text-end text-xs text-fg-muted">{ck("checkins.form.counter", { used, max: MAX_ANSWER_LENGTH })}</span>
          </div>
        );
      })}

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-fg-muted">{ck("checkins.form.tasks")}</legend>
        <p className="text-xs text-fg-muted">{ck("checkins.form.tasks_hint")}</p>
        {offered.length === 0 && taskIds.length === 0 ? (
          <p className="text-xs text-fg-muted">{ck("checkins.form.no_tasks")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {offered.map((task) => {
              const on = taskIds.includes(task.id);
              return (
                <li key={task.id}>
                  <label className={`flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent/10 text-fg" : "border-border bg-surface-1 text-fg-muted"}`}>
                    <input
                      type="checkbox"
                      className="size-4 accent-accent"
                      checked={on}
                      onChange={() => setTaskIds((cur) => (cur.includes(task.id) ? cur.filter((x) => x !== task.id) : [...cur, task.id]))}
                    />
                    <span className="max-w-56 truncate">{task.title}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      {alreadySent ? <p className="text-xs text-fg-muted">{ck("checkins.form.edit_hint")}</p> : null}
      {note ? (
        <p role="status" className="text-xs text-ok">
          {ck(note)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {ck(error)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || empty}>
          {ck(alreadySent ? "checkins.form.update" : "checkins.form.submit")}
        </Button>
        {!alreadySent ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onExcuse?.()}>
            {ck("checkins.excuse.button")}
          </Button>
        ) : null}
      </div>
      {!alreadySent ? <p className="text-xs text-fg-muted">{ck("checkins.excuse.hint")}</p> : null}
    </form>
  );
}
