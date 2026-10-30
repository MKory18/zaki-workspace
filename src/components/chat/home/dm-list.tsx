"use client";

import React from "react";
import Link from "next/link";
import type { DmSummaryDto } from "@/server/chat/dto";
import { Avatar } from "@/components/ui/avatar";
import { ct } from "@/lib/chat/text";
import { ORDER_MAX, moveWithinGroup } from "@/lib/chat/order";
import { ArrangeList } from "./arrange-list";
import { RowMenu } from "./row-menu";

/** What a private chat row says: the person, the last message, the tick and the unread count. */
function DmBody({ dm }: { dm: DmSummaryDto }) {
  return (
    <>
      <Avatar name={dm.peer.name} src={dm.peer.avatarUrl} className="size-9" />
      <span className="min-w-0 flex-1 truncate">{dm.peer.name}<small className="block truncate text-fg-muted">{dm.lastMessage?.preview ?? ct("chath.start")}</small></span>
      {dm.lastMessage?.mine && <span role="img" aria-label={ct("chath.sent")}>✓</span>}
      {dm.unread > 0 && <span className="rounded-full bg-accent/10 px-2 text-xs">{dm.unread}</span>}
    </>
  );
}

/**
 * The person's private chats. While `arrange` is given they are dragged by a handle (their own order, scope
 * `arrange.scope`), and a row is not a link: a tap never opens a chat by accident.
 */
export function DmList({
  dms,
  menu,
  onChanged,
  arrange,
}: {
  dms: DmSummaryDto[];
  menu?: { canPurge: boolean };
  onChanged: () => void;
  arrange?: { scope: string; onSave: (scope: string, ids: string[]) => void };
}) {
  if (arrange) {
    const byId = new Map(dms.map((d) => [d.id, d]));
    const fullIds = dms.map((d) => d.id);
    return (
      <ArrangeList
        className="divide-y divide-border"
        items={dms.map((d) => ({ id: d.id, group: "d", label: d.peer.name }))}
        row={(id) => <div className="flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2"><DmBody dm={byId.get(id)!} /></div>}
        onMove={(activeId, overId, groupIds) => {
          const next = moveWithinGroup(fullIds, groupIds, activeId, overId);
          if (next) arrange.onSave(arrange.scope, next.slice(0, ORDER_MAX));
        }}
      />
    );
  }
  return (
    <ul className="divide-y divide-border">
      {dms.map((dm) => (
        <li key={dm.id} className="flex items-center gap-1">
          <Link href={`/chat/${dm.id}`} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2"><DmBody dm={dm} /></Link>
          {menu && <RowMenu id={dm.id} title={dm.peer.name} kind="dm" canPurge={menu.canPurge} onChanged={onChanged} />}
        </li>
      ))}
    </ul>
  );
}
