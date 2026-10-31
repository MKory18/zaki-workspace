"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { rt } from "@/lib/reminders/client";
import { FieldChipPicker, type PickerDef } from "./field-chips";

/**
 * «حقول مخصصة» on the list: pick a project to get its fields, then FILTER by one choice / yes-no / person field and SORT by one
 * number / date field (every control is a real address parameter, so the choice survives a reload and a shared link), and pick up to
 * three fields to show as chips on every row. The server validates every parameter again against the project's own fields.
 */
export interface FilterField {
  id: string;
  label: string;
  type: "SINGLE_CHOICE" | "BOOLEAN" | "PERSON";
  options: { id: string; label: string }[];
}

const selectCls = "min-h-11 md:h-8 rounded-lg border border-muted bg-surface-1 px-2 text-base md:text-xs text-fg";

export function FieldListControls({
  params,
  projects,
  projectId,
  filterFields,
  sortFields,
  people,
  pickerDefs,
  total,
}: {
  /** The address parameters in force (workspace, group, priority, assignee, q, reward, project, ff, fv, fs, fd): kept when one changes. */
  params: Record<string, string>;
  projects: { id: string; name: string }[];
  projectId: string;
  filterFields: FilterField[];
  sortFields: { id: string; label: string }[];
  people: { id: string; name: string }[];
  pickerDefs: PickerDef[];
  /** The exact total of the sorted NUMBER field over the rows shown (decimal text), when there is one. */
  total?: { label: string; text: string } | null;
}) {
  const router = useRouter();
  const ff = params["ff"] ?? "";
  const field = filterFields.find((f) => f.id === ff);

  function go(change: Record<string, string>) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...change })) if (v) sp.set(k, v);
    router.push(`/list?${sp.toString()}`);
  }

  return (
    <div data-field-controls className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2">
      <select aria-label={rt("fields.list.project")} className={selectCls} value={projectId} onChange={(e) => go({ project: e.target.value, ff: "", fv: "", fs: "", fd: "" })}>
        <option value="">{rt("fields.list.project_any")}</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {projectId && filterFields.length > 0 ? (
        <>
          <select aria-label={rt("fields.list.filter")} className={selectCls} value={ff} onChange={(e) => go({ ff: e.target.value, fv: "" })}>
            <option value="">{rt("fields.list.filter")}</option>
            {filterFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          {field ? (
            <select aria-label={field.label} className={selectCls} value={params["fv"] ?? ""} onChange={(e) => go({ fv: e.target.value })}>
              <option value="">{rt("fields.list.filter_any")}</option>
              {field.type === "BOOLEAN" ? (
                <>
                  <option value="yes">{rt("fields.yes")}</option>
                  <option value="no">{rt("fields.no")}</option>
                </>
              ) : null}
              {field.type === "SINGLE_CHOICE" ? field.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>) : null}
              {field.type === "PERSON" ? people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>) : null}
            </select>
          ) : null}
        </>
      ) : null}

      {projectId && sortFields.length > 0 ? (
        <>
          <select aria-label={rt("fields.list.sort")} className={selectCls} value={params["fs"] ?? ""} onChange={(e) => go({ fs: e.target.value, fd: e.target.value ? (params["fd"] ?? "asc") : "" })}>
            <option value="">{rt("fields.list.sort_none")}</option>
            {sortFields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          {params["fs"] ? (
            <select aria-label={rt("fields.list.sort")} className={selectCls} value={params["fd"] ?? "asc"} onChange={(e) => go({ fd: e.target.value })}>
              <option value="asc">{rt("fields.list.asc")}</option>
              <option value="desc">{rt("fields.list.desc")}</option>
            </select>
          ) : null}
        </>
      ) : null}

      {total ? (
        <span data-field-total className="text-xs text-fg-muted">
          {total.label}
        </span>
      ) : null}

      <FieldChipPicker defs={pickerDefs} className="ms-auto" />
    </div>
  );
}
