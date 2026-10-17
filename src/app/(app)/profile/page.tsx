import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { avatarHue } from "@/lib/format";
import { ProfileForm } from "@/components/profile-form";

export default async function ProfilePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const me = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, name: true, jobTitle: true, bio: true, locale: true },
  });
  if (!me) redirect("/login");
  return <ProfileForm me={{ ...me, hue: avatarHue(me.name) }} />;
}

export const dynamic = "force-dynamic";
