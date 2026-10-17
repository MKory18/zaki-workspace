import Link from "next/link";
import { CheckCircle2, Link2, XCircle } from "lucide-react";
import { getServerT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

/** One integrations row on the settings hub: honest status + setup link. */
export function IntegrationBadge({
  ok,
  label,
  href,
  muted,
}: {
  ok: boolean;
  label: string;
  href: string;
  muted?: string | null;
}) {
  const { t } = getServerT();
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2 transition-colors hover:border-accent/40"
    >
      <span className="flex items-center gap-2 text-sm">
        <Link2 className="size-4 text-muted" />
        {label}
      </span>
      <span className={cn("flex items-center gap-1.5 text-[10px] font-medium", ok ? "text-emerald-600" : "text-muted")}>
        {ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
        {ok ? t("settings.connected") : mutedKey(muted, t)}
      </span>
    </Link>
  );
}

function mutedKey(muted: string | null | undefined, t: (k: string) => string): string {
  return muted ? t(muted) : t("settings.notConnected");
}
