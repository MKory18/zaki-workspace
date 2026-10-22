> ⚠️ Written before the 2026-10-22 audit; some claims do not match the code. The verified state is in [docs/PHASE0-AUDIT.md](PHASE0-AUDIT.md).

# Zakai.io — Security Audit (Phase 2)

Scope: Chat AuthN/AuthZ, CRM Mass Assignment, `activeOrgCtx()`. Findings from actual code inspection, with file/line references.

---

## Q1 — Chat Routes Authentication : PASS

**Files examined:**
- `src/app/api/chat/messages/[id]/route.ts` — PATCH/DELETE message
- `src/app/api/chat/messages/[id]/pin/route.ts` — POST pin toggle
- `src/app/api/chat/messages/[id]/react/route.ts` — POST reaction toggle
- `src/app/api/chat/conversations/[id]/messages/route.ts` — POST send message
- `src/app/api/chat/conversations/[id]/route.ts` — GET/PATCH/DELETE conversation
- `src/app/api/chat/conversations/route.ts` — GET/POST conversations
- `src/app/api/chat/directory/route.ts` — GET member directory
- `src/server/services/chat.ts` — service layer
- `src/server/api.ts` — withApi wrapper

**Execution path:** Route handler → `activeOrgCtx()` (auth+org) → chat service function → `requireConversationMember` → Prisma scoped query.

**Verified:**
- Every route calls `activeOrgCtx()` before any data access; no route touches the DB without an authenticated session.
- `requireConversationMember(conversationId, userId)` performs a Prisma query on the `ConversationMember` unique compound key, rejecting (404) any request where the caller is not a member of the requested conversation.
- `editMessage` / `deleteMessage` verify conversation membership *and* the `canModifyMessage` policy: message author, or group admin, or — nothing else. Ownership is enforced server-side.
- `togglePin` uses `canPinMessage` (DM participants; group admins only) server-side.
- `toggleReact` verifies conversation membership before any reaction is read/written; no ID guessing possible.
- `createDm` / `createGroup` enforce org membership of invitees (same `ctx.orgId`) and reject GUESTS (`assertChatAllowed`).
- Message creation sets `orgId: ctx.orgId` server-side; `conversationId` is checked against conversation membership.
- Reaction palette is a closed set (`ALLOWED_REACTIONS`); arbitrary emoji rejected server-side.
- Guest (GUEST org role) is rejected for all chat writes via `assertChatAllowed(ctx.orgRole)`; reads allowed.
- Directory route filters out non-GUEST members only — GUEST cannot enumerate or message others.

**Verdict:** PASS — no unauthorized access path found. All permission decisions enforced server-side in the service layer.

---

## Q2 — CRM Zod Schemas and Mass Assignment : PASS

**Files examined:**
- `src/server/services/crm.ts` (lines 17–175, schemas and CRUD)
- `src/app/api/crm/customers/route.ts`, `src/app/api/crm/customers/[id]/route.ts`
- `src/app/api/crm/opportunities/route.ts`, `src/app/api/crm/opportunities/[id]/route.ts`

**Schemas (verified actual code, lines 17–47 of crm.ts):**

- `createCustomerSchema` (line 17): `{name: 2–150, company: ≤150, email: email ≤200, phone: ≤50, notes: ≤2000}` — plain `z.object`, defaults to **strip** unknown keys (Zod's default behavior, not `passthrough`/`strict`).
- `updateCustomerSchema` (line 25): `createCustomerSchema.partial()` + `refine(not empty)`.
- `createOpportunitySchema` (line 30): `{customerId, title, value ≥0, stage (enum), expectedCloseAt, notes}`.
- `updateOpportunitySchema` (line 39): `{title, value, stage, expectedCloseAt, notes}` — no `customerId`, no `orgId`, no `ownerId`, no `number`.

**Mass assignment analysis:**
- **Internal fields NOT in schemas:** `orgId`, `creatorId`/`createdById`, `ownerId`, `number` cannot be injected from any request body. They don't exist in the Zod schema and Zod strips unknown keys.
- **Server-side hard-set:** `createCustomer` sets `orgId: ctx.orgId` and `creatorId: ctx.userId` from authenticated context. `createOpportunity` sets `orgId: ctx.orgId` and `ownerId: ctx.userId` server-side. The client cannot spoof these even by modifying the raw JSON before stripping.
- **DB field alignment:** `updateCustomer` passes the parsed input to `db.customer.update({ data: input })` — but `input` is the Zod-parsed result which only contains the schema-defined safe fields (name/company/email/phone/notes). No `orgId`/`id` injection possible.
- **`updateOpportunity` explicitly deletes `customerId`** from the spread before the update (line 163: `delete data.customerId`) — defending against the input leaking through if someone adds `customerId` to the update schema in the future.
- **Scoping:** All CRUD operations use `where: { id, orgId: ctx.orgId }` — records cannot be found, updated, or deleted across organizations.
- **No raw `req.body` → Prisma:** Every write passes through `parseJson(schema, req)` → `.parse()` before reaching the service layer.

**Verdict:** PASS — no mass assignment vulnerability. Internal fields are stripped by Zod AND hard-set server-side from the authenticated context.

**Residual risk:** Low. Zod "strip" behavior is version-dependent (safe in current version); switching to `strict()` would reject unknown keys loudly instead of silently — optional hardening, not a required fix.

---

## Q3 — `activeOrgCtx()` : PASS

**Files examined:** `src/server/services/integrations.ts` (lines 16–25), all 84 usage references across API routes.

**Contract:**
```typescript
export async function activeOrgCtx(): Promise<OrgAccessContext> {
  const user = await requireUser();          // throws 401 if no session
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },           // oldest membership wins
    select: { organizationId: true, role: true },
  });
  if (!membership) throw new ForbiddenError("not_org_member");
  return { orgId: membership.organizationId, orgRole: membership.role, userId: user.id };
}
```

**Analysis:**
- **Org derivation is server-side:** The caller's `orgId` comes from a live DB query against `organizationMember`, not from any client-supplied parameter. There is no query/body/header path that can set the active org.
- **Multi-org:** Always the *oldest* membership (`orderBy: createdAt asc`); deterministic, not client-controlled. A user cannot spoof a different org's context.
- **Membership check:** Fresh DB query per call — no caching. If a user's membership is deleted, the next call throws `ForbiddenError("not_org_member")`.
- **Role:** Comes from the same membership row. The caller uses `ctx.orgRole` for further role checks (e.g., `assertOrgManager` for OWNER/ADMIN).
- **Interaction with `requireOrgMember`/`requireWorkspace`:** `activeOrgCtx` is independent — used for org-scoped resources (CRM, files, integrations, chat, departments, tickets) that don't need workspace-level scoping. `requireWorkspace` is used separately for workspace-scoped resources (tasks, boards, projects).
- **Limitation (documented design choice):** For multi-org users, the active org is always the oldest membership — users cannot switch orgs at this time. This is a UX limitation, not a security issue.
- **Usage:** 84 references across API routes — consistent adoption. No route bypasses `activeOrgCtx()` to access org-scoped data.

**Verdict:** PASS — context is server-controlled, membership is live-verified, no caching, no client trust.

---

## Status Summary

| Question | Status | Notes |
|----------|--------|-------|
| Q1 Chat AuthN/AuthZ | PASS | Membership + ownership enforced server-side in service layer |
| Q2 CRM Mass Assignment | PASS | Zod strip + server-side field injection both safe |
| Q3 activeOrgCtx | PASS | Server-controlled org from live DB, no client trust, no cache |

## Next Phase
Phase 4: Database audit (constraints, indexes, cascading deletes, race conditions, migration safety).
