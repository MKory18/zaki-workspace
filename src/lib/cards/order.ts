/**
 * Fractional ordering for cards (the same idea tasks use): a card has a number, a move writes ONE number between its two
 * new neighbours, and nobody else is touched. Pure, so the arithmetic is tested without a database.
 */

/** The gap left at either end of the list, and between neighbours when everything is renumbered. */
export const POSITION_STEP = 1000;

/** Below this gap two floats are too close to halve again: the server renumbers the space once and goes on. */
export const MIN_GAP = 1e-6;

/**
 * Where a card goes between two neighbours (`before` is the one above it, `after` the one below; null = no neighbour on
 * that side). Returns null when there is no honest number between them (they are equal, reversed or touching): the
 * caller renumbers and asks again.
 */
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number | null {
  const hasBefore = typeof before === "number" && Number.isFinite(before);
  const hasAfter = typeof after === "number" && Number.isFinite(after);
  if (!hasBefore && !hasAfter) return POSITION_STEP;
  if (!hasBefore) return (after as number) - POSITION_STEP;
  if (!hasAfter) return (before as number) + POSITION_STEP;
  const gap = (after as number) - (before as number);
  if (!(gap > MIN_GAP)) return null;
  return (before as number) + gap / 2;
}

/** A new card goes to the top of the manual order: one step above the first card. */
export function positionOnTop(first: number | null | undefined): number {
  return positionBetween(null, first ?? null) ?? POSITION_STEP;
}

/** The positions a renumbering gives `n` cards, in their current order. */
export function renumbered(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i + 1) * POSITION_STEP);
}

/**
 * From the list as the screen shows it (ids in order) and the card that moved, the two neighbours it now sits between,
 * counting only the cards of its own group (pinned cards float above the others, so a card is never placed between a
 * pinned card and an unpinned one). `previousId` = the card above it in that group, `nextId` = the one below.
 */
export function neighboursOf(
  shown: ReadonlyArray<{ id: string; pinned: boolean }>,
  movedId: string,
): { previousId: string | null; nextId: string | null } {
  const at = shown.findIndex((c) => c.id === movedId);
  if (at < 0) return { previousId: null, nextId: null };
  const group = shown[at]!.pinned;
  let previousId: string | null = null;
  for (let i = at - 1; i >= 0; i--) {
    if (shown[i]!.pinned === group) {
      previousId = shown[i]!.id;
      break;
    }
  }
  let nextId: string | null = null;
  for (let i = at + 1; i < shown.length; i++) {
    if (shown[i]!.pinned === group) {
      nextId = shown[i]!.id;
      break;
    }
  }
  return { previousId, nextId };
}
