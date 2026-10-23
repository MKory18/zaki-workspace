"use client";

import * as React from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * The props every call site already passes: `open`, `title`, `onClose`, children. They did not change
 * when the insides moved to Radix (tests/ui-overlays.test.ts pins the type), so no call site changes.
 */
export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** Radix says when it wants the dialog to open or close; the call sites only ever hear about closing. */
export function whenClosed(onClose: () => void): (open: boolean) => void {
  return (open) => {
    if (!open) onClose();
  };
}

/**
 * The visible part of a Modal: the title (the dialog's name for screen readers) pinned on top and the
 * children below it, scrolling inside the panel when they are tall. `portal={false}` is for tests that
 * render on the server, where a portal draws nothing.
 */
export function ModalContent({
  title,
  children,
  portal,
}: {
  title: string;
  children: React.ReactNode;
  portal?: boolean;
}): React.JSX.Element {
  return (
    <DialogContent aria-label={title} portal={portal}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody>{children}</DialogBody>
    </DialogContent>
  );
}

/**
 * A modal dialog. Focus is trapped inside it and given back to the button that opened it, Escape and a
 * tap on the dimmed area close it (through `onClose`), the page behind does not scroll and is hidden
 * from screen readers. Nothing is drawn while `open` is false.
 */
export function Modal({ open, title, onClose, children }: ModalProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={whenClosed(onClose)}>
      <ModalContent title={title}>{children}</ModalContent>
    </Dialog>
  );
}
