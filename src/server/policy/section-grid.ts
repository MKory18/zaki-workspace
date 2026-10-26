import { db, type DbClient } from "@/server/db";
import { featureOn } from "@/lib/features";

/**
 * Is the per-person section grid on for this company? It is the switch «صلاحيات الأقسام» of «الميزات»
 * (`sectionPermissions`); off, everyone holds their rank's template for the sections (see `CapabilityOptions`).
 */
export function sectionGridOf(orgSettings: unknown): boolean {
  return featureOn(orgSettings, "sectionPermissions");
}

export async function sectionGridOn(orgId: string, client: DbClient = db): Promise<boolean> {
  const org = await client.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  return sectionGridOf(org?.settings);
}
