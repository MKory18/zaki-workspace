import { NextResponse } from "next/server";
import { db } from "@/server/db";

// Evaluated on every request. Without this Next prerenders the handler at BUILD time (it uses no
// request API), so the answer - including "database: fail" from the build machine - would be
// frozen forever and the container health check could never notice a real database outage.
export const dynamic = "force-dynamic";

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
    // 503 below: a container that cannot reach its database must not report itself healthy
  }
  const allOk = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    { status: allOk ? "ok" : "degraded", checks, time: new Date().toISOString() },
    { status: allOk ? 200 : 503 },
  );
}
