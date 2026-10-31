import { statusText, statusTone } from "@/lib/approvals/shared";
import { cn } from "@/lib/utils";

/** The tone classes of a status: the theme's tokens only (never a palette colour). */
const TONE: Record<ReturnType<typeof statusTone>, string> = {
  warn: "border-warn/40 bg-warn/10 text-warn",
  ok: "border-ok/40 bg-ok/10 text-ok",
  danger: "border-danger/40 bg-danger/10 text-danger",
  info: "border-info/40 bg-info/10 text-info",
  muted: "border-border bg-surface-2 text-fg-muted",
};

/** «بانتظار القرار» / «تمت الموافقة» / «مرفوض» / «مطلوب تعديل» / «ملغى»: a request's (or a step's) state, in Arabic. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span data-approval-status={status} className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium", TONE[statusTone(status)], className)}>
      {statusText(status)}
    </span>
  );
}
