"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPut } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { SKILL_LEVELS, SKILL_LIMITS } from "@/lib/team-development";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { HistoryDTO, PersonSkillRow } from "@/server/services/team-skills";
import { devErrorText } from "./errors";

/**
 * «المهارات» of one person: for each skill the supervisor's level and the person's own estimate side by side, with the gap.
 * The supervisor's column is editable only for somebody who may enter it (the owner, or `people.review` for one's subtree), the
 * own-estimate column only for the person themselves; the server decides again on every save. A save writes the history row.
 */

function Level({ value, label }: { value: number | null; label: (n: number) => string }) {
  const { t } = useI18n();
  if (value === null) return <span className="text-fg-muted">{t("teamdev.skill.none")}</span>;
  return (
    <span>
      <b className="tabular-nums">{fmtNumber(value)}</b> <span className="text-xs text-fg-muted">{label(value)}</span>
    </span>
  );
}

function Editor({ userId, skillId, source, level, note }: { userId: string; skillId: string; source: "MANUAL" | "SELF"; level: number | null; note: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [value, setValue] = useState(level === null ? "" : String(level));
  const [text, setText] = useState(note);
  const [busy, setBusy] = useState(false);
  const dirty = value !== "" && (value !== (level === null ? "" : String(level)) || text !== note);
  async function save() {
    setBusy(true);
    try {
      await apiPut(`/api/team-development/people/${userId}/skills`, { skillId, source, level: Number(value), note: text });
      toast(t("teamdev.skill.saved"), "success");
      router.refresh();
    } catch (err) {
      toast(devErrorText(err, t), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) void save();
      }}
      data-skill-editor={`${skillId}:${source}`}
    >
      <select
        aria-label={t(source === "MANUAL" ? "teamdev.skill.manual" : "teamdev.skill.self")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-11 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg md:h-9"
      >
        <option value="">{t("teamdev.skill.pick")}</option>
        {SKILL_LEVELS.map((n) => (
          <option key={n} value={n}>
            {fmtNumber(n)} — {t(`teamdev.level.${n}`)}
          </option>
        ))}
      </select>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={SKILL_LIMITS.note}
        placeholder={t("teamdev.skill.note")}
        aria-label={t("teamdev.skill.note")}
        className="h-11 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg md:h-9"
      />
      <Button type="submit" size="sm" disabled={busy || !dirty}>
        {t("common.save")}
      </Button>
    </form>
  );
}

export function PersonSkills({
  userId,
  rows,
  history,
  canEnterManual,
  isSelf,
}: {
  userId: string;
  rows: PersonSkillRow[];
  history: HistoryDTO[];
  canEnterManual: boolean;
  isSelf: boolean;
}) {
  const { t } = useI18n();
  const label = (n: number) => t(`teamdev.level.${n}`);
  const skillName = new Map(rows.map((r) => [r.skill.id, r.skill.name]));
  if (rows.length === 0) return <p className="rounded-xl border border-border bg-surface p-4 text-sm text-fg-muted">{t("teamdev.skill.empty")}</p>;
  return (
    <div className="space-y-4">
      <ul className="space-y-3" data-person-skills>
        {rows.map((r) => (
          <li key={r.skill.id} className={cn("rounded-xl border border-border bg-surface p-3 shadow-card", r.skill.archived && "opacity-70")} data-skill-row={r.skill.id}>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <h3 className="font-medium">{r.skill.name}</h3>
              {r.skill.category ? <span className="rounded-md bg-surface-2 px-1.5 text-xs text-fg-muted">{r.skill.category}</span> : null}
              {r.skill.archived ? <span className="text-xs text-warn">{t("teamdev.skill.archived")}</span> : null}
              {r.gap !== null && r.gap !== 0 ? (
                <span className="ms-auto rounded-md border border-warn/40 bg-warn/10 px-1.5 text-xs text-warn" data-gap={r.gap}>
                  {t("teamdev.skill.gap", { n: fmtNumber(Math.abs(r.gap)) })} — {t(r.gap > 0 ? "teamdev.skill.gap_up" : "teamdev.skill.gap_down")}
                </span>
              ) : null}
            </div>
            {r.skill.description ? <p className="mb-2 text-xs leading-5 text-fg-muted">{r.skill.description}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-surface-1 p-2" data-column="manual">
                <h4 className="mb-1 text-xs font-medium text-fg-muted">{t("teamdev.skill.manual")}</h4>
                {canEnterManual && !r.skill.archived ? (
                  <Editor userId={userId} skillId={r.skill.id} source="MANUAL" level={r.manual?.level ?? null} note={r.manual?.note ?? ""} />
                ) : (
                  <p className="text-sm">
                    <Level value={r.manual?.level ?? null} label={label} />
                    {r.manual?.note ? <span className="mt-1 block text-xs text-fg-muted">{r.manual.note}</span> : null}
                  </p>
                )}
                {r.manual ? (
                  <p className="mt-1 text-xs text-fg-muted">
                    {r.manual.updatedBy} · {fmtDateTime(r.manual.updatedAt)}
                  </p>
                ) : null}
              </div>
              <div className="rounded-lg bg-surface-1 p-2" data-column="self">
                <h4 className="mb-1 text-xs font-medium text-fg-muted">{t("teamdev.skill.self")}</h4>
                {isSelf && !r.skill.archived ? (
                  <Editor userId={userId} skillId={r.skill.id} source="SELF" level={r.self?.level ?? null} note={r.self?.note ?? ""} />
                ) : (
                  <p className="text-sm">
                    <Level value={r.self?.level ?? null} label={label} />
                    {r.self?.note ? <span className="mt-1 block text-xs text-fg-muted">{r.self.note}</span> : null}
                  </p>
                )}
                {r.self ? <p className="mt-1 text-xs text-fg-muted">{fmtDateTime(r.self.updatedAt)}</p> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <details className="rounded-xl border border-border bg-surface p-3 text-sm" data-skill-history>
        <summary className="min-h-11 cursor-pointer py-2 font-medium">{t("teamdev.skill.history")}</summary>
        {history.length === 0 ? (
          <p className="mt-2 text-fg-muted">{t("teamdev.skill.history_empty")}</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {history.map((h) => (
              <li key={h.id} className="leading-6" data-history={h.id}>
                <b>{skillName.get(h.skillId) ?? ""}</b> · {t(h.source === "MANUAL" ? "teamdev.skill.manual" : "teamdev.skill.self")}:{" "}
                {h.oldLevel === null ? t("teamdev.skill.none") : fmtNumber(h.oldLevel)} ← {fmtNumber(h.newLevel)}
                <span className="text-xs text-fg-muted">
                  {" "}
                  · {h.changedBy} · {fmtDateTime(h.at)}
                  {h.reason ? ` · ${t("teamdev.skill.from_goal")}` : ""}
                </span>
                {h.note ? <span className="block text-xs text-fg-muted">{h.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
