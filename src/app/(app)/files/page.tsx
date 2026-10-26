import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { getServerT } from "@/lib/i18n/server";
import { FilesView } from "@/components/files-view";

/** Org-wide file library — versions, previews, permission-checked downloads. */
export default async function FilesPage() {
  const { t } = await getServerT();
  const { user, actor } = await pageActor();

  // The library is org-wide (price sheets, specifications...): the API refuses guests, so they
  // get a notice rather than a view whose every request fails.
  if (actor.isExternal) {
    return <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">{t("guest.no_access")}</div>;
  }

  // the library row of the person's grid
  if (!actorCan(actor, "files.view")) return <SectionOffNotice />;
  return <FilesView me={{ id: user.id, role: actor.role }} may={{ edit: actorCan(actor, "files.edit"), delete: actorCan(actor, "files.delete") }} />;
}

export const dynamic = "force-dynamic";
