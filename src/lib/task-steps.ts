/**
 * «خطوات» — the short checklist inside a task, pure (no React, no server imports): the shape the screens share,
 * the progress, and the fractional position of a step (like the board's tasks: a move writes ONE row).
 */

/** Most steps one task carries: a checklist, not a project plan (a longer one is a project of its own). */
export const MAX_STEPS = 100;
export const MAX_STEP_TITLE = 200;

/** The gap a fresh position leaves, and the smallest gap two neighbours may keep before the whole list is renumbered. */
export const STEP_GAP = 1000;
export const MIN_STEP_GAP = 1e-6;

export interface StepProgress {
  done: number;
  total: number;
}

export interface StepDto {
  id: string;
  title: string;
  done: boolean;
  doneAt: string | null;
}

export function progressOf(steps: readonly { done: boolean }[]): StepProgress {
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

/** The position between two neighbours (`null`: that end of the list). */
export function positionBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return STEP_GAP;
  if (prev === null) return (next as number) / 2;
  if (next === null) return prev + STEP_GAP;
  return (prev + next) / 2;
}

/** Are two neighbours too close (or the candidate not strictly between them) for one more insertion? */
export function crowded(candidate: number, prev: number | null, next: number | null): boolean {
  if (candidate <= 0) return true;
  if (prev !== null && candidate - prev < MIN_STEP_GAP) return true;
  if (next !== null && next - candidate < MIN_STEP_GAP) return true;
  return false;
}

/**
 * The new order after moving `id` to sit right after `afterId` (`null`: first). Returns the ids in their new order,
 * or null when `id` or `afterId` is not in the list (or they are the same).
 */
export function reorder(ids: readonly string[], id: string, afterId: string | null): string[] | null {
  if (!ids.includes(id) || id === afterId) return null;
  if (afterId !== null && !ids.includes(afterId)) return null;
  const rest = ids.filter((x) => x !== id);
  const at = afterId === null ? 0 : rest.indexOf(afterId) + 1;
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
