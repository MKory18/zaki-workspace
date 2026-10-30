"use client";

import { cn } from "@/lib/utils";

/**
 * «لمين» when the task is for more than one person: the people of the space, each a tick.
 *
 * The person ticked first is the task's own assignee (`assigneeId`) — the one every old list, counter and
 * notification still reads; the rest ride beside them (`TaskCoAssignee`). The order picked is kept, so
 * unticking somebody never silently moves the task to another person.
 *
 * Plain checkboxes: one thumb on a phone, one keyboard on a laptop, no drag and no search for a list
 * this short.
 */
export function PeopleMulti({
  people,
  value,
  onChange,
  label,
  emptyText,
}: {
  people: { id: string; name: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
  /** Shown when the space has nobody to offer (never a blank box). */
  emptyText?: string;
}) {
  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  if (people.length === 0) {
    return <p className="text-xs text-muted">{emptyText ?? ""}</p>;
  }

  return (
    <div
      role="group"
      aria-label={label}
      className="max-h-44 overflow-y-auto rounded-lg border border-border bg-surface-1 p-1"
    >
      {people.map((person) => {
        const on = value.includes(person.id);
        return (
          <label
            key={person.id}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm",
              on ? "bg-accent/10 text-fg" : "text-fg-muted hover:bg-surface-2",
            )}
          >
            <input
              type="checkbox"
              checked={on}
              onChange={() => toggle(person.id)}
              className="size-4 shrink-0 accent-accent"
            />
            <span className="min-w-0 flex-1 truncate">{person.name}</span>
          </label>
        );
      })}
    </div>
  );
}

/** «فلان وفلان»: the people a task is for, as one readable line (Arabic list joining, never a comma dump). */
export function peopleLine(names: string[], and: string): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join("، ")} ${and} ${names[names.length - 1]}`;
}
