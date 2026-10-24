"use client";
import React from "react";
import { AR } from "@/lib/i18n/dict";
import { CHAT_REACTIONS } from "@/lib/chat-reactions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { menuFor, menuOpen, type MessageMenuContext, type MessageMenuId } from "./message-menu-registry";

const tr = (key: string) => AR[key] ?? key;

/** A press this long on a phone opens the sheet (a short tap stays a tap: links, the player, scrolling). */
export const LONG_PRESS_MS = 450;

export interface MessageMenuProps {
 context: MessageMenuContext;
 /** «⋯» trigger and the long-press sheet both call this with the picked action (or an emoji). */
 onAction: (id: MessageMenuId) => void;
 onReact: (emoji: string) => void;
 /** the phone sheet: opened by the bubble's long press (controlled from MessageItem) */
 sheetOpen: boolean;
 onSheetOpenChange: (open: boolean) => void;
}

function ReactionBar({ onReact, close }: { onReact: (emoji: string) => void; close: () => void }) {
 return (
  <div role="group" aria-label={tr("chatc.menu.react")} className="flex justify-between gap-1 px-1 py-1">
   {CHAT_REACTIONS.map((emoji) => (
    <button key={emoji} type="button" className="flex h-11 w-11 items-center justify-center rounded-full text-xl hover:bg-surface-2 focus-visible:bg-surface-2" aria-label={`${tr("chatc.menu.react")} ${emoji}`} onClick={() => { onReact(emoji); close(); }}>
     {emoji}
    </button>
   ))}
  </div>
 );
}

/**
 * The one menu of a message: a 6-emoji bar on top, then the actions this person may take here.
 * Desktop: «⋯» beside the bubble, shown on hover or keyboard focus, opening a dropdown. Phone: a long
 * press on the bubble opens the same list as a bottom sheet. Delete asks first.
 */
export function MessageMenu({ context, onAction, onReact, sheetOpen, onSheetOpenChange }: MessageMenuProps) {
 const [confirmDelete, setConfirmDelete] = React.useState(false);
 const [open, setOpen] = React.useState(false);
 if (!menuOpen(context)) return null;
 const actions = menuFor(context);
 const pick = (id: MessageMenuId) => {
  setOpen(false);
  onSheetOpenChange(false);
  if (id === "delete") setConfirmDelete(true);
  else onAction(id);
 };
 return (
  <>
   <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild>
     <button
      type="button"
      aria-label={tr("chatc.menu.open")}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted opacity-0 transition-opacity hover:bg-surface-2 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:hidden"
     >
      <span aria-hidden="true">⋯</span>
     </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-56">
     <ReactionBar onReact={onReact} close={() => setOpen(false)} />
     {actions.length > 0 && <DropdownMenuSeparator />}
     {actions.map((a) => (
      <DropdownMenuItem key={a.id} tone={a.danger ? "danger" : undefined} onSelect={() => pick(a.id)}>
       {tr(a.labelKey(context))}
      </DropdownMenuItem>
     ))}
    </DropdownMenuContent>
   </DropdownMenu>

   <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
    <SheetContent>
     <SheetHeader>
      <SheetTitle>{tr("chatc.menu.title")}</SheetTitle>
     </SheetHeader>
     <SheetBody>
      <ReactionBar onReact={onReact} close={() => onSheetOpenChange(false)} />
      <ul className="mt-2 flex flex-col">
       {actions.map((a) => (
        <li key={a.id}>
         <button type="button" className={`min-h-11 w-full rounded-md px-3 text-start hover:bg-surface-2 ${a.danger ? "text-danger" : ""}`} onClick={() => pick(a.id)}>
          {tr(a.labelKey(context))}
         </button>
        </li>
       ))}
      </ul>
     </SheetBody>
    </SheetContent>
   </Sheet>

   <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
    <DialogContent aria-label={tr("chatc.menu.delete_title")}>
     <DialogHeader>
      <DialogTitle>{tr("chatc.menu.delete_title")}</DialogTitle>
     </DialogHeader>
     <DialogBody>
      <p>{tr(context.mine ? "chatc.menu.delete_body_mine" : "chatc.menu.delete_body_other")}</p>
     </DialogBody>
     <DialogFooter>
      <Button type="button" variant="secondary" onClick={() => setConfirmDelete(false)}>{tr("chatc.cancel")}</Button>
      <Button type="button" variant="danger" onClick={() => { setConfirmDelete(false); onAction("delete"); }}>{tr("chatc.menu.delete")}</Button>
     </DialogFooter>
    </DialogContent>
   </Dialog>
  </>
 );
}
