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
export const FEATURES = ["watch", "sectionPermissions", "libraryDrive", "pushEverything", "chatRowMenu", "callNoiseFilter", "instantWork", "avatars", "peopleDock", "chatBubbles", "taskLinks", "milestones", "ownerHiddenOnline", "quickChat", "taskSteps", "reminders"] as const;
export type FeatureKey = (typeof FEATURES)[number];

/** A key nobody switched yet is this (a new feature is on unless its key says otherwise). */
export const FEATURE_DEFAULTS: Readonly<Record<FeatureKey, boolean>> = {
  watch: true,
  // the per-person section grid «الأقسام» (src/server/policy/capabilities.ts): off, everyone has their rank's template
  sectionPermissions: true,
  // new library files go to the owner's Google Drive (src/server/files/drive-store.ts): off, they are written to the
  // server as before; the files already on Drive still open
  libraryDrive: true,
  // every notification of the bell also reaches the person's phone and laptop while the site is closed (Web Push);
  // off: only a ringing call does, as before
  pushEverything: true,
  // «⋯» next to every topic and chat of the list (pin, archive, delete) and the owner's «حذف نهائي» (src/server/chat/purge.ts)
  chatRowMenu: true,
  // the noise filter on the microphone in calls (src/components/calls/noise-filter.ts): off, the voice is sent as the
  // browser captures it, as before
  callNoiseFilter: true,
  // «مهمة فورية» and «تذكرة فورية» (src/server/services/instant-work.ts): off, neither is offered and their routes
  // answer «not found»; the ones already made stay where they are
  instantWork: true,
  // a person's own picture (src/server/services/avatars.ts): off, nobody uploads or removes one and the profile page
  // does not offer it; the pictures already uploaded keep showing (they are data, like a file already on Drive)
  avatars: true,
  // the staff strip along the bottom of the shell (src/components/shell/people-dock.tsx): off, the row is not drawn
  // and `/api/presence` answers «not found»; the presence itself is untouched
  peopleDock: true,
  // the modern message layout with the sender outside the bubble and a day separator (message-item.tsx,
  // lib/chat/day-separator.ts): off, the log goes back to the previous bubble and has no day lines
  chatBubbles: true,
  // «التبعيات» on a task (src/server/services/task-links.ts): off, the card is not drawn and its routes answer
  // «not found»; the links already stored stay, and come back with the switch
  taskLinks: true,
  // «المعالم» on a project (src/server/services/milestones.ts): off, the card is not drawn, the task's picker is not
  // offered and the routes answer «not found»; the milestones already made stay where they are
  milestones: true,
  // «إخفاء المالك من متصل» (the owner, 2026-10-30: «ميزة اقدر افعلها والغيها»): ON, everybody else sees the owner as not
  // at his screen (the people dock, the member pills of a conversation); he still sees himself. OFF (the default): as
  // before. Only what is DRAWN changes: whether he receives a notification still follows his real presence.
  ownerHiddenOnline: false,
  // the floating quick chat in the corner of the shell (src/components/shell/quick-chat.tsx): off, the button is not
  // drawn; the chat itself and every message already sent are untouched
  quickChat: true,
  // «خطوات» inside a task (src/server/services/task-steps.ts): off, the card is not drawn, the little «3 من 5» on the
  // cards is gone and the routes answer «not found»; the steps already written stay and come back with the switch
  taskSteps: true,
  // «ذكّرني» (src/server/services/reminders.ts): off, no «ذكّرني» button, no «تذكيراتي» card, the routes answer «not found»
  // and the job runner fires nothing; the reminders already set wait and are due again when the switch is back on
  reminders: true,
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
