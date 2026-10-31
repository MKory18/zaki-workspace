import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { pageActor } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { DetailView } from "@/components/approvals/detail-view";
import { NotFoundError } from "@/server/auth";
import { keepInSpace } from "@/server/services/current-space";
import { approvalsOn, eligibleApprovers } from "@/server/services/approval-access";
import { getApproval, spaceOfApproval } from "@/server/services/approvals";

/**
 * «طلب موافقة» — /approvals/[id]. The requester, the people named in its chain, the space's managers and the OWNER read it (the
 * owner silently: reading leaves no trace); anybody else, and a request that does not exist, get «not found». A request of another
 * space of theirs opens that space first. The approver whose turn it is gets the decision panel; the requester gets cancel and,
 * after «اطلب تعديل», the form to edit and resubmit. A guest is refused, the switch off is «not found».
 */
export default async function ApprovalPage({ params }: { params: { id: string } }) {
  const { actor } = await pageActor();
  if (refusedToGuest(actor, "approvals")) return <GuestNotice />;
  if (!(await approvalsOn(actor.orgId))) notFound();
  const spaceId = await spaceOfApproval(actor, params.id);
  if (!spaceId) notFound();
  await keepInSpace(actor, spaceId, `/approvals/${params.id}`);
  const detail = await getApproval(actor, params.id).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const { t } = getServerT();
  // only the requester who must edit it needs the people to choose from
  const people = detail.you.canResubmit ? (await eligibleApprovers(actor.orgId, detail.workspaceId)).filter((p) => p.id !== actor.userId) : [];
  return (
    <div dir="rtl" className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <Link href="/approvals" className="text-sm text-accent hover:underline">
        {t("approvals.back")}
      </Link>
      <DetailView detail={detail} people={people} />
    </div>
  );
}

export const dynamic = "force-dynamic";
