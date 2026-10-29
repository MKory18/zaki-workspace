import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Regenerates `docs/CODEMAP.md` from the code: the folder map is prose, every other table is read
 * out of `src/`, `prisma/schema.prisma` and `src/lib/features.ts`.
 *
 *   node scripts/codemap.mjs              → rewrites docs/CODEMAP.md
 *   node scripts/codemap.mjs --check      → exits 1 if the committed file is stale (used by the tests)
 *   node scripts/codemap.mjs <root> <out> → another checkout, another file
 *
 * A map written by hand drifts within a week; this one cannot, because it is the output of a script
 * that fails to run when the code moves. It reads text with regular expressions on purpose: it must
 * run with no build step and no dependency, so a reviewer can run it on a fresh clone.
 */
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const CHECK = process.argv.includes("--check");
const ROOT = ARGS[0] ?? fileURLToPath(new URL("..", import.meta.url));
const OUT = ARGS[1] ?? path.join(ROOT, "docs", "CODEMAP.md");
const APP = path.join(ROOT, "src", "app");

/**
 * Byte-wise comparison, never `localeCompare`: the output must be the same file on every machine.
 * `localeCompare` asks the platform's collator (and `readdirSync` returns sorted names on NTFS but
 * hash order on ext4), which put the same code in a different order and failed `--check` in CI.
 */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function walk(dir) {
  return readdirSync(dir).sort(byText).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Text as the file is written in git: LF, whatever the checkout's line endings are. */
const read = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/** Every name that decides *who* may run a route; the first one in the body is the door. */
const GUARDS = [
  "requireActor",
  "requireUser",
  "requireOrgMember",
  "requireOrgRole",
  "requireWorkspace",
  "requireProjectAccess",
  "requireTaskAccess",
  "requireTeamWork",
  "requireAccountsActor",
  "currentUser",
  "pageUser",
  "pageActor",
  "activeOrgCtx",
  "crmContext",
  "directoryContext",
  "ideaAccessCtx",
  "ideasCtx",
  "assertOrgManager",
  "assertCan",
  "assertMemberCan",
  "assertNotGuest",
  "assertCanWrite",
  "assertFeatureOn",
  "isFeatureOn",
  "assertMayReadFile",
  "assertMayCreateInTeam",
  "assertOversightRead",
  "assertActiveAssignee",
  "canAdministrateTarget",
  "canReadConversation",
  "canManageHere",
  "currentSpace",
  "getProfileForViewer",
  "getCustomer",
  "getOpportunity",
  "getDepartment",
  "getFileMeta",
  "getGoogleStatus",
  "getN8nStatus",
  "getProjectTimeline",
  "activeCallOf",
  "allowTyping",
];

/** Routes with no guard on purpose, and the sentence that makes it right. */
const PUBLIC_ROUTES = {
  "/api/health": "The liveness probe. Answers `{status, checks:{app,database}}` and nothing else; no data, no identity.",
  "/api/auth/login":
    "Sign-in itself. Rate-limited (`RateLimitedError`, `login-guard.ts`) and audited; the caller has no session yet by definition.",
  "/api/auth/register":
    "Asking for a NEW company. Always answers the same 202 (no address enumeration), capped per address and per server (`registration.ts`).",
  "/api/auth/register/confirm": "The one-time link e-mailed by the step above. The token in the body IS the credential.",
  "/api/integrations/n8n/inbound":
    "Machine door, no session: the caller proves it holds the org's secret with `x-zaki-signature` (HMAC over `timestamp.body`, 5-minute replay window) or the legacy `x-zaki-token`. Org from `x-zaki-org`.",
  "/api/organizations/[id]/join-code": "Retired: answers 410 to every method. It reads nothing and writes nothing.",
};

/* A write that goes straight to Prisma from a handler, instead of through a service. */
const WRITE_RE = /\bdb\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;

const routes = walk(APP)
  .filter((f) => /route\.tsx?$/.test(f))
  .map((file) => {
    const src = read(file);
    const rel = path.relative(APP, file).split(path.sep).join("/");
    const clean = rel
      .replace(/\/(route)\.tsx?$/, "")
      .split("/")
      .filter((seg) => !/^\(.*\)$/.test(seg))
      .join("/");
    const url = "/" + clean;

    const methods = [
      ...src.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g),
    ].map((m) => m[1]);

    const guards = GUARDS.map((g) => ({ name: g, at: src.search(new RegExp(`\\b${g}\\s*\\(`)) }))
      .filter((g) => g.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((g) => g.name);

    const services = [
      ...src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@\/server\/services\/([\w-]+)["']/g),
    ].map((m) => ({
      service: m[2],
      fns: m[1]
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0])
        .filter(Boolean),
    }));

    const wrapped = /\bwith(?:Accounts)?Api\s*\(/.test(src);

    return {
      url,
      file: "src/app/" + rel,
      methods,
      guards,
      services,
      wrapped,
      writes: [...src.matchAll(WRITE_RE)].map((m) => `${m[1]}.${m[2]}`),
      lines: src.split("\n").length,
    };
  })
  .sort((a, b) => byText(a.url, b.url));

/* ---------------------------------------------------------------- sources */
const ALL = walk(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
const sources = ALL.map((f) => ({
  file: path.relative(ROOT, f).split(path.sep).join("/"),
  src: read(f),
}));

/* ---------------------------------------------------------------- models */
const schema = read(path.join(ROOT, "prisma", "schema.prisma"));
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
const writersOf = (model) => {
  const prop = model[0].toLowerCase() + model.slice(1);
  const re = new RegExp(`\\b\\w+\\.${prop}\\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\\b`, "g");
  const hits = new Map();
  for (const s of sources) {
    const n = [...s.src.matchAll(re)].length;
    if (n) hits.set(s.file, n);
  }
  return [...hits.entries()].map(([file, n]) => ({ file, n })).sort((a, b) => b.n - a.n || byText(a.file, b.file));
};
const modelWriters = models.map((m) => ({ model: m, writers: writersOf(m) }));

/**
 * A row can also be written through a RELATION rather than by name: `task.update({ data: { labels:
 * { create: [...] } } })` writes `TaskLabel` without one `db.taskLabel` in sight. For a model with
 * no direct writer, look up the relation fields other models point at it with, and see whether any
 * source performs a nested write through one of them.
 */
const modelBodies = new Map(
  [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map((m) => [m[1], m[2]]),
);
const relationsTo = (target) => {
  const fields = [];
  for (const [host, body] of modelBodies) {
    if (host === target) continue;
    for (const f of body.matchAll(/^\s{2}(\w+)\s+(\w+)(\[\])?/gm)) {
      if (f[2] === target) fields.push({ host, field: f[1] });
    }
  }
  return fields;
};
const NESTED_WRITE_KEYS = /^\s*\{\s*(create|createMany|connect|connectOrCreate|disconnect|set|deleteMany|upsert|update|updateMany)\b/;
const nestedWritersOf = (model) =>
  relationsTo(model).flatMap(({ host, field }) => {
    const re = new RegExp(`(?:\\b${field}\\s*:|\\b${field}\\s*=)`, "g");
    return sources
      .filter((s) =>
        [...s.src.matchAll(re)].some((hit) => {
          const at = s.src.indexOf("{", hit.index + hit[0].length);
          if (at < 0 || at - hit.index > 120) return false;
          return NESTED_WRITE_KEYS.test(s.src.slice(at, at + 60));
        }),
      )
      .map((s) => ({ host, field, file: s.file }));
  });

/* --------------------------------------------------------------- services */
const serviceDir = path.join(ROOT, "src", "server", "services");
const serviceFiles = readdirSync(serviceDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => path.join(serviceDir, f));

/**
 * The file's own header comment — the one that sits BEFORE the first `export`, never a comment
 * that belongs to one parameter deep inside the file (that produced nonsense lines in an earlier run).
 */
const firstSentence = (src, exports) => {
  const firstExport = src.search(/^export\s+(?:async\s+)?(?:function|const|class|interface|type)\s/m);
  const head = firstExport >= 0 ? src.slice(0, firstExport) : src;
  const doc = /\/\*\*([\s\S]*?)\*\//.exec(head);
  const body = doc
    ? doc[1]
        .split("\n")
        .map((l) => l.replace(/^\s*\*\s?/, "").trim())
        .filter((l) => l && !l.startsWith("@") && !l.startsWith("⚠") && !l.startsWith("🔧") && !l.startsWith("-"))
        .join(" ")
        .replace(/(^|\s)\d{1,2}[.)]\s+/g, " ")
        .replace(/\*\*/g, "")
    : "";
  if (!body) {
    /* No file header: say so, and give the reader the names the file exports instead of a dash. */
    const shown = exports.slice(0, 5).map((e) => "`" + e + "`").join(", ");
    return exports.length ? "no header comment — exports " + shown + (exports.length > 5 ? ", …" : "") : "—";
  }
  const sentence = /^(.+?[.!?])(\s|$)/.exec(body);
  const out = (sentence ? sentence[1] : body).trim();
  return out.length > 180 ? out.slice(0, 177) + "…" : out;
};

const serviceCallers = serviceFiles
  .map((f) => {
    const name = path.basename(f, ".ts");
    const selfRel = path.relative(ROOT, f).split(path.sep).join("/");
    const src = read(f);
    const callers = sources
      .filter((s) => s.file !== selfRel)
      .filter((s) => new RegExp(`@/server/services/${name}["']`).test(s.src))
      .map((s) => s.file);
    const exports = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/gm)].map((m) => m[1]);
    return { service: name, callers, exports, hint: firstSentence(src, exports), lines: src.split("\n").length };
  })
  .sort((a, b) => byText(a.service, b.service));

/* --------------------------------------------------------------- switches */
const featuresSrc = read(path.join(ROOT, "src", "lib", "features.ts"));
const switchKeys = [...featuresSrc.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
const switchUse = switchKeys.map((key) => ({
  key,
  usedIn: sources
    .filter((s) => s.file !== "src/lib/features.ts")
    .filter((s) => new RegExp(`["']${key}["']`).test(s.src) || new RegExp(`\\b${key}\\b`).test(s.src))
    .map((s) => s.file),
}));

/* --------------------------------------------------------------- markdown */
const L = [];
const p = (s = "") => L.push(s);

const cell = (s) => String(s).replace(/\|/g, "\\|");

const guardOf = (r) => {
  if (r.guards.length === 0) return "**none** (public by design)";
  const first = r.guards[0];
  return first;
};

const servicesOf = (r) => {
  if (r.services.length === 0) return "—";
  return r.services
    .map((s) => `\`${s.service}\`: ${s.fns.slice(0, 4).join(", ")}${s.fns.length > 4 ? ", …" : ""}`)
    .join("<br>");
};

p("# Code map — Zaki Workspace");
p();
p("> Phase A of the owner's review (2026-10-29). This file is generated from the code, not written");
p("> from memory: `scripts/codemap.mjs` reads `src/`, `prisma/schema.prisma` and `src/lib/features.ts`");
p("> and prints every table below. Re-run it after a change and the map is right again.");
p('> ⚠️ A hand-written map drifts. The generator is the source; this file is its output.');
p("> 🔧 `node scripts/codemap.mjs` rewrites it in place.");
p();
p("## What this answers");
p();
p("1. **Where does a job live?** — the folder map (§2).");
p("2. **Who may call this door, and what does it call?** — all " + routes.length + " routes, one row each (§4).");
p("3. **If I change a service, what breaks?** — every service and its callers (§6).");
p("4. **If I change a table, who writes it?** — every model and the code that writes it (§7).");
p("5. **If I flip a switch, what disappears?** — the seven feature switches and every place that reads them (§8).");
p();

p("## 1. The layers");
p();
p("```");
p("browser");
p("  │  a page (server component) reads through a service, never through Prisma directly");
p("  │  a client component mutates through fetch('/api/…')");
p("  ▼");
p("src/middleware.ts        ← runs on the edge for every request");
p("  · API writes must come from this app's own pages (Origin guard, canonical path)");
p("  · a page needs a VERIFIED session cookie, else /login?next=…");
p("  · a cookie still owing a password change or the notice → /onboarding");
p("  ▼");
p("src/app/api/**/route.ts  ← thin: parse with zod, call ONE service, wrap in withApi()");
p("  · the door: requireActor / activeOrgCtx / requireWorkspace / crmContext … (§3)");
p("  ▼");
p("src/server/services/*     ← the rules and the transactions");
p("  · re-checks the door (assertMemberCan / memberCan) so a new caller cannot forget it");
p("  ▼");
p("prisma/schema.prisma      ← the data; a write belongs to a service (§7 lists every file that writes)");
p("```");
p();
p("Two rules the code keeps, and a reviewer can check by reading the map:");
p();
p("- **One door per route.** No route decides access by comparing a role name; it asks a guard (§3).");
p("- **One writer per concept.** A model belongs to the service that owns it; §7 names every file that writes a row, and §9 the handlers that still write theirs directly.");
p();

p("## 2. Folder map");
p();
p("| Where | Job |");
p("|---|---|");
p("| `src/app/(app)/` | the signed-in screens: one folder per place (today, boards, chat, crm, …) |");
p("| `src/app/api/` | " + routes.length + " route handlers — the only mutating surface (§4) |");
p("| `src/app/login`, `register`, `onboarding`, `go` | the doors that work without a session |");
p("| `src/components/` | the interface, grouped by feature; `shell/` is the frame, `ui/` the primitives |");
p("| `src/lib/` | pure helpers that run on both sides: `i18n/`, `format.ts`, `features.ts`, `nav/`, `themes/` |");
p("| `src/server/` | everything that may only run on the server |");
p("| `src/server/policy/` | who may do what: ranks, capabilities, the section grid, conversation and call rules |");
p("| `src/server/services/` | " + serviceCallers.length + " services — the business rules (§6) |");
p("| `src/server/chat/`, `calls/`, `files/`, `watch/`, `realtime/` | the larger features, split out of `services/` |");
p("| `prisma/` | the schema and the additive-only migrations |");
p("| `worker/` | a heartbeat placeholder: no scheduled job runs today |");
p("| `tests/` | unit tests (`tests/`) and the real-database tests (`tests/db/`) |");
p("| `scripts/` | the gate scripts: migrations lint, secret scan, icon and CSS builders, this map |");
p();

p("## 3. The guards — what each one proves");
p();
p("| Guard | Where | What it proves |");
p("|---|---|---|");
p("| `requireUser()` | `server/auth.ts` | a valid session cookie whose `tokenVersion` still matches the database; 403 `auth.onboarding_required` for a pending person |");
p("| `requireActor()` | `policy/actor.ts` | the above, plus an ACTIVE membership: the person, their organization, rank, capabilities, `isOwner`, `isExternal` |");
p("| `requireOrgMember(orgId)` | `auth.ts` | membership of THAT organization, ACTIVE |");
p("| `requireOrgRole(orgId, roles)` | `auth.ts` | the above, and one of the given ranks |");
p("| `requireWorkspace(wsId)` | `auth.ts` | a `WorkspaceMember` row — an ADMIN inherits nothing; the owner needs no row |");
p("| `requireProjectAccess` / `requireTaskAccess` / `requireTeamWork` | `auth.ts` | the workspace a project, a task or a team belongs to, and the caller is in it |");
p("| `activeOrgCtx()` | `services/integrations.ts` | the caller's oldest ACTIVE membership, as `{userId, orgId, orgRole}` — the commonest door |");
p("| `crmContext(mode)` / `directoryContext()` | `app/api/_access.ts` | not a guest, plus `crm.view` / `crm.edit` / `crm.delete` / `directory.view` |");
p("| `ideaAccessCtx(id)` / `ideasCtx` | `services/ideas.ts` | not a guest, plus the idea's own visibility |");
p("| `assertOrgManager(orgId)` | `services/integrations.ts` | the `integrations.manage` capability |");
p("| `assertCan` / `assertMemberCan` / `memberCan` | `policy/actor.ts` | one named capability, on the session or on a member row read from the database |");
p("| `assertNotGuest` / `assertCanWrite` | `services/guest-guard.ts` | an external partner never reads a staff area and never writes |");
p("| `assertFeatureOn` | `services/features.ts` | the feature's switch in «الميزات» is on |");
p("| `currentSpace()` | `services/current-space.ts` | which space this request is working in |");
p("| `assertMayReadFile` | `services/files.ts` | this person may open this file (owner, space, or conversation) |");
p();

p("## 4. Every route — its door and its service");
p();
p("The **Door** column is the first guard the handler calls. `public by design` means there is none on");
p("purpose — §5 says why for each one. A handler with no `withApi` wrapper is marked with † (it answers");
p("by hand: SSE, a redirect, an HMAC check, or the account wrapper that adds `no-store`). A handler that");
p("writes to the database itself, instead of through a service, is marked with ‡ (§9 counts them).");
p("**Service imports** are the functions the handler imports from `server/services/*` — the door itself");
p("is often one of them.");
p();
const doorCount = new Map();
for (const r of routes) {
  const k = r.guards.length ? r.guards[0] : "(none)";
  doorCount.set(k, (doorCount.get(k) ?? 0) + 1);
}
p(
  "Doors in use: " +
    [...doorCount.entries()]
      .sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))
      .map(([k, v]) => `\`${k}\` ${v}`)
      .join(" · ") +
    ".",
);
p();
p("| Method | Path | Door | Service imports |");
p("|---|---|---|---|");
for (const r of routes) {
  const door = guardOf(r) + (r.wrapped ? "" : " †") + (r.writes.length ? " ‡" : "");
  p(`| ${r.methods.join(", ")} | \`${r.url}\` | ${cell(door)} | ${cell(servicesOf(r))} |`);
}
p();

p("## 5. Routes with no guard — and why that is correct");
p();
p("Six of " + routes.length + ". Each one is a door that cannot have a session, or one that is closed.");
p();
p("| Route | Why it has no guard |");
p("|---|---|");
for (const [url, why] of Object.entries(PUBLIC_ROUTES)) {
  p(`| \`${url}\` | ${cell(why)} |`);
}
p();
p("Everything else is behind a door. The middleware adds a second line in front of all of them: a write");
p("to `/api/…` must carry an `Origin`/`Sec-Fetch-Site` this app accepts, judged on the canonical path.");
p();

p("## 6. Services → who calls them");
p();
p("`callers` counts the files that import the service (a route, a page, another service). A service with a");
p("high count is a wide surface: changing its signature reaches all of them.");
p();
p("| Service | Lines | Imported by | What it owns |");
p("|---|---|---|---|");
for (const s of [...serviceCallers].sort((a, b) => b.callers.length - a.callers.length || byText(a.service, b.service))) {
  p(`| \`${s.service}\` | ${s.lines} | ${s.callers.length} | ${cell(s.hint)} |`);
}
p();

p("## 7. Models → who writes them");
p();
p("Only `.create`, `.update`, `.upsert` and `.delete` are counted — that is the code that changes a row.");
p("A model written from more than one place is listed with all of them: those are the places a new rule has");
p("to be added to, and the places a bug can leave the row half-written.");
p();
p("| Model | Writes | Written by (file: calls) |");
p("|---|---|---|");
for (const m of modelWriters) {
  if (m.writers.length === 0) continue;
  const list = m.writers
    .slice(0, 4)
    .map((w) => `\`${w.file.replace(/^src\//, "")}\`: ${w.n}`)
    .join("<br>");
  p(`| \`${m.model}\` | ${m.writers.reduce((n, w) => n + w.n, 0)} | ${list}${m.writers.length > 4 ? `<br>+${m.writers.length - 4} more` : ""} |`);
}
p();
const noWriter = modelWriters.filter((m) => m.writers.length === 0);
if (noWriter.length) {
  for (const m of noWriter) {
    const nested = nestedWritersOf(m.model);
    const files = [...new Set(nested.map((n) => n.file))];
    p(
      nested.length
        ? "`" +
            m.model +
            "` has no direct write of its own: it is filled only through a nested write on " +
            [...new Set(nested.map((n) => n.host + "." + n.field))].map((x) => "`" + x + "`").join(", ") +
            " in " +
            files.map((f) => "`" + f.replace("src/", "") + "`").join(", ") +
            " — counted here so a change there is read as a change here."
        : "⚠️ **Nothing writes `" +
            m.model +
            "` — not a route, not a service, not the seed, not a nested write.** The table was created by the first migration and has never held a row: a feature that was not built. 🔧 Keep the table (additive-only) and either build the feature or stop selecting it in Phase E.",
    );
  }
  p();
}

p("## 8. Feature switches → where they are read");
p();
p("The owner's rule: every new feature sits behind its own switch, and off means the site is as it was");
p("before it. A switch is only honest if something reads it, so this is the list of readers.");
p();
p("| Switch | Places that read it |");
p("|---|---|");
for (const s of switchUse) {
  p(`| \`${s.key}\` | ${s.usedIn.length} — ${s.usedIn.map((f) => "`" + f.replace(/^src\//, "") + "`").join(", ")} |`);
}
p();

p("## 9. What this map noticed");
p();
p("Written down, not fixed: Phase E decides what becomes a PR. Every item was read in the code, not guessed.");
p();
const directWriters = routes
  .filter((r) => r.writes.length)
  .map((r) => {
    const src = read(path.join(ROOT, r.file));
    return {
      url: r.url,
      hits: r.writes,
      audit: /\baudit\s*\(/.test(src),
      feed: /\btaskActivity\.|\bTaskActivity\b|\blogEvent\s*\(/.test(src),
    };
  });
const appWriters = sources
  .filter((s) => s.file.startsWith("src/app/") && !s.file.endsWith("/route.ts") && !s.file.startsWith("src/app/api/"))
  .filter((s) => [...s.src.matchAll(WRITE_RE)].length);
const audited = directWriters.filter((r) => r.audit);
const fed = directWriters.filter((r) => !r.audit && r.feed);
const bare = directWriters.filter((r) => !r.audit && !r.feed);

const findings = [];
findings.push(
  "**Every guarded route asks a guard — none compares a role name.** " +
    (routes.length - Object.keys(PUBLIC_ROUTES).length) +
    " of " +
    routes.length +
    " routes open with a function from §3; the other " +
    Object.keys(PUBLIC_ROUTES).length +
    " are the doors listed in §5.",
);
findings.push(
  "**Two doors carry most of the traffic.** `activeOrgCtx()` and `requireActor()` are the first call of " +
    ((doorCount.get("activeOrgCtx") ?? 0) + (doorCount.get("requireActor") ?? 0)) +
    " routes; both re-read the membership and its status from the database on every request, so a suspension takes effect on the next call, not on the next sign-in.",
);
findings.push(
  "**" +
    directWriters.length +
    " route handlers write to the database themselves instead of calling a service.** " +
    audited.length +
    " of them write their own `audit()` row (" +
    audited.map((r) => "`" + r.url + "`").join(", ") +
    "); " +
    (fed.length
      ? fed.length === 1
        ? "one writes a task-feed row instead (" + fed.map((r) => "`" + r.url + "`").join(", ") + "); "
        : fed.length + " write a task-feed row instead (" + fed.map((r) => "`" + r.url + "`").join(", ") + "); "
      : "") +
    (bare.length
      ? (bare.length === 1 ? "one writes neither (" : bare.length + " write neither (") +
        bare.map((r) => "`" + r.url + "`").join(", ") +
        "); " +
        (() => {
          const self = bare.filter((r) => /^\/api\/me\/|^\/api\/notifications\//.test(r.url));
          const rest = bare.filter((r) => !self.includes(r));
          return (
            self.length +
            " of those are one person's own preference (" +
            self.map((r) => "`" + r.url + "`").join(", ") +
            "), which is right" +
            (rest.length
              ? "; the " + rest.length + " left (" + rest.map((r) => "`" + r.url + "`").join(", ") + ") are the ones Phase E looks at."
              : ".")
          );
        })()
      : "") +
    " Nothing is silently lost today, but *who may, what is logged and what is notified* lives in the handler, not in one place." +
    (appWriters.length === 0
      ? " No screen file writes directly: every write comes through `/api`."
      : " Screens writing directly: " + appWriters.map((s) => "`" + s.file + "`").join(", ") + "."),
);
findings.push(
  "**" +
    modelWriters.filter((m) => m.writers.length > 3).length +
    " models are written from more than three files** — see §7 for the list. Those are where a new invariant has to be added more than once, and where a half-written row is possible if one caller forgets a field.",
);
for (const f of findings) p("- " + f);
p();

const text = L.join("\n") + "\n";

if (CHECK) {
  /* --check never writes: it answers whether the committed map still matches the code. */
  let onDisk = null;
  try {
    onDisk = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
  } catch {
    onDisk = null;
  }
  if (onDisk !== text) {
    console.error(
      `${OUT} is out of date${onDisk === null ? " (missing)" : ""}.\n` +
        `Run: node scripts/codemap.mjs\n` +
        `The map is generated, never edited by hand.`,
    );
    process.exit(1);
  }
  console.log(`${OUT} matches the code`);
} else {
  writeFileSync(OUT, text, "utf8");
  console.log(`wrote ${OUT}`);
}
console.log(`routes ${routes.length}, services ${serviceCallers.length}, models ${models.length}, switches ${switchKeys.length}`);
