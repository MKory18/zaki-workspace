import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { getServerT } from "@/lib/i18n/server";
import { NotFoundError } from "@/server/auth";
import { keepInSpace } from "@/server/services/current-space";
import { readCardPage } from "@/server/services/card-page";
import { CardPage } from "@/components/cards/card-page";

/** The browser tab says «اللوحات» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("cards.title") };

/**
 * The page inside a card. Who may read it, and what they may do on it, is decided by the service from the session; a card
 * of a space the person is not in does not exist for them (404). A card of another space of theirs opens that space first,
 * so the library an upload goes to is the card's own. The OWNER reads silently: nothing is written for his reading.
 */
export default async function CardPageRoute({ params }: { params: { id: string } }) {
  const { user, actor } = await pageActor();
  let data;
  try {
    data = await readCardPage(actor, params.id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  await keepInSpace(actor, data.spaceId, `/cards/${params.id}`);
  return <CardPage initial={data} userId={user.id} />;
}

export const dynamic = "force-dynamic";
