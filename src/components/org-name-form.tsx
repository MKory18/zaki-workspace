"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPatch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

/** Rename the organization (OWNER-only action; the API enforces it too). */
export function OrgNameForm({ organizationId, initialName }: { organizationId: string; initialName: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (next.length < 2 || next === initialName) return;
    setBusy(true);
    try {
      await apiPatch(`/api/organizations/${organizationId}`, { name: next });
      toast(t("settings.orgRenamed"), "success");
      router.refresh();
    } catch {
      toast(t("common.error"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
      <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="flex-1" />
      <Button type="submit" disabled={busy || name.trim() === initialName || name.trim().length < 2}>
        {t("common.save")}
      </Button>
    </form>
  );
}
