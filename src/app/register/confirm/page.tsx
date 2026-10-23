import { RegisterConfirm } from "@/components/register-steps";

/** The mailed link lands here; nothing happens until «تأكيد» is pressed. */
export default function RegisterConfirmPage({ searchParams }: { searchParams: { token?: string | string[] } }) {
  const raw = searchParams.token;
  return <RegisterConfirm token={typeof raw === "string" ? raw : ""} />;
}

export const dynamic = "force-dynamic";
