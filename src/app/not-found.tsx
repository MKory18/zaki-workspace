import Link from "next/link";
import { getServerT } from "@/lib/i18n/server";

/**
 * An address that matches no page at all (a typo, a very old link, a page that was removed). Next draws this
 * inside the root layout, so the theme and the Arabic dictionary are there, but there is no shell: the side menu
 * belongs to the pages of the app. A page of the app that calls `notFound()` lands on `(app)/not-found.tsx`
 * instead, inside the shell.
 *
 * One sentence says «it is not there» and «it is not yours»: telling them apart would tell a stranger which
 * ids exist. The way out is the Today page, which every signed-in person has.
 */
export default function NotFound() {
  const { t } = getServerT();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-fg">{t("errpage.notfound.title")}</h1>
      <p className="text-sm leading-7 text-fg-muted">{t("errpage.notfound.hint")}</p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
      >
        {t("errpage.home")}
      </Link>
    </main>
  );
}
