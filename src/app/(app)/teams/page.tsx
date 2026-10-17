import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { memberDirectory } from "@/server/services/users";
import { Avatar } from "@/components/ui/avatar";
import { JoinCodePanel } from "@/components/join-code-panel";
import { getServerT } from "@/lib/i18n/server";
import { ROLE_KEYS } from "@/lib/i18n/roles";

export default async function TeamsPage() {
  const { t } = getServerT();
  const user = await currentUser();
  if (!user) redirect("/login");

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
            {org.canManage && org.joinCode ? (
              <JoinCodePanel organizationId={org.organizationId} initialCode={org.joinCode} />
            ) : null}
          </div>
          <ul className="divide-y divide-border/60 rounded-xl border border-border bg-surface">
            {org.members.map((m) => (
              <li key={m.userId}>
                <a
                  href={`/u/${m.userId}`}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2"
                >
                  <Avatar name={m.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{m.name}</p>
                    <p className="truncate text-xs text-fg-muted">{m.jobTitle ?? t("teams.noTitle")}</p>
                  </div>
                  {m.email ? <p className="hidden truncate text-[10px] text-muted md:block">{m.email}</p> : null}
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-fg-muted">
                    {t(ROLE_KEYS[m.role] ?? "role.member")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

export const dynamic = "force-dynamic";
