"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { errorText } from "./errors";

/** «أرشِف» / «أعِد»: nothing is deleted; an archived form is not offered for filling and keeps every request made from it. */
export function FormArchiveButton({ familyId, archived }: { familyId: string; archived: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await apiPost(`/api/approval-forms/${familyId}/archive`, { archived: !archived });
            router.refresh();
          } catch (err) {
            setError(errorText(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        {archived ? t("approvals.forms.restore") : t("common.archive")}
      </Button>
      {error ? (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
