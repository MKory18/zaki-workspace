"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPatch, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

/**
 * «نقل إلى فريق» on a project's page: which team of its space the project belongs to («كل المساحة» = none).
 * Only a manager of the space sees it (the teams API says `canManage`); moving changes who sees the project, so
 * the server checks it again (`moveProjectToTeam`). Nothing is drawn in a space with no team.
 */
export function ProjectTeamPicker({ projectId, workspaceId, teamId }: { projectId: string; workspaceId: string; teamId: string | null }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const teams = useQuery({
    queryKey: ["ws-teams", workspaceId],
    queryFn: () => apiGet<{ teams: { id: string; name: string }[]; canManage: boolean }>(`/api/workspaces/${workspaceId}/teams`),
  });
  const move = useMutation({
    mutationFn: (next: string | null) => apiPatch(`/api/projects/${projectId}`, { teamId: next }),
    onSuccess: () => router.refresh(),
    onError: (err) => toast(err instanceof ApiError && err.messageKey ? t(err.messageKey) : t("common.error"), "error"),
  });
  if (!teams.data?.canManage || teams.data.teams.length === 0) return null;
  return (
    <label className="inline-flex items-center gap-2 text-xs text-fg-muted">
      <span>{t("spaceteams.move")}</span>
      <select
        value={teamId ?? ""}
        disabled={move.isPending}
        onChange={(e) => move.mutate(e.target.value || null)}
        className="min-h-9 rounded-lg border border-muted bg-surface-1 px-2 text-sm text-fg"
      >
        <option value="">{t("spaceteams.whole_space")}</option>
        {teams.data.teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
    </label>
  );
}
