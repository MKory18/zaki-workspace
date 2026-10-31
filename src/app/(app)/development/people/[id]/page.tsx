import { pageActor } from "@/app/(app)/_access";
import { PersonFile, tabOf } from "@/components/team-development/person-file";

/**
 * «ملف الأداء والتطوير» of one person. The person themselves, their supervisors and the owner open it; anybody else, a guest and
 * the company with the feature switched off get «not found» (never «forbidden»). The body is `PersonFile`.
 */
export default async function PersonDevelopmentPage({ params, searchParams }: { params: { id: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const { actor } = await pageActor();
  return <PersonFile actor={actor} userId={params.id} tab={tabOf(searchParams?.["tab"])} basePath={`/development/people/${params.id}`} query={searchParams} />;
}

export const dynamic = "force-dynamic";
