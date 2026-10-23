"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { allStepsDone, progressOf, stepDone, type FirstStepView } from "@/lib/guide/first-steps";
import {
  browserStore,
  dismissFirstSteps,
  loadFirstStepsLocal,
  markFirstStepDone,
  restoreFirstSteps,
  setFirstStepsCollapsed,
  type FirstStepsLocal,
} from "@/lib/guide/storage";
import {
  FIRST_STEPS_STATES,
  parseFirstStepsCookie,
  writeFirstStepsCookie,
  type FirstStepsCookieState,
} from "./first-steps-cookie";
import { cn } from "@/lib/utils";

/**
 * The card drawn from its two sources of truth: what the server says (`steps`, from real data) and
 * what this device remembers (`local`). A pure view - the state lives in FirstStepsCardClient - so
 * every state of the card can be rendered and tested.
 *
 * It is the «أول خطواتك» route of the adopted mockup: a dashed gold thread with a node per step —
 * a gold star once the step is done, a breathing gold ring on the current one, a plain ring on the
 * ones still waiting. Each waiting step is a link to its page; the current one also carries its hint
 * and the single primary button («ابدأ»).
 *
 * It draws nothing when it was hidden on this device, when there is nothing to show, or when every
 * step is done: a finished card disappears.
 */
export function FirstStepsView({
  steps,
  local,
  onMark,
  onCollapse,
  onDismiss,
}: {
  steps: readonly FirstStepView[];
  local: FirstStepsLocal;
  onMark: (stepId: string) => void;
  onCollapse: (collapsed: boolean) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  if (local.dismissed || steps.length === 0 || allStepsDone(steps, local)) return null;

  const { done, total } = progressOf(steps, local);
  const nextId = steps.find((step) => !stepDone(step, local))?.id;
  const iconButton =
    "grid size-11 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg";

  /** «تم»: the person confirms a step only they can know (the app is installed). */
  const markButton = (step: FirstStepView, title: string, className: string) =>
    step.manual ? (
      <button
        type="button"
        onClick={() => onMark(step.id)}
        aria-label={t("guide.first.mark_aria", { title })}
        className={cn(
          "inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-3 text-sm font-medium text-fg hover:bg-surface-2",
          className,
        )}
      >
        {t("guide.first.mark")}
      </button>
    ) : null;

  return (
    <section data-tour="first-steps" aria-labelledby="first-steps-title" className="rounded-[18px] border border-border bg-surface-1 p-[18px]">
      <div className="flex items-center gap-2">
        <h2 id="first-steps-title" className="font-display text-lg font-bold leading-tight text-fg">
          {t("guide.first.title")}
        </h2>
        <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[13px] font-medium text-muted">
          {t("guide.first.progress", { done, total })}
        </span>
        <button
          type="button"
          onClick={() => onCollapse(!local.collapsed)}
          aria-expanded={!local.collapsed}
          aria-controls="first-steps-list"
          aria-label={local.collapsed ? t("guide.first.expand") : t("guide.first.collapse")}
          className={cn(iconButton, "ms-auto")}
        >
          {local.collapsed ? <ChevronDown aria-hidden className="size-5" /> : <ChevronUp aria-hidden className="size-5" />}
        </button>
        <button type="button" onClick={onDismiss} aria-label={t("guide.first.dismiss")} className={iconButton}>
          <X aria-hidden className="size-5" />
        </button>
      </div>

      <div aria-hidden="true" className="zk-orn my-2" />

      <div
        role="progressbar"
        aria-label={t("guide.first.title")}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="sr-only"
      >
        {done}
      </div>

      {local.collapsed ? null : (
        <ol id="first-steps-list" className="zk-route">
          {steps.map((step) => {
            const isDone = stepDone(step, local);
            const isNext = step.id === nextId;
            const title = t(step.titleKey);
            const stateNote = <span className="sr-only"> — {isDone ? t("guide.first.done_sr") : t("guide.first.todo_sr")}</span>;
            const state = isDone ? "done" : isNext ? "current" : "todo";

            // done: the star node and a muted line, nothing to press
            if (isDone) {
              return (
                <li key={step.id} data-state={state}>
                  <span aria-hidden="true" className="zk-route-node" />
                  <b className="text-[15px] font-semibold leading-6 text-fg-muted">
                    {title}
                    {stateNote}
                  </b>
                  <small className="text-[13px] leading-5 text-muted">{t("guide.first.done_sr")}</small>
                </li>
              );
            }

            // the next step: the breathing node, its hint, and the one primary button
            if (isNext) {
              return (
                <li key={step.id} data-state={state}>
                  <span aria-hidden="true" className="zk-route-node" />
                  <b className="text-[15px] font-semibold leading-6 text-accent-2">
                    {title}
                    {stateNote}
                  </b>
                  <small className="text-[13px] leading-5 text-muted">{t(step.hintKey)}</small>
                  <span className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href={step.href}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg hover:brightness-110"
                    >
                      {t("guide.first.go")}
                    </Link>
                    {markButton(step, title, "")}
                  </span>
                </li>
              );
            }

            // waiting, not next: the whole row is one link to the step's page
            return (
              <li key={step.id} data-state={state} className="relative">
                <span aria-hidden="true" className="zk-route-node" />
                <Link href={step.href} className="flex min-h-12 flex-col justify-center rounded-lg pe-2 hover:bg-surface-2">
                  <b className="text-[15px] font-semibold leading-6 text-fg">
                    {title}
                    {stateNote}
                  </b>
                  <small className="text-[13px] leading-5 text-muted">{t("guide.first.todo_sr")}</small>
                </Link>
                {markButton(step, title, "absolute end-2 top-1/2 -translate-y-1/2")}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Running as an installed app (from the home-screen icon), on Android or iPhone. */
function runsInstalled(): boolean {
  try {
    return window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** The cookie state that goes with a `local` state: hidden wins, then folded, then open. */
export function cookieStateOfLocal(local: FirstStepsLocal | null): FirstStepsCookieState {
  if (!local) return "open";
  if (local.dismissed) return "hidden";
  return local.collapsed ? "collapsed" : "open";
}

/**
 * The card with its memory. What this device remembers is read after the page has loaded, never
 * during the server render, so nothing flashes and the server and the browser always agree on the
 * first paint (the card appears once the device has been asked). Opened from the home-screen icon,
 * the app is installed: the install step ticks itself.
 *
 * The open/collapsed/hidden state ALSO lives in the `zk-fs` cookie, which the SERVER page reads:
 * the first HTML already shows the card in its state, and the list of tasks below it does not
 * jump. What only this device and this person know (the steps the device confirmed) stays in
 * localStorage, and is applied on top of the cookie state once the device has been asked.
 */
export function FirstStepsCardClient({
  userId,
  steps,
  initialCookieState = "open",
}: {
  userId: string;
  steps: readonly FirstStepView[];
  /** What the server read from the `zk-fs` cookie for this person. */
  initialCookieState?: FirstStepsCookieState;
}) {
  const [local, setLocal] = useState<FirstStepsLocal | null>(null);

  useEffect(() => {
    const store = browserStore();
    let state = loadFirstStepsLocal(store, userId);
    if (runsInstalled() && !state.done.includes("install")) state = markFirstStepDone(store, userId, "install");
    setLocal(state);
  }, [userId]);

  // keep the cookie in step with the newest state the device knows (the steps confirmed here never
  // change the open/collapsed/hidden part, so this only writes when that part actually differs)
  const cookieState = cookieStateOfLocal(local);
  useEffect(() => {
    writeFirstStepsCookie(cookieState, document);
  }, [cookieState]);

  if (initialCookieState === "hidden") return null;
  if (!local) {
    return <FirstStepsView steps={steps} local={{ dismissed: false, collapsed: initialCookieState === "collapsed", done: [] }} onMark={() => {}} onCollapse={() => {}} onDismiss={() => {}} />;
  }
  return (
    <FirstStepsView
      steps={steps}
      local={local.dismissed || local.collapsed !== (initialCookieState === "collapsed") ? { ...local, dismissed: false, collapsed: initialCookieState === "collapsed" } : local}
      onMark={(id) => setLocal(markFirstStepDone(browserStore(), userId, id))}
      onCollapse={(collapsed) => setLocal(setFirstStepsCollapsed(browserStore(), userId, collapsed))}
      onDismiss={() => setLocal(dismissFirstSteps(browserStore(), userId))}
    />
  );
}

/** Ticks «افتح الدليل» on this device. Draws nothing: the guide pages mount it. */
export function OpenedGuideMark({ userId }: { userId: string }) {
  useEffect(() => {
    markFirstStepDone(browserStore(), userId, "open-guide");
  }, [userId]);
  return null;
}

/** For somebody who hid the card: a way to bring it back (shown only on a device where it was hidden). */
export function RestoreFirstStepsButton({ userId }: { userId: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<"hidden" | "offer" | "restored">("hidden");

  useEffect(() => {
    setState(loadFirstStepsLocal(browserStore(), userId).dismissed ? "offer" : "hidden");
  }, [userId]);

  if (state === "hidden") return null;
  if (state === "restored") {
    return (
      <p role="status" className="rounded-xl border border-border bg-surface-1 p-4 text-sm leading-7 text-fg">
        {t("guide.first.restored")}
      </p>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-4">
      <p className="text-sm leading-7 text-fg-muted">{t("guide.first.restore_hint")}</p>
      <button
        type="button"
        onClick={() => {
          restoreFirstSteps(browserStore(), userId);
          setState("restored");
        }}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90"
      >
        {t("guide.first.restore")}
      </button>
    </div>
  );
}
