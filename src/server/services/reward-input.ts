import { z } from "zod";
import { ValidationError } from "@/server/auth";
import { amountTextToMinor, REWARD_NOTE_MAX } from "@/lib/rewards";
import type { RewardRequest } from "./rewards";

/**
 * What a request body says about a reward: the amount as the person typed it (`amount`: "12.5", in the major unit) or already
 * in minor units (`amountMinor`), the currency (optional: the company's default is used when it has one) and a note.
 * Only this file turns a typed amount into minor units, with integer arithmetic (src/lib/rewards.ts).
 */
export const rewardBodySchema = z
  .object({
    amount: z.union([z.string().max(24), z.number()]).optional(),
    amountMinor: z.number().int().optional(),
    currency: z.string().max(8).nullable().optional(),
    note: z.string().max(REWARD_NOTE_MAX, "reward.note_long").nullable().optional(),
  })
  .strict();

export type RewardBody = z.infer<typeof rewardBodySchema>;

/** The body as the service takes it; an amount that is not a plain positive number is 422 `reward.amount_invalid`. */
export function toRewardRequest(body: RewardBody): RewardRequest {
  let amountMinor: number | null = null;
  if (body.amountMinor !== undefined) amountMinor = body.amountMinor;
  else if (body.amount !== undefined) amountMinor = amountTextToMinor(String(body.amount));
  if (amountMinor === null) throw new ValidationError([{ path: "amount", message: "reward.amount_invalid" }]);
  return { amountMinor, currency: body.currency ?? null, note: body.note ?? null };
}
