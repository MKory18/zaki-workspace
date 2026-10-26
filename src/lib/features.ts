/**
 * «الميزات» — THE OWNER'S ON/OFF SWITCHES, ONE PER FEATURE.
 *
 * The owner's rule (2026-10-26, «كل اشي ينضاف ك فيتشر اقدر اطفيه وارجع الموقع للمود الأصلي»): every new
 * feature sits behind its own switch. Off, the site is as it was before that feature: nothing of it is offered
 * or answers, and nothing it holds is lost (switched on again, everything is back).
 *
 * Pure (no React, no server imports): the map of places hides a switched-off feature's place, the server refuses
 * its routes (src/server/services/features.ts), and «الميزات» in the settings lists every key.
 *
 * 🔧 A new feature is one key here, its default, and its two lines in the dictionary
 *    (`features.<key>.name`, `features.<key>.hint`); tests/features.test.ts fails on a key without them.
 */

/** Every switch, in the order «الميزات» lists them. */
export const FEATURES = ["watch", "sectionPermissions", "libraryDrive"] as const;
export type FeatureKey = (typeof FEATURES)[number];

/** A key nobody switched yet is this (a new feature is on unless its key says otherwise). */
export const FEATURE_DEFAULTS: Readonly<Record<FeatureKey, boolean>> = {
  watch: true,
  // the per-person section grid «الأقسام» (src/server/policy/capabilities.ts): off, everyone has their rank's template
  sectionPermissions: true,
  // new library files go to the owner's Google Drive (src/server/files/drive-store.ts): off, they are written to the
  // server as before; the files already on Drive still open
  libraryDrive: true,
};

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && (FEATURES as readonly string[]).includes(value);
}

/** The switches stored on the company (`Organization.settings.features`), unknown or broken entries ignored. */
function storedOf(orgSettings: unknown): Partial<Record<FeatureKey, boolean>> {
  if (!orgSettings || typeof orgSettings !== "object") return {};
  const features = (orgSettings as { features?: unknown }).features;
  if (!features || typeof features !== "object") return {};
  const out: Partial<Record<FeatureKey, boolean>> = {};
  for (const key of FEATURES) {
    const v = (features as Record<string, unknown>)[key];
    if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

/** Is this feature on for the company whose settings these are? Unset: its default. */
export function featureOn(orgSettings: unknown, key: FeatureKey): boolean {
  return storedOf(orgSettings)[key] ?? FEATURE_DEFAULTS[key];
}

/** Every switch of the company, each with its default filled in. */
export function featuresOf(orgSettings: unknown): Record<FeatureKey, boolean> {
  const stored = storedOf(orgSettings);
  return Object.fromEntries(FEATURES.map((key) => [key, stored[key] ?? FEATURE_DEFAULTS[key]])) as Record<FeatureKey, boolean>;
}

/** The keys that are off (what the map of places is told to hide). */
export function featuresOff(orgSettings: unknown): FeatureKey[] {
  const all = featuresOf(orgSettings);
  return FEATURES.filter((key) => !all[key]);
}

/** `Organization.settings` with one switch set, every other key of the settings kept as it was. */
export function withFeature(orgSettings: unknown, key: FeatureKey, on: boolean): Record<string, unknown> {
  const base = orgSettings && typeof orgSettings === "object" ? (orgSettings as Record<string, unknown>) : {};
  const features = base["features"] && typeof base["features"] === "object" ? (base["features"] as Record<string, unknown>) : {};
  return { ...base, features: { ...features, [key]: on } };
}
