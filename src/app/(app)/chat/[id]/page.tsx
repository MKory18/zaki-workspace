import { pageActor } from "@/app/(app)/_access";

/** Temporary typed route shell; Step 19 replaces this with ConversationScreen. */
export default async function ChatConversationPage({ params }: { params: { id: string } }) {
  await pageActor();
  return <section className="mx-auto max-w-3xl p-4" aria-labelledby="conversation-title"><a href="/chat" className="mb-4 inline-flex min-h-11 items-center text-sm text-accent">رجوع للدردشة</a><h1 id="conversation-title" className="text-lg font-semibold">المحادثة</h1><p className="mt-2 text-sm text-fg-muted">{params.id}</p><p className="mt-4 rounded-xl border border-border bg-surface-1 p-4 text-sm">واجهة المحادثة قيد التجهيز.</p></section>;
}
