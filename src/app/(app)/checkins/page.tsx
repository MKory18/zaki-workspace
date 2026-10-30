import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { CheckinsView } from "@/components/checkins/checkins-view";
import { getServerT } from "@/lib/i18n/server";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { getToday } from "@/server/services/checkins";
import { currentSpace } from "@/server/services/current-space";
import { actorFeatureOn } from "@/server/services/features";

/** The browser tab says «التسجيل اليومي» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("checkins.title") };

/**
 * «التسجيل اليومي» — the short daily stand-up of the space the person is in: today's form, the team's answers once they have
 * answered, and the history.
 *
 * The page decides nothing. WHO the person is comes from `pageActor()`; an external partner gets the notice; the company's
 * `checkins` switch makes the page «not found»; WHAT is read (my answer, the roster, the teammates' answers) is decided by
 * `getToday`, which refuses a person who is not in the space. The owner reads a space he is not in silently.
 *
 * It is a tab of «الشغل» (`PLACES.work`, behind its switch).
 */
export default async function CheckinsPage() {
  const { actor } = await pageActor();
  if (refusedToGuest(actor, "checkins")) return <GuestNotice />;
  if (!(await actorFeatureOn(actor, "checkins"))) notFound();
  const space = await currentSpace(actor);
  if (!space) notFound();
  try {
    const initial = await getToday(space.id);
    return <CheckinsView initial={initial} workspaceId={space.id} spaceName={space.name} />;
  } catch (err) {
    if (err instanceof ForbiddenError) return <GuestNotice />;
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}

export const dynamic = "force-dynamic";
