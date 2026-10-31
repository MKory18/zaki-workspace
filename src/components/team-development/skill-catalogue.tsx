"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPatch, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { SKILL_LIMITS } from "@/lib/team-development";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { SkillDTO } from "@/server/services/team-skills";
import { devErrorText } from "./errors";

/**
 * «قائمة المهارات» — the company's checklist, kept by the owner and whoever holds `people.manage_lines`: add a skill, edit it,
 * archive it (never delete: the levels already entered keep their meaning) and bring it back.
 */

const field = "h-11 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg md:h-9";

function SkillForm({ initial, onDone, submitLabel }: { initial?: SkillDTO; onDone: () => void; submitLabel: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          if (initial) await apiPatch(`/api/team-development/skills/${initial.id}`, { name, category, description });
          else await apiPost("/api/team-development/skills", { name, category, description });
          toast(t("teamdev.catalogue.saved"), "success");
          if (!initial) {
            setName("");
            setCategory("");
            setDescription("");
          }
          onDone();
          router.refresh();
        } catch (err) {
          toast(devErrorText(err, t), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={SKILL_LIMITS.name} placeholder={t("teamdev.catalogue.name")} aria-label={t("teamdev.catalogue.name")} className={field} required />
      <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={SKILL_LIMITS.category} placeholder={t("teamdev.catalogue.category")} aria-label={t("teamdev.catalogue.category")} className={field} />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={SKILL_LIMITS.description}
        placeholder={t("teamdev.catalogue.description")}
        aria-label={t("teamdev.catalogue.description")}
        className={cn(field, "sm:col-span-2")}
      />
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy || name.trim() === ""}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function SkillItem({ skill }: { skill: SkillDTO }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  async function archive(archived: boolean) {
    setBusy(true);
    try {
      await apiPatch(`/api/team-development/skills/${skill.id}`, { archived });
      router.refresh();
    } catch (err) {
      toast(devErrorText(err, t), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={cn("rounded-lg border border-border bg-surface p-3", skill.archived && "opacity-70")} data-catalogue-skill={skill.id}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="font-medium">{skill.name}</b>
        {skill.category ? <span className="rounded-md bg-surface-2 px-1.5 text-xs text-fg-muted">{skill.category}</span> : null}
        {skill.archived ? <span className="text-xs text-warn">{t("teamdev.skill.archived")}</span> : null}
        <span className="ms-auto flex gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing((v) => !v)}>
            {t("common.edit")}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => archive(!skill.archived)} data-archive-skill={skill.id}>
            {t(skill.archived ? "teamdev.catalogue.restore" : "teamdev.catalogue.archive")}
          </Button>
        </span>
      </div>
      {skill.description ? <p className="mt-1 text-xs leading-5 text-fg-muted">{skill.description}</p> : null}
      {editing ? (
        <div className="mt-2">
          <SkillForm initial={skill} onDone={() => setEditing(false)} submitLabel={t("common.save")} />
        </div>
      ) : null}
    </li>
  );
}

export function SkillCatalogue({ skills }: { skills: SkillDTO[] }) {
  const { t } = useI18n();
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-3 shadow-card" data-catalogue>
      <h2 className="font-medium">{t("teamdev.catalogue.title")}</h2>
      <p className="text-xs leading-5 text-fg-muted">{t("teamdev.catalogue.hint", { max: SKILL_LIMITS.maxSkills })}</p>
      <SkillForm onDone={() => {}} submitLabel={t("teamdev.catalogue.add")} />
      <ul className="space-y-2">
        {skills.map((s) => (
          <SkillItem key={s.id} skill={s} />
        ))}
      </ul>
    </section>
  );
}
