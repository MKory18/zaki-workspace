"use client";

import { useRouter } from "next/navigation";
import { enumOptions } from "@/lib/i18n/enums";

export interface FilterWorkspace {
  id: string;
  name: string;
}

/** Filter bar for the global List view; every control maps to a real URL/API param. */
export function ListFilters({
  workspaces,
  wsId,
  group,
  priority,
  assigneeId,
  q,
  members,
  labels,
}: {
  workspaces: FilterWorkspace[];
  wsId: string;
  group: string;
  priority: string;
  assigneeId: string;
  q: string;
  members: { id: string; name: string }[];
  labels: Record<string, string>;
}) {
  const router = useRouter();

  /** Always push the complete param set so filters compose, never clobber. */
  function push(next: { group?: string; priority?: string; assignee?: string; q?: string }) {
    const sp = new URLSearchParams({ workspace: wsId, group, priority, assignee: assigneeId });
    if (q) sp.set("q", q);
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
    }
    router.push(`/list?${sp.toString()}`);
  }

  const selectCls =
    "min-h-11 md:h-8 rounded-lg border border-muted bg-surface-1 px-2 text-base md:text-xs text-fg";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
      <select
        aria-label={labels.workspace}
        className={selectCls}
        value={wsId}
        onChange={(e) => router.push(`/list?workspace=${e.target.value}&group=${group}`)}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>

      <select
        aria-label={labels.groupBy}
        className={selectCls}
        value={group}
        onChange={(e) => push({ group: e.target.value })}
      >
        {["status", "priority", "project", "assignee"].map((g) => (
          <option key={g} value={g}>
            {labels[`group_${g}`]}
          </option>
        ))}
      </select>

      <select
        aria-label={labels.priorityField}
        className={selectCls}
        value={priority}
        onChange={(e) => push({ priority: e.target.value })}
      >
        <option value="">{labels.priorityAny}</option>
        {enumOptions("TaskPriority").map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <select
        aria-label={labels.assignee}
        className={selectCls}
        value={assigneeId}
        onChange={(e) => push({ assignee: e.target.value })}
      >
        <option value="">{labels.assigneeAny}</option>
        <option value="__none__">{labels.unassigned}</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      <form
        className="flex flex-1 items-center justify-end"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement | null;
          push({ q: input?.value.trim() ?? "" });
        }}
      >
        <input
          name="q"
          type="search"
          defaultValue={q}
          aria-label={labels.search}
          placeholder={labels.search}
          className="min-h-11 md:h-8 w-52 md:w-52 rounded-lg border border-muted bg-surface-1 px-2 text-base md:text-xs text-fg placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset"
        />
      </form>
    </div>
  );
}
