"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { apiPut } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { devErrorText } from "./errors";

/**
 * «غيّر المسؤول» — one person's supervisor, chosen from the people the page offers (everybody but the person and the people
 * below them; the server refuses a loop or a chain deeper than 6 anyway). Drawn only for the owner and whoever holds
 * `people.manage_lines`.
 */
export function SupervisorPicker({ userId, name, current, options }: { userId: string; name: string; current: string | null; options: { userId: string; name: string }[] }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiPut(`/api/team-development/lines/${userId}`, { managerId: value === "" ? null : value });
      toast(t("teamdev.lines.saved"), "success");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast(devErrorText(err, t), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)} aria-label={`${t("teamdev.lines.change")}: ${name}`} data-change-supervisor={userId}>
        <UserCog className="size-4" aria-hidden />
        {t("teamdev.lines.change")}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="sr-only" htmlFor={`sup-${userId}`}>
        {t("teamdev.lines.supervisor")}
      </label>
      <select id={`sup-${userId}`} value={value} onChange={(e) => setValue(e.target.value)} className="h-11 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg md:h-9" data-supervisor-select={userId}>
        <option value="">{t("teamdev.lines.none")}</option>
        {options.map((o) => (
          <option key={o.userId} value={o.userId}>
            {o.name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={busy}>
        {t("common.save")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t("common.cancel")}
      </Button>
    </form>
  );
}
