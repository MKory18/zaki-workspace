import Link from "next/link";
import { getServerT } from "@/lib/i18n/server";

/**
 * What a page of the app shows when it calls `notFound()`: an old link, a task that was deleted, a project in a
 * space the person is not in, a profile they may not open. Next draws it INSIDE the shell (the side menu and the
 * bottom bar stay where they are), so the way out is already one tap away; the button is the Today page.
 *
 * The words are the same for «not there» and «not yours» on purpose: the answer must not tell a stranger which
 * ids exist. The shell already owns the page's `<main>`, so this is a plain block.
 */
export default function AppNotFound() {
  const { t } = getServerT();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 p-6 pt-16 text-center md:pt-24">
      <h1 className="text-lg font-semibold text-fg">{t("errpage.notfound.title")}</h1>
      <p className="text-sm leading-7 text-fg-muted">{t("errpage.notfound.hint")}</p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
      >
        {t("errpage.home")}
      </Link>
    </div>
  );
}
