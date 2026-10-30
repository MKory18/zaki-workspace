"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Clapperboard, Search, Users } from "lucide-react";
import { apiPost, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOptionalToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { useNewIntent } from "@/lib/nav/use-new-intent";
import { fmtDateTime } from "@/lib/format";
import { parseWatchLink, watchThumbUrl } from "@/lib/watch/source";
import { cn } from "@/lib/utils";
import { foldedIncludes } from "@/lib/search/arabic";

export interface WatchCard {
  id: string;
  title: string;
  thumbUrl: string;
  host: { id: string; name: string };
  peopleCount: number;
  live: boolean;
  createdAt: string;
}

/** The machine key an API refusal carries (a field's first problem, else the error's own), when it has words. */
export function watchErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    const issue = Array.isArray(err.details) ? (err.details[0] as { message?: unknown } | undefined)?.message : undefined;
    for (const key of [issue, err.messageKey]) if (typeof key === "string" && AR[key]) return key;
  }
  return "common.error";
}

/**
 * «نتفرّج سوا» — the tab's page: paste a link, pick who, go (the owner's rule: no needless steps). The link is read
 * as it is typed, so the person knows at once whether it plays; the server reads it again before anything is kept.
 */
export function WatchHome({
  initial,
  candidates,
  canStart,
}: {
  initial: WatchCard[];
  candidates: { id: string; name: string }[];
  canStart: boolean;
}) {
  const { t } = useI18n();
  const toast = useOptionalToast();
  const router = useRouter();
  const linkRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [everyone, setEveryone] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  // «جديد» → «نتفرّج سوا» lands here with the link box ready
  useNewIntent("watch", () => linkRef.current?.focus(), canStart);

  const source = useMemo(() => parseWatchLink(link), [link]);
  const shown = useMemo(() => {
    const q = query.trim();
    return q ? candidates.filter((p) => foldedIncludes(p.name, q)) : candidates;
  }, [candidates, query]);
  const hasPeople = everyone || picked.size > 0;
  const live = initial.filter((s) => s.live);
  const past = initial.filter((s) => !s.live);

  function toggle(id: string) {
    setEveryone(false);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (!source || !hasPeople || busy) return;
    setBusy(true);
    try {
      const out = await apiPost<{ path: string }>("/api/watch", {
        url: link,
        ...(title.trim() ? { title: title.trim() } : {}),
        everyone,
        memberIds: everyone ? [] : [...picked],
      });
      router.push(out.path);
    } catch (err) {
      toast?.toast(t(watchErrorKey(err)), "error");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
          <Clapperboard className="h-5 w-5 text-accent" aria-hidden="true" />
          {t("watch.title")}
        </h1>
        <p className="text-xs text-fg-muted">{t("watch.subtitle")}</p>
      </header>

      {canStart ? (
        <form onSubmit={start} className="space-y-4 rounded-xl border border-border bg-surface p-4" aria-label={t("watch.start.heading")}>
          <div className="space-y-1.5">
            <label htmlFor="watch-link" className="text-sm font-medium text-fg">
              {t("watch.start.link")}
            </label>
            <Input
              id="watch-link"
              ref={linkRef}
              dir="ltr"
              inputMode="url"
              autoComplete="off"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={t("watch.start.link_placeholder")}
            />
            {link.trim() ? (
              source ? (
                <div className="flex items-center gap-3 pt-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- the video's own still, from its site */}
                  <img src={watchThumbUrl(source)} alt="" className="h-14 w-24 shrink-0 rounded-md object-cover" />
                  <p className="text-xs text-ok">{t("watch.start.link_ok")}</p>
                </div>
              ) : (
                <p className="text-xs text-danger" role="alert">
                  {t("watch.start.link_bad")}
                </p>
              )
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="watch-name" className="text-sm font-medium text-fg">
              {t("watch.start.name")}
            </label>
            <Input id="watch-name" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={t("watch.start.name_placeholder")} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-fg">{t("watch.start.who")}</legend>
            {candidates.length === 0 ? (
              <p className="text-xs text-muted">{t("watch.start.nobody_here")}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={everyone}
                    onClick={() => {
                      setEveryone((v) => !v);
                      setPicked(new Set());
                    }}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm md:min-h-8",
                      everyone ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted hover:bg-surface-2",
                    )}
                  >
                    <Users className="h-4 w-4" aria-hidden="true" />
                    {t("watch.start.everyone")}
                  </button>
                  {picked.size > 0 ? <span className="text-xs text-fg-muted">{t("watch.start.picked", { n: picked.size })}</span> : null}
                </div>
                {candidates.length > 8 ? (
                  <div className="relative">
                    <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
                    <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("watch.start.search")} aria-label={t("watch.start.search")} className="ps-9" />
                  </div>
                ) : null}
                <ul className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
                  {shown.map((p) => {
                    const on = everyone || picked.has(p.id);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(p.id)}
                          className={cn(
                            "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm md:min-h-8",
                            on ? "border-accent bg-accent/10 text-fg" : "border-border text-fg-muted hover:bg-surface-2",
                          )}
                        >
                          {on ? <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> : null}
                          <bdi>{p.name}</bdi>
                        </button>
                      </li>
                    );
                  })}
                  {shown.length === 0 ? <li className="text-xs text-muted">{t("watch.start.no_match")}</li> : null}
                </ul>
              </>
            )}
          </fieldset>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {source && !hasPeople && candidates.length > 0 ? <p className="text-xs text-fg-muted">{t("watch.start.pick_someone")}</p> : null}
            <Button type="submit" disabled={!source || !hasPeople || busy}>
              <Clapperboard className="h-4 w-4" aria-hidden="true" />
              {busy ? t("watch.start.going") : t("watch.start.go")}
            </Button>
          </div>
        </form>
      ) : null}

      {initial.length === 0 ? <p className="py-8 text-center text-sm text-muted">{t("watch.empty")}</p> : null}
      <SessionList heading={t("watch.live")} sessions={live} />
      <SessionList heading={t("watch.past")} sessions={past} />
    </div>
  );
}

function SessionList({ heading, sessions }: { heading: string; sessions: WatchCard[] }) {
  const { t } = useI18n();
  if (sessions.length === 0) return null;
  return (
    <section className="space-y-2" aria-label={heading}>
      <h2 className="text-sm font-semibold text-fg">{heading}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {sessions.map((s) => (
          <li key={s.id}>
            <Link href={`/watch/${s.id}`} className="flex gap-3 rounded-xl border border-border bg-surface p-3 hover:bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- the video's own still, from its site */}
              <img src={s.thumbUrl} alt="" className="h-16 w-28 shrink-0 rounded-md object-cover" loading="lazy" />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium text-fg">
                  <bdi>{s.title}</bdi>
                </p>
                <p className="mt-1 text-xs text-fg-muted">
                  <bdi>{t("watch.by", { name: s.host.name })}</bdi> · {t("watch.people", { n: s.peopleCount })}
                </p>
                <p className="text-xs text-muted">{fmtDateTime(s.createdAt)}</p>
              </div>
              {s.live ? <span className="self-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">{t("watch.enter")}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
