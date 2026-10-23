import { AuthForm } from "@/components/auth-form";

export default async function LoginPage() {
  return <AuthForm mode="login" />;
}

// never cached: the auth shell changed over time and browsers kept a
// year-long s-maxage copy of the prerendered HTML
export const dynamic = "force-dynamic";
