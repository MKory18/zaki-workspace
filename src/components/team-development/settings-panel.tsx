"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPatch, apiPost, apiPut } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { CRITERIA_LIMITS } from "@/lib/team-reviews";
import { INDICATOR_KEYS, type IndicatorKey, type Weights } from "@/lib/team-score";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { CriterionDTO } from "@/server/services/team-criteria";
import { devErrorText } from "./errors";

/** «إعدادات التقييم» — the OWNER's: the weights of the score and the criteria a reviewer rates (rename, add up to 8, retire). */

const field = "h-11 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg md:h-9";
const LABEL: Record<IndicatorKey, string> = { manual: "teamdev.score.ind.manual", completed: "teamdev.score.ind.completed", onTime: "teamdev.score.ind.onTime", steps: "teamdev.score.ind.steps" };

function Weights_({ weights }: { weights: Weights }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [draft, setDraft] = useState<Record<IndicatorKey, string>>({ manual: String(weights.manual), completed: String(weights.completed), onTime: String(weights.onTime), steps: String(weights.steps) });
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3 rounded-xl border border-border bg-surface p-3 shadow-card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await apiPut("/api/team-development/weights", Object.fromEntries(INDICATOR_KEYS.map((k) => [k, Number(draft[k])])));
          toast(t("teamdev.settings.saved"), "success");
          router.refresh();
        } catch (err) {
          toast(devErrorText(err, t), "error");
        } finally {
          setBusy(false);
        }
      }}
      data-weights-form
    >
      <h2 className="font-medium">{t("teamdev.settings.weights")}</h2>
      <p className="text-xs leading-5 text-fg-muted">{t("teamdev.settings.weights_hint")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {INDICATOR_KEYS.map((k) => (
          <label key={k} className="flex flex-col gap-1 text-xs text-fg-muted">
            {t(LABEL[k])}
            <input type="number" min={0} max={100} step={1} inputMode="numeric" value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} className={field} data-weight={k} />
          </label>
        ))}
      </div>
      <Button type="submit" size="sm" disabled={busy}>
        {t("common.save")}
      </Button>
    </form>
  );
}

function CriterionRow({ c }: { c: CriterionDTO }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [name, setName] = useState(c.name);
  const [busy, setBusy] = useState(false);
  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await apiPatch(`/api/team-development/criteria/${c.id}`, body);
      router.refresh();
    } catch (err) {
      toast(devErrorText(err, t), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={cn("flex flex-wrap items-center gap-2", c.archived && "opacity-70")} data-criterion={c.id}>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={CRITERIA_LIMITS.name} aria-label={t("teamdev.settings.criterion")} className={cn(field, "min-w-0 flex-1")} />
      <Button type="button" size="sm" variant="secondary" disabled={busy || name.trim() === "" || name === c.name} onClick={() => patch({ name })}>
        {t("common.save")}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => patch({ archived: !c.archived })} data-archive-criterion={c.id}>
        {t(c.archived ? "teamdev.catalogue.restore" : "teamdev.catalogue.archive")}
      </Button>
    </li>
  );
}

function Criteria({ criteria }: { criteria: CriterionDTO[] }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-3 shadow-card" data-criteria>
      <h2 className="font-medium">{t("teamdev.settings.criteria")}</h2>
      <p className="text-xs leading-5 text-fg-muted">{t("teamdev.settings.criteria_hint", { max: CRITERIA_LIMITS.maxLive })}</p>
      <ul className="space-y-2">
        {criteria.map((c) => (
          <CriterionRow key={c.id} c={c} />
        ))}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await apiPost("/api/team-development/criteria", { name });
            setName("");
            router.refresh();
          } catch (err) {
            toast(devErrorText(err, t), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={CRITERIA_LIMITS.name} placeholder={t("teamdev.settings.new_criterion")} aria-label={t("teamdev.settings.new_criterion")} className={cn(field, "min-w-0 flex-1")} />
        <Button type="submit" size="sm" disabled={busy || name.trim() === ""}>
          {t("teamdev.settings.add_criterion")}
        </Button>
      </form>
    </section>
  );
}

export function SettingsPanel({ weights, criteria }: { weights: Weights; criteria: CriterionDTO[] }) {
  return (
    <div className="space-y-5">
      <Weights_ weights={weights} />
      <Criteria criteria={criteria} />
    </div>
  );
}
