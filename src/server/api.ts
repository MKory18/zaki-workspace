import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./auth";
import { log } from "./log";

export type ApiErrorCode =
  | "auth.required"
  | "forbidden"
  | "not_found"
  | "validation.failed"
  | "conflict"
  | "internal";

const STATUS: Record<ApiErrorCode, number> = {
  "auth.required": 401,
  forbidden: 403,
  not_found: 404,
  "validation.failed": 422,
  conflict: 409,
  internal: 500,
};

export function apiError(
  code: ApiErrorCode,
  message?: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { error: code, message, details },
    { status: STATUS[code] },
  );
}

/** Central handler: consistent shapes, no stack traces in prod responses. */
export function withApi(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return fn().catch((err) => {
    if (err instanceof UnauthorizedError) return apiError("auth.required", err.message);
    if (err instanceof ForbiddenError) return apiError("forbidden", err.message);
    if (err instanceof NotFoundError) return apiError("not_found", err.message);
    if (err instanceof ValidationError || err instanceof ZodError) {
      return apiError("validation.failed", "validation.failed", readableIssues(err));
    }
    // Prisma known errors: never leak the invocation text; log the details instead.
    if (typeof err === "object" && err !== null && "code" in err && String(err.code).startsWith("P")) {
      const prismaCode = String((err as { code: unknown }).code);
      const target = (err as { meta?: { target?: unknown } }).meta?.target;
      log.error("api.prisma_error", { code: prismaCode, target: Array.isArray(target) ? target.join(",") : undefined, message: err instanceof Error ? err.message : String(err) });
      // unique-constraint on a register/login flow most commonly means a duplicate email
      if (prismaCode === "P2002" && Array.isArray(target) && target.some((t) => String(t).includes("email"))) {
        return apiError("conflict", "email.taken");
      }
      return apiError("conflict");
    }
    log.error("api.unhandled", {
      name: err instanceof Error ? err.name : String(err),
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 4).join("\n") : undefined,
    });
    return apiError("internal");
  });
}

interface IssueLike {
  path: string;
  message: string;
}

function readableIssues(err: Error | ZodError): IssueLike[] {
  if (err instanceof ZodError) {
    return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  }
  return (err as ValidationError).issues;
}
