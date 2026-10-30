import { redirect } from "next/navigation";
import { actorCanWork } from "@/server/policy/actor";
import {
  listWorkspacePeople,
  queryTasksForView,
  resolveWorkspaceView,
  sortByDue,
  type ViewTask,
} from "@/server/services/views";
import { TaskRow, type RowMember } from "@/components/task-row";
import { ListFilters } from "@/components/list-filters";
import { getServerT } from "@/lib/i18n/server";
import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { currentSpace } from "@/server/services/current-space";
import { columnLabel, enumLabel } from "@/lib/i18n/enums";
import { actorFeatureOn } from "@/server/services/features";
import { stepProgressFor } from "@/server/services/task-steps";

import Link from "next/link";
const GROUPS = ["status", "priority", "project", "assignee"] as const;
type Group = (typeof GROUPS)[number];
const PRIORITY_ORDER = ["URGENT", "HIGH", "NORMAL", "LOW", "NONE"] as const;

export default async function ListPage({
  searchParams,
}: {
  searchParams: { workspace?: string; group?: string; priority?: string; assignee?: string; q?: string };
}) {
  const { t } = getServerT();
  // the space the person is in, never one named in the address (that is entered through the switcher)
  const { actor } = await pageActor();
  // the tasks row of the person's grid (a guest works in their shared spaces by the space's rules)
  if (!actorCanWork(actor, "tasks.view")) return <SectionOffNotice />;
  const space = await currentSpace(actor);
  const result = await resolveWorkspaceView(space?.id ?? "");
  if ("pageRedirect" in result) redirect("/login");

  if ("none" in result) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <h1 className="text-base font-semibold text-fg">{t("list.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("list.noWorkspace")}</p>
          <Link href="/projects" className="mt-3 inline-block rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg">
            {t("nav.projects")}
          </Link>
        </div>
      </div>
    );
  }

  const ctx = result.ctx;
  const group: Group = GROUPS.includes((searchParams.group ?? "") as Group)
    ? ((searchParams.group ?? "status") as Group)
    : "status";

  const priority = (searchParams.priority ?? "").trim();
  const validPriority = PRIORITY_ORDER.includes(priority as (typeof PRIORITY_ORDER)[number])
    ? priority
    : undefined;
  const assigneeParam = (searchParams.assignee ?? "").trim();
  const assigneeId = assigneeParam === "__none__" ? "__none__" : assigneeParam || undefined;
  const q = (searchParams.q ?? "").trim();

  // org members: the org's people; org guests: only those who share this workspace
  const members: RowMember[] = ctx.denied ? [] : await listWorkspacePeople(ctx);

  const tasks: ViewTask[] = ctx.denied
    ? []
    : sortByDue(
        await queryTasksForView({
          orgId: ctx.orgId,
          workspaceId: ctx.workspaceId,
          visible: ctx.visible,
          assigneeId: assigneeId === "__none__" ? undefined : assigneeId,
          priority: validPriority as ViewTask["priority"] | undefined,
          search: q || undefined,
          limit: 300,
        }),
      ).filter((task) => (assigneeId === "__none__" ? task.assigneeId === null : true));

  // «٣ من ٥» on the rows: one grouped read for the page, and only while the company's «الخطوات» switch is on
  const progress = (await actorFeatureOn(actor, "taskSteps")) ? await stepProgressFor(tasks.map((t) => t.id)) : new Map();

  // grouping still depends on the same rows; no requery
  interface GroupBucket {
    label: string;
    ordered: string; // group sort key
    rows: ViewTask[];
  }
  const buckets = new Map<string, GroupBucket>();
  const ensure = (id: string, label: string, ordered: string): GroupBucket => {
    let b = buckets.get(id);
    if (!b) {
      b = { label, ordered, rows: [] };
      buckets.set(id, b);
    }
    return b;
  };

  for (const task of tasks) {
    switch (group) {
      case "status":
        ensure(task.columnId, columnLabel(task.columnName), "0").rows.push(task);
        break;
      case "priority": {
        const idx = PRIORITY_ORDER.indexOf(task.priority);
        ensure(task.priority, enumLabel("TaskPriority", task.priority), String(idx < 0 ? 9 : idx)).rows.push(task);
        break;
      }
      case "project":
        ensure(task.projectId, task.projectName, "0").rows.push(task);
        break;
      case "assignee": {
        const id = task.assigneeId ?? "__none__";
        ensure(id, task.assigneeName ?? t("list.unassigned"), "0").rows.push(task);
        break;
      }
    }
  }

  const sortedBuckets = [...buckets.values()].sort((a, b) =>
    a.ordered === b.ordered ? a.label.localeCompare(b.label, "ar") : a.ordered.localeCompare(b.ordered),
  );

  const labels = {
    workspace: t("ws.one"),
    groupBy: t("list.groupBy"),
    group_status: t("list.group.status"),
    group_priority: t("list.group.priority"),
    group_project: t("list.group.project"),
    group_assignee: t("list.group.assignee"),
    priorityField: t("task.priority"),
    priorityAny: t("list.priorityAny"),
    assignee: t("task.assignee"),
    assigneeAny: t("list.assigneeAny"),
    unassigned: t("list.unassigned"),
    search: t("common.search"),
  };

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto">
      <header className="border-b border-border bg-surface px-5 py-4">
        <h1 className="text-base font-semibold text-fg">{t("list.title")}</h1>
        <p className="text-xs text-fg-muted">{ctx.denied ? t("forbidden") : ctx.workspaceName}</p>
      </header>

      <ListFilters
        wsId={ctx.workspaceId}
        group={group}
        priority={priority}
        assigneeId={assigneeId ?? ""}
        q={q}
        members={members}
        labels={labels}
      />

      <div className="flex-1 px-3 py-3">
        {ctx.denied ? (
          <p className="px-2 py-10 text-center text-sm text-muted">{t("forbidden")}</p>
        ) : tasks.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted">{t("list.empty")}</p>
        ) : (
          <div className="space-y-5">
            {sortedBuckets.map((b) => (
              <section key={b.label} aria-label={b.label}>
                <h2 className="mb-1 flex items-center gap-2 px-2 text-xs font-semibold text-fg-muted">
                  {b.label}
                  <span className="rounded-full bg-surface-2 px-1.5 text-xs font-normal">{b.rows.length}</span>
                </h2>
                <ul className="divide-y divide-border/60">
                  {b.rows.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={{ ...task, steps: progress.get(task.id) }}
                      editable={ctx.editable}
                      members={members}
                      showProject={group !== "project"}
                      showColumn={group !== "status"}
                      timeZone={ctx.timeZone}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
