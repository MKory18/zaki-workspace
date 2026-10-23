import { AuthForm } from "@/components/auth-form";

/** Create a new organisation and become its owner. Everyone can register. */
export default async function RegisterPage() {
  return <AuthForm mode="register" />;
}

export const dynamic = "force-dynamic";
