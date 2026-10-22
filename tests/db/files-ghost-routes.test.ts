import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as versionsRoute from "@/app/api/files/[id]/versions/route";
import { PENDING_PATH } from "@/server/services/files";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * A failed upload used to leave a row with path = 'pending' (the bytes never reached disk). The
 * library service hides those rows; the two places that read the table directly must too.
 */
describe("rows with path = 'pending' (failed uploads) are not real files", () => {
  it("cannot be the anchor of a new version (the version route answers 'not found')", async () => {
    const { org, member } = await makeTeam();
    const ghost = await db.storedFile.create({
      data: { orgId: org.id, uploaderId: member.id, name: "lost.png", mimeType: "image/png", size: 12, path: PENDING_PATH, familyId: "ghost-family", version: 1, isLatest: true },
    });
    await loginAs(member.id);
    const res = await call(versionsRoute.POST, { method: "POST", params: { id: ghost.id } });
    expect(res.status).toBe(404);
    expect(res.json).toMatchObject({ message: "files.not_found" });
  });

  it("are not counted on the dashboard (source contract: the count excludes PENDING_PATH)", () => {
    const home = readFileSync(path.resolve(__dirname, "../../src/app/(app)/page.tsx"), "utf8");
    const line = home.split(/\r?\n/).find((l) => l.includes("db.storedFile.count")) ?? "";
    expect(line).toContain("PENDING_PATH");
  });
});
