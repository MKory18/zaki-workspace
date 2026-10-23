"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import "./overlay-motion.css";

/**
 * A dropdown menu on Radix DropdownMenu: opens from a trigger, arrow keys / Home / End / first-letter
 * move between items, Enter or Space picks, Escape closes and gives focus back to the trigger.
 *
 *   <DropdownMenu>
 *     <DropdownMenuTrigger asChild><button …>…</button></DropdownMenuTrigger>
 *     <DropdownMenuContent align="end">               // "start" (default) | "end": the logical edges
 *       <DropdownMenuLabel>حسابي</DropdownMenuLabel>
 *       <DropdownMenuItem asChild><Link href="/profile">الملف الشخصي</Link></DropdownMenuItem>
 *       <DropdownMenuSeparator />
 *       <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
 *         <DropdownMenuRadioItem value="day">نهاري</DropdownMenuRadioItem>
 *       </DropdownMenuRadioGroup>
 *       <DropdownMenuCheckboxItem checked={on} onCheckedChange={setOn}>خيار</DropdownMenuCheckboxItem>
 *       <DropdownMenuItem tone="danger" onSelect={logout}>تسجيل الخروج</DropdownMenuItem>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 *
 * - Right-to-left by default (`dir="rtl"` on the root; pass `dir="ltr"` for the rare English corner).
 *   `align="start"` lines the menu up with the START edge of its trigger (the right in Arabic) and
 *   `align="end"` with the end edge (the left); Radix flips them by the direction of the page and keeps the
 *   menu on the screen (8px from the edge).
 * - Every item is a 44px target on a phone and 36px with a mouse; keyboard focus shows the theme's ring
 *   inside the item (the highlight follows the pointer and the arrow keys).
 * - Theme tokens only; indicators sit at the START of the line (logical), so they flip in Arabic.
 * - `portal={false}` draws the menu in place instead of on <body> (server-render tests).
 */

/** The root. Right-to-left unless told otherwise (the keyboard direction and the placement follow it). */
export function DropdownMenu({ dir = "rtl", ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>): React.JSX.Element {
  return <DropdownMenuPrimitive.Root dir={dir} {...props} />;
}

export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

type ContentElement = React.ElementRef<typeof DropdownMenuPrimitive.Content>;
type ContentProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>;

/** The menu panel itself, without a portal. */
export const DropdownMenuPanel = React.forwardRef<ContentElement, ContentProps>(
  ({ className, sideOffset = 6, collisionPadding = 8, align = "start", ...props }, ref) => (
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      align={align}
      className={cn(
        "zk-pop zk-menu z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[12rem] max-w-[calc(100vw-1rem)] overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-surface-1 p-1 text-fg shadow-lg",
        className,
      )}
      {...props}
    />
  ),
);
DropdownMenuPanel.displayName = "DropdownMenuPanel";

export interface DropdownMenuContentProps extends ContentProps {
  /** Draw in a portal on <body> (default). `false` draws in place: server-render tests, a given container. */
  portal?: boolean;
}

/** The menu, in a portal on <body> so no ancestor's overflow or z-index can clip it. */
export const DropdownMenuContent = React.forwardRef<ContentElement, DropdownMenuContentProps>(({ portal = true, ...props }, ref) => {
  if (!portal) return <DropdownMenuPanel ref={ref} {...props} />;
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPanel ref={ref} {...props} />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuContent.displayName = "DropdownMenuContent";

const ITEM =
  "relative flex min-h-11 w-full cursor-default select-none items-center gap-2 rounded-lg border-s-4 border-s-transparent px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-inset focus-visible:ring-offset-0 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:border-s-accent data-[highlighted]:bg-accent/10 md:min-h-9";

const TONES = {
  default: "",
  danger: "text-danger data-[highlighted]:bg-danger/10",
} as const;

export interface DropdownMenuItemProps extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  /** `danger` is for the item that deletes or signs out: red text and a red-tinted highlight. */
  tone?: keyof typeof TONES;
}

export const DropdownMenuItem = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Item>, DropdownMenuItemProps>(
  ({ className, tone = "default", ...props }, ref) => (
    <DropdownMenuPrimitive.Item ref={ref} className={cn(ITEM, TONES[tone], className)} {...props} />
  ),
);
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem ref={ref} className={cn(ITEM, "ps-8", className)} {...props}>
    <span className="absolute start-2 flex size-4 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="size-4" aria-hidden="true" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem ref={ref} className={cn(ITEM, "ps-8", className)} {...props}>
    <span className="absolute start-2 flex size-4 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="size-2 fill-current" aria-hidden="true" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

/** A quiet heading inside the menu. */
export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label ref={ref} className={cn("px-3 py-1.5 text-xs font-semibold text-muted", className)} {...props} />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

/** A hairline between groups of items. */
export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
