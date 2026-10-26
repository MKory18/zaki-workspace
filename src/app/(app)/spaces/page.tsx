import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import { getServerT } from "@/lib/i18n/server";
import { fmtNumber } from "@/lib/format";
import { goHref } from "@/lib/space-link";
import { currentSpace } from "@/server/services/current-space";
import { mayOverview, spacesOverview } from "@/server/services/spaces-overview";
import { UnplacedPanel } from "@/components/unplaced-panel";
import { SpaceDeleteButton } from "@/components/space-delete-button";

export const metadata = { title: getServerT().t("spaces.overview.title") };

/**
 * «كل المساحات» — the owner's and the admins' look over every space they can open: a card per space with what is
 * open, late and waiting there, and the way in. Entering a space (`/go`) opens its «اليوم»; nothing of its work
 * is shown here. Under the cards, «أشيا قديمة بلا مساحة»: what has no space yet, moved from here into one. Anybody
 * else is sent to their «اليوم».
 */
export default async function SpacesPage() {
  const { t } = getServerT();
  const { actor } = await pageActor();
  if (!mayOverview(actor)) redirect("/");
  const [cards, here] = await Promise.all([spacesOverview(actor), currentSpace(actor)]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 md:px-6 md:py-6">
      <header>
        <h1 className="text-xl font-semibold text-fg">{t("spaces.overview.title")}</h1>
        <p className="text-sm text-fg-muted">{t("spaces.overview.hint")}</p>
      </header>
      {cards.length === 0 ? (
        <EmptyState title={t("shell.spaces.empty")} hint={t("spaces.overview.empty_hint")} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((s) => (
            <li key={s.id} className="relative">
              {/* the OWNER deletes a space with its work (never «الشركة» or a department's space) */}
              {actor.role === "OWNER" && s.kind === "STANDARD" ? (
                <div className="absolute end-2 top-2 z-10">
                  <SpaceDeleteButton id={s.id} name={s.name} />
                </div>
              ) : null}
              <a href={goHref(s.id)} className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                <Card className="h-full transition-colors hover:border-accent/40">
                  <CardBody className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span aria-hidden="true" className="text-xl leading-none">{s.emoji ?? "🗂️"}</span>
                      <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
                        <bdi>{s.name}</bdi>
                      </h2>
                      {s.id === here?.id ? (
                        <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent">
                          {t("spaces.overview.here")}
                        </span>
                      ) : null}
                    </div>
                    <dl className="grid grid-cols-4 gap-2 text-center">
                      <Stat label={t("spaces.overview.open")} value={s.open} />
                      <Stat label={t("spaces.overview.overdue")} value={s.overdue} tone={s.overdue > 0 ? "danger" : undefined} />
                      <Stat label={t("spaces.overview.unread")} value={s.unread} tone={s.unread > 0 ? "accent" : undefined} />
                      <Stat label={t("spaces.overview.members")} value={s.members} />
                    </dl>
                    <p className="text-xs font-semibold text-accent">{t("spaces.overview.enter")}</p>
                  </CardBody>
                </Card>
              </a>
            </li>
          ))}
        </ul>
      )}
      <UnplacedPanel spaces={cards.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "accent" }) {
  return (
    // the term first (as a list of terms wants), drawn under its number
    <div className="flex flex-col-reverse rounded-xl bg-surface-2 px-1 py-2">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={tone === "danger" ? "text-lg font-bold text-danger" : tone === "accent" ? "text-lg font-bold text-accent" : "text-lg font-bold text-fg"}>
        {fmtNumber(value)}
      </dd>
    </div>
  );
}

export const dynamic = "force-dynamic";
