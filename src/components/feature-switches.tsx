"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPatch } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useOptionalToast } from "@/components/ui/toast";
import type { FeatureKey } from "@/lib/features";
import { cn } from "@/lib/utils";

/**
 * «الميزات»: the owner switches each feature on or off. Off, the feature is gone from every screen and its doors
 * answer «not found»; what it stored is kept, and switching it on brings it all back.
 */
export function FeatureSwitches({ initial }: { initial: { key: FeatureKey; on: boolean }[] }) {
  const { t } = useI18n();
  const toast = useOptionalToast();
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<FeatureKey | null>(null);

  async function flip(key: FeatureKey, on: boolean) {
    setBusy(key);
    setItems((all) => all.map((f) => (f.key === key ? { ...f, on } : f)));
    try {
      await apiPatch("/api/settings/features", { key, on });
      toast?.toast(t(on ? "features.turned_on" : "features.turned_off", { name: t(`features.${key}.name`) }), "success");
      // the menu and «جديد» are drawn on the server: draw them again
      router.refresh();
    } catch {
      setItems((all) => all.map((f) => (f.key === key ? { ...f, on: !on } : f)));
      toast?.toast(t("common.error"), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((f) => (
        <li key={f.key} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">{t(`features.${f.key}.name`)}</p>
            <p className="text-xs text-muted">{t(`features.${f.key}.hint`)}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={f.on}
            aria-label={t(`features.${f.key}.name`)}
            disabled={busy === f.key}
            onClick={() => flip(f.key, !f.on)}
            className={cn(
              "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:opacity-60",
              f.on ? "border-accent bg-accent" : "border-border bg-surface-2",
            )}
          >
            <span className={cn("inline-block size-5 rounded-full bg-surface shadow transition-transform", f.on ? "-translate-x-6" : "-translate-x-1")} />
          </button>
        </li>
      ))}
    </ul>
  );
}
