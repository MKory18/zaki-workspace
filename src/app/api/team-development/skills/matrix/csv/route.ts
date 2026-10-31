import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { getServerT } from "@/lib/i18n/server";
import { requireActor } from "@/server/policy/actor";
import { loadSkillMatrix, skillMatrixCsv } from "@/server/services/team-skills";

/** The matrix as a CSV: exactly the table the viewer may see, UTF-8 with a BOM, formula-safe cells. */
export async function GET() {
  return withApi(async () => {
    const { t } = getServerT();
    const body = skillMatrixCsv(await loadSkillMatrix(await requireActor()), { person: t("teamdev.col.person"), manual: t("teamdev.skill.manual"), self: t("teamdev.skill.self") });
    return new NextResponse(body, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="skills-matrix.csv"', "cache-control": "no-store" },
    });
  });
}
