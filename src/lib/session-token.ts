import { SignJWT, jwtVerify } from "jose";

/**
 * Session tokens, in a module with NO Next/Node-only imports so the Edge middleware and the
 * server code verify tokens with exactly the same code.
 *
 *  - `tv` (token version): the user's `tokenVersion` when the token was issued. Suspending,
 *    offboarding, resetting a password or "log out everywhere" bumps the stored value, which
 *    invalidates every older token. A token without a numeric `tv` (all tokens issued before
 *    this existed) is refused, so everybody signs in once after the release that introduced it.
 *  - `mcp` / `tp`: the person must still change a temporary password / accept the transparency
 *    notice. The Edge middleware uses them to send the browser to /onboarding without a database
 *    call; the server re-checks the real state on every API request.
 *
 * The key is SHA-256(AUTH_SECRET), the same derivation the app has always used.
 */
export interface SessionClaims {
  userId: string;
  tv: number;
  mcp?: boolean;
  tp?: boolean;
}

async function deriveKey(secret: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return new Uint8Array(digest);
}

export async function signSessionToken(claims: SessionClaims, secret: string, ttlSeconds: number): Promise<string> {
  const payload: Record<string, unknown> = { userId: claims.userId, tv: claims.tv };
  if (claims.mcp) payload["mcp"] = true;
  if (claims.tp) payload["tp"] = true;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(await deriveKey(secret));
}

export async function verifySessionTokenWith(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, await deriveKey(secret));
    if (typeof payload["userId"] !== "string") return null;
    const tv = payload["tv"];
    if (typeof tv !== "number" || !Number.isInteger(tv) || tv < 0) return null;
    return {
      userId: payload["userId"],
      tv,
      ...(payload["mcp"] === true ? { mcp: true } : {}),
      ...(payload["tp"] === true ? { tp: true } : {}),
    };
  } catch {
    return null;
  }
}
