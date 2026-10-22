"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { rankEntries } from "@/lib/guide/match";
import type { GuideEntry } from "@/lib/guide/articles";

/**
 * The guide's index: a search box over article cards. The server hands over only the articles this
 * person may read (with only the text they may read), so searching can never turn up anything
 * above their level. Spelling-tolerant (see lib/guide/match.ts); the list is the whole guide until
 * something is typed.
 */
export function GuideSearch({ entries, initialQuery = "" }: { entries: readonly GuideEntry[]; initialQuery?: string }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const shown = useMemo(() => rankEntries(entries, query), [entries, query]);
  const searching = query.trim() !== "";

  return (
    <div className="space-y-4">
      <div className="relative">
        <label htmlFor="guide-search" className="sr-only">
          {t("guide.search.label")}
        </label>
        <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted" />
        <input
          id="guide-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("guide.search.placeholder")}
          autoComplete="off"
          enterKeyHint="search"
          className="h-12 w-full rounded-xl border border-muted bg-surface-1 pe-12 ps-10 text-base text-fg placeholder:text-fg-muted"
        />
        {searching ? (
          <button
            type="button"
            aria-label={t("guide.search.clear")}
            onClick={() => setQuery("")}
            className="absolute end-0.5 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-lg text-fg-muted hover:text-fg"
          >
            <X aria-hidden className="size-5" />
          </button>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {searching ? t("guide.search.results", { n: shown.length }) : ""}
      </p>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm leading-7 text-fg-muted">
          {t("guide.search.empty")}
        </p>
      ) : (
        <ul className="grid gap-3">
          {shown.map((entry) => (
            <li key={entry.slug}>
              <Link
                href={`/guide/${entry.slug}`}
                className="block min-h-11 rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:border-accent/50"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="text-base font-semibold text-fg">{entry.title}</span>
                  {entry.badge ? (
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
                      {t("guide.badge.managers")}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-sm leading-7 text-fg-muted">{entry.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
