"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { completeTask } from "./complete-task";

/** How long «تمّت المهمّة!» stays over the card before the page brings the next mission. */
export const PASSED_MS = 1800;

/**
 * «خلّصتها ✓» — finishes the mission from its card, through the same endpoint and the same messages as a row
 * of the list (`completeTask`). On success «تمّت المهمّة!» plays once over the whole card (`.zk-passed`, a
 * `role="status"` the screen reader says), then the page is refreshed and the next mission takes its place.
 * On a refusal nothing changes on the card and the reason is said in a toast.
 *
 * No «+١ نجمة»: the stars are the rewards phase, not this one.
 */
export function MissionDone({ task }: { task: { id: string; title: string } }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "passed">("idle");

  useEffect(() => {
    if (state !== "passed") return;
    const timer = window.setTimeout(() => router.refresh(), PASSED_MS);
    return () => window.clearTimeout(timer);
  }, [state, router]);

  async function finish() {
    if (state !== "idle") return;
    setState("pending");
    const result = await completeTask(task.id);
    if (result.ok) {
      setState("passed");
      return;
    }
    setState("idle");
    toast(t(result.messageKey), "error");
  }

  return (
    <>
      <button
        type="button"
        onClick={finish}
        disabled={state !== "idle"}
        aria-label={t("today.mission.done_aria", { title: task.title })}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-accent-2 px-4 text-sm font-semibold text-fg transition-colors hover:bg-accent-2/15 disabled:opacity-60"
      >
        <Check aria-hidden="true" className="size-4 text-accent-2" />
        {t("today.mission.done")}
      </button>
      {state === "passed" ? (
        <div role="status" className="zk-passed absolute inset-0 z-20 grid place-items-center bg-scrim/80 text-center">
          <div>
            <p className="font-brand text-4xl leading-tight text-on-photo">{t("today.mission.passed_title")}</p>
            <p className="mt-1 text-sm font-semibold text-on-photo">{t("today.mission.passed_sub")}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
