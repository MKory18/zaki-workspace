import * as approvalsRoute from "@/app/api/approvals/route";
import * as approvalRoute from "@/app/api/approvals/[id]/route";
import * as decideRoute from "@/app/api/approvals/[id]/decide/route";
import * as cancelRoute from "@/app/api/approvals/[id]/cancel/route";
import * as resubmitRoute from "@/app/api/approvals/[id]/resubmit/route";
import * as approversRoute from "@/app/api/approvals/approvers/route";
import * as formsRoute from "@/app/api/approval-forms/route";
import * as formRoute from "@/app/api/approval-forms/[id]/route";
import * as submitRoute from "@/app/api/approval-forms/[id]/submit/route";
import * as archiveRoute from "@/app/api/approval-forms/[id]/archive/route";
import * as featuresRoute from "@/app/api/settings/features/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * Fixtures and route wrappers for the approvals tests (kept apart from helpers.ts: that file belongs to the harness).
 *
 * One company with a person of every rank, a space they work in (the admin is its ADMIN, the guest is in it as a partner), a person
 * who works only in ANOTHER space, and a second company.
 */

export const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;

export async function approvalsWorld() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const lead = await makeUser({ orgId, role: "LEAD", name: "Lead" });
  const member2 = await makeUser({ orgId, role: "MEMBER", name: "Member2" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const ws = await makeWorkspace(
    orgId,
    [
      { userId: t.admin.id, role: "ADMIN" },
      { userId: lead.id },
      { userId: t.member.id },
      { userId: member2.id },
      { userId: t.guest.id, role: "GUEST" },
    ],
    "مساحة الموافقات",
  );
  // a space the outsider works in alone (and the member too): the people of `ws` are not in it
  const other = await makeWorkspace(orgId, [{ userId: outsider.id }, { userId: t.member.id }], "مساحة أخرى");
  // a different company altogether
  const foreign = await makeTeam();
  const foreignWs = await makeWorkspace(foreign.org.id, [{ userId: foreign.member.id }], "مساحة غريبة");
  jar().set(SPACE_COOKIE, ws.id);
  return { ...t, orgId, lead, member2, outsider, ws, other, foreign, foreignWs };
}
export type AWorld = Awaited<ReturnType<typeof approvalsWorld>>;

type Json = Record<string, unknown> | null;
export const messageOf = (res: { json: Json }) => res.json?.["message"] as string | undefined;
export const detailKey = (res: { json: Json }) => (res.json?.["details"] as { message: string; path: string }[] | undefined)?.[0]?.message;
export const detailPath = (res: { json: Json }) => (res.json?.["details"] as { message: string; path: string }[] | undefined)?.[0]?.path;
export const approvalOf = (res: { json: Json }) => res.json?.["approval"] as Record<string, any>;

export const create = (body: Record<string, unknown>) => call(approvalsRoute.POST, { body });
export const list = (query = "") => call(approvalsRoute.GET, { url: `http://localhost/api/approvals${query}` });
export const read = (id: string) => call(approvalRoute.GET, { params: { id } });
export const decide = (id: string, decision: "APPROVE" | "REJECT" | "CHANGES", reason?: string) => call(decideRoute.POST, { params: { id }, body: { decision, ...(reason !== undefined ? { reason } : {}) } });
export const cancel = (id: string) => call(cancelRoute.POST, { params: { id }, body: {} });
export const resubmit = (id: string, body: Record<string, unknown> = {}) => call(resubmitRoute.POST, { params: { id }, body });
export const approvers = (workspaceId: string) => call(approversRoute.GET, { url: `http://localhost/api/approvals/approvers?workspaceId=${workspaceId}` });
export const flip = (key: string, on: boolean) => call(featuresRoute.PATCH, { method: "PATCH", body: { key, on } });

export const createForm = (body: Record<string, unknown>) => call(formsRoute.POST, { body });
export const listForms = (workspaceId: string) => call(formsRoute.GET, { url: `http://localhost/api/approval-forms?workspaceId=${workspaceId}` });
export const readForm = (id: string) => call(formRoute.GET, { params: { id } });
export const editForm = (id: string, body: Record<string, unknown>) => call(formRoute.PUT, { method: "PUT", params: { id }, body });
export const fill = (id: string, body: Record<string, unknown>) => call(submitRoute.POST, { params: { id }, body });
export const archiveForm = (id: string, archived: boolean) => call(archiveRoute.POST, { params: { id }, body: { archived } });

/** A request, asked by `as` (signed in for the call), to these approvers in order. Returns its id. */
export async function ask(w: AWorld, as: { id: string }, approverIds: string[], over: Record<string, unknown> = {}): Promise<string> {
  await loginAs(as.id);
  const res = await create({ workspaceId: w.ws.id, title: "شراء جهاز", details: "جهاز جديد للمكتب", approverIds, ...over });
  if (res.status !== 201) throw new Error(`could not ask: ${res.status} ${res.text}`);
  return approvalOf(res)["id"] as string;
}

/** A finished upload of this person, as the chat's upload route leaves it (a CHAT file with its bytes "on disk"). */
export async function makeUpload(orgId: string, uploaderId: string, name = "عرض-سعر.pdf", createdAt = new Date()) {
  return db.storedFile.create({
    data: { orgId, uploaderId, familyId: `f-${Math.random().toString(36).slice(2)}`, name, path: `chat/${Math.random().toString(36).slice(2)}`, mimeType: "application/pdf", size: 1234, purpose: "CHAT", createdAt },
  });
}

export const bell = (userId: string, type: string) => db.notification.findMany({ where: { userId, type }, orderBy: { createdAt: "asc" } });

/** A form of the space, with the preset chain, as the manager would write it. */
export const leaveForm = (approverIds: string[], over: Record<string, unknown> = {}) => ({
  name: "طلب إجازة",
  description: "إجازة سنوية أو مرضية",
  schema: {
    fields: [
      { id: "f1", type: "choice", label: "نوع الإجازة", required: true, options: ["سنوية", "مرضية"] },
      { id: "f2", type: "date", label: "من تاريخ", required: true },
      { id: "f3", type: "number", label: "عدد الأيام", required: true, min: 1, max: 30 },
      { id: "f4", type: "textarea", label: "السبب", required: false },
      { id: "f5", type: "yesno", label: "سلّمت عملي", required: false },
      { id: "f6", type: "text", label: "رقم للتواصل", required: false },
    ],
    approvers: approverIds,
  },
  ...over,
});
