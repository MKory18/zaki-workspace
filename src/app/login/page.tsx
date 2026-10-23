import { AuthForm } from "@/components/auth-form";
import { registrationOpen } from "@/server/services/orgs";
import { log } from "@/server/log";

export default async function LoginPage() {
  // On a brand-new installation (no company yet) the page offers the one-time set-up.
  let firstRun = false;
  try {
    firstRun = await registrationOpen();
  } catch (err) {
    log.error("login.first_run_check_failed", { name: err instanceof Error ? err.name : "unknown" });
  }
  return <AuthForm mode="login" firstRun={firstRun} />;
}

// never cached: the auth shell changed over time and browsers kept a
// year-long s-maxage copy of the prerendered HTML
export const dynamic = "force-dynamic";
