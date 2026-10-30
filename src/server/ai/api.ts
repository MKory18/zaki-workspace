import { NextResponse } from "next/server";
import { apiError, withApi, type ApiErrorCode } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { AiProviderError } from "./provider";

/**
 * «مساعد المالك» — the answers of its routes. Every refusal is a dictionary KEY (`assistant.*`, shown to the owner as
 * `t(key)`), never text from the model's provider, never a stack, never the key.
 *
 *   quota / limits   429 `rate_limited`            «وصلت للحد اليومي / الشهري»
 *   no key / state   409 `conflict`                «ما في مفتاح» · «الاقتراح مش بانتظار قرارك»
 *   provider failed  502 `upstream` (key in message)
 *   everything else  what `withApi` already does (404 for a person who is not the owner, 422 for a bad body)
 */
export class AssistantError extends Error {
  constructor(
    readonly key: string,
    readonly code: ApiErrorCode = "conflict",
  ) {
    super(key);
    this.name = "AssistantError";
  }
}

export function withAssistantApi(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return withApi(async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AssistantError) return apiError(err.code, err.key);
      if (err instanceof AiProviderError) return NextResponse.json({ error: "upstream", message: err.key }, { status: 502 });
      throw err;
    }
  });
}

/** The answer of a route that reads or writes the owner's assistant: never cached. */
export const noStore = { headers: { "cache-control": "no-store" } } as const;

/** The JSON body of a request; anything that is not JSON is a 422 that says nothing about what was sent. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError([{ path: "body", message: "validation.failed" }]);
  }
}
