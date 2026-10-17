"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, RefreshCw } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

/** Invitation code viewer (OWNER/ADMIN): copy + rotate. Joiners use it at register. */
export function JoinCodePanel({
  organizationId,
  initialCode,
}: {
  organizationId: string;
  initialCode: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);

  async function regenerate() {
    setBusy(true);
    try {
      const res = await apiPost<{ joinCode: string }>(`/api/organizations/${organizationId}/join-code`);
      setCode(res.joinCode);
      toast(t("teams.codeRegenerated"), "success");
      router.refresh();
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-surface-1 px-3 py-2">
      <span className="text-[10px] text-muted">{t("teams.joinCode")}</span>
      <code className="font-mono text-sm font-bold text-fg">{code}</code>
      <button
        type="button"
        aria-label={t("teams.copyCode")}
        title={t("teams.copyCode")}
        onClick={() => {
          navigator.clipboard.writeText(code).catch(() => undefined);
          toast(t("teams.codeCopied"), "success");
        }}
        className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={regenerate}
        disabled={busy}
        aria-label={t("teams.regenerateCode")}
        title={t("teams.regenerateCode")}
        className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
