import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { CardConflictError } from "@/server/services/cards";

/**
 * `withApi` for the card routes that save content: a card that moved on since the editor started answers 409 with the
 * card as it is now (`card`), so the screen can show «اللوحة تغيّرت» and let the person decide. Never a silent overwrite.
 */
export function withCardApi(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return withApi(async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CardConflictError) {
        return NextResponse.json({ error: "conflict", message: "cards.conflict", card: err.card }, { status: 409 });
      }
      throw err;
    }
  });
}
