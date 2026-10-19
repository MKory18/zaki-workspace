"use client";

import { useState } from "react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { apiPost, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinMode, setJoinMode] = useState<null | "create" | "join">(null); // null → chooser

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const data = Object.fromEntries(form.entries());
    try {
      if (mode === "login") {
        await apiPost("/api/auth/login", { email: data.email, password: data.password });
      } else {
        const payload =
          joinMode === "join"
            ? { email: data.email, name: data.name, password: data.password, jobTitle: data.jobTitle, joinCode: data.joinCode }
            : { email: data.email, name: data.name, password: data.password, jobTitle: data.jobTitle, orgName: data.orgName };
        await apiPost("/api/auth/register", payload);
      }
      window.location.href = "/";
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
    <div className="flex min-h-dvh items-center justify-center bg-surface-1 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm"
        >
          {mode === "register" && joinMode === null ? (
            <>
              <p className="text-lg font-semibold text-fg">{t("auth.register")}</p>
              <button
                type="button"
                onClick={() => setJoinMode("create")}
                className="w-full rounded-lg border border-border bg-surface-1 px-3 py-3 text-start hover:border-accent"
              >
                <span className="block text-sm font-medium text-fg">{t("auth.createOrgTitle")}</span>
                <span className="block text-xs text-muted">{t("auth.createOrgHint")}</span>
              </button>
              <button
                type="button"
                onClick={() => setJoinMode("join")}
                className="w-full rounded-lg border border-border bg-surface-1 px-3 py-3 text-start hover:border-accent"
              >
                <span className="block text-sm font-medium text-fg">{t("auth.joinOrgTitle")}</span>
                <span className="block text-xs text-muted">{t("auth.joinOrgHint")}</span>
              </button>
          <p className="text-center text-xs text-fg-muted">
            {t("auth.haveAccount")}
            <a href="/login" className="ms-1 text-accent hover:underline">
              {t("auth.login")}
            </a>
          </p>
            </>
          ) : null}

          {mode === "login" || joinMode !== null ? (
            <p className="text-lg font-semibold text-fg">
              {mode === "login" ? t("auth.login") : joinMode === "join" ? t("auth.joinOrgTitle") : t("auth.createOrgTitle")}
            </p>
          ) : null}

          {mode === "register" && joinMode !== null ? (
            <>
              <div>
                <Label>{t("auth.name")}</Label>
                <Input name="name" required maxLength={100} autoComplete="name" />
              </div>
              <div>
                <Label>{t("auth.jobTitle")}</Label>
                <Input name="jobTitle" maxLength={60} placeholder={t("auth.jobTitlePlaceholder")} />
              </div>
              {joinMode === "join" ? (
                <div>
                  <Label>{t("auth.joinCode")}</Label>
                  <Input name="joinCode" required minLength={4} maxLength={12} className="uppercase" autoComplete="off" />
                </div>
              ) : (
                <div>
                  <Label>{t("auth.orgName")}</Label>
                  <Input name="orgName" required maxLength={120} />
                </div>
              )}
            </>
          ) : null}

          {mode === "login" || joinMode !== null ? (
            <>
              <div>
                <Label>{t("auth.email")}</Label>
                <Input name="email" type="email" required autoComplete="email" />
              </div>
              <div>
                <Label>{t("auth.password")}</Label>
                <Input
                  name="password"
                  type="password"
                  required
                  minLength={mode === "register" ? 8 : 1}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
                {mode === "register" ? (
                  <p className="mt-1 text-[10px] text-muted">{t("auth.passwordRule")}</p>
                ) : null}
              </div>
            </>
          ) : null}

          {error ? <p className="text-xs text-red-500">{error}</p> : null}

          {mode === "login" || joinMode !== null ? (
            <Button type="submit" disabled={pending} className="w-full">
              {mode === "login" ? t("auth.submitLogin") : t("auth.submitRegister")}
            </Button>
          ) : null}

          {mode === "register" && joinMode !== null ? (
            <p className="text-center text-xs text-fg-muted">
              <button type="button" onClick={() => setJoinMode(null)} className="text-accent hover:underline">
                {t("auth.backToChoice")}
              </button>
            </p>
          ) : null}

          {mode === "login" ? (
            <p className="text-center text-xs text-fg-muted">
              {t("auth.needAccount")}
              <a href="/register" className="ms-1 text-accent hover:underline">
                {t("auth.register")}
              </a>
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
