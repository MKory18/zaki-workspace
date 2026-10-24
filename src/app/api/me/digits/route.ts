import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { DIGITS_COOKIE, DIGIT_MODES } from "@/lib/digits";
import { prefCookieOptions } from "@/lib/themes/registry";

const digitsChoiceSchema = z.object({ digits: z.enum(DIGIT_MODES) }).strict();

/**
 * Save how the caller sees 0-9 («الأرقام: 123 / ١٢٣», src/lib/digits.ts): written to `User.digits` (so the
 * choice follows them to every device: the sign-in sets it as the cookie there) and set as the `zk-digits`
 * cookie by the server, for a year (a script-written cookie lasts seven days in Safari). Usable during the
 * onboarding, like the theme. Answers `{ ok, digits }`; anything but "latin" or "arabic" is a 422.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const user = await requireUser({ allowPending: true });
    const { digits } = await parseJson(digitsChoiceSchema, req);
    await db.user.update({ where: { id: user.id }, data: { digits } });
    const res = NextResponse.json({ ok: true, digits });
    res.cookies.set(DIGITS_COOKIE, digits, prefCookieOptions(process.env.NODE_ENV === "production"));
    return res;
  });
}
