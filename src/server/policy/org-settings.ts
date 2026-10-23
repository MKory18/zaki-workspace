import { z } from "zod";

/**
 * `Organization.settings` is free-form JSON in the database; this is the shape the code relies on.
 * Unknown keys are kept (other phases add their own) and a broken value falls back to its default.
 */
export const orgSettingsSchema = z
  .object({
    /** Bump it to make everybody accept the transparency notice again. */
    transparencyVersion: z.number().int().min(1).optional(),
  })
  .passthrough();

export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const DEFAULT_TRANSPARENCY_VERSION = 1;

export function transparencyVersionOf(settings: unknown): number {
  const parsed = orgSettingsSchema.safeParse(settings ?? {});
  return parsed.success ? (parsed.data.transparencyVersion ?? DEFAULT_TRANSPARENCY_VERSION) : DEFAULT_TRANSPARENCY_VERSION;
}

/** What a signed-in person must still do before the app lets them in. */
export interface OnboardingState {
  mustChangePassword: boolean;
  transparencyPending: boolean;
}

export function onboardingStateOf(
  user: { mustChangePassword: boolean; transparencyVersion: number | null },
  orgSettings: unknown,
): OnboardingState {
  return {
    mustChangePassword: user.mustChangePassword,
    transparencyPending: (user.transparencyVersion ?? 0) < transparencyVersionOf(orgSettings),
  };
}
