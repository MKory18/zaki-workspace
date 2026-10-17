import Link from "next/link";
import { redirect } from "next/navigation";
import { Globe, KeyRound, Lock, Users } from "lucide-react";
import { currentUser } from "@/server/auth";
import { fmtDMY } from "@/lib/format";
import { db } from "@/server/db";
import { getServerT } from "@/lib/i18n/server";
import { getGoogleStatus } from "@/server/services/google";
import { getIntegration } from "@/server/services/integrations";
import { JoinCodePanel } from "@/components/join-code-panel";
import { OrgNameForm } from "@/components/org-name-form";
import { IntegrationBadge } from "@/components/integration-badge";

export default async function SettingsPage() {
  const { t } = getServerT();
  const user = await currentUser();
  if (!user) redirect("/login");

  const org = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      organizationId: true,
      role: true,
      organization: { select: { id: true, name: true, joinCode: true, createdAt: true } },
    },
  });
  if (!org) redirect("/login");

  const [telegram, n8n, google] = await Promise.all([
    getIntegration(org.organizationId, "TELEGRAM"),
    getIntegration(org.organizationId, "N8N"),
    getGoogleStatus(org.organizationId),
  ]);
  const membersCount = await db.organizationMember.count({ where: { organizationId: org.organizationId } });

  const isManager = org.role === "OWNER" || org.role === "ADMIN";

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="text-xs text-muted">{t("settings.subtitle")}</p>
      </header>

      {/* organization */}
      <section className="space-y-4 rounded-xl border border-border bg-surface-1 p-5">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-accent/10 text-accent">
            <Globe className="size-5" />
          </span>
          <h2 className="text-sm font-semibold">{t("settings.org")}</h2>
        </div>
        {isManager ? (
          <OrgNameForm organizationId={org.organizationId} initialName={org.organization.name} />
        ) : (
          <p className="text-sm">{org.organization.name}</p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>{t("settings.role")}: <b className="text-fg">{org.role}</b></span>
          <span aria-hidden>·</span>
          <span>{t("settings.createdAt")}: {fmtDMY(org.organization.createdAt, "ar")}</span>
        </div>
        {isManager && (
          <div className="space-y-2">
            <JoinCodePanel organizationId={org.organizationId} initialCode={org.organization.joinCode} />
            <p className="text-[10px] text-muted">{t("settings.joinHint")}</p>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs">
          {isManager ? (
            <Link href="/members" className="inline-flex items-center gap-1.5 text-accent hover:underline">
              <Users className="size-3.5" />
              {t("settings.membersLink", { n: membersCount })}
            </Link>
          ) : (
            <Link href="/teams" className="inline-flex items-center gap-1.5 text-accent hover:underline">
              <Users className="size-3.5" />
              {t("settings.membersLink", { n: membersCount })}
            </Link>
          )}
        </div>
      </section>

      {/* integrations */}
      <section className="space-y-3 rounded-xl border border-border bg-surface-1 p-5">
        <h2 className="text-sm font-semibold">{t("settings.integrations")}</h2>
        <IntegrationBadge ok={Boolean(telegram?.connected)} label="Telegram" href="/telegram" />
        <IntegrationBadge ok={Boolean(n8n?.connected)} label="n8n" href="/automation" />
        <IntegrationBadge ok={google.connected} label="Google Drive" href="/automation" muted={google.connected ? null : google.configured ? "google.notConnected" : "google.needsEnv"} />
      </section>

      {/* security & personal */}
      <section className="grid gap-3 md:grid-cols-2">
        <Link href="/profile" className="group rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:border-accent/50">
          <span className="mb-2 grid size-9 place-items-center rounded-lg bg-sky-500/15 text-sky-500">
            <Lock className="size-5" />
          </span>
          <h3 className="text-sm font-semibold group-hover:text-accent">{t("settings.profileLink")}</h3>
          <p className="mt-1 text-[10px] text-muted">{t("settings.profileLinkHint")}</p>
        </Link>
        <Link href="/profile" className="group rounded-xl border border-border bg-surface-1 p-4 transition-colors hover:border-accent/50">
          <span className="mb-2 grid size-9 place-items-center rounded-lg bg-amber-500/15 text-amber-500">
            <KeyRound className="size-5" />
          </span>
          <h3 className="text-sm font-semibold group-hover:text-accent">{t("settings.passwordLink")}</h3>
          <p className="mt-1 text-[10px] text-muted">{t("settings.passwordLinkHint")}</p>
        </Link>
      </section>
    </div>
  );
}

export const dynamic = "force-dynamic";
