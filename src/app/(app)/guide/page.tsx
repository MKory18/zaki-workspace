import { pageActor } from "@/app/(app)/_access";
import { searchEntries } from "@/lib/guide/articles";
import { audienceOf } from "@/lib/guide/audience";
import { getServerT } from "@/lib/i18n/server";
import { GuideSearch } from "@/components/guide/guide-search";
import { Hint } from "@/components/guide/hint";
import { OpenedGuideMark, RestoreFirstStepsButton } from "@/components/guide/first-steps-client";

/** The browser tab says «الدليل» (the root layout adds the app name). Static: it names no article. */
export const metadata = { title: getServerT().t("guide.title") };

/**
 * الدليل — short Arabic articles about what the system does, with a search box. Each person gets
 * the articles that apply to them (an external partner never sees the people, customers or files
 * material; the people article is for those who manage accounts); the level comes from the actor,
 * on the server.
 */
export default async function GuidePage() {
  const { t } = getServerT();
  const { user, actor } = await pageActor();
  const entries = searchEntries(audienceOf(actor));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 md:p-6">
      {/* opening the guide ticks «افتح الدليل» on this device */}
      <OpenedGuideMark userId={user.id} />
      <header>
        <h1 className="text-2xl font-bold text-fg">{t("guide.title")}</h1>
        <p className="mt-1 text-sm leading-7 text-fg-muted">{t("guide.subtitle")}</p>
      </header>
      <Hint id="guide-help-button">{t("guide.hint.help_button")}</Hint>
      <GuideSearch entries={entries} />
      <RestoreFirstStepsButton userId={user.id} />
    </div>
  );
}

export const dynamic = "force-dynamic";
