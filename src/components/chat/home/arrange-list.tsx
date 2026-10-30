"use client";

import React, { useEffect, useId, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { ct } from "@/lib/chat/text";

/**
 * The «ترتيب» mode of the chat home: a list whose rows are dragged by a grip handle. A drag starts ONLY from the
 * handle (pointer: after a few pixels; keyboard: space lifts, arrows move, space drops, the escape key cancels),
 * so scrolling the list or tapping a row never starts one. A row moves only among the rows of its own group
 * (a pinned topic never leaves the pinned group); a drop anywhere else means nothing. Arabic announcements for
 * screen readers; with «reduce motion» nothing slides or flies back.
 */

export interface ArrangeItem {
  id: string;
  /** rows of the same group may be dragged among themselves (pinned / not pinned) */
  group: string;
  /** what a screen reader calls the row */
  label: string;
}

/** True while the person asks the system for less motion (never during server rendering). */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/** Rows move up and down only. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** The handle as drawn on the lifted copy (not a control: the real one stays in the list). */
function Grip() {
  return (
    <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center text-fg-muted">
      <GripVertical className="size-5" />
    </span>
  );
}

function SortableRow({ item, reduced, children }: { item: ArrangeItem; reduced: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    transition: reduced ? null : { duration: 220, easing: "cubic-bezier(0.25, 1, 0.5, 1)" },
    attributes: { roleDescription: ct("chato.role") },
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition: transition ?? undefined }}
      data-arrange-row={item.id}
      className={`flex items-center gap-1 rounded-xl border-2 ${isDragging ? "border-dashed border-accent/60 bg-accent/5" : "border-transparent"}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={ct("chato.grip", { name: item.label })}
        data-arrange-grip=""
        className="inline-flex size-11 shrink-0 touch-none cursor-grab items-center justify-center rounded-lg text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing"
      >
        <GripVertical aria-hidden="true" className="size-5" />
      </button>
      <div className={`flex min-w-0 flex-1 items-center gap-1 ${isDragging ? "invisible" : ""}`}>{children}</div>
    </li>
  );
}

/**
 * `row(id)` is what sits next to the handle (the topic's or the chat's content). `onMove(activeId, overId, groupIds)`
 * fires once a row is dropped on another row of its own group; `groupIds` are that group's ids in the order shown.
 */
export function ArrangeList({
  items,
  row,
  onMove,
  className,
}: {
  items: ArrangeItem[];
  row: (id: string) => React.ReactNode;
  onMove: (activeId: string, overId: string, groupIds: string[]) => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const dndId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  const groups: string[] = [];
  for (const i of items) if (!groups.includes(i.group)) groups.push(i.group);
  const idsOf = (group: string) => items.filter((i) => i.group === group).map((i) => i.id);

  const spot = (id: string): { name: string; pos: number; total: number } | null => {
    const item = byId.get(id);
    if (!item) return null;
    const ids = idsOf(item.group);
    return { name: item.label, pos: ids.indexOf(id) + 1, total: ids.length };
  };
  const say = (key: string, id: string | number | undefined): string => {
    const s = id === undefined ? null : spot(String(id));
    return s ? ct(key, s) : "";
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => say("chato.ann.start", active.id),
    onDragOver: ({ active, over }) => {
      if (!over) return "";
      const a = byId.get(String(active.id));
      const o = byId.get(String(over.id));
      if (!a || !o) return "";
      if (a.group !== o.group) return ct("chato.ann.blocked", { name: a.label });
      const ids = idsOf(a.group);
      return ct("chato.ann.over", { name: a.label, pos: ids.indexOf(o.id) + 1, total: ids.length });
    },
    onDragEnd: ({ active, over }) => {
      const a = byId.get(String(active.id));
      const o = over ? byId.get(String(over.id)) : undefined;
      if (!a) return "";
      const ids = idsOf(a.group);
      const at = o && o.group === a.group ? ids.indexOf(o.id) : ids.indexOf(a.id);
      return ct("chato.ann.end", { name: a.label, pos: at + 1, total: ids.length });
    },
    onDragCancel: ({ active }) => say("chato.ann.cancel", active.id),
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const a = byId.get(String(active.id));
    const o = byId.get(String(over.id));
    if (!a || !o || a.group !== o.group) return;
    onMove(a.id, o.id, idsOf(a.group));
  };
  const active = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      accessibility={{ announcements, screenReaderInstructions: { draggable: ct("chato.instructions") } }}
      onDragStart={({ active: a }: DragStartEvent) => setActiveId(String(a.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <ul className={className} data-arranging="">
        {groups.map((g) => (
          <SortableContext key={g} items={idsOf(g)} strategy={verticalListSortingStrategy}>
            {items.filter((i) => i.group === g).map((i) => (
              <SortableRow key={i.id} item={i} reduced={reduced}>{row(i.id)}</SortableRow>
            ))}
          </SortableContext>
        ))}
      </ul>
      <DragOverlay dropAnimation={reduced ? null : { duration: 200, easing: "cubic-bezier(0.25, 1, 0.5, 1)" }} modifiers={[verticalOnly]}>
        {active ? (
          <div
            data-arrange-overlay=""
            className={`flex items-center gap-1 rounded-xl border border-accent/40 bg-surface-1 shadow-lg ${reduced ? "" : "scale-[1.02]"}`}
          >
            <Grip />
            <div className="flex min-w-0 flex-1 items-center gap-1">{row(active.id)}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
