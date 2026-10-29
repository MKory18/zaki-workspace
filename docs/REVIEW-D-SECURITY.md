# Phase D — the doors that were open

> Phase D of the owner's review (2026-10-29). Phase A mapped the code, Phase B tested the numbers,
> Phase C tested who may do what. Phase D asks a different question: what can somebody who is NOT
> allowed in still do — an anonymous caller, a member sending a crafted request, a site the app was
> not meant to talk to.
>
> Four things were wrong and are fixed here, each with a test that failed before it. Everything else
> the phase looked at is listed below with what makes it safe, so the next reader does not have to
> rediscover it.

## 1. What was fixed in this PR

| # | Where | What was wrong | What it does now |
|---|---|---|---|
| D1 | `src/lib/space-link.ts` `safeNext` | A second, weaker copy of the redirect rule. `/go?next=%2F%09%2Fevil.example` passed it: a browser drops the tab and reads `//evil.example`, so the space switcher was an open redirect out of the site — the classic sign-in-phishing step. | `safeNext` delegates to `safeNextPath` (`src/lib/safe-next.ts`): one rule, one place. Nothing else in the app decides a `next` its own way. |
| D2 | `body-limit.ts` (new) · n8n inbound · whiteboard · the three upload routes | `await req.text()` and `await req.formData()` hold WHATEVER arrived before any check can refuse it. The n8n inbound webhook answers **without a session** and its signature covers the body, so an anonymous caller could post hundreds of megabytes into memory with no secret at all. The whiteboard read the whole body and then compared it to 4 MB, and the merged board had no total size — 5000 elements of any size each. The upload routes had no cap beyond the per-kind check that runs after parsing. | `readTextLimited` / `readBytesLimited` / `readFormDataLimited` count the stream and stop at a ceiling. The inbound webhook is capped at 1 MB → 413; the whiteboard keeps its 422 and gains `MAX_BOARD_BYTES`; the library form is capped at the 25 MB file limit plus the envelope → 413; chat at the video limit plus the envelope → 422. |
| D3 | `src/lib/security-headers.ts` (new) · `src/middleware.ts` | Nothing set any security header. The app could be put in a frame by any site (a fake sign-in laid over ours, or «offboard this person» clicked under a finger), a browser guessed types it was not told, and a page's address — ids, `?next=` — travelled to every site a link led to. | The middleware stamps every response it answers (page, redirect, refusal, API and file bytes): `x-content-type-options`, `x-frame-options: SAMEORIGIN`, `referrer-policy: same-origin`, `content-security-policy: frame-ancestors 'self'; base-uri 'self'; form-action 'self'`, a `permissions-policy` that keeps camera and microphone for this site only, and HSTS on an https visit. `frame-ancestors` is `'self'`, not `'none'`: the file preview frames its own PDF. |
| D4 | `package.json` | `nodemailer` 10.0.16 carried three `addressparser` advisories (a comment, a `;` and a `>` could move a recipient to a domain the header never named). | 10.3.0, same major, no API touched; registration mail is the only sender. `npm audit --omit=dev` no longer lists it. |

Proved by tests that failed before the change:

- **D1** — `tests/db/current-space.test.ts`: `/go?next=%2F%09%2Fevil.example` answered
  `'/\t/evil.example'`, now `'/'`.
- **D2** — `tests/body-limit.test.ts` (5, the ceiling itself), and against the real routes: a 1 MB+
  signed inbound request answered 201 and created the task, now 413 `n8n.body_too_large` with
  nothing created; a second 2 MB element on a board answered 200, now 422 `whiteboard.e.too_big`
  and the board stayed at version 1; a 27 MB library upload answered 403 with the row already
  buffered, now 413 `files.too_large` and the library stays empty.
- **D3** — `tests/security-headers.test.ts` (7): a page, an API response and a refused cross-site
  write all carry them, HSTS absent over http, the frame rule is `'self'`.
- **D4** — `npm audit --omit=dev`: 14 findings → 13, none of them nodemailer.

The whole gate set was run after these commits: `typecheck` clean, `lint` clean (only the two
pre-existing warnings), `npm test` 2248 passed, `node scripts/lint-migrations.mjs` clean
(38/38), `npm run test:db` 1703 passed, `npm run scan:secrets` clean (948 files), `npm run build`
compiled.

On Windows six unit suites and two DB suites fail to LOAD, all for the same reason — they
`import` a `scripts/*.mjs` helper and Node on Windows rejects it with `SyntaxError: Invalid or
unexpected token`. The list is `pwa-manifest`, `pwa-icons`, `migrations-lint`, `make-icons`,
`chat-structure`, `chat-data-move` (and `health-route`, which reads a local untracked
`docker-compose.override.yml`). None of them touches code changed here; CI on Linux is the
verdict.

## 2. What the phase checked and found already correct

| Area | Where | Why it holds |
|---|---|---|
| The cross-site write guard | `src/middleware.ts`, `src/lib/origin-guard.ts` | A write is refused unless the `Origin` matches the host (or the configured public address), decided on the CANONICAL path — percent-escapes decoded, dot segments resolved — because Next's router resolves `/%61pi/...` to `/api/...`. Tests: `middleware-canonical-path`, `middleware-origin`. |
| Session cookies | `src/lib/session-token.ts`, `src/server/auth.ts` | `httpOnly`, `sameSite=lax`, `secure` in production, and `tv` (the token version) is compared to the database on every request: suspending, offboarding, a password reset or «log out everywhere» kills every older cookie at once. |
| Redirects on the server | `src/middleware.ts`, `src/lib/safe-next.ts` | With `APP_URL` set, a forwarded host that is not the configured one redirects to `APP_URL` itself, never to a host a client chose. |
| Injected HTML | whole source | No `dangerouslySetInnerHTML` anywhere; every value React renders is escaped, and the only frame is the file preview's own PDF. |
| SQL | `src/server/**` | Every raw statement goes through Prisma's tagged template (`$queryRaw`) — parameters are bound, never concatenated. No string-built SQL. |
| Uploads | `src/server/files/sniff.ts`, `services/files.ts` | The bytes decide the type (`magic bytes`), the client's claim is ignored, SVG is never accepted (script in an image), `text/plain` is the fallback. A file row exists only after its bytes are on disk. |
| Serving bytes back | `api/files/[id]/raw`, `api/chat/attachments/[id]` | `nosniff`, the stored type, `Content-Disposition` with an RFC 5987 filename, ranges answered 206 with the exact `Content-Range` or 416. |
| Google OAuth | `services/google.ts` | The `state` parameter is signed and bound to `orgId` + `userId`; a callback for another organisation or another person is refused. |
| Outbound URLs (SSRF) | `src/server/net-guard.ts`, `services/integrations.ts`, `services/n8n.ts` | An admin's webhook must be public https, no credentials, and a name that only RESOLVES to a private, loopback, CGNAT, link-local or metadata address is refused — checked at save AND again right before delivery. Redirects are not followed (`redirect: "manual"`) and the request aborts after 5 s. |
| Webhook signatures | `src/server/webhook-signing.ts` | `sha256=HMAC(secret, "<timestamp>.<raw body>")`, constant-time compare, ±5 minutes (seconds and milliseconds both accepted, because the OMS sends one and we the other), over the timestamp text exactly as it arrived. |
| Integration status payloads | `services/n8n.ts`, `services/google.ts`, `services/integrations.ts` | The n8n status answers `sharedSecret: "__stored__"` and hides the URL and event list from anybody without `integrations.manage`; the Google status carries no token; a GUEST gets 403. |
| Registration | `services/registration.ts` | A one-time token of 32 random bytes, stored only as `sha256`, 24 hours; every address gets the same 202 (no enumeration); a per-address limit and a server-wide cap on top. |
| Telegram | `src/app/api/integrations/telegram/*` | No inbound webhook route exists: the bot is outbound only, so there is nothing to forge a request to. |
| Calls | `src/server/calls/livekit.ts` | A join grant lives 120 s and is bound to that one room and that one person. |
| Web Push | `src/server/calls/push.ts` | Unsubscribing is scoped to the caller's own subscription; no key of another person is reachable. |
| Drive proxy | `src/server/files/drive-store.ts` | Every request is built from fixed Google hosts, and the file id goes through `encodeURIComponent`. |
| Sign-in limits | `src/server/login-guard.ts`, `src/server/rate-limit.ts` | Per (address, account) pair and per address, and `X-Forwarded-For` is read from the RIGHT by `TRUSTED_PROXY_HOPS` entries, so a client cannot choose the address it is counted as. |

## 3. Found, written down, and NOT changed here

⚠️ **D5 — `next` 14.2.35 carries a critical advisory; the fix is Next 16.**
`npm audit` refuses 14.x and offers only `next@16.4.3`, three majors up: async `params`, `after()`,
`unstable_*` — every page and route would have to be re-read against a different framework, and this
repository is deliberately on 14.2.
🔧 Treat it as a planned migration with its own branch, its own gate run and a written rollback
(the previous image), not a version bump inside a security PR. What reduces the exposure today is
already in place: `images.remotePatterns` were never configured (no proxy to abuse),
`poweredByHeader` is off, and D3 now adds the frame and type rules.

⚠️ **D6 — `zod` 3.25.76 can exhaust memory on an oversized constrained collection.**
The advisories are fixed in zod 4, which changes the error shapes (`ZodError.issues`, `flatten`,
the `.error` message contract) that `withApi` and every API test read.
🔧 The migration is a branch of its own. Meanwhile every body is bounded (D2) and the schemas that
could be forced are on routes that need a session.

⚠️ **D7 — `lodash-es`, `nanoid`, `mermaid`, `katex`, `chevrotain`: a chain, not five bugs.**
All of them reach the app only through `@excalidraw/excalidraw` (the whiteboard's browser bundle) or
through `postcss` at build time. Nothing on the server imports them.
🔧 The fix is the next `@excalidraw/excalidraw`, which is a major of its own; a forced `overrides`
pin on `nanoid` inside a third party's tree is more likely to break the board than to protect
anything. Re-check when Excalidraw releases.

⚠️ **D8 — the rate limiter is in memory.**
`src/server/rate-limit.ts` counts per process. That is correct for the way the app runs today — one
container — and it silently stops being a limit the day a second replica is added.
🔧 If a second replica is ever deployed, the counter moves to Postgres or Redis (the table/schema
question is the owner's); until then the assumption is written down here and in the file.

⚠️ **D9 — a DNS answer can change between the check and the connection (rebinding).**
`net-guard.ts` resolves the name, then `fetch` resolves it again. A DNS server that answers
differently the second time can still reach a private address.
🔧 Closing it needs a connection-level hook that pins the resolved address (an undici dispatcher) —
a new dependency. The gap needs the attacker to control the admin's own webhook domain, and
`redirect: "manual"` already removes the easy half.

⚠️ **D10 — uploads are still held in memory up to their ceiling.**
D2 bounds them (25 MB a library file, the video limit in chat) and that is what stops an anonymous
or careless caller from taking the container down. A member can still spend that much memory per
request, deliberately.
🔧 Streaming straight to disk (and to Drive) would remove even that; it is a rewrite of `ingest`, not
a line in a security PR, and it changes the failure paths the file tests pin.

✅ **D11 — the legacy `x-zaki-token` inbound path stays, on purpose.**
It is a second way to present the same shared secret, kept until every n8n workflow signs its
requests, and written down in the route's own comment. It is not a weaker secret — only a weaker
transport, because the secret travels in a header instead of proving itself through an HMAC.
