import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { getSessionUser } from "@/server/session";
import { safeNextPath } from "@/lib/safe-next";
import { OnboardingForm } from "@/components/onboarding-form";

/**
 * The one-time onboarding: choose your own password (when the current one is a temporary one) and
 * accept the transparency notice (when this version is not accepted yet). The middleware sends
 * every page here while the session cookie says something is owed; the app layout does the same
 * from the database. Afterwards the person continues to `?next=` (a path on this site only) or "/".
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const next = safeNextPath(searchParams["next"]);
  const user = await currentUser();
  if (!user) redirect("/login");

  if (!user.mustChangePassword && !user.transparencyPending) {
    // Nothing is owed. If the cookie still says otherwise (the notice was accepted on another
    // device), going on would bounce straight back here through the middleware: the form
    // refreshes the cookie first, then continues.
    const claims = await getSessionUser();
    if (!claims?.mcp && !claims?.tp) redirect(next);
  }

  return (
    <OnboardingForm
      name={user.name}
      owesPassword={user.mustChangePassword}
      owesNotice={user.transparencyPending}
      next={next}
    />
  );
}

export const dynamic = "force-dynamic";
