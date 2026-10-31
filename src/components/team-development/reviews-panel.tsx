"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPatch, apiPut } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { enumLabel } from "@/lib/i18n/enums";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { REVIEW_LIMITS } from "@/lib/team-reviews";
import { LIGHTS, type Light } from "@/lib/team-score";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { CriterionDTO } from "@/server/services/team-criteria";
import type { ReviewDTO } from "@/server/services/team-reviews";
import { devErrorText } from "./errors";

/**
 * «التقييمات» of one person. A reviewer (the owner, or a supervisor holding `people.review` for this person) sees every version of
 * every review with its private note, can write their own review of a period (ratings 1-5 per criterion, a light, strengths,
 * improvement, a private note), submit it and share it. The PERSON sees only what was shared with them: the server does not even
 * send them the private note. A shared review is locked: «تصحيح» starts a new version.
 */

const field = "rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg";
const LIGHT_DOT: Record<Light, string> = { GREEN: "bg-ok", AMBER: "bg-warn", RED: "bg-danger" };

export function ReviewsPanel({
  userId,
  reviews,
  criteria,
  periods,
  canWrite,
  selfView,
}: {
  userId: string;
  reviews: ReviewDTO[];
  criteria: CriterionDTO[];
  periods: { key: string; label: string }[];
  canWrite: boolean;
  selfView: boolean;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const names = useMemo(() => new Map(criteria.map((c) => [c.id, c.name])), [criteria]);
  const live = criteria.filter((c) => !c.archived);
  const [period, setPeriod] = useState(periods[0]?.key ?? "");
  const mine = reviews.find((r) => r.mine && r.live && r.period === period);
  const base = mine && mine.status !== "SHARED" ? mine : undefined;
  const [ratings, setRatings] = useState<Record<string, number>>(base?.ratings ?? {});
  const [light, setLight] = useState<Light | "">(base?.light ?? "");
  const [strengths, setStrengths] = useState(base?.strengths ?? "");
  const [improvement, setImprovement] = useState(base?.improvement ?? "");
  const [privateNote, setPrivateNote] = useState(base?.privateNote ?? "");
  const [busy, setBusy] = useState(false);

  function load(key: string) {
    setPeriod(key);
    const r = reviews.find((x) => x.mine && x.live && x.period === key);
    const open = r && r.status !== "SHARED" ? r : undefined;
    setRatings(open?.ratings ?? {});
    setLight(open?.light ?? "");
    setStrengths(open?.strengths ?? "");
    setImprovement(open?.improvement ?? "");
    setPrivateNote(open?.privateNote ?? "");
  }

  async function run(job: () => Promise<unknown>, okKey: string) {
    setBusy(true);
    try {
      await job();
      toast(t(okKey), "success");
      router.refresh();
    } catch (err) {
      toast(devErrorText(err, t), "error");
    } finally {
      setBusy(false);
    }
  }

  const save = (newVersion: boolean) =>
    run(() => apiPut(`/api/team-development/people/${userId}/reviews`, { period, ratings, light: light === "" ? null : light, strengths, improvement, privateNote, ...(newVersion ? { newVersion: true } : {}) }), "teamdev.review.saved");

  const byPeriod = new Map<string, ReviewDTO[]>();
  for (const r of reviews) byPeriod.set(r.period, [...(byPeriod.get(r.period) ?? []), r]);

  return (
    <div className="space-y-5" data-reviews-panel>
      {canWrite ? (
        <form
          className="space-y-3 rounded-xl border border-border bg-surface p-3 shadow-card"
          onSubmit={(e) => {
            e.preventDefault();
            void save(mine?.status === "SHARED");
          }}
          data-review-form
        >
          <h2 className="font-medium">{t("teamdev.review.form")}</h2>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {t("teamdev.col.period")}
            <select value={period} onChange={(e) => load(e.target.value)} className={cn(field, "h-11 md:h-9")}>
              {periods.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {mine?.status === "SHARED" ? <p className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs text-warn">{t("teamdev.review.locked_note")}</p> : null}
          <fieldset className="space-y-2">
            <legend className="text-xs text-fg-muted">{t("teamdev.review.ratings")}</legend>
            {live.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">{c.name}</span>
                <div className="flex gap-1" role="radiogroup" aria-label={c.name}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={ratings[c.id] === n}
                      onClick={() => setRatings((cur) => (cur[c.id] === n ? Object.fromEntries(Object.entries(cur).filter(([k]) => k !== c.id)) : { ...cur, [c.id]: n }))}
                      className={cn("size-11 rounded-lg border text-sm tabular-nums md:size-9", ratings[c.id] === n ? "border-accent bg-accent/10 font-semibold" : "border-border bg-surface-1 text-fg-muted")}
                      data-rating={`${c.id}:${n}`}
                    >
                      {fmtNumber(n)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-xs text-fg-muted">{t("teamdev.review.light")}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {LIGHTS.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={light === l}
                  onClick={() => setLight(light === l ? "" : l)}
                  className={cn("inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm md:min-h-9", light === l ? "border-accent bg-accent/10" : "border-border bg-surface-1 text-fg-muted")}
                  data-light-choice={l}
                >
                  <span aria-hidden className={cn("size-2.5 rounded-full", LIGHT_DOT[l])} />
                  {enumLabel("ReviewLight", l)}
                </button>
              ))}
            </div>
            <p className="text-xs text-fg-muted">{t("teamdev.review.light_hint")}</p>
          </fieldset>
          {(
            [
              ["strengths", strengths, setStrengths, "teamdev.review.strengths"],
              ["improvement", improvement, setImprovement, "teamdev.review.improvement"],
              ["privateNote", privateNote, setPrivateNote, "teamdev.review.private"],
            ] as const
          ).map(([key, value, set, label]) => (
            <label key={key} className="flex flex-col gap-1 text-xs text-fg-muted">
              {t(label)}
              <textarea value={value} onChange={(e) => set(e.target.value)} maxLength={REVIEW_LIMITS.text} rows={3} className={cn(field, "py-2")} data-review-field={key} />
            </label>
          ))}
          <p className="text-xs text-fg-muted">🔒 {t("teamdev.review.private_hint")}</p>
          <Button type="submit" size="sm" disabled={busy}>
            {mine?.status === "SHARED" ? t("teamdev.review.new_version") : t("common.save")}
          </Button>
        </form>
      ) : null}

      {reviews.length === 0 ? <p className="rounded-xl border border-border bg-surface p-4 text-sm text-fg-muted">{t(selfView ? "teamdev.review.none_self" : "teamdev.review.none")}</p> : null}

      {[...byPeriod.entries()].map(([key, list]) => (
        <section key={key} className="space-y-2" data-review-period={key}>
          <h3 className="text-sm font-semibold">{periods.find((p) => p.key === key)?.label ?? key}</h3>
          <ul className="space-y-3">
            {list.map((r) => (
              <li key={r.id} className={cn("rounded-xl border border-border bg-surface p-3 shadow-card", !r.live && "opacity-70")} data-review={r.id}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <b>{r.reviewerName}</b>
                  <span className="text-xs text-fg-muted">
                    {t("teamdev.review.version", { n: fmtNumber(r.version) })} · {enumLabel("ReviewStatus", r.status)} · {fmtDateTime(r.updatedAt)}
                  </span>
                  {r.light ? (
                    <span className="inline-flex items-center gap-1.5 text-xs" data-review-light={r.light}>
                      <span aria-hidden className={cn("size-2 rounded-full", LIGHT_DOT[r.light])} />
                      {enumLabel("ReviewLight", r.light)}
                    </span>
                  ) : null}
                </div>
                {Object.keys(r.ratings).length > 0 ? (
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {Object.entries(r.ratings).map(([cid, v]) => (
                      <li key={cid} className="flex justify-between gap-2 text-sm">
                        <span className="text-fg-muted">{names.get(cid) ?? ""}</span>
                        <b className="tabular-nums">{fmtNumber(v)} / {fmtNumber(5)}</b>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {r.strengths ? (
                  <p className="mt-2 text-sm leading-6">
                    <span className="text-fg-muted">{t("teamdev.review.strengths")}: </span>
                    {r.strengths}
                  </p>
                ) : null}
                {r.improvement ? (
                  <p className="mt-1 text-sm leading-6">
                    <span className="text-fg-muted">{t("teamdev.review.improvement")}: </span>
                    {r.improvement}
                  </p>
                ) : null}
                {r.privateNote ? (
                  <p className="mt-1 rounded-lg bg-surface-2 p-2 text-sm leading-6" data-private-note>
                    <span className="text-fg-muted">🔒 {t("teamdev.review.private")}: </span>
                    {r.privateNote}
                  </p>
                ) : null}
                {canWrite && (r.mine || r.editable) && r.live ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.status === "DRAFT" ? (
                      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => run(() => apiPatch(`/api/team-development/reviews/${r.id}`, { status: "SUBMITTED" }), "teamdev.review.submitted")} data-submit-review={r.id}>
                        {t("teamdev.review.submit")}
                      </Button>
                    ) : null}
                    {r.status === "SUBMITTED" ? (
                      <Button type="button" size="sm" disabled={busy} onClick={() => run(() => apiPatch(`/api/team-development/reviews/${r.id}`, { status: "SHARED" }), "teamdev.review.shared")} data-share-review={r.id}>
                        {t("teamdev.review.share")}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
