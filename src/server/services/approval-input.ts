import { z } from "zod";
import { ValidationError } from "@/server/auth";
import { amountTextToMinor } from "@/lib/rewards";
import { DECISIONS, LINK_KINDS } from "@/lib/approvals/shared";

/**
 * What a request body says about an approval: the amount as typed (`amount`: "12.5", in the major unit) or already in minor
 * units (`amountMinor`), the currency, the chain, the thing it is about and its files. The limits written here are only wide
 * guards against absurd input: the service owns the real ones and answers with their Arabic keys.
 * Only this file turns a typed amount into minor units (the one helper of src/lib/rewards.ts, integer arithmetic).
 */
const id = z.string().min(1).max(64);

export const linkSchema = z.object({ kind: z.enum(LINK_KINDS), id });

const amountParts = {
  amount: z.union([z.string().max(24), z.number()]).nullish(),
  amountMinor: z.number().int().nullish(),
  currency: z.string().max(8).nullish(),
};

export const createBodySchema = z
  .object({
    workspaceId: id,
    title: z.string().max(1000),
    details: z.string().max(20000).nullish(),
    ...amountParts,
    approverIds: z.array(id).max(10),
    link: linkSchema.nullish(),
    fileIds: z.array(id).max(30).optional(),
  })
  .strict();

export const resubmitBodySchema = z
  .object({
    title: z.string().max(1000).optional(),
    details: z.string().max(20000).nullish(),
    ...amountParts,
    approverIds: z.array(id).max(10).optional(),
    link: linkSchema.nullish(),
    fileIds: z.array(id).max(30).optional(),
    /** A request that came from a form is edited through its answers. */
    answers: z.record(z.string().max(40), z.unknown()).optional(),
  })
  .strict();

export const decideBodySchema = z.object({ decision: z.enum(DECISIONS), reason: z.string().max(5000).nullish() }).strict();

export const fillBodySchema = z
  .object({ answers: z.record(z.string().max(40), z.unknown()), fileIds: z.array(id).max(30).optional(), link: linkSchema.nullish() })
  .strict();

export const formBodySchema = z
  .object({
    name: z.string().max(1000),
    description: z.string().max(5000).nullish(),
    schema: z.unknown(),
    baseVersion: z.number().int().optional(),
  })
  .strict();

type AmountBody = { amount?: string | number | null; amountMinor?: number | null; currency?: string | null };

/**
 * The amount of a body. `present: false` when the body says nothing about one (a resubmit keeps the old); `null` fields when it
 * says «no amount». A typed amount that is not a plain positive number with at most two decimals is 422 `approvals.e.amount_invalid`.
 */
export function amountOf(body: AmountBody): { present: boolean; amountMinor: number | null; currency: string | null } {
  const touched = body.amount !== undefined || body.amountMinor !== undefined || body.currency !== undefined;
  if (!touched) return { present: false, amountMinor: null, currency: null };
  let minor: number | null = null;
  if (body.amountMinor !== undefined && body.amountMinor !== null) minor = body.amountMinor;
  else if (body.amount !== undefined && body.amount !== null && String(body.amount).trim() !== "") {
    minor = amountTextToMinor(String(body.amount));
    if (minor === null) throw new ValidationError([{ path: "amount", message: "approvals.e.amount_invalid" }]);
  }
  return { present: true, amountMinor: minor, currency: body.currency ?? null };
}
