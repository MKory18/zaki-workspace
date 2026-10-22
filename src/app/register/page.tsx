import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { registrationOpen } from "@/server/services/orgs";

/** First-run set-up only: once a company exists, accounts are created by its owner. */
export default async function RegisterPage() {
  if (!(await registrationOpen())) redirect("/login");
  return <AuthForm mode="register" />;
}

export const dynamic = "force-dynamic";
