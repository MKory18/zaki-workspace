import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { pageActor } from "@/app/(app)/_access";
import { neighbors, readableArticle } from "@/lib/guide/articles";
import { audienceOf } from "@/lib/guide/audience";
import { getServerT } from "@/lib/i18n/server";
import { ArticleBody } from "@/components/guide/article-body";
import { OpenedGuideMark } from "@/components/guide/first-steps-client";
import { ArtSlot } from "@/components/theme/art-slot";

/** Every article's tab says «الدليل»: a title read from the slug would name an article to somebody who may not open it. */
export const metadata = { title: getServerT().t("guide.title") };

/**
 * One article of the guide. An unknown slug is a 404, and so is an article above the viewer's
 * level (the people article for the team, the task article for a guest): the server decides from
 * the actor, so a typed link cannot read what the guide does not offer.
 */
export default async function GuideArticlePage({ params }: { params: { slug: string } }) {
  const { t } = getServerT();
  const { user, actor } = await pageActor();
  const viewer = audienceOf(actor);
  const article = readableArticle(params.slug, viewer);
  if (!article) notFound();
  const { prev, next } = neighbors(article.slug, viewer);

  const step =
    "block min-h-11 rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:border-accent/50";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 md:p-6">
      <OpenedGuideMark userId={user.id} />

      <Link href="/guide" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent hover:underline">
        <ArrowRight aria-hidden className="size-4" />
        {t("guide.back")}
      </Link>

      <header>
        <h1 className="text-2xl font-bold leading-snug text-fg">{article.title}</h1>
        <p className="mt-2 text-base leading-8 text-fg-muted">{article.summary}</p>
      </header>

      {/* the owner's drawing for this article, once its file exists; sized with max-* so that, until then, it leaves no hole */}
      {article.art ? <ArtSlot slot={article.art} className="mx-auto max-h-44 w-auto rounded-2xl" /> : null}

      <ArticleBody blocks={article.blocks} />

      {article.cta ? (
        <Link
          href={article.cta.href}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
        >
          {article.cta.label}
        </Link>
      ) : null}

      <nav aria-label={t("guide.title")} className="grid gap-3 border-t border-border pt-5 sm:grid-cols-2">
        {prev ? (
          <Link href={`/guide/${prev.slug}`} className={step}>
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              <ArrowRight aria-hidden className="size-3.5" />
              {t("guide.article.prev")}
            </span>
            <span className="mt-1 block text-base font-semibold text-fg">{prev.title}</span>
          </Link>
        ) : (
          <span aria-hidden className="hidden sm:block" />
        )}
        {next ? (
          <Link href={`/guide/${next.slug}`} className={step}>
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              {t("guide.article.next")}
              <ArrowLeft aria-hidden className="size-3.5" />
            </span>
            <span className="mt-1 block text-base font-semibold text-fg">{next.title}</span>
          </Link>
        ) : null}
      </nav>
    </div>
  );
}

export const dynamic = "force-dynamic";
