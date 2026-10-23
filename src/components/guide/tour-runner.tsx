"use client";

import "driver.js/dist/driver.css";
import "./tour.css";
import { useEffect } from "react";
import type { Driver } from "driver.js";
import { useI18n } from "@/lib/i18n";
import { browserStore, isTourSeen, markTourSeen } from "@/lib/guide/storage";
import { hookSelector, resolveTourSteps, type TourHook, type TourKey } from "@/lib/guide/tours";

/** The translator the tour speaks through (the client one from useI18n fits). */
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Is this element really on screen? (A hook can also sit on an element a small screen hides.) */
function isShown(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * The element a hook points at, or null. Two elements may carry the same hook (a side menu for the
 * computer and a bottom bar for the phone): the one that is actually shown is the one to point at.
 */
export function findHookElement(hook: TourHook, root: ParentNode = document): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(hookSelector(hook))) {
    if (isShown(el)) return el;
  }
  return null;
}

/** Has this device finished (or closed) this tour before? */
export function hasSeenTour(tour: TourKey): boolean {
  return isTourSeen(browserStore(), tour);
}

let running: Driver | null = null;

/** Ends the tour that is running, if any (the page changed under it). Finishing counts as seen. */
export function stopTour(): void {
  running?.destroy();
}

/**
 * Starts a tour on the page that is open. A step whose element is not there is skipped; when no
 * element is there at all, nothing starts and the answer is false (the caller says so, instead of
 * showing an empty tour).
 *
 * The library is loaded only now, so the tour costs nothing until somebody asks for it. It is
 * drawn right to left with Arabic buttons, reduced motion is respected, and the arrow keys follow
 * the reading direction (the library's own go the other way): left is "next", right is "back".
 * Finishing or closing it is remembered on this device.
 */
export async function startTour(tour: TourKey, t: Translate): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const steps = resolveTourSteps(tour, t, (hook) => findHookElement(hook));
  if (steps.length === 0) return false;

  const { driver } = await import("driver.js");
  running?.destroy();

  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  function onKey(e: KeyboardEvent) {
    if (!instance.isActive()) return;
    if (e.key === "Escape") {
      instance.destroy();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      instance.moveNext();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      instance.movePrevious();
    }
  }

  const instance = driver({
    steps,
    animate: !reduceMotion,
    smoothScroll: !reduceMotion,
    allowClose: true,
    // the library maps the right arrow to "next": wrong for a right-to-left page, so keys are ours
    allowKeyboardControl: false,
    showProgress: true,
    progressText: t("guide.tour.progress"),
    nextBtnText: t("guide.tour.next"),
    prevBtnText: t("guide.tour.prev"),
    doneBtnText: t("guide.tour.done"),
    closeBtnLabel: t("guide.tour.close"),
    popoverClass: "zaki-tour",
    // the highlighted bell or avatar is shown, not pressed: a click would open a panel over the tour
    // or leave the page with the dimmed overlay still up
    disableActiveInteraction: true,
    stagePadding: 6,
    stageRadius: 10,
    overlayOpacity: 0.55,
    onDestroyed: () => {
      document.removeEventListener("keydown", onKey, true);
      markTourSeen(browserStore(), tour);
      if (running === instance) running = null;
    },
  });

  running = instance;
  document.addEventListener("keydown", onKey, true);
  instance.drive();
  return true;
}

/**
 * Starts a tour by itself, once per device, shortly after the page appears: `<TourRunner tour="today" auto />`.
 * Without `auto` it does nothing (a tour is something somebody asks for with «فرجيني»).
 */
export function TourRunner({ tour, auto = false, delayMs = 800 }: { tour: TourKey; auto?: boolean; delayMs?: number }) {
  const { t } = useI18n();

  useEffect(() => {
    if (!auto || isTourSeen(browserStore(), tour)) return;
    const timer = window.setTimeout(() => {
      void startTour(tour, t);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      // leaving the page ends the tour that started on it
      stopTour();
    };
  }, [auto, tour, delayMs, t]);

  return null;
}
