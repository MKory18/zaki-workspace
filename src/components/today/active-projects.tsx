import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getServerT } from "@/lib/i18n/server";
import type { TodayProject } from "@/lib/today";
import { cn } from "@/lib/utils";

/**
 * «مشاريعي النشطة»: a compact list of the projects that are going, each a link to the project, with its status in
 * Arabic and its open tasks. For an external partner it is the projects they have work in, and the number is
 * their own open tasks there (the service decides; the words follow: «مهامك المفتوحة»).
 *
 * Empty, it says so and points to the projects page: no dead end.
 */
export function ActiveProjects({ projects, isExternal }: { projects: TodayProject[]; isExternal: boolean }) {
  const { t } = getServerT();
  return (
    <section aria-labelledby="today-projects-title" className="rounded-card border border-border bg-surface-1 p-4 shadow-card">
      <div className="flex items-center gap-3">
        <h2 id="today-projects-title" className="text-base font-semibold text-fg">
          {t("today.projects.title")}
        </h2>
        <Link href="/projects" className="ms-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent hover:underline">
          {t("today.projects.all")}
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {projects.length > 0 ? (
        <ul role="list" className="divide-y divide-border">
          {projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} prefetch={false} className="flex min-h-14 items-center gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">
                    <bdi>{project.name}</bdi>
                  </span>
                  <span className="block text-xs leading-5 text-fg-muted">
                    {isExternal ? t("today.projects.open_mine", { n: project.openTasks }) : t("today.projects.open", { n: project.openTasks })}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
                    project.status === "AT_RISK" ? "border-warn/40 text-warn" : "border-border text-fg-muted",
                  )}
                >
                  {project.statusLabel}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-fg-muted">{t("today.projects.empty")}</p>
      )}
    </section>
  );
}
