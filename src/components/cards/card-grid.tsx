"use client";

import * as React from "react";
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
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { neighboursOf } from "@/lib/cards/order";
import type { CardItem } from "@/lib/cards/shared";
import { groupByCategory, type CardView } from "@/lib/cards/view";
import { CardTile, DragHandle, type TileActions } from "./card-tile";

/** `prefers-reduced-motion: reduce`: no lift, no slide, no drop animation. Read once on the client, never on the server. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener?.("change", on);
    return () => query.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

export interface CardGridProps {
  /** The cards as they are to be shown: already filtered and sorted. */
  cards: CardItem[];
  view: CardView;
  /** Drag and drop is on: the manual order, in a view that has one, for somebody who writes. */
  canReorder: boolean;
  canWrite: boolean;
  owner: boolean;
  archivedView?: boolean;
  /** A «تصنيع» space: tables carry the line about the official ledger. */
  ledgerNotice?: boolean;
  actions: TileActions;
  /** The card went between these two neighbours (ids of its own pinned group; null: no neighbour on that side). */
  onReorder: (movedId: string, previousId: string | null, nextId: string | null) => void;
}

function SortableCard({ card, density, canWrite, owner, actions, reduced, ledgerNotice }: { card: CardItem; density: "tile" | "row"; canWrite: boolean; owner: boolean; actions: TileActions; reduced: boolean; ledgerNotice: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    transition: reduced ? null : { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}
      className={cn("relative list-none", isDragging && "z-10")}
    >
      {/* the place the card left: a dashed, softly pulsing outline (still when motion is reduced) */}
      <div
        className={cn(
          "rounded-xl transition-opacity",
          isDragging && "pointer-events-none opacity-40 outline-dashed outline-2 outline-accent/60 motion-safe:animate-pulse",
        )}
      >
        <CardTile
          card={card}
          density={density}
          canWrite={canWrite}
          owner={owner}
          ledgerNotice={ledgerNotice}
          actions={actions}
          handle={<DragHandle ref={setActivatorNodeRef} cardTitle={card.title} {...attributes} {...listeners} />}
        />
      </div>
    </li>
  );
}

function PlainCard({ card, density, canWrite, owner, archivedView, actions, ledgerNotice }: { card: CardItem; density: "tile" | "row"; canWrite: boolean; owner: boolean; archivedView: boolean; actions: TileActions; ledgerNotice: boolean }) {
  return (
    <li className="list-none">
      <CardTile card={card} density={density} canWrite={canWrite} owner={owner} archivedView={archivedView} ledgerNotice={ledgerNotice} actions={actions} />
    </li>
  );
}

const NOOP_ACTIONS: TileActions = {
  onEdit: () => {},
  onArchive: () => {},
  onRestore: () => {},
  onPin: () => {},
  onDuplicate: () => {},
  onSend: () => {},
  onTask: () => {},
  onToggleItem: () => {},
};

export function CardGrid({ cards, view, canReorder, canWrite, owner, archivedView = false, ledgerNotice = false, actions, onReorder }: CardGridProps) {
  const { t } = useI18n();
  const reduced = usePrefersReducedMotion();
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // «أعمدة حسب التصنيف»: one column per category. Each column scrolls with the page; the row of columns scrolls sideways.
  if (view === "columns") {
    const columns = groupByCategory(cards);
    return (
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {columns.map((col) => (
          <section key={col.category ?? "none"} aria-label={col.category ?? t("cards.no_category")} className="w-[85vw] shrink-0 snap-start sm:w-80">
            <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-fg">
              <span dir="auto" className="min-w-0 truncate">{col.category ?? t("cards.no_category")}</span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-normal text-fg-muted">{col.cards.length}</span>
            </h2>
            <ul className="flex flex-col gap-3 p-0">
              {col.cards.map((card) => (
                <PlainCard key={card.id} card={card} density="tile" canWrite={canWrite} owner={owner} archivedView={archivedView} ledgerNotice={ledgerNotice} actions={actions} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  const density = view === "list" ? "row" : "tile";
  const listClass = view === "list" ? "flex flex-col gap-2 p-0" : "grid grid-cols-1 items-start gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3";

  if (!canReorder) {
    return (
      <ul className={listClass}>
        {cards.map((card) => (
          <PlainCard key={card.id} card={card} density={density} canWrite={canWrite} owner={owner} archivedView={archivedView} ledgerNotice={ledgerNotice} actions={actions} />
        ))}
      </ul>
    );
  }

  const titleOf = (id: string | number) => cards.find((c) => c.id === id)?.title ?? "";
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("cards.dnd.start", { title: titleOf(active.id) }),
    onDragOver: ({ active, over }) => (over ? t("cards.dnd.over", { title: titleOf(active.id), target: titleOf(over.id) }) : undefined),
    onDragEnd: ({ active, over }) => (over ? t("cards.dnd.end", { title: titleOf(active.id), target: titleOf(over.id) }) : t("cards.dnd.cancel", { title: titleOf(active.id) })),
    onDragCancel: ({ active }) => t("cards.dnd.cancel", { title: titleOf(active.id) }),
  };

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = cards.findIndex((c) => c.id === active.id);
    const to = cards.findIndex((c) => c.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(cards, from, to);
    const { previousId, nextId } = neighboursOf(next, String(active.id));
    onReorder(String(active.id), previousId, nextId);
  }

  const active = activeId ? cards.find((c) => c.id === activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("cards.dnd.instructions") } }}
    >
      <SortableContext items={cards.map((c) => c.id)} strategy={view === "list" ? verticalListSortingStrategy : rectSortingStrategy}>
        <ul className={listClass}>
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} density={density} canWrite={canWrite} owner={owner} actions={actions} reduced={reduced} ledgerNotice={ledgerNotice} />
          ))}
        </ul>
      </SortableContext>
      {/* the lifted card: it grows a little and throws a shadow (nothing but the shadow when motion is reduced) */}
      <DragOverlay dropAnimation={reduced ? null : { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {active ? (
          <div className={cn("rounded-xl shadow-lg ring-2 ring-accent/50", !reduced && "scale-[1.03] transition-transform")}>
            <CardTile card={active} density={density} canWrite={false} owner={false} ledgerNotice={ledgerNotice} actions={NOOP_ACTIONS} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
