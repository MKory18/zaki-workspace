"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { ArticleBody } from "@/components/guide/article-body";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * What a page of the app shows when it fails while it is drawn (a query that errored, a bug). Next draws it
 * INSIDE the shell, so the menu stays and the way out is one tap away.
 *
 * ⚠️ It never prints the error. In production Next already replaces the message with a hash; in development the
 *    message is the developer's. Either way a visitor must not read a stack, a query or a connection string, so the
 *    text is fixed Arabic and the error object is not touched.
 * 🔧 The words come with the way out, together, drawn the way the whole system draws a risk (the guide's warning
 *    block): try again, or go back to the Today page.
 *
 * The retry button (`errpage.retry`) asks the SERVER again (`router.refresh()`) and then calls `reset()`, both
 * inside one transition. `reset()` alone only draws the failed render once more: the failure of a server component
 * is in the payload the server sent, and drawing that again fails again. The transition is React's own
 * `startTransition`, not the one `useTransition` hands out: that one may only be called while React is rendering
 * this component, and a press of the button happens outside any render.
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  const router = useRouter();

  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div role="alert" className="mx-auto flex w-full max-w-md flex-col gap-4 p-4 pt-12 md:p-6 md:pt-20">
      <h1 className="text-lg font-semibold text-fg">{t("errpage.error.title")}</h1>
      <ArticleBody blocks={[{ type: "warn", text: t("errpage.error.warn"), fix: t("errpage.error.fix") }]} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-11 px-5" onClick={retry}>
          {t("errpage.retry")}
        </Button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-surface px-5 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
        >
          {t("errpage.home")}
        </Link>
      </div>
    </div>
  );
}
