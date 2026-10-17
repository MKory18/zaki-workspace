"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

let seq = 0;

/** App-wide toasts. All mutations should surface results through this. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = ++seq;
    setItems((prev) => [...prev.slice(-4), { id, kind, message }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const api = useMemo<ToastApi>(() => ({ toast }), [toast]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 end-4 z-[70] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <ToastRow key={t.id} item={t} onDismiss={() => setItems((p) => p.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const icons: Record<ToastKind, ReactNode> = {
    success: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
    error: <AlertCircle className="h-4 w-4 text-red-500" />,
    info: <Info className="h-4 w-4 text-accent" />,
  };
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-start gap-2 rounded-lg border border-border bg-surface p-3 shadow-md animate-fade-in",
      )}
    >
      {icons[item.kind]}
      <p className="flex-1 text-xs text-fg">{item.message}</p>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="rounded p-0.5 text-muted hover:text-fg"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast requires ToastProvider");
  return ctx;
}
