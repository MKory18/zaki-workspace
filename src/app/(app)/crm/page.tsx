import { pageActor, SectionOffNotice } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { getServerT } from "@/lib/i18n/server";
import { CrmView } from "@/components/crm-view";

/**
 * CRM is staff-only: its API answers 403 to an external partner (guest), so the
 * view is not rendered for them — they get a notice instead of a page that never loads.
 * For everybody else it is the `crm.view` switch: when the owner turned it off for a person, the
 * API refuses them too, so they get the "not enabled for you" notice instead of a page that never loads.
 * Whoever may read but not `crm.edit` gets the view without its create, edit and delete controls.
 */
export default async function CrmPage() {
	const { t } = getServerT();
	const { actor } = await pageActor();
	if (actor.isExternal) {
		return (
			<div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">
				{t("guest.no_access")}
			</div>
		);
	}
	if (!actorCan(actor, "crm.view")) return <SectionOffNotice />;
	return <CrmView canEdit={actorCan(actor, "crm.edit")} canDelete={actorCan(actor, "crm.delete")} />;
}

export const dynamic = "force-dynamic";
