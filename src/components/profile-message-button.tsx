"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiPost, ApiError } from "@/lib/api-client";
import { AR } from "@/lib/i18n/dict";

/** «راسله»: opens (or finds) the private chat with this person in the space I am in, and goes to it. */
export function ProfileMessageButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    setBusy(true);
    setError("");
    try {
      const made = await apiPost<{ id: string }>("/api/chat/dm", { userId });
      router.push(`/chat/${made.id}`);
    } catch (err) {
      const key = err instanceof ApiError && err.messageKey ? err.messageKey : "common.error";
      setError(AR[key] ?? AR["common.error"] ?? "");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" data-message-button onClick={() => void open()} disabled={busy}>
        {AR["profilecard.message"]}
      </Button>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
