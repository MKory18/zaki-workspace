"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { BoardCreateModal } from "@/components/create-forms";

export function BoardCreateButton({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        {t("board.new")}
      </Button>
      <BoardCreateModal open={open} onClose={() => setOpen(false)} projectId={projectId} />
    </>
  );
}
