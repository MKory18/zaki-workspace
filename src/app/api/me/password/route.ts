import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson, passwordChangeSchema } from "@/server/validation";
import { requireUser } from "@/server/auth";
import { changePassword } from "@/server/services/users";

/** Change own password; current password must verify. */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(passwordChangeSchema, req);
    const user = await requireUser();
    await changePassword(user.id, input.currentPassword, input.newPassword);
    return NextResponse.json({ ok: true });
  });
}
