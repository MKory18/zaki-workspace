import type { Capability } from "@/server/policy/capabilities";

/** One section's row of the person's grid, as a screen needs it: may they see it, add/edit in it, delete from it. */
export interface SectionMay {
  view: boolean;
  edit: boolean;
  delete: boolean;
}

/** Everything allowed: what a screen assumes when it is not told (the server decides again on every request). */
export const MAY_ALL: SectionMay = { view: true, edit: true, delete: true };

/** The row of `section` from the signed-in person's capabilities (pages read it from `actor.caps`). */
export function sectionMay(caps: ReadonlySet<Capability> | readonly string[], section: string): SectionMay {
  const has = (c: string) => (caps instanceof Set ? caps.has(c as Capability) : (caps as readonly string[]).includes(c));
  return { view: has(`${section}.view`), edit: has(`${section}.edit`), delete: has(`${section}.delete`) };
}
