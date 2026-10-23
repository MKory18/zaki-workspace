"use client";

import { useCallback, useEffect, useState } from "react";
import type { HomeDto } from "@/server/chat/dto";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ChatHome } from "./chat-home";

export function ChatHomeClient({ guest }: { guest: boolean }) {
  const [home, setHome] = useState<HomeDto>({ spaces: [], dms: [], canOversee: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  useRealtime((event) => { if (!event.conversationId || event.kind === "conversation.changed" || event.kind.startsWith("message.") || event.kind === "membership.changed") refresh(); });
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch("/api/chat/home", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("home");
      return response.json() as Promise<HomeDto>;
    }).then((data) => { if (alive) { setHome(data); setError(false); } }).catch(() => { if (alive) setError(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reload]);
  return <div className="min-h-full">{loading && <div role="status" aria-label="جارٍ التحميل" className="mx-4 mt-4 space-y-3"><div className="h-16 animate-pulse rounded-xl bg-surface-2"/><div className="h-28 animate-pulse rounded-xl bg-surface-2"/></div>}{error && <div role="alert" className="mx-4 mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">ما قدرنا نحمّل المحادثات. <button type="button" onClick={refresh} className="underline">حاول مرة ثانية</button></div>}<ChatHome home={home} guest={guest}/></div>;
}
