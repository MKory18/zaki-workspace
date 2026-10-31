import type { NextResponse } from "next/server";
import { apiError, withApi } from "@/server/api";
import { ApprovalConflictError } from "@/server/services/approvals";

/**
 * `withApi` plus the one answer it has no word for: a decision that lost the race (or a state that has moved on) is
 * 409 `conflict` with the dictionary key as its message. Everything else is `withApi`'s own mapping.
 */
export function withApprovalsApi(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return withApi(async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApprovalConflictError) return apiError("conflict", err.message);
      throw err;
    }
  });
}
