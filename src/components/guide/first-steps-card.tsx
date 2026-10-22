import { cookies } from "next/headers";
import { requireActor, type Actor } from "@/server/policy/actor";
import { getFirstSteps } from "@/server/services/first-steps";
import { parseFirstStepsCookie } from "./first-steps-cookie";
import { FirstStepsCardClient } from "./first-steps-client";

/**
 * «خطواتك الأولى»: the card for a new account, for the Today page to mount (`<FirstStepsCard />`,
 * or `<FirstStepsCard actor={actor} />` when the page already has the actor).
 *
 * The steps are computed here, on the server, from real data for the signed-in person (see
 * services/first-steps.ts); the browser part adds what only the device knows - the app installed,
 * the guide opened - and remembers, per device and per person, whether the card is folded or
 * hidden. Whether it is open, folded or hidden is read here from the `zk-fs` COOKIE, so the first
 * HTML already shows the card in its state and the page's task list does not jump. It carries the
 * tour hook first-steps, and it draws nothing once every step is done.
 */
export async function FirstStepsCard({ actor }: { actor?: Actor }) {
  const who = actor ?? (await requireActor());
  const [{ steps }, state] = await Promise.all([
    getFirstSteps(who),
    Promise.resolve(parseFirstStepsCookie(cookies().get("zk-fs")?.value)),
  ]);
  // nothing to ask, or every step is decided by data and already done
  if (steps.length === 0 || steps.every((step) => step.done)) return null;
  return <FirstStepsCardClient userId={who.userId} steps={steps} initialCookieState={state} />;
}
