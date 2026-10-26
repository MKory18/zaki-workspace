import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { EmptyState } from "@/components/ui/card";
import { getServerT } from "@/lib/i18n/server";
import { currentSpace } from "@/server/services/current-space";
import { mayOverview, spacesOverview } from "@/server/services/spaces-overview";
import { archivedSpaces } from "@/server/services/space-manage";
import { UnplacedPanel } from "@/components/unplaced-panel";
import { ArchivedSpaces, SpacesBoard, type BoardCard } from "@/components/spaces-board";

export const metadata = { title: getServerT().t("spaces.overview.title") };

/**
 * «كل المساحات» — the owner's and the admins' look over every space they can open: a card per space with what is
 * open, late and waiting there, and the way in. Entering a space (`/go`) opens its «اليوم»; nothing of its work
 * is shown here. The cards are managed in place (drag to order, rename, archive, delete: `SpacesBoard`); under them
 * the archived spaces, and «أشيا قديمة بلا مساحة»: what has no space yet, moved from here into one. Anybody else is
 * sent to their «اليوم».
 */
export default async function SpacesPage() {
  const { t } = getServerT();
  const { actor } = await pageActor();
  if (!mayOverview(actor)) redirect("/");
  const [cards, here, archived] = await Promise.all([spacesOverview(actor), currentSpace(actor), archivedSpaces(actor)]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 md:px-6 md:py-6">
      <header>
        <h1 className="text-xl font-semibold text-fg">{t("spaces.overview.title")}</h1>
        <p className="text-sm text-fg-muted">{t("spaces.overview.hint")}</p>
      </header>
      {cards.length === 0 ? (
        <EmptyState title={t("shell.spaces.empty")} hint={t("spaces.overview.empty_hint")} />
      ) : (
        <SpacesBoard cards={cards as BoardCard[]} hereId={here?.id ?? null} manage owner={actor.role === "OWNER"} />
      )}
      <ArchivedSpaces rows={archived} />
      <UnplacedPanel spaces={cards.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}

export const dynamic = "force-dynamic";
