import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { db } from "@/server/db";
import { avatarHue } from "@/lib/format";
import { actorFeatureOn } from "@/server/services/features";
import { ProfileForm } from "@/components/profile-form";

export default async function ProfilePage() {
  const { user, actor } = await pageActor();
  const me = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, name: true, jobTitle: true, bio: true, locale: true, avatarUrl: true },
  });
  if (!me) redirect("/login");
  // «الصورة الشخصية» switched off: the form does not offer it, and the upload route answers «not found»
  const withPicture = await actorFeatureOn(actor, "avatars");
  return <ProfileForm me={{ ...me, hue: avatarHue(me.name) }} withPicture={withPicture} />;
}

export const dynamic = "force-dynamic";
