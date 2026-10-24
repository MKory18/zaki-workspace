"use client";

import { useState } from "react";
import { DoorShell } from "@/components/theme/door-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiPost, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

/**
 * The two steps after the register form (services/registration.ts): «شوف بريدك», then the mailed
 * link's page, where «تأكيد» (a POST, so a mail scanner following links never uses it up) opens the
 * company and signs its owner in. Same door as sign-in: phone first, 44 px targets.
 */
export function RegisterCheckEmail() {
  const { t } = useI18n();
  return (
    <DoorShell>
      <Card className="space-y-3 rounded-2xl p-5 shadow-card sm:p-6">
        <h1 className="text-xl font-semibold text-fg">{t("register.check_title")}</h1>
        <p className="text-sm leading-6 text-fg">{t("register.check_body")}</p>
        <p className="text-xs leading-5 text-fg-muted">{t("register.check_hint")}</p>
        <a href="/login" className="flex min-h-11 items-center justify-center text-sm text-accent hover:underline">
          {t("auth.haveAccount")}
        </a>
      </Card>
    </DoorShell>
  );
}

export function RegisterConfirm({ token }: { token: string }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : t("auth.registration_link_invalid"));

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const res = await apiPost<{ ok: true; next?: string }>("/api/auth/register/confirm", { token });
      window.location.href = res.next ?? "/";
    } catch (err) {
      const key = err instanceof ApiError ? err.messageKey : undefined;
      const mapped = key ? t(key) : "";
      setError(mapped && mapped !== key ? mapped : t("common.error"));
      setPending(false);
    }
  }

  return (
    <DoorShell>
      <Card className="space-y-4 rounded-2xl p-5 shadow-card sm:p-6">
        <h1 className="text-xl font-semibold text-fg">{t("register.confirm_title")}</h1>
        <p className="text-sm leading-6 text-fg">{t("register.confirm_body")}</p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="button" onClick={() => void confirm()} disabled={pending || !token} className="h-11 w-full text-base">
          {pending ? t("register.confirming") : t("register.confirm_submit")}
        </Button>
        <a href="/register" className="flex min-h-11 items-center justify-center text-sm text-accent hover:underline">
          {t("register.new_link")}
        </a>
      </Card>
    </DoorShell>
  );
}
