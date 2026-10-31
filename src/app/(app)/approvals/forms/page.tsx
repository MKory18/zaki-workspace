import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerT } from "@/lib/i18n/server";
import { pageActor } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { EmptyState } from "@/components/ui/card";
import { FormBuilder } from "@/components/approvals/form-builder";
import { FormArchiveButton } from "@/components/approvals/form-archive-button";
import { NotFoundError } from "@/server/auth";
import { currentSpace } from "@/server/services/current-space";
import { approvalsOn, eligibleApprovers } from "@/server/services/approval-access";
import { getForm, listForms } from "@/server/services/approval-forms";

/**
 * «النماذج» — /approvals/forms. Everybody who works in the space sees its forms and fills one (a form creates an approval request with
 * its own preset chain). The OWNER and the space's ADMIN also create, edit (an edit writes the next version: requests already made
 * keep their questions) and archive them. A guest is refused, the switch off is «not found».
 * ⚠️ A form whose preset approver can no longer be asked here says so, with the fix next to it.
 */
export default async function ApprovalFormsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  if (refusedToGuest(actor, "approvals")) return <GuestNotice />;
  if (!(await approvalsOn(actor.orgId))) notFound();
  const { t } = getServerT();
  const space = await currentSpace(actor);
  const frame = (children: React.ReactNode) => (
    <div dir="rtl" className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <Link href="/approvals" className="text-sm text-accent hover:underline">
        {t("approvals.back")}
      </Link>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{t("approvals.forms.title")}</h1>
        <p className="text-sm text-muted">{t("approvals.forms.subtitle")}</p>
      </header>
      {children}
    </div>
  );
  if (!space) return frame(<EmptyState title={t("approvals.no_space")} />);

  const forms = await listForms(actor, space.id);
  const canManage = space.manager;
  const one = (key: string) => {
    const v = searchParams?.[key];
    return typeof v === "string" ? v : undefined;
  };
  const editing = one("edit");
  if (canManage && (one("new") === "1" || editing)) {
    // the people a form may preset: everybody who works in the space (the manager included)
    const people = await eligibleApprovers(actor.orgId, space.id);
    const existing = editing
      ? await getForm(actor, editing).catch((err: unknown) => {
          if (err instanceof NotFoundError) notFound();
          throw err;
        })
      : null;
    if (existing && existing.workspaceId !== space.id) notFound();
    return frame(
      <FormBuilder
        workspaceId={space.id}
        people={people}
        initial={existing ? { familyId: existing.familyId, version: existing.version, name: existing.name, description: existing.description, schema: existing.schema } : undefined}
      />,
    );
  }

  return frame(
    <>
      {canManage ? (
        <Link href="/approvals/forms?new=1" className="inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent/90 md:min-h-9">
          {t("approvals.forms.new")}
        </Link>
      ) : null}
      {forms.length === 0 ? (
        <EmptyState title={t("approvals.forms.empty")} hint={t(canManage ? "approvals.forms.empty_manager" : "approvals.forms.empty_member")} />
      ) : (
        <ul className="space-y-2" data-forms-list>
          {forms.map((f) => (
            <li key={f.id} className="list-none rounded-xl border border-border bg-surface-1 p-3" data-form={f.familyId}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1 text-sm font-semibold text-fg">{f.name}</span>
                {f.archived ? <span className="text-xs text-fg-muted">{t("approvals.forms.archived")}</span> : null}
                <span className="text-xs text-fg-muted">{t("approvals.forms.meta", { fields: f.fields, version: f.version })}</span>
              </div>
              {f.description ? <p className="mt-1 text-xs text-fg-muted">{f.description}</p> : null}
              <p className="mt-1 text-xs text-fg-muted">{t("approvals.fill.chain", { names: f.approvers.map((a) => a.name).join(" ← ") })}</p>
              {f.approverProblem ? (
                <p className="mt-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg" role="status" data-form-problem>
                  <span className="block font-medium">{t("approvals.forms.problem")}</span>
                  <span className="block text-fg-muted">{t("approvals.forms.problem_fix")}</span>
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {!f.archived ? (
                  <Link href={`/approvals?fill=${f.familyId}`} className="inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent/90 md:min-h-8">
                    {t("approvals.forms.fill")}
                  </Link>
                ) : null}
                {canManage ? (
                  <>
                    <Link href={`/approvals/forms?edit=${f.familyId}`} className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm text-fg hover:bg-surface-2 md:min-h-8">
                      {t("common.edit")}
                    </Link>
                    <FormArchiveButton familyId={f.familyId} archived={f.archived} />
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>,
  );
}

export const dynamic = "force-dynamic";
