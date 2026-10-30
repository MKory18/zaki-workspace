"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { rewardErrorText } from "./reward-fields";

/** «ثبّت» / «ألغِ التثبيت» on the task page: drawn for the owner and the space's ADMIN only (the server decides again). */
export function PinButton({ taskId, pinned }: { taskId: string; pinned: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={busy}
      data-pin-button={pinned ? "pinned" : "unpinned"}
      title={t("pin.hint")}
      onClick={async () => {
        setBusy(true);
        try {
          await apiPost(`/api/tasks/${taskId}/pin`, { pinned: !pinned });
          toast(t(pinned ? "pin.undone" : "pin.done"), "success");
          router.refresh();
        } catch (err) {
          toast(rewardErrorText(err, t), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {pinned ? <PinOff className="size-4" aria-hidden /> : <Pin className="size-4" aria-hidden />}
      {t(pinned ? "pin.unpin" : "pin.button")}
    </Button>
  );
}
