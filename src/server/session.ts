import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

const COOKIE_NAME = "zaki_session";

export interface SessionUser {
  userId: string;
}

function key(): Uint8Array {
  // derive stable 32-byte key even if provided secret is shorter
  return crypto.createHash("sha256").update(env().AUTH_SECRET).digest();
}

export async function createSessionToken(userId: string): Promise<string> {
  const ttl = env().SESSION_TTL_HOURS * 3600;
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(key());
}

export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    if (typeof payload["userId"] !== "string") return null;
    return { userId: payload["userId"] };
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = await createSessionToken(userId);
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
