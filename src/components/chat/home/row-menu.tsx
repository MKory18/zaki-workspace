"use client";

import React, { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useOptionalToast } from "@/components/ui/toast";
import { ct } from "@/lib/chat/text";

/**
 * «⋯» next to a topic or a chat of the list (the owner's ask, 2026-10-26: «3 نقط جنب المحادثة او التوبك فيها التثبيت
 * الحذف»). A space's manager pins, archives and deletes an empty topic; the OWNER also deletes any topic or chat for
 * good, messages and all («حذف نهائي», after one clear confirmation). What a person may not do is not offered; the
 * server decides again. Behind «قائمة المحادثة» in «الميزات».
 */
export function RowMenu({
  id,
  title,
  kind,
  pinned = false,
  archived = false,
  system = false,
  canModerate = false,
  canPurge = false,
  onChanged,
}: {
  id: string;
  title: string;
  kind: "topic" | "dm";
  pinned?: boolean;
  archived?: boolean;
  system?: boolean;
  canModerate?: boolean;
  canPurge?: boolean;
  onChanged: () => void;
}) {
  const toast = useOptionalToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const manage = kind === "topic" && canModerate;
  const purge = canPurge && !system;
  if (!manage && !purge) return null;

  const say = (key: string, tone: "success" | "error" = "success") => toast?.toast(ct(key), tone);
  async function call(path: string, method: string, body?: unknown, done = "chath.menu.done"): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        say(data.message === "chat.topic_has_messages" ? "chath.menu.has_messages" : (data.message ?? "chath.menu.failed"), "error");
        return false;
      }
      say(done);
      onChanged();
      return true;
    } catch {
      say("chath.menu.failed", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const topic = `/api/chat/topics/${encodeURIComponent(id)}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={ct("chath.menu.open", { title })}
            disabled={busy}
            className="grid size-11 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <MoreHorizontal className="size-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {manage && !archived ? (
            <DropdownMenuItem onSelect={() => void call(topic, "PATCH", { pinned: !pinned })}>
              <span aria-hidden="true">📌</span> {pinned ? ct("chatc.topic.unpin") : ct("chatc.topic.pin")}
            </DropdownMenuItem>
          ) : null}
          {manage && !system ? (
            <DropdownMenuItem onSelect={() => void call(topic, "PATCH", { archived: !archived })}>
              <span aria-hidden="true">🗄️</span> {archived ? ct("chatc.topic.unarchive") : ct("chatc.topic.archive")}
            </DropdownMenuItem>
          ) : null}
          {manage && !system && !purge ? (
            <DropdownMenuItem tone="danger" onSelect={() => void call(topic, "DELETE", undefined, "chath.menu.deleted")}>
              <span aria-hidden="true">🗑️</span> {ct("chatc.topic.delete")}
            </DropdownMenuItem>
          ) : null}
          {purge ? (
            <DropdownMenuItem tone="danger" onSelect={() => setConfirming(true)}>
              <span aria-hidden="true">🗑️</span> {ct("chath.menu.purge")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Modal open={confirming} title={ct("chath.menu.purge_title", { title })} onClose={() => setConfirming(false)}>
        <p className="text-sm leading-6">{ct("chath.menu.purge_body")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
            {ct("chath.menu.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={busy}
            onClick={() =>
              void call(`/api/chat/conversations/${encodeURIComponent(id)}/purge`, "POST", undefined, "chath.menu.deleted").then((ok) => {
                if (ok) setConfirming(false);
              })
            }
          >
            {ct("chath.menu.purge_confirm")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
