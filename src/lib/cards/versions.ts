/**
 * «الإصدارات»: every saved edit of a card is a version. Pure helpers shared by the server (numbering, the 409 decision)
 * and the screen (the difference between two versions, the choice a person makes after «اللوحة تغيّرت»).
 *
 * A card sits at version N. The editor sends the N it started from; if the card is no longer at N somebody saved in the
 * meantime and the server answers 409 with the current card. Nothing is overwritten silently.
 */

export const FIRST_VERSION = 1;

/** What a revision remembers about a card. */
export interface CardSnapshot {
  title: string;
  body: string | null;
  data: unknown;
  color: string;
  category: string | null;
  tags: string[];
  fileId: string | null;
}

export const SNAPSHOT_FIELDS = ["title", "body", "data", "color", "category", "tags", "fileId"] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/** The number the card carries after a saved edit. */
export function nextVersion(current: number): number {
  return Math.max(FIRST_VERSION, Math.trunc(current)) + 1;
}

/** JSON with the keys in a fixed order, so two equal values always compare equal as text. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** The fields `next` carries whose value differs from `current`. */
export function changedFields(current: CardSnapshot, next: Partial<CardSnapshot>): SnapshotField[] {
  return SNAPSHOT_FIELDS.filter((f) => f in next && next[f] !== undefined && !sameValue(current[f], next[f]));
}

export type SaveDecision = { kind: "apply" } | { kind: "noop" } | { kind: "conflict" };

/**
 * What the server does with a save:
 *  - nothing changed: `noop` (no new version, no revision);
 *  - the editor started from the version the card is at (or sent none: an older client): `apply`;
 *  - the card moved on since: `conflict` (409).
 */
export function decideSave(opts: { baseVersion: number | null | undefined; currentVersion: number; changed: readonly string[] }): SaveDecision {
  if (opts.changed.length === 0) return { kind: "noop" };
  if (opts.baseVersion === undefined || opts.baseVersion === null) return { kind: "apply" };
  return opts.baseVersion === opts.currentVersion ? { kind: "apply" } : { kind: "conflict" };
}

// ---------- the screen: the difference, and the choice after a 409 ----------

export interface FieldDiff {
  field: SnapshotField;
  before: unknown;
  after: unknown;
}

/** The fields that differ between two snapshots, in the order the card shows them. */
export function diffSnapshots(before: CardSnapshot, after: CardSnapshot): FieldDiff[] {
  return SNAPSHOT_FIELDS.filter((f) => !sameValue(before[f], after[f])).map((field) => ({ field, before: before[field], after: after[field] }));
}

export interface ConflictRow {
  field: SnapshotField;
  original: unknown;
  mine: unknown;
  theirs: unknown;
  /** I changed this field since I started. */
  byMe: boolean;
  /** Somebody else changed it since I started. */
  byThem: boolean;
}

/**
 * «اللوحة تغيّرت»: the fields where my version and the card now differ. `original` is what I started from. A field only I
 * changed can simply be kept; a field only they changed is theirs; a field both changed needs a conscious choice.
 */
export function conflictRows(original: CardSnapshot, mine: CardSnapshot, theirs: CardSnapshot): ConflictRow[] {
  return SNAPSHOT_FIELDS.filter((f) => !sameValue(mine[f], theirs[f])).map((field) => ({
    field,
    original: original[field],
    mine: mine[field],
    theirs: theirs[field],
    byMe: !sameValue(original[field], mine[field]),
    byThem: !sameValue(original[field], theirs[field]),
  }));
}

export type Pick = "mine" | "theirs";

/** What is chosen when nobody chooses: my own changes where they did not touch the field, theirs everywhere else. */
export function defaultPick(row: ConflictRow): Pick {
  return row.byMe && !row.byThem ? "mine" : "theirs";
}

/** The patch that keeps my choices on top of the current card (fields left on «theirs» are not sent). */
export function patchFromChoices(rows: readonly ConflictRow[], picks: Partial<Record<SnapshotField, Pick>>): Partial<CardSnapshot> {
  const patch: Record<string, unknown> = {};
  for (const row of rows) {
    if ((picks[row.field] ?? defaultPick(row)) === "mine") patch[row.field] = row.mine;
  }
  return patch as Partial<CardSnapshot>;
}
