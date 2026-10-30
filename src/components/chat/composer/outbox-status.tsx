import React from "react";
import { ctCount } from "@/lib/chat/text";

/**
 * The line above the composer while messages wait to be sent: «ما في نت: 3 رسائل بانتظار الإرسال» (offline) or the same
 * without the first words (back online, still sending), and «n رسائل تعذّر إرسالها» when the server refused some. It is
 * gone when nothing waits. The region itself stays (aria-live, polite) so a screen reader hears it appear and clear.
 */
export function OutboxStatusLine({ pending, failed, offline }: { pending: number; failed: number; offline: boolean }) {
  return (
    <div aria-live="polite" data-outbox-status>
      {pending > 0 && <p role="status" data-outbox-pending={pending} className="px-1 pb-1 text-xs font-semibold text-warn">{ctCount(offline ? "outbox.status.offline" : "outbox.status.online", pending)}</p>}
      {failed > 0 && <p role="status" data-outbox-failed={failed} className="px-1 pb-1 text-xs font-semibold text-danger">{ctCount("outbox.status.failed", failed)}</p>}
    </div>
  );
}
