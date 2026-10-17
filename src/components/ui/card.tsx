import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface-1", className)}>{children}</div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("border-b border-border px-4 py-3", className)}>{children}</div>;
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}

export function Badge({
  children,
  color,
  className,
}: {
  children: React.ReactNode;
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted",
        className,
      )}
    >
      {color ? <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} /> : null}
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
      {children}
    </div>
  );
}
