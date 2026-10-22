"use client";

import { useState } from "react";
import { DoorShell } from "@/components/theme/door-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { apiPost, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { safeNextPath } from "@/lib/safe-next";

/**
 * Sign-in (username or e-mail + password) and the first-run set-up (the very first company and its
 * owner). Self-registration and joining with a code are closed: the owner creates every account.
 *
 * Both sit on the door (`DoorShell`): the Zaki Workspace mark and wordmark, the decoration of the active theme
 * behind, and the form on an opaque card. Phone first: 375 px, 16 px gutters, fields and buttons 44 px tall.
 */
export function AuthForm({ mode, firstRun = false }: { mode: "login" | "register"; firstRun?: boolean }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const data = Object.fromEntries(form.entries());
    try {
      if (mode === "login") {
        const res = await apiPost<{ ok: true; next?: string }>("/api/auth/login", {
          identifier: data.identifier,
          password: data.password,
        });
        // where the person wanted to go (a path on this site only), through the onboarding if it is owed
        const wanted = safeNextPath(new URLSearchParams(window.location.search).get("next"));
        window.location.href =
          res.next === "/onboarding"
            ? `/onboarding${wanted === "/" ? "" : `?next=${encodeURIComponent(wanted)}`}`
            : wanted;
      } else {
        await apiPost("/api/auth/register", {
          email: data.email,
          name: data.name,
          password: data.password,
          jobTitle: data.jobTitle,
          orgName: data.orgName,
        });
        window.location.href = "/";
      }
    } catch (err) {
      // show the server's known error keys in Arabic; unknown → generic message
      let msg = t("common.error");
      if (err instanceof ApiError) {
        if (err.messageKey) {
          const mapped = t(err.messageKey);
          if (mapped !== err.messageKey) msg = mapped;
        } else if (err.code === "validation.failed" && Array.isArray(err.details) && err.details.length > 0) {
          const first = (err.details[0] as { message?: string }).message;
          const mapped = first ? t(first) : "";
          msg = mapped && mapped !== first ? mapped : t("auth.validationHint");
        }
      }
      setError(msg);
      setPending(false);
    }
  }

  return (
    <DoorShell>
      <Card className="rounded-2xl p-5 shadow-card sm:p-6">
        <form onSubmit={submit} className="space-y-4">
          {mode === "login" ? (
            <>
              <h1 className="text-xl font-semibold text-fg">{t("auth.login")}</h1>
              <label className="block">
                <Label>{t("login.identifier")}</Label>
                <Input
                  name="identifier"
                  required
                  maxLength={255}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  dir="ltr"
                  className="h-11 text-base"
                />
              </label>
              <label className="block">
                <Label>{t("auth.password")}</Label>
                <Input name="password" type="password" required autoComplete="current-password" dir="ltr" className="h-11 text-base" />
              </label>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-fg">{t("bootstrap.title")}</h1>
              <p className="text-xs leading-5 text-fg-muted">{t("bootstrap.hint")}</p>
              <label className="block">
                <Label>{t("auth.orgName")}</Label>
                <Input name="orgName" required maxLength={120} className="h-11 text-base" />
              </label>
              <label className="block">
                <Label>{t("auth.name")}</Label>
                <Input name="name" required maxLength={100} autoComplete="name" className="h-11 text-base" />
              </label>
              <label className="block">
                <Label>{t("auth.jobTitle")}</Label>
                <Input name="jobTitle" maxLength={60} placeholder={t("auth.jobTitlePlaceholder")} className="h-11 text-base" />
              </label>
              <label className="block">
                <Label>{t("auth.email")}</Label>
                <Input name="email" type="email" required autoComplete="email" dir="ltr" className="h-11 text-base" />
              </label>
              <label className="block">
                <Label>{t("auth.password")}</Label>
                <Input name="password" type="password" required minLength={8} autoComplete="new-password" dir="ltr" className="h-11 text-base" />
                <p className="mt-1 text-xs text-fg-muted">{t("auth.passwordRule")}</p>
              </label>
            </>
          )}

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={pending} className="h-11 w-full text-base">
            {mode === "login" ? t("auth.submitLogin") : t("auth.submitRegister")}
          </Button>

          {mode === "login" ? (
            <p className="text-center text-xs leading-5 text-fg-muted">
              {t("login.no_account")}
              {firstRun ? (
                <a href="/register" className="flex min-h-11 items-center justify-center text-accent hover:underline">
                  {t("login.first_run")}
                </a>
              ) : null}
            </p>
          ) : (
            <p className="text-center text-xs text-fg-muted">
              <a href="/login" className="flex min-h-11 items-center justify-center text-accent hover:underline">
                {t("auth.haveAccount")}
              </a>
            </p>
          )}
        </form>
      </Card>
    </DoorShell>
  );
}
