"use client";

import React from "react";
import { Repeat } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { rt } from "@/lib/reminders/client";
import { enumLabel } from "@/lib/i18n/enums";
import { STOP_REASONS, type StopReason } from "@/lib/task-recurrence";
import type { RecurrenceDto } from "@/server/services/task-recurrence";
import { RecurrenceForm, nextLine, recurrenceSummary } from "./recurrence-form";

/**
 * «تكرار» on the task page: a button that opens the recurrence dialog, and under it what the series is («تتكرر كل أسبوع:
 * السبت، الإثنين» · «تنتهي في …» · the next date). A series that stopped on its own says why with ⚠️ and the fix under
 * it with 🔧. The page draws it only while the company's «مهمة متكررة» switch is on; `canEdit` is the page's own rule
 * (who may edit the task; never a guest, never the owner reading silently) and the server decides again.
 */
export function RecurrenceControl({
  taskId,
  initial,
  timeZone,
  canEdit,
}: {
  taskId: string;
  initial: RecurrenceDto | null;
  timeZone: string;
  canEdit: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<RecurrenceDto | null>(initial);
  const [justStopped, setJustStopped] = React.useState(false);
  const running = !!state?.active;
  const reason: StopReason | null =
    state && !state.active && state.stoppedReason && (STOP_REASONS as readonly string[]).includes(state.stoppedReason) ? state.stoppedReason : null;

  // a person who may not edit sees what is set and nothing to press
  if (!canEdit && !running) return null;

  return (
    <div data-recurrence className="flex flex-col items-end gap-1 text-xs">
      {canEdit ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <Repeat className="me-1 h-3.5 w-3.5" aria-hidden="true" />
          {rt("recurring.button")}
        </Button>
      ) : null}
      {running && state ? (
        <div className="space-y-0.5 text-end text-fg-muted" data-recurrence-summary>
          <p className="text-info">
            <span aria-hidden="true">🔁 </span>
            {recurrenceSummary(state)}
            {state.endsOn ? ` · ${rt("recurring.ends_on", { day: state.endsOn })}` : ""}
          </p>
          <p>{enumLabel("RecurrenceMode", state.mode)}</p>
          {nextLine(state, timeZone) ? <p>{nextLine(state, timeZone)}</p> : null}
          {state.isTemplate ? null : <p>{rt("recurring.is_copy")}</p>}
        </div>
      ) : null}
      {reason ? (
        <div className="max-w-xs space-y-0.5 rounded-lg border border-warn/40 bg-warn/10 p-2 text-end text-fg" role="status" data-recurrence-stopped={reason}>
          <p>
            <span aria-hidden="true">⚠️ </span>
            {rt(`recurring.stopped.${reason}`)}
          </p>
          <p className="text-fg-muted">
            <span aria-hidden="true">🔧 </span>
            {rt(`recurring.fix.${reason}`)}
          </p>
        </div>
      ) : null}
      {justStopped && !running ? (
        <p role="status" className="text-fg-muted">
          {rt("recurring.stopped_manual")}
        </p>
      ) : null}
      {canEdit ? (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : setOpen(false))}>
          <DialogContent aria-label={rt("recurring.title")}>
            <DialogHeader>
              <DialogTitle>{rt("recurring.title")}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              {open ? (
                <>
                  <p className="mb-3 text-xs text-fg-muted">{rt("recurring.hint")}</p>
                  <RecurrenceForm
                    taskId={taskId}
                    initial={state}
                    timeZone={timeZone}
                    onCancel={() => setOpen(false)}
                    onSaved={(next) => {
                      setState(next);
                      setJustStopped(!next?.active);
                      setOpen(false);
                    }}
                  />
                </>
              ) : null}
            </DialogBody>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
