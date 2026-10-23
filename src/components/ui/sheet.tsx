"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { DialogCloseButton, DialogDescription, DialogOverlay, DialogTitle, useReturnFocus } from "@/components/ui/dialog";
import "./overlay-motion.css";

/**
 * A sheet: a bottom sheet on phones and a side panel from the `md` breakpoint (768px) up. The same
 * Radix Dialog underneath, so focus is trapped, Escape and a tap outside close it, and the page behind
 * is inert.
 *
 *   <Sheet open={open} onOpenChange={setOpen}>
 *     <SheetContent>                                  // side="end" by default; "start" for the other edge
 *       <SheetHeader>
 *         <SheetTitle>العنوان</SheetTitle>
 *         <SheetDescription>شرح اختياري</SheetDescription>
 *       </SheetHeader>
 *       <SheetBody>…</SheetBody>                      // scrolls inside the sheet
 *       <SheetFooter>…</SheetFooter>
 *     </SheetContent>
 *   </Sheet>
 *
 * - Phone: pinned to the bottom, full width, rounded top, at most 85% of the screen height, a drag-handle
 *   look on top (decoration: dragging is not wired), padding for the home indicator (safe-area inset).
 * - From md: a 28rem panel on the END side (the left in Arabic) or on the START side with `side="start"`,
 *   full height, with the notch and home-indicator insets as padding.
 * - Logical CSS only; theme tokens only; the slide respects `prefers-reduced-motion` (overlay-motion.css).
 * - `portal={false}` draws in place instead of on <body> (server-render tests).
 */

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetOverlay = DialogOverlay;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;

export type SheetSide = "start" | "end";

type ContentElement = React.ElementRef<typeof DialogPrimitive.Content>;

export interface SheetPanelProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Which edge the side panel is attached to from md up. Default: the end of the line. */
  side?: SheetSide;
  /** Leave out the corner close button. */
  hideClose?: boolean;
}

const SIDES: Record<SheetSide, string> = {
  end: "zk-sheet-end md:start-auto md:end-0 md:rounded-s-2xl md:border-s",
  start: "zk-sheet-start md:start-0 md:end-auto md:rounded-e-2xl md:border-e",
};

/** The panel itself, without an overlay and without a portal. */
export const SheetPanel = React.forwardRef<ContentElement, SheetPanelProps>(
  ({ className, children, side = "end", hideClose = false, onCloseAutoFocus, ...props }, ref) => {
    const returnFocus = useReturnFocus(onCloseAutoFocus);
    return (
      <DialogPrimitive.Content
        ref={ref}
        aria-modal="true"
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
        onInteractOutside={(e) => {
          // a tap on a toast must close the toast, not the sheet beneath it
          if ((e.target as Element | null)?.closest?.("[data-zk-toast]")) e.preventDefault();
        }}
        className={cn(
          "zk-sheet fixed bottom-0 end-0 start-0 z-50 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-2xl border-t border-border ring-1 ring-muted bg-surface-1 pb-[env(safe-area-inset-bottom)] text-fg shadow-lg focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0",
          "md:top-0 md:max-h-none md:w-[28rem] md:max-w-[calc(100vw-2.5rem)] md:rounded-none md:border-t-0 md:pt-[env(safe-area-inset-top)]",
          SIDES[side],
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
SheetPanel.displayName = "SheetPanel";

export interface SheetContentProps extends SheetPanelProps {
  /** Draw in a portal on <body> (default). `false` draws in place: server-render tests, a given container. */
  portal?: boolean;
}

/** Overlay + panel, in a portal on <body>. */
export const SheetContent = React.forwardRef<ContentElement, SheetContentProps>(({ portal = true, ...props }, ref) => {
  if (!portal) {
    return (
      <>
        <SheetOverlay />
        <SheetPanel ref={ref} {...props} />
      </>
    );
  }
  return (
    <DialogPrimitive.Portal>
      <SheetOverlay />
      <SheetPanel ref={ref} {...props} />
    </DialogPrimitive.Portal>
  );
});
SheetContent.displayName = "SheetContent";

/** Title and description, with room at the end of the line for the corner close button. */
export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("flex shrink-0 flex-col gap-1 pb-3 pe-14 ps-5 pt-2 md:pt-5", className)} {...props} />;
}

/** The part that scrolls inside the sheet and does not drag the page behind it along. */
export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5", className)} {...props} />;
}

/** Buttons at the end of the line, separated from the body by a hairline. */
export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn("flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3", className)} {...props} />;
}
