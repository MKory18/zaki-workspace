"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPatch, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { enumLabel } from "@/lib/i18n/enums";
import { fmtNumber, formatDate } from "@/lib/format";
import { SKILL_LEVELS } from "@/lib/team-development";
import { PLAN_LIMITS } from "@/lib/team-plans";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { GoalDTO } from "@/server/services/team-plans";
import type { SkillDTO } from "@/server/services/team-skills";
import { devErrorText } from "./errors";

/**
 * «خطة التطوير» of one person: the goals (a skill of the catalogue or a free title, a target level, actions, a due day), each OPEN,
 * DONE or CANCELLED. A supervisor writes goals and moves them; the person adds only «اقتراح» items, which a supervisor accepts. A DONE
 * goal with a skill and a target level offers «اعتمد المستوى»: one click, a manual confirm, written to the skill history.
 */

const field = "h-11 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg md:h-9";

function GoalCard({ goal, canEnter }: { goal: GoalDTO; canEnter: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
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
  const patch = (body: Record<string, unknown>, okKey: string) => run(() => apiPatch(`/api/team-development/goals/${goal.id}`, body), okKey);
  return (
    <li className={cn("rounded-xl border border-border bg-surface p-3 shadow-card", goal.status !== "OPEN" && "opacity-80")} data-goal={goal.id} data-goal-status={goal.status}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="font-medium">{goal.title}</b>
        {goal.proposal ? <span className="rounded-md border border-info/40 bg-info/10 px-1.5 text-xs text-info" data-proposal>{t("teamdev.plan.proposal")}</span> : null}
        <span className="text-xs text-fg-muted">{enumLabel("DevGoalStatus", goal.status)}</span>
        {goal.dueDate ? <span className="ms-auto text-xs text-fg-muted">{t("teamdev.plan.due")}: {formatDate(goal.dueDate)}</span> : null}
      </div>
      {goal.skillName ? (
        <p className="mt-1 text-sm text-fg-muted">
          {t("teamdev.plan.skill")}: {goal.skillName}
          {goal.targetLevel !== null ? ` — ${t("teamdev.plan.target")}: ${fmtNumber(goal.targetLevel)} (${t(`teamdev.level.${goal.targetLevel}`)})` : ""}
        </p>
      ) : null}
      {goal.actions ? <p className="mt-1 text-sm leading-6">{goal.actions}</p> : null}
      <p className="mt-1 text-xs text-fg-muted">{goal.createdBy}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {canEnter && goal.proposal && goal.status === "OPEN" ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => patch({ accept: true }, "teamdev.plan.accepted")} data-accept-goal={goal.id}>
            {t("teamdev.plan.accept")}
          </Button>
        ) : null}
        {canEnter && !goal.proposal && goal.status === "OPEN" ? (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => patch({ status: "DONE" }, "teamdev.plan.done")} data-done-goal={goal.id}>
            {t("teamdev.plan.mark_done")}
          </Button>
        ) : null}
        {goal.canApply ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => run(() => apiPost(`/api/team-development/goals/${goal.id}/apply`), "teamdev.plan.applied")} data-apply-goal={goal.id}>
            {t("teamdev.plan.apply")}
          </Button>
        ) : null}
        {goal.applied ? <span className="text-xs text-ok">✓ {t("teamdev.plan.applied_mark")}</span> : null}
        {goal.canEdit && goal.status === "OPEN" ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => patch({ status: "CANCELLED" }, "teamdev.plan.cancelled")} data-cancel-goal={goal.id}>
            {t("teamdev.plan.cancel")}
          </Button>
        ) : null}
        {canEnter && goal.status !== "OPEN" && !goal.applied ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => patch({ status: "OPEN" }, "teamdev.plan.reopened")}>
            {t("teamdev.plan.reopen")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function PlanPanel({ userId, goals, skills, canEnter, isSelf }: { userId: string; goals: GoalDTO[]; skills: SkillDTO[]; canEnter: boolean; isSelf: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [skillId, setSkillId] = useState("");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [actions, setActions] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const canAdd = canEnter || isSelf;
  return (
    <div className="space-y-4" data-plan-panel>
      {canAdd ? (
        <form
          className="grid gap-2 rounded-xl border border-border bg-surface p-3 shadow-card sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await apiPost(`/api/team-development/people/${userId}/goals`, { skillId: skillId || null, title, targetLevel: target === "" ? null : Number(target), actions, dueDate: due || null });
              toast(t(isSelf && !canEnter ? "teamdev.plan.proposed" : "teamdev.plan.added"), "success");
              setSkillId("");
              setTitle("");
              setTarget("");
              setActions("");
              setDue("");
              router.refresh();
            } catch (err) {
              toast(devErrorText(err, t), "error");
            } finally {
              setBusy(false);
            }
          }}
          data-goal-form
        >
          <h2 className="font-medium sm:col-span-2">{t(isSelf && !canEnter ? "teamdev.plan.propose" : "teamdev.plan.add")}</h2>
          <select value={skillId} onChange={(e) => setSkillId(e.target.value)} className={field} aria-label={t("teamdev.plan.skill")}>
            <option value="">{t("teamdev.plan.no_skill")}</option>
            {skills.filter((s) => !s.archived).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={skillId === ""} className={field} aria-label={t("teamdev.plan.target")}>
            <option value="">{t("teamdev.plan.no_target")}</option>
            {SKILL_LEVELS.map((n) => (
              <option key={n} value={n}>
                {fmtNumber(n)} — {t(`teamdev.level.${n}`)}
              </option>
            ))}
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={PLAN_LIMITS.title} placeholder={t("teamdev.plan.title")} aria-label={t("teamdev.plan.title")} className={cn(field, "sm:col-span-2")} />
          <textarea value={actions} onChange={(e) => setActions(e.target.value)} maxLength={PLAN_LIMITS.actions} rows={3} placeholder={t("teamdev.plan.actions")} aria-label={t("teamdev.plan.actions")} className={cn(field, "h-auto py-2 sm:col-span-2")} />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} aria-label={t("teamdev.plan.due")} />
          <div>
            <Button type="submit" size="sm" disabled={busy || (title.trim() === "" && skillId === "")}>
              {t(isSelf && !canEnter ? "teamdev.plan.send_proposal" : "teamdev.plan.add_button")}
            </Button>
          </div>
        </form>
      ) : null}
      {goals.length === 0 ? <p className="rounded-xl border border-border bg-surface p-4 text-sm text-fg-muted">{t("teamdev.plan.empty")}</p> : null}
      <ul className="space-y-3">
        {goals.map((g) => (
          <GoalCard key={g.id} goal={g} canEnter={canEnter} />
        ))}
      </ul>
    </div>
  );
}
