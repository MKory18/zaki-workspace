import { pageActor, SectionOffNotice } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { memberDirectory } from "@/server/services/users";
import { Avatar } from "@/components/ui/avatar";
import { getServerT } from "@/lib/i18n/server";
import { ROLE_KEYS } from "@/lib/i18n/roles";

export default async function TeamsPage() {
  const { t } = getServerT();
  const { user, actor } = await pageActor();
  // the staff directory is a switch: a guest keeps the names-only list the service gives them,
  // everybody else needs `directory.view`
  if (!actor.isExternal && !actorCan(actor, "directory.view")) return <SectionOffNotice />;

  const orgs = await memberDirectory(user.id);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-lg font-semibold text-fg">{t("teams.title")}</h1>
        <p className="text-xs text-fg-muted">{t("teams.subtitle")}</p>
      </header>

      {orgs.map((org) => (
        <section key={org.organizationId} aria-label={org.organizationName}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">{org.organizationName}</h2>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted">
              {t("teams.yourRole")}: {t(ROLE_KEYS[org.orgRole] ?? "role.member")}
            </span>
          </div>
          <ul className="divide-y divide-border/60 rounded-xl border border-border bg-surface">
            {org.members.map((m) => {
              // An external partner (guest) sees names only: no title, role, e-mail, or profile link.
              const rowClass = "flex items-center gap-3 px-3 py-2.5";
              const content = (
                <>
                  <Avatar name={m.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{m.name}</p>
                    {org.restricted ? null : (
                      <p className="truncate text-xs text-fg-muted">{m.jobTitle ?? t("teams.noTitle")}</p>
                    )}
                  </div>
                  {m.email ? <p className="hidden truncate text-[10px] text-muted md:block">{m.email}</p> : null}
                  {org.restricted ? null : (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted">
                      {t(ROLE_KEYS[m.role] ?? "role.member")}
                    </span>
                  )}
                </>
              );
              return (
                <li key={m.userId}>
                  {org.restricted ? (
                    <div className={rowClass}>{content}</div>
                  ) : (
                    <a href={`/u/${m.userId}`} className={`${rowClass} hover:bg-surface-2`}>
                      {content}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}

export const dynamic = "force-dynamic";
