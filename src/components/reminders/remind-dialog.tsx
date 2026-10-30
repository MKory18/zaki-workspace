"use client";

import React from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { rt } from "@/lib/reminders/client";
import { ReminderForm } from "./reminder-form";

/**
 * «ذكّرني» as a dialog: a reminder for ME on a task or on a chat message (or on nothing). The form inside only
 * exists while the dialog is open, so a closed dialog costs nothing and needs no provider.
 */
export function RemindDialog({
  open,
  onClose,
  onSaved,
  defaultTitle = "",
  taskId = null,
  messageId = null,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  defaultTitle?: string;
  taskId?: string | null;
  messageId?: string | null;
}) {
  const heading = taskId ? "reminder.dialog_task" : messageId ? "reminder.dialog_message" : "reminder.dialog_title";
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent aria-label={rt(heading)}>
        <DialogHeader>
          <DialogTitle>{rt(heading)}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {open ? <ReminderForm defaultTitle={defaultTitle} taskId={taskId} messageId={messageId} onSaved={onSaved} onCancel={onClose} /> : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The «ذكّرني» button of a task page: opens the dialog for this task. The page draws it only while the company's
 * switch is on.
 */
export function RemindTaskButton({ taskId, taskTitle }: { taskId: string; taskTitle: string }) {
  const [open, setOpen] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => { setSaved(false); setOpen(true); }}>
        {rt("reminder.add")}
      </Button>
      {saved ? (
        <span role="status" className="text-xs text-ok">
          {rt("reminder.saved")}
        </span>
      ) : null}
      <RemindDialog
        open={open}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          setSaved(true);
        }}
        defaultTitle={taskTitle}
        taskId={taskId}
      />
    </>
  );
}
