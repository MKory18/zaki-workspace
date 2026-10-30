"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowUpDown, GripVertical } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * «ترتيب» — the shell's reorder mode, one set of parts for the three lists a person may reorder: the places of the
 * side menu (a column), the places of the phone's bar and the tabs under the top bar (a row).
 *
 * It starts only from a deliberate switch (the button in the menu's footer, a long press on the phone's bar), so a
 * normal click or a scroll never starts a drag. In the mode each row wears a grip; the grip is the drag handle:
 *   - a mouse or a finger drags it (a short distance first, so a tap is still a tap);
 *   - the keyboard: Space lifts, the arrows move, Space drops, Escape puts it back — and a screen reader hears each
 *     step in Arabic (`navorder.lift` · `move` · `drop` · `cancel`);
 *   - the row lifts (a small scale and a shadow) and its neighbours slide aside — the gap is the placeholder; with
 *     `prefers-reduced-motion` the slide and the lift are off and the row simply jumps.
 * Nothing here saves anything: it hands the new order of the keys to `onReorder`.
 */

/** `prefers-reduced-motion: reduce`, live. The server and the first client frame say «no»; an effect then reads the device. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)") : undefined;
    if (!query) return;
    const read = () => setReduced(query.matches);
    read();
    query.addEventListener?.("change", read);
    return () => query.removeEventListener?.("change", read);
  }, []);
  return reduced;
}

/** What a drag is allowed to do along the other axis: nothing, so a column stays a column. */
const lockY: Modifier = ({ transform }) => ({ ...transform, y: 0 });
const lockX: Modifier = ({ transform }) => ({ ...transform, x: 0 });

export interface SortEntry {
  id: string;
  label: string;
}

/** A sortable list: the context, the sensors, the Arabic announcements. Its items are `SortableItem`s. */
export function SortableList({
  id,
  entries,
  axis,
  onReorder,
  children,
}: {
  /** A stable id per list: dnd-kit builds the screen-reader ids from it, and server and browser must agree. */
  id: string;
  entries: readonly SortEntry[];
  axis: "vertical" | "horizontal";
  onReorder: (keys: string[]) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const sensors = useSensors(
    // a short drag first: a tap on the grip is not a drag
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = entries.map((entry) => entry.id);
  const labelOf = (key: UniqueIdentifier) => entries.find((entry) => entry.id === key)?.label ?? String(key);
  const posOf = (key: UniqueIdentifier) => Math.max(1, ids.indexOf(String(key)) + 1);
  const total = entries.length;

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("navorder.lift", { label: labelOf(active.id), pos: posOf(active.id), total }),
    onDragOver: ({ active, over }) => (over ? t("navorder.move", { label: labelOf(active.id), pos: posOf(over.id), total }) : undefined),
    onDragEnd: ({ active, over }) => t("navorder.drop", { label: labelOf(active.id), pos: posOf(over?.id ?? active.id), total }),
    onDragCancel: ({ active }) => t("navorder.cancel", { label: labelOf(active.id) }),
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[axis === "vertical" ? lockX : lockY]}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("navorder.instructions") } }}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={axis === "vertical" ? verticalListSortingStrategy : horizontalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** What a row needs to become the drag handle: spread it on the element that is grabbed. */
export type HandleProps = Record<string, unknown>;

/** One row of a sortable list: an `<li>` that moves, and hands its handle to `children`. */
export function SortableItem({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: (handle: { props: HandleProps; dragging: boolean }) => ReactNode;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const sortable = useSortable({
    id,
    transition: reduced ? null : { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    attributes: { roleDescription: t("navorder.role") },
  });
  const dragging = sortable.isDragging;
  const props: HandleProps = { ref: sortable.setActivatorNodeRef, ...sortable.attributes, ...sortable.listeners };
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition ?? undefined }}
      data-sort-id={id}
      data-dragging={dragging ? "" : undefined}
      className={cn(className, "relative", dragging && "zk-lift z-30 rounded-xl bg-surface-2 shadow-lg ring-1 ring-accent/40")}
    >
      {children({ props, dragging })}
    </li>
  );
}

/** The grip: a small button with a Arabic name, the thing a person grabs (or focuses and lifts with Space). */
export function Grip({ handle, label, className }: { handle: HandleProps; label: string; className?: string }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      {...handle}
      aria-label={t("navorder.grip", { label })}
      className={cn(
        // touch-none: a finger on the grip drags; a finger anywhere else still scrolls
        "grid h-9 w-6 shrink-0 cursor-grab touch-none place-items-center rounded-md text-fg-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing",
        className,
      )}
    >
      <GripVertical aria-hidden="true" className="size-4" />
    </button>
  );
}

/**
 * «تم» and «رجّع الترتيب الأصلي» — what the reorder mode shows while it is on. `canReset` is false while there is no
 * saved order (nothing to give back).
 */
export function NavOrderControls({
  onDone,
  onReset,
  canReset,
  className,
}: {
  onDone: () => void;
  onReset: () => void;
  canReset: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t("navorder.mode")} className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={onDone}
        className="h-10 shrink-0 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        {t("navorder.done")}
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={!canReset}
        className="h-10 min-w-0 flex-1 truncate rounded-xl border border-border px-3 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {t("navorder.reset")}
      </button>
    </div>
  );
}

/** The switch that starts the mode (the side menu's footer). */
export function NavOrderToggle({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      data-nav-order-toggle=""
      aria-label={t("navorder.toggle")}
      title={t("navorder.toggle_title")}
      className={cn(
        "flex h-11 w-full items-center gap-2.5 rounded-xl text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg [@media(max-height:760px)]:h-9",
        collapsed ? "justify-center px-0" : "px-3",
      )}
    >
      <ArrowUpDown aria-hidden="true" className="size-5 shrink-0" />
      <span className={cn("truncate", collapsed && "sr-only")}>{t("navorder.toggle")}</span>
    </button>
  );
}
