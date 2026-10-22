import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 chars"),
  // Optional: key for secrets-at-rest (integration tokens), independent of AUTH_SECRET.
  // Blank counts as unset (compose forwards an unset variable as ""); when present it must
  // be strong: generate with `openssl rand -hex 32`. The message never echoes the value.
  ENCRYPTION_KEY: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(32, "ENCRYPTION_KEY must be at least 32 chars (openssl rand -hex 32)").optional(),
  ),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  APP_URL: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | undefined;

/** Validates env at startup; fails fast with the exact missing key . */
export function env(): AppEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration -> ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
