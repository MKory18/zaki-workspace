# Engineering Progress Log — Zakai.io

## 2026-10-17

### Security Audit (Session 1 — findings 1–7)
1. **orgId mutation** — `orgId` added to Zod schemas as `.optional().nullable()` and stripped before Prisma insert. Verified with `curl` sending `orgId` inside payload → DB read-back shows correct org. **PASS**
2. **Chat file access control** — `conversationId` now required in download and preview routes; both resolve the conversation and call `requireConversationMember()`; DMs/org-wide conversations enforced server-side. Non-members get `file.not_found` (404). **PASS**
3. **User-file download** — `userId` param ignored; route always uses `session.user.id`; personal files only accessible to their owner. **PASS**
4. **CSRF** — origin validation added globally (`origin-host-must-match-host`); requests from foreign origins rejected with 403. **PASS**
5. **Cookie hardening** — `sameSite: lax`, `httpOnly: true`, `secure` in production, explicit path. **PASS**
6. **Rate limiting** — login attempts limited to 5 per minute per IP (in-memory Map, resets window). 6th attempt returns 429. **PASS**
7. **Workspace isolation** — projects, tasks, conversations all scoped by `workspaceId` where required; API resolves workspace from authenticated membership, not client-supplied id. **PASS**

### Security Audit (Session 2 — findings 8–14)
8. **Conversation membership enforcement** — `requireConversationMember` now runs on every message POST/GET/PATCH; DM and org-wide verified with two accounts (member vs. non-member). **PASS**
9. **Opportunity/Ticket org scoping** — create/update validates that the referenced `customerId`/`departmentId` belongs to the caller's org; mismatch returns `crm.not_found` / `ticket.not_found`. **PASS**
10. **Task dependency cross-org guard** — `createTaskDependency` blocks linking tasks from different orgs with `dependency.not_found`. **PASS**
11. **Idea vote dedup + org check** — one vote per user per idea, and idea must belong to caller's org. **PASS**
12. **SQL injection sweep** — all raw queries use tagged templates / `$queryRaw` with parameterization (never `$queryRawUnsafe` with string interpolation). **PASS**
13. **StoredFile download via chat route** — verified content-disposition attachment, and `?disposition=inline` path requires member too. **PASS**
14. **Service-layer org scoping audit** — every service method that takes `orgId` uses it in its `where` clause; verified file-by-file for `crm.ts`, `tasks.ts`, `chat.ts`, `departments.ts`, `files.ts`, `ideas.ts`. **PASS**

### Security Audit (Session 3 — chat routes / Zod mass-assignment / activeOrgCtx / database)
15. **Chat routes auth** — all chat API routes resolve user via session (`requireAuth()`), verify org membership via `requireOrgAccess()`, and conversation membership via `requireConversationMember()`. Message edit/delete checks author id server-side. Attachments resolve through conversation membership. Verified with two accounts. **PASS**
16. **CRM Zod schemas / mass assignment** — schemas use explicit field allowlists (Zod default strips unknown keys); `orgId`, `createdById`, `ownerId` never accepted from client. Cross-org `customerId` on opportunity create returns `crm.not_found`. Integration tests run against local DB. **PASS**
17. **`activeOrgCtx()`** — resolves active org from server session (cookie), NOT from client-supplied `orgId`; verifies current membership in DB on every call; invalid/expired membership falls back to first valid org or throws `org.required`. **PASS** (verified by reading `src/server/auth.ts` + integration test)
18. **Database audit** — schema (43 models, 67 indexes), cascade integrity, migration safety (additive-only), concurrency (TaskCounter unique, fractional ordering with deterministic tiebreaker, transactions), query patterns (scoped where clauses, cursor pagination). See `docs/DATABASE_AUDIT.md`. **PASS**

### Gates after audit
- `tsc`: clean
- `vitest`: 68/68 (+ integration tests)
- `next build`: green
- Runtime: health ok, chat/CRM flows re-verified live

## Next
- Phase 5: department products (تذاكر IT داخل الأقسام) — awaiting owner "كمل".
- ZAKI AI — awaits owner LLM key.
- Google Drive — awaits OAuth credentials.
