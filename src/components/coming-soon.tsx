import { getServerT } from "@/lib/i18n/server";

/** Explicit "not built yet" state — never a fake feature. */
export function ComingSoon({ titleKey, hintKey }: { titleKey: string; hintKey: string }) {
  const { t } = getServerT();
  return (
    <main className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold text-fg">{t(titleKey)}</h1>
        <p className="mt-1 text-sm text-muted">{t(hintKey)}</p>
        <p className="mt-3 inline-block rounded-full bg-surface-2 px-3 py-1 text-[10px] text-muted">
          {t("coming.badge")}
        </p>
      </div>
    </main>
  );
}
