import { cookies } from "next/headers";
import { env } from "./env";
import { signSessionToken, verifySessionTokenWith, type SessionClaims } from "@/lib/session-token";

export const COOKIE_NAME = "zaki_session";

export type { SessionClaims };
/** What a valid cookie proves on its own (the database decides whether it is still honoured). */
export type SessionUser = SessionClaims;

export async function createSessionToken(claims: SessionClaims): Promise<string> {
  return signSessionToken(claims, env().AUTH_SECRET, env().SESSION_TTL_HOURS * 3600);
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  return verifySessionTokenWith(token, env().AUTH_SECRET);
}

export async function setSessionCookie(claims: SessionClaims): Promise<void> {
  const token = await createSessionToken(claims);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: env().SESSION_TTL_HOURS * 3600,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
