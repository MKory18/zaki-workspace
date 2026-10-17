"use client";

import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** Header button linking a project to its timeline page. */
export function TimelineBadgeButton({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/projects/${projectId}/timeline`}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-fg transition-colors hover:bg-surface-2"
    >
      <CalendarRange className="size-4 text-accent" />
      {t("timeline.open")}
    </Link>
  );
}
