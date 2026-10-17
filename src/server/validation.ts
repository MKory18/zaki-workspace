import { z } from "zod";
import { ValidationError } from "./auth";
import type { ZodType } from "zod";

/** Parses input with a Zod schema; throws a typed ValidationError on failure. */
export function parse<S extends ZodType>(schema: S, input: unknown): import("zod").infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

/** Parses a JSON body, guarding against non-JSON requests. */
export async function parseJson<S extends ZodType>(schema: S, req: Request): Promise<import("zod").infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError([{ path: "body", message: "invalid JSON" }]);
  }
  return parse(schema, body);
}

// ---------- shared shapes ----------

export const cuid = z.string().cuid();

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const priorities = ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"] as const;
export const taskTypes = [
  "TASK", "BUG", "FEATURE", "IMPROVEMENT", "RESEARCH",
  "MEETING", "CONTENT", "MARKETING", "OPERATIONS", "AUTOMATION", "AI_AGENT",
] as const;

// ---------- account & registration ----------

const passwordShape = z
  .string()
  .min(8, "password.min8")
  .max(200)
  .regex(/[A-Za-z]/, "password.letter")
  .regex(/[0-9]/, "password.digit");

const jobTitleShape = z
  .string()
  .trim()
  .min(2, "jobTitle.min2")
  .max(60, "jobTitle.max60")
  .optional()
  .or(z.literal("").transform(() => undefined));

/**
 * Register: either create a new organization (orgName required) or join an
 * existing one by invitation code (joinCode required). Discriminated by the
 * presence of joinCode; jobTitle is an optional profile field for both modes.
 */
export const registerSchema = z
  .object({
    email: z.string().email().max(255),
    name: z.string().trim().min(1).max(100),
    password: passwordShape,
    jobTitle: jobTitleShape,
    orgName: z.string().trim().optional(),
    joinCode: z.string().trim().min(4).max(12).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.joinCode) return; // join mode: orgName not needed
    if (!v.orgName || v.orgName.length < 1 || v.orgName.length > 120) {
      ctx.addIssue({ path: ["orgName"], code: "custom", message: "orgName.required" });
    }
  })
  .transform((v) =>
    v.joinCode
      ? { mode: "join" as const, email: v.email, name: v.name, password: v.password, jobTitle: v.jobTitle, joinCode: v.joinCode.toUpperCase() }
      : { mode: "create" as const, email: v.email, name: v.name, password: v.password, jobTitle: v.jobTitle, orgName: v.orgName! },
  );

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  jobTitle: jobTitleShape,
  bio: z.string().trim().max(500, "bio.max500").nullable().optional(),
  locale: z.literal("ar").optional(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordShape,
});

export const ideaStatuses = ["NEW", "UNDER_REVIEW", "ACCEPTED", "REJECTED"] as const;
