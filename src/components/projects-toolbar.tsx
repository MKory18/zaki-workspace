"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { ProjectCreateModal } from "@/components/create-forms";
import { useNewIntent } from "@/lib/nav/use-new-intent";

interface OrgsResponse {
  organizations: { workspaces: { id: string; name: string }[] }[];
}

export function ProjectsToolbar() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const orgs = useQuery({
    queryKey: ["orgs"],
    queryFn: () => apiGet<OrgsResponse>("/api/workspaces"),
  });
  const workspaces = (orgs.data?.organizations ?? []).flatMap((o) => o.workspaces);
  // «جديد» → «مشروع» lands here with ?new=project; the form opens once it knows the spaces
  useNewIntent("project", () => setOpen(true), orgs.isSuccess);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        {t("proj.new")}
      </Button>
      <ProjectCreateModal open={open} onClose={() => setOpen(false)} workspaces={workspaces} />

    </>
  );
}
