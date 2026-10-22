import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import {
  DECOR_COOKIE,
  DECOR_LEVELS,
  THEME_COOKIE,
  THEME_KEYS,
  prefCookieOptions,
  themeOf,
} from "@/lib/themes/registry";

/** One of the four themes and/or one of the three decoration levels — and nothing else. */
const themeChoiceSchema = z
  .object({
    theme: z.enum(THEME_KEYS).optional(),
    decor: z.enum(DECOR_LEVELS).optional(),
  })
  .strict()
  .refine((v) => v.theme !== undefined || v.decor !== undefined, { message: "validation.failed" });

/**
 * Save the caller's look. `theme` is written to `User.theme` (so it follows the person to every
 * device: the sign-in sets it as the cookie there) and set as the `zaki_theme` cookie; `decor` is
 * per device and only set as the `zk-decor` cookie (there is no column for it, and Phase 2 adds
 * none). The cookies are set by the server on purpose: the client provider writes them too, but
 * Safari caps a script-written cookie at seven days, and a server-set one keeps its year.
 *
 * Usable during the onboarding (its pages are themed too). Answers `{ ok, theme }` (+ `decor` when
 * one was sent); `theme` is the saved theme, the default for somebody who never chose.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const user = await requireUser({ allowPending: true });
    const input = await parseJson(themeChoiceSchema, req);

    let theme = input.theme;
    if (theme) {
      await db.user.update({ where: { id: user.id }, data: { theme } });
    } else {
      const row = await db.user.findUnique({ where: { id: user.id }, select: { theme: true } });
      theme = themeOf(row?.theme);
    }

    const res = NextResponse.json({ ok: true, theme, ...(input.decor ? { decor: input.decor } : {}) });
    const options = prefCookieOptions(process.env.NODE_ENV === "production");
    if (input.theme) res.cookies.set(THEME_COOKIE, input.theme, options);
    if (input.decor) res.cookies.set(DECOR_COOKIE, input.decor, options);
    return res;
  });
}
