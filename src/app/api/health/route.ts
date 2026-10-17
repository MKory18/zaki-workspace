import { NextResponse } from "next/server";
import { db } from "@/server/db";

/**
 * Liveness/readiness. Reports component status without leaking secrets.
 * Used by Docker HEALTHCHECK and reverse proxies.
 */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {
    app: "ok",
    database: "fail",
  };
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    // stay 200 with degraded status so orchestrators can decide policy
  }
  const allOk = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    { status: allOk ? "ok" : "degraded", checks, time: new Date().toISOString() },
    { status: allOk ? 200 : 200 },
  );
}
