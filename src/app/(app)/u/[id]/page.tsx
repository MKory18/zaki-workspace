import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { getPublicProfile } from "@/server/services/users";
import { Avatar } from "@/components/ui/avatar";
import { getServerT } from "@/lib/i18n/server";
import { ROLE_KEYS } from "@/lib/i18n/roles";

export default async function PublicProfilePage({ params }: { params: { id: string } }) {
  const { t } = getServerT();
  const viewer = await currentUser();
  if (!viewer) redirect("/login");

  let profile: Awaited<ReturnType<typeof getPublicProfile>> | null = null;
  try {
    profile = await getPublicProfile(viewer.id, params.id);
  } catch {
    profile = null;
  }
  if (!profile) notFound();

  const stats: { label: string; value: number }[] = [
    { label: t("stat.ideas"), value: profile.stats.ideasCreated },
    { label: t("stat.votes"), value: profile.stats.ideasVotesReceived },
    { label: t("stat.openTasks"), value: profile.stats.openTasksAssigned },
    { label: t("stat.completedTasks"), value: profile.stats.tasksCompleted },
  ];

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-4 md:p-6">
      <header className="flex items-center gap-3 rounded-xl border border-border bg-surface p-5">
        <Avatar name={profile.name} className="h-14 w-14 text-base" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-fg">{profile.name}</h1>
          <p className="text-sm font-medium text-accent">{profile.jobTitle ?? t("teams.noTitle")}</p>
          <p className="text-xs text-muted">
            {profile.organizationName} · {t(ROLE_KEYS[profile.organizationRole] ?? "role.member")}
          </p>
        </div>
      </header>

      {profile.bio ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-fg-muted">{profile.bio}</p>
      ) : null}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface p-3 text-center">
            <p className="text-xl font-bold text-fg">{s.value}</p>
            <p className="text-[10px] text-muted">{s.label}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

export const dynamic = "force-dynamic";
