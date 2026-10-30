"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ct } from "@/lib/chat/text";
import { Avatar } from "@/components/ui/avatar";
import { callApi, type CallView } from "./call-api";
import { useOptionalCall } from "./call-provider";
import { ensurePush } from "./push-client";
import { startRing } from "@/lib/calls/ring-sound";

/** A ring stops by itself after this long (an unanswered call). */
export const RING_FOR_MS = 30_000;

/**
 * The incoming call, on every page: somebody rang this person (a DM call, a topic call that «رنّ على الكل», or
 * «ضيف حدا»). The event carries ids only; the card asks the calls API, which answers only somebody who may join,
 * and a call that ended rings nobody. «ردّ» opens the call's page; «رفض» or thirty seconds close the card.
 */
export function CallRing() {
  const router = useRouter();
  const pathname = usePathname();
  const [ringing, setRinging] = React.useState<CallView | null>(null);
  const call = useOptionalCall();

  useRealtime((event) => {
    if (event.kind !== "call.ring" || !event.callId) return;
    if (pathname === `/calls/${event.callId}`) return; // already in it
    void callApi<CallView>(`/api/calls/${encodeURIComponent(event.callId)}`).then(
      (view) => {
        if (!view.endedAt) {
          setRinging(view);
          // warm the connection while it rings, so «ردّ» is instant
          call?.prefetch(view.id);
        }
      },
      () => undefined,
    );
  });

  React.useEffect(() => {
    if (!ringing) return;
    const stop = setTimeout(() => setRinging(null), RING_FOR_MS);
    const tone = startRing();
    return () => {
      clearTimeout(stop);
      tone();
    };
  }, [ringing]);

  if (!ringing) return null;
  const where = ringing.conversationTitle || ringing.title;
  return (
    <div role="alertdialog" aria-live="assertive" aria-label={ct("calls.ring.from", { name: ringing.startedBy.name })} dir="rtl" lang="ar" className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-2xl border border-border bg-surface-1 p-3 shadow-lg">
      <Avatar name={ringing.startedBy.name} src={ringing.startedBy.avatarUrl} className="h-11 w-11" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{ct("calls.ring.from", { name: ringing.startedBy.name })}</p>
        <p className="truncate text-sm text-fg-muted">
          {ringing.video ? ct("calls.video") : ct("calls.audio")}
          {where ? ` ${ct("calls.ring.in", { title: where })}` : ""}
        </p>
      </div>
      <button type="button" onClick={() => setRinging(null)} className="min-h-11 rounded-full border border-border px-3 text-sm hover:bg-surface-2">
        {ct("calls.ring.decline")}
      </button>
      <button
        type="button"
        onClick={() => {
          const id = ringing.id;
          void ensurePush(true);
          setRinging(null);
          router.push(`/calls/${encodeURIComponent(id)}`);
        }}
        className="min-h-11 rounded-full bg-ok px-4 text-sm font-semibold text-ok-fg"
      >
        {ct("calls.ring.answer")}
      </button>
    </div>
  );
}
