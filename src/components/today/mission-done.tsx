"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { completeTask } from "./complete-task";

/**
 * «خلّصتها» in the mission card, and the gold band that plays once: «تمّت المهمّة!» with the star
 * spinning behind it. Optimistic like the row's circle, and it goes through the same endpoint
 * (`completeTask`): a refusal comes back as an Arabic toast and the band is never played.
 *
 * Nothing is measured here: two words, a star and the page's own colours.
 */
export function MissionDone({ taskId, title }: { taskId: string; title: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "sending" | "passed">("idle");

  async function run() {
    if (phase !== "idle") return;
    setPhase("sending");
    const result = await completeTask(taskId);
    if (!result.ok) {
      setPhase("idle");
      toast(t(result.messageKey), "error");
      return;
    }
    setPhase("passed");
    // the band plays for two seconds, then the page comes back without the finished task
    window.setTimeout(() => router.refresh(), 1900);
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={phase !== "idle"}
        aria-label={t("today.mission.done_aria", { title })}
        className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border-[1.5px] border-on-photo/60 px-4 font-bold text-on-photo transition-colors hover:bg-on-photo/10 disabled:opacity-70"
      >
        <Check aria-hidden="true" className="size-5" />
        {t("today.mission.done")}
      </button>

      {phase === "passed" ? (
        <div role="status" className="zk-passed pointer-events-none absolute start-0 end-0 top-[38%] z-20 grid place-items-center">
          <div className="relative flex w-full flex-col items-center gap-0.5 overflow-hidden bg-scrim/80 py-4">
            <span aria-hidden="true" className="zk-passed-star zk-star absolute size-[260px] text-accent-2 opacity-15" />
            <span className="zk-gta relative text-[42px] leading-tight md:text-[64px]" style={{ "--zk-stroke": "7px", "--zk-shadow": "5px 5px 0" } as CSSProperties}>
              {t("today.mission.passed_title")}
            </span>
            <span className="relative font-semibold text-on-photo">{t("today.mission.passed_sub")}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
