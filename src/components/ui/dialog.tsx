"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { rememberFocus, restoreFocus, type Focusable } from "@/lib/focus-return";
import "./overlay-motion.css";

/**
 * Dialog building blocks on Radix Dialog. What Radix gives for free, and the old hand-made modal did not:
 * focus is trapped inside while it is open (and given back to whoever opened it when it closes: see
 * useReturnFocus), Escape and a tap outside close it, the page behind is inert (hidden from screen readers)
 * and does not scroll, and the panel is announced as a dialog named by its title.
 *
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent size="md">                      // overlay + panel, drawn in a portal on <body>
 *       <DialogHeader>
 *         <DialogTitle>العنوان</DialogTitle>
 *         <DialogDescription>شرح اختياري</DialogDescription>
 *       </DialogHeader>
 *       <DialogBody>…</DialogBody>                   // the part that scrolls when the content is tall
 *       <DialogFooter>…</DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 *
 * - Anything outside DialogBody scrolls with the panel; use DialogBody for long content so the header,
 *   the footer and the close button stay in view.
 * - The close button is the LAST thing in the panel (so the first focus lands on the first field, not on
 *   the X) and sits at the end of the first line (the left in Arabic) as a 44px target.
 * - Colours are theme tokens only (the panel is an elevated card, `surface-1`; the dimming overlay is the
 *   theme's `scrim` at 60%); direction is logical (start/end), so everything flips by itself.
 * - `portal={false}` draws the overlay and the panel where they are in the tree instead of on <body>:
 *   for server-render tests (a portal renders nothing on the server) and for a dialog that must live
 *   inside a given container.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

type OverlayElement = React.ElementRef<typeof DialogPrimitive.Overlay>;
type ContentElement = React.ElementRef<typeof DialogPrimitive.Content>;

/**
 * Mounts together with a panel's content (so only while the dialog is open) and notes who has focus
 * BEFORE the panel takes it. It does this while rendering, not in an effect: by the time effects run, an
 * `autoFocus` field inside the panel has already moved focus.
 */
function NoteOpener({ into }: { into: React.MutableRefObject<Focusable | null> }): null {
  React.useState(() => {
    into.current = rememberFocus(typeof document === "undefined" ? null : document);
    return null;
  });
  return null;
}

/**
 * Focus goes back to whoever had it when the panel opened. Radix only knows how to return it to its own
 * `DialogTrigger`; a dialog opened from state (every `<Modal open …>`) has none, so without this a keyboard
 * user would lose their place on close. Used by DialogPanel and SheetPanel:
 *
 *   const returnFocus = useReturnFocus(onCloseAutoFocus);
 *   <DialogPrimitive.Content onCloseAutoFocus={returnFocus.onCloseAutoFocus}>
 *     {returnFocus.noteOpener}   // first child: remembers the opener while the content renders
 *
 * The caller's own `onCloseAutoFocus` goes through it: when that one calls `preventDefault()`, the caller
 * decides where focus goes.
 */
export function useReturnFocus(onCloseAutoFocus?: (event: Event) => void): {
  onCloseAutoFocus: (event: Event) => void;
  noteOpener: React.ReactElement;
} {
  const opener = React.useRef<Focusable | null>(null);
  const handler = React.useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      const target = opener.current;
      opener.current = null;
      restoreFocus(target, event);
    },
    [onCloseAutoFocus],
  );
  return { onCloseAutoFocus: handler, noteOpener: <NoteOpener into={opener} /> };
}

/**
 * The dimming layer behind the panel, fading in and out: the theme's `scrim` token at 60%. The scrim is a
 * DARK veil tinted to the theme in every theme (it dims, it never lightens), and 60% is the backdrop alpha
 * the theme tests check the dialog card against (SCRIM_BACKDROP_ALPHA in src/lib/themes/palettes.ts).
 */
export const DialogOverlay = React.forwardRef<OverlayElement, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay ref={ref} className={cn("zk-fade fixed inset-0 z-50 bg-scrim/60", className)} {...props} />
  ),
);
DialogOverlay.displayName = "DialogOverlay";

/** The corner button that closes a dialog or a sheet: named in Arabic, 44px, after the content in the document. */
export const DialogCloseButton = React.forwardRef<HTMLButtonElement, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>>(
  ({ className, ...props }, ref) => {
    const { t } = useI18n();
    return (
      <DialogPrimitive.Close
        ref={ref}
        aria-label={t("ui.close")}
        className={cn(
          "absolute end-2 top-2 flex size-11 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg",
          className,
        )}
        {...props}
      >
        <X className="size-4" aria-hidden="true" />
      </DialogPrimitive.Close>
    );
  },
);
DialogCloseButton.displayName = "DialogCloseButton";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
} as const;

export type DialogSize = keyof typeof SIZES;

export interface DialogPanelProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Width: sm 24rem, md 28rem (default), lg 32rem, xl 42rem. On a phone it is the screen minus 16px each side. */
  size?: DialogSize;
  /** Leave out the corner close button (the dialog must then offer its own way out). */
  hideClose?: boolean;
}

/**
 * The panel itself, without an overlay and without a portal. Centred with `inset-0 m-auto` rather than a
 * translate, so the entrance animation is free to use the transform. Never taller than the screen.
 */
export const DialogPanel = React.forwardRef<ContentElement, DialogPanelProps>(
  ({ className, children, size = "md", hideClose = false, onCloseAutoFocus, ...props }, ref) => {
    const returnFocus = useReturnFocus(onCloseAutoFocus);
    return (
      <DialogPrimitive.Content
        ref={ref}
        aria-modal="true"
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        onInteractOutside={(e) => {
          // a tap on a toast must close the toast, not the dialog beneath it
          if ((e.target as Element | null)?.closest?.("[data-zk-toast]")) e.preventDefault();
        }}
        className={cn(
          "zk-pop fixed inset-0 z-50 m-auto flex h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col overflow-y-auto rounded-xl border border-border ring-1 ring-muted bg-surface-1 text-fg shadow-lg focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
          SIZES[size],
          className,
        )}
        {...props}
      >
        {returnFocus.noteOpener}
        {children}
        {hideClose ? null : <DialogCloseButton />}
      </DialogPrimitive.Content>
    );
  },
);
DialogPanel.displayName = "DialogPanel";

export interface DialogContentProps extends DialogPanelProps {
  /** Draw in a portal on <body> (default). `false` draws in place: server-render tests, a given container. */
  portal?: boolean;
}

/** Overlay + panel, in a portal on <body> so no ancestor's transform, overflow or z-index can trap it. */
export const DialogContent = React.forwardRef<ContentElement, DialogContentProps>(({ portal = true, ...props }, ref) => {
  if (!portal) {
    return (
      <>
        <DialogOverlay />
        <DialogPanel ref={ref} {...props} />
      </>
    );
  }
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPanel ref={ref} {...props} />
    </DialogPrimitive.Portal>
  );
});
DialogContent.displayName = "DialogContent";

/** Title and description, with room at the end of the line for the corner close button. */
export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("flex shrink-0 flex-col gap-1 pb-4 pe-14 ps-5 pt-5", className)} {...props} />;
}

export const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Title ref={ref} className={cn("text-base font-semibold leading-6 text-fg", className)} {...props} />
  ),
);
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm leading-6 text-fg-muted", className)} {...props} />
));
DialogDescription.displayName = "DialogDescription";

/** The part that scrolls when the content is taller than the screen. */
export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5", className)} {...props} />;
}

/** Buttons at the end of the line, separated from the body by a hairline. */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3", className)} {...props} />;
}
