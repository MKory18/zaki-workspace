import { pageActor } from "@/app/(app)/_access";
import { getServerT } from "@/lib/i18n/server";
import { currentSpace } from "@/server/services/current-space";
import { listCards } from "@/server/services/cards";
import { EmptyState } from "@/components/ui/card";
import { CardsView } from "@/components/cards/cards-view";

/** The browser tab says «اللوحات» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("cards.title") };

/**
 * «اللوحات» — the cards of the space the person is in. It opens in every space (a space of the CARDS type lives here;
 * a general space simply has them too). Who may read and write is decided by the service from the session, and decided
 * again on every request the screen makes; the page only passes down what it was told.
 */
export default async function CardsPage() {
  const { t } = getServerT();
  const { user, actor } = await pageActor();
  const space = await currentSpace(actor);
  if (!space) return <EmptyState title={t("cards.no_space")} />;
  const list = await listCards(actor, space.id);
  return <CardsView spaceId={space.id} spaceName={space.name} userId={user.id} initial={list.cards} canWrite={list.canWrite} owner={list.owner} layout={space.layout} />;
}

export const dynamic = "force-dynamic";
