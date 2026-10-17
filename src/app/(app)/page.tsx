import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CalendarX,
  FileText,
  FolderKanban,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  ListFilter,
  MessageSquare,
  Network,
  Send,
  Settings,
  Target,
  Factory,
  Users,
  Workflow,
  Layers,
  ArrowLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { db } from "@/server/db";
import { currentUser } from "@/server/auth";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { getServerT, type ServerT } from "@/lib/i18n/server";
import { ProjectsToolbar } from "@/components/projects-toolbar";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/card";
import { formatDate, isOverdue } from "@/lib/format";

interface NavCardItem {
  href: string;
  labelKey: string;
  descKey: string;
  icon: LucideIcon;
  tile: string; // colored bg for the icon square
  text: string; // colored icon color
  count?: number | null;
  unitKey?: string | null;
  soon?: boolean;
}

const TILE: Record<string, { bg: string; text: string }> = {
  sky: { bg: "bg-sky-500/10", text: "text-sky-600 dark:text-sky-400" },
  violet: { bg: "bg-violet-500/10", text: "text-violet-600 dark:text-violet-400" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400" },
  blue: { bg: "bg-blue-500/10", text: "text-blue-600 dark:text-blue-400" },
  orange: { bg: "bg-orange-500/10", text: "text-orange-600 dark:text-orange-400" },
  rose: { bg: "bg-rose-500/10", text: "text-rose-600 dark:text-rose-400" },
  amber: { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400" },
  indigo: { bg: "bg-indigo-500/10", text: "text-indigo-600 dark:text-indigo-400" },
  teal: { bg: "bg-teal-500/10", text: "text-teal-600 dark:text-teal-400" },
  fuchsia: { bg: "bg-fuchsia-500/10", text: "text-fuchsia-600 dark:text-fuchsia-400" },
  cyan: { bg: "bg-cyan-500/10", text: "text-cyan-600 dark:text-cyan-400" },
  red: { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400" },
  slate: { bg: "bg-slate-500/10", text: "text-slate-600 dark:text-slate-400" },
  purple: { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-400" },
  green: { bg: "bg-green-500/10", text: "text-green-600 dark:text-green-400" },
  gray: { bg: "bg-gray-500/10", text: "text-gray-600 dark:text-gray-400" },
};

export default async function HomePage() {
  const { t, locale } = getServerT();
  const user = await currentUser();
  if (!user) redirect("/login");

  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const in7 = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

  const orgs = await db.organizationMember.findMany({
    where: { userId: user.id },
    select: { organization: { select: { id: true, name: true } } },
  });
  const orgIds = orgs.map((o) => o.organization.id);
  const wsIds = await accessibleWorkspaceIds(user.id);
  const wsScope = wsIds.length ? wsIds : ["__none__"];
  const primaryOrg = orgIds[0] ?? "__none__";

  const [
    assigned,
    dueToday,
    overdue,
    myOpen,
    upcoming7,
    projects,
    chatCount,
    ideaCount,
    fileCount,
    deptCount,
    teamCount,
    spaceCount,
    routineCount,
  ] = await Promise.all([
    db.task.findMany({
      where: {
        assigneeId: user.id,
        workspaceId: { in: wsScope },
        archived: false,
        completedAt: null,
      },
      orderBy: [{ dueDate: "asc" }, { id: "desc" }],
      take: 7,
      include: {
        labels: { select: { label: { select: { id: true, name: true, color: true } } } },
        assignee: { select: { id: true, name: true } },
        _count: { select: { comments: true } },
      },
    }),
    db.task.count({
      where: { assigneeId: user.id, workspaceId: { in: wsScope }, archived: false, completedAt: null, dueDate: { gte: now, lte: endOfDay } },
    }),
    db.task.count({
      where: { assigneeId: user.id, workspaceId: { in: wsScope }, archived: false, completedAt: null, dueDate: { lt: now } },
    }),
    db.task.count({
      where: { assigneeId: user.id, workspaceId: { in: wsScope }, archived: false, completedAt: null },
    }),
    db.task.count({
      where: { workspaceId: { in: wsScope }, archived: false, completedAt: null, dueDate: { gte: now, lte: in7 } },
    }),
    db.project.findMany({
      where: { workspaceId: { in: wsScope }, status: { in: ["ACTIVE", "PLANNING", "AT_RISK"] } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, name: true, status: true, targetDate: true, _count: { select: { tasks: { where: { archived: false } } } } },
    }),
    db.conversationMember.count({ where: { userId: user.id } }),
    db.idea.count({ where: { organization: { id: { in: orgIds } } } }),
    db.storedFile.count({ where: { organization: { id: { in: orgIds } }, deletedAt: null } }),
    db.department.count({ where: { orgId: { in: orgIds } } }),
    db.team.count({ where: { workspace: { organizationId: { in: orgIds } } } }),
    wsIds.length,
    db.routine.count({ where: { orgId: { in: orgIds }, active: true } }),
  ]);

  const cardsWork: NavCardItem[] = [
    { href: "/", labelKey: "nav.home", descKey: "home.desc.home", icon: LayoutDashboard, tile: TILE.sky!.bg, text: TILE.sky!.text },
    { href: "/projects", labelKey: "nav.projects", descKey: "home.desc.list", icon: FolderKanban, tile: TILE.violet!.bg, text: TILE.violet!.text, count: projects.length, unitKey: "home.unit_projects" },
    { href: "/my-work", labelKey: "nav.myWork", descKey: "home.desc.myWork", icon: Inbox, tile: TILE.emerald!.bg, text: TILE.emerald!.text, count: myOpen, unitKey: "home.unit_open" },
    { href: "/list", labelKey: "nav.listView", descKey: "home.desc.list", icon: ListFilter, tile: TILE.blue!.bg, text: TILE.blue!.text, count: upcoming7, unitKey: "home.unit_upcoming" },
    { href: "/calendar", labelKey: "nav.calendar", descKey: "home.desc.calendar", icon: CalendarDays, tile: TILE.orange!.bg, text: TILE.orange!.text, count: dueToday, unitKey: "home.unit_due" },
    { href: "/chat", labelKey: "nav.chat", descKey: "home.desc.chat", icon: MessageSquare, tile: TILE.rose!.bg, text: TILE.rose!.text, count: chatCount, unitKey: "home.unit_chats" },
    { href: "/production", labelKey: "nav.production", descKey: "home.desc.production", icon: Factory, tile: TILE.orange!.bg, text: TILE.orange!.text, count: routineCount, unitKey: "home.unit_routines" },
  ];
  const cardsLib: NavCardItem[] = [
    { href: "/ideas", labelKey: "nav.ideas", descKey: "home.desc.ideas", icon: Lightbulb, tile: TILE.amber!.bg, text: TILE.amber!.text, count: ideaCount, unitKey: "home.unit_ideas" },
    { href: "/goals", labelKey: "nav.goals", descKey: "home.desc.goals", icon: Target, tile: TILE.red!.bg, text: TILE.red!.text },
    { href: "/documents", labelKey: "nav.docs", descKey: "home.desc.docs", icon: FileText, tile: TILE.indigo!.bg, text: TILE.indigo!.text, soon: true },
    { href: "/files", labelKey: "nav.files", descKey: "home.desc.files", icon: FolderOpen, tile: TILE.teal!.bg, text: TILE.teal!.text, count: fileCount, unitKey: "home.unit_files" },
    { href: "/departments", labelKey: "nav.departments", descKey: "home.desc.departments", icon: Network, tile: TILE.fuchsia!.bg, text: TILE.fuchsia!.text, count: deptCount, unitKey: "home.unit_depts" },
    { href: "/teams", labelKey: "nav.teams", descKey: "home.desc.teams", icon: Users, tile: TILE.cyan!.bg, text: TILE.cyan!.text, count: teamCount, unitKey: "home.unit_teams" },
    { href: "/projects", labelKey: "top.workspaces", descKey: "home.desc.workspaces", icon: Layers, tile: TILE.slate!.bg, text: TILE.slate!.text, count: spaceCount, unitKey: "home.unit_spaces" },
  ];
  const cardsTools: NavCardItem[] = [
    { href: "/telegram", labelKey: "nav.telegram", descKey: "home.desc.telegram", icon: Send, tile: TILE.sky!.bg, text: TILE.sky!.text },
    { href: "/automation", labelKey: "nav.automation", descKey: "home.desc.automation", icon: Workflow, tile: TILE.purple!.bg, text: TILE.purple!.text },
    { href: "/analytics", labelKey: "nav.analytics", descKey: "home.desc.analytics", icon: BarChart3, tile: TILE.green!.bg, text: TILE.green!.text },
    { href: "/settings", labelKey: "nav.settings", descKey: "home.desc.settings", icon: Settings, tile: TILE.gray!.bg, text: TILE.gray!.text },
  ];

  const overdueIsNow = overdue > 0;
  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 pb-10 md:p-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-card md:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 end-0 size-80 rounded-full bg-accent/8 blur-3xl"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-accent">
              {t("home.date")} · {fmtToday(now, locale)}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-fg md:text-3xl">
              {t("home.welcome")}, {user.name.split(" ")[0]}
            </h1>
            <p className="mt-1.5 max-w-md text-sm text-fg-muted">{t("home.subtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ProjectsToolbar />
          </div>
        </div>
      </section>

      {/* Live status strip */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("home.unit_open")} value={myOpen} icon={Inbox} cls="bg-sky-500/10 text-sky-600 dark:text-sky-400" href="/my-work" />
        <Stat label={t("home.unit_due")} value={dueToday} icon={CalendarDays} cls="bg-orange-500/10 text-orange-600 dark:text-orange-400" href="/calendar" />
        <Stat label={t("home.unit_overdue")} value={overdue} alarm={overdueIsNow} icon={CalendarX} cls="bg-red-500/10 text-red-600 dark:text-red-400" href="/my-work" />
        <Stat label={t("home.unit_projects")} value={projects.length} icon={FolderKanban} cls="bg-violet-500/10 text-violet-600 dark:text-violet-400" href="/projects" />
      </section>

      {/* Sections as grids */}
      <NavGrid title={t("home.sectionWork")} items={cardsWork} cols={3} t={t} />
      <NavGrid title={t("home.sectionLib")} items={cardsLib} cols={3} t={t} />
      <NavGrid title={t("home.sectionTools")} items={cardsTools} cols={4} t={t} />

      {/* Tasks + Projects two-pane */}
      <section className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardBody className="p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <Inbox className="size-4 text-emerald-500" />
                {t("home.sectionBoard")}
              </h2>
              <Link href="/my-work" className="flex items-center gap-1 text-xs text-accent hover:underline">
                {t("home.viewAll")}
                <ArrowLeft className="size-3.5" />
              </Link>
            </div>
            <ul className="divide-y divide-border">
              {assigned.map((task) => {
                const late = isOverdue(task.dueDate?.toISOString?.() ?? null);
                return (
                  <li key={task.id} className="px-5 py-3">
                    <Link href={`/tasks/${task.id}`} className="group flex items-start gap-3">
                      <span className="mt-2 grid size-1.5 shrink-0 place-items-center" aria-hidden>
                        <i className={task.dueDate ? (late ? "size-2 rounded-full bg-red-500" : "size-2 rounded-full bg-sky-500") : "size-2 rounded-full bg-slate-300"} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-fg group-hover:text-accent">{task.title}</p>
                        <p className="mt-0.5 truncate text-[11px] text-muted">
                          {task.assignee ? `${t("home.assignee")} ${task.assignee.name}` : t("home.noAssignee")}
                          {task.dueDate ? ` · ${t("home.dueIn")} ${fmtShort(task.dueDate, locale)}` : ""}
                        </p>
                      </div>
                      {task._count.comments > 0 ? <span className="mt-1 text-[10px] text-muted">💬 {task._count.comments}</span> : null}
                    </Link>
                  </li>
                );
              })}
              {assigned.length === 0 ? (
                <li className="px-5 py-8 text-center text-sm text-muted">{t("home.noTasks")}</li>
              ) : null}
            </ul>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardBody className="p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <FolderKanban className="size-4 text-violet-500" />
                {t("home.sectionProjects")}
              </h2>
              <Link href="/projects" className="text-xs text-accent hover:underline">
                {t("home.viewAll")}
              </Link>
            </div>
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li key={p.id} className="px-5 py-3">
                  <Link href={`/projects/${p.id}`} className="group flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg group-hover:text-accent">{p.name}</p>
                      <p className="text-[11px] text-muted">
                        {p._count.tasks} {t("home.unit_open")} · {formatDate(p.targetDate, locale)}
                      </p>
                    </div>
                    <Badge>{p.status}</Badge>
                  </Link>
                </li>
              ))}
              {projects.length === 0 ? (
                <li className="px-5 py-8 text-center text-sm text-muted">{t("home.noProjects")}</li>
              ) : null}
            </ul>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function fmtToday(d: Date, locale: string): string {
  const MONTHS: Record<string, string[]> = {
    ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
    fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  };
  const WEEKDAYS: Record<string, string[]> = {
    ar: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
    fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
    en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  };
  const loc = ["fr", "en"].includes(locale) ? locale : "ar";
  const months = MONTHS[loc] ?? MONTHS["en"]!;
  const wds = WEEKDAYS[loc] ?? WEEKDAYS["en"]!;
  return `${wds[d.getDay()]!} ${d.getDate()} ${months[d.getMonth()]!} ${d.getFullYear()}`;
}

function fmtShort(d: Date | string | null | undefined, locale: string): string {
  if (!d) return "";
  const date = new Date(d);
  const MONTHS: Record<string, string[]> = {
    ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
    fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
    en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  };
  const loc = ["fr", "en"].includes(locale) ? locale : "ar";
  return `${date.getDate()} ${MONTHS[loc]![date.getMonth()]!}`;
}

function Stat({
  label,
  value,
  icon: Icon,
  cls,
  alarm,
  href,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  cls: string;
  alarm?: boolean;
  href: string;
}) {  return (
    <Link href={href} className="group rounded-xl border border-border bg-surface p-4 shadow-card transition-all hover:border-accent/40 hover:shadow-card-hover">
      <div className="flex items-center justify-between">
        <span className={`grid size-9 place-items-center rounded-lg ${cls}`}>
          <Icon className="size-4.5" />
        </span>
        <span className={`text-2xl font-bold ${alarm ? "text-red-500" : "text-fg"}`}>{value}</span>
      </div>
      <p className="mt-2 text-[11px] text-fg-muted">{label}</p>
    </Link>
  );
}

function NavGrid({ title, items, cols, t }: { title: string; items: NavCardItem[]; cols: 3 | 4; t: ServerT }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
        <i className="inline-block h-3.5 w-1 rounded-full bg-accent/70" aria-hidden />
        {title}
      </h2>
      <ul className={`grid gap-3 sm:grid-cols-2 ${cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4"}`}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group flex h-full items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card-hover"
              >
                <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${item.tile} ${item.text} transition-transform group-hover:scale-105`}>
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-fg">{t(item.labelKey)}</p>
                    {item.soon ? (
                      <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600">{t("coming.soon")}</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted">{t(item.descKey)}</p>
                  {item.count != null && item.unitKey ? (
                    <p className="mt-1 text-[11px] font-semibold text-accent">
                      {item.count} <span className="font-normal text-muted">{t(item.unitKey)}</span>
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
