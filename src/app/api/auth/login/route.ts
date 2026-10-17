import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { db } from "@/server/db";
import { audit, setSessionCookie, verifyPassword, ForbiddenError } from "@/server/auth";
import { apiError, withApi } from "@/server/api";

const credentialsSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  return withApi(async () => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError("validation.failed", "invalid JSON");
    }
    const parsed = credentialsSchema.safeParse(body);
    if (!parsed.success) return apiError("auth.required", "invalid_credentials");

    const { email, password } = parsed.data;
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, passwordHash: true },
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      await audit("auth.login_failed", { target: email.toLowerCase() });
      return apiError("auth.required", "invalid_credentials");
    }
    await setSessionCookie(user.id);
    await audit("auth.login", { actorId: user.id });
    return NextResponse.json({ ok: true });
  });
}
