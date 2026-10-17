"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { apiPost, apiPatch, ApiError } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";

export interface MeData {
  id: string;
  email: string;
  name: string;
  jobTitle: string | null;
  bio: string | null;
  locale: string;
  hue: number;
}

/** Self-service account form: identity + job title + bio + password change. */
export function ProfileForm({ me }: { me: MeData }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    try {
      await apiPatch("/api/me", {
        name: f.get("name"),
        jobTitle: f.get("jobTitle") || "",
        bio: f.get("bio") || null,
      });
      toast(t("profile.saved"), "success");
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError && err.code === "forbidden" ? t("forbidden") : t("common.error"), "error");
    } finally {
      setPending(false);
    }
  }

  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    setPending(true);
    try {
      await apiPost("/api/me/password", {
        currentPassword: f.get("currentPassword"),
        newPassword: f.get("newPassword"),
      });
      form.reset();
      toast(t("profile.passwordChanged"), "success");
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "internal";
      toast(code === "password.wrong_current" ? t("profile.wrongCurrent") : t("common.error"), "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 md:p-6">
      <section>
        <h1 className="mb-3 text-base font-semibold text-fg">{t("profile.title")}</h1>
        <form onSubmit={saveProfile} className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div>
            <Label>{t("auth.name")}</Label>
            <Input name="name" defaultValue={me.name} required maxLength={100} />
          </div>
          <div>
            <Label>{t("auth.jobTitle")}</Label>
            <Input name="jobTitle" defaultValue={me.jobTitle ?? ""} maxLength={60} placeholder={t("auth.jobTitlePlaceholder")} />
          </div>
          <div>
            <Label>{t("profile.bio")}</Label>
            <Textarea name="bio" defaultValue={me.bio ?? ""} maxLength={500} rows={3} />
          </div>
          <Button type="submit" disabled={pending}>
            {t("task.save")}
          </Button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-fg">{t("profile.changePassword")}</h2>
        <form onSubmit={changePassword} className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div>
            <Label>{t("profile.currentPassword")}</Label>
            <Input name="currentPassword" type="password" required autoComplete="current-password" />
          </div>
          <div>
            <Label>{t("auth.password")}</Label>
            <Input name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
            <p className="mt-1 text-[10px] text-muted">{t("auth.passwordRule")}</p>
          </div>
          <Button type="submit" disabled={pending}>
            {t("profile.changePassword")}
          </Button>
        </form>
      </section>
    </div>
  );
}
