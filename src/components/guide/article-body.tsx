import { Fragment } from "react";
import type { ResolvedBlock } from "@/lib/guide/articles";
import { getServerT, type ServerT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

const TEXT = "text-[15px] leading-8 text-fg";

/**
 * An article, drawn for one viewer (the blocks are already filtered for them). Plain markup, no
 * state: it renders on the server. Phone first, right-to-left, theme tokens only.
 *
 * A warning is drawn the way the whole system draws a risk: ⚠️ with the words and 🔧 with the way
 * out, together. The symbols are decoration; a screen reader hears «تنبيه» and «الحل».
 */
export function ArticleBody({ blocks }: { blocks: readonly ResolvedBlock[] }) {
  const { t } = getServerT();
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} t={t} />
      ))}
    </div>
  );
}

function BlockView({ block, t }: { block: ResolvedBlock; t: ServerT }) {
  switch (block.type) {
    case "h":
      return <h2 className="pt-3 text-lg font-semibold text-fg">{block.text}</h2>;

    case "p":
      return <p className={TEXT}>{block.text}</p>;

    case "steps":
      return (
        <section className="space-y-3">
          {block.title ? <h3 className="text-sm font-semibold text-accent">{block.title}</h3> : null}
          <ol className="space-y-3">
            {block.items.map((text, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-fg"
                >
                  {i + 1}
                </span>
                <span className={cn("min-w-0 flex-1", TEXT)}>{text}</span>
              </li>
            ))}
          </ol>
        </section>
      );

    case "list":
      return (
        <section className="space-y-2">
          {block.title ? <h3 className="text-sm font-semibold text-accent">{block.title}</h3> : null}
          <ul className="list-disc space-y-2 ps-5 marker:text-accent">
            {block.items.map((text, i) => (
              <li key={i} className={TEXT}>
                {text}
              </li>
            ))}
          </ul>
        </section>
      );

    case "tip":
      return (
        <div role="note" className="flex gap-3 rounded-xl border border-border bg-surface-2 p-3.5">
          <span aria-hidden className="text-lg leading-8">
            💡
          </span>
          <p className={cn("min-w-0 flex-1", TEXT)}>
            <span className="sr-only">{t("guide.article.tip")}: </span>
            {block.text}
          </p>
        </div>
      );

    case "warn":
      return (
        <div role="note" className="space-y-2 rounded-xl border border-s-4 border-border border-s-warn bg-surface-2 p-3.5">
          <p className={cn("flex gap-3", TEXT)}>
            <span aria-hidden>⚠️</span>
            <span className="min-w-0 flex-1">
              <span className="sr-only">{t("guide.article.warn")}: </span>
              {block.text}
            </span>
          </p>
          <p className={cn("flex gap-3", TEXT)}>
            <span aria-hidden>🔧</span>
            <span className="min-w-0 flex-1">
              <span className="sr-only">{t("guide.article.fix")}: </span>
              {block.fix}
            </span>
          </p>
        </div>
      );

    case "keys": {
      // Ctrl + K is a chord; the two arrows are a pair, not a combination
      const chord = block.keys.some((key) => /[A-Za-z]/.test(key));
      return (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-1 p-3">
          {/* a shortcut always reads left to right, like the keys on the keyboard */}
          <span dir="ltr" className="inline-flex items-center gap-1.5">
            {block.keys.map((key, i) => (
              <Fragment key={`${key}-${i}`}>
                {chord && i > 0 ? (
                  <span aria-hidden className="text-fg-muted">
                    +
                  </span>
                ) : null}
                <kbd className="min-w-8 rounded-md border border-border bg-surface-2 px-2 py-1 text-center font-mono text-xs text-fg">
                  {key}
                </kbd>
              </Fragment>
            ))}
          </span>
          <span className={cn("min-w-0 flex-1 basis-40", TEXT)}>{block.text}</span>
        </div>
      );
    }
  }
}
