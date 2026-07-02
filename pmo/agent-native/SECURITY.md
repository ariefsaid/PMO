# PMO agent-native — Security surface registry (E6)

> **Scope:** every caller-executing surface the embedded Nitro sidecar
> (`createAgentNativeEmbeddedPlugin`) exposes to a browser/HTTP/MCP/A2A caller,
> the deputy invariant that gates PMO business data on each, and the ADR-0039
> untrusted-output boundary. This is the **G3 upgrade-canary** reference: an
> upstream `@agent-native/core` bump that opens a hole on any surface goes RED
> in `test/deputy-surfaces.gate.test.ts` (AC-601…AC-608) before it ships.

## Pinned dependency + cadence (NFR-407 / G3)

- **`@agent-native/core` is pinned EXACT** to `0.84.8` in `package.json`
  (no `^`/`~`/`latest`). Verified installed === pinned. The framework churns
  ~4×/day pre-1.0; a bump is a deliberate, reviewed act — never transitive.
- **The upgrade canary is the gate suite**, not human review:
  `test/deputy-invariant.gate.test.ts` (the original AC-403 5/5) **plus**
  `test/deputy-surfaces.gate.test.ts` (AC-601…AC-608, added by E6). CI runs
  both on every change to `pmo/agent-native/**`. **Before bumping the pin,
  re-derive every "Exposed?" / "Auth model" cell below against the new
  `dist/**/*.d.ts` + a booted sidecar probe, and re-run the full gate.**

## Deputy model recap (the one load-bearing fact)

PMO business data is reachable **only** through the four PMO `defineAction`s
(`pmo_query`, `query_entity`, `create_activity`, `update_task_status`). Each
action resolves the caller identity **solely** from the host-owned
`AsyncLocalStorage`:

```
Authorization: Bearer <PMO jwt>
        │
        ▼
server/middleware/deputy.ts   ← GLOBAL Nitro middleware (runs before ALL /_agent-native/**)
   verifyJwt (service_role: auth.getUser + profiles ONLY)  →  runWithDeputy({ rawJwt, … })
        │
        ▼  (ALS entered for the whole downstream async chain)
server/actions/*.ts
   const jwt = getCallerJwt()        ← undefined ⇒ refuse (NO_CALLER_IDENTITY)
   const caller = createCallerClient(jwt)   ← anon key + caller JWT ⇒ RLS resolves as caller
```

`service_role` is constructed in **exactly one** place (`createVerifierClient`
in `server/lib/supabase.ts`) and used **only** for `auth.getUser` + a `profiles`
identity read inside `verifyJwt`. **No business path constructs or imports a
service_role client** (proven by the static scan in AC-606 / gate-4). RLS is the
enforcement ceiling; the FE/middleware may be stricter.

Because every PMO action funnels through this **one** deputy seam, the
invariant holds on **every** surface that can reach a PMO action — direct,
MCP, A2A, embed fetch — as long as the seam itself is intact. AC-606 is the
canary that fires if an upstream bump (or a new PMO action) bypasses it.

## Surface registry

Each row is asserted empirically in `test/deputy-surfaces.gate.test.ts`
(tagged `AC-6xx`). "Caller-executing" = a remote caller can drive code that
could touch PMO data.

| # | Surface | Route(s) | Exposed? | Auth model | Deputy-safe? | AC |
|---|---------|----------|----------|------------|--------------|----|
| 1 | `defineAction` (data) | `POST /_agent-native/actions/{pmo_query,query_entity,create_activity,update_task_status}` | **Yes** (PMO actions wired in `server/plugins/agent-native.ts`) | Framework session gate (401 anon) **+** deputy ALS (`getCallerJwt`) | **Yes** — deputy + RLS; cross-tenant read/write denied (AC-403 gate-1/2) | AC-601, AC-606 |
| 2 | MCP tool server | `POST /_agent-native/mcp` (JSON-RPC, streamable-HTTP) | **Yes** (mounted by `createAgentChatPlugin` → dynamic `mountMCP`) | Protocol handshake (`initialize`/`tools/list`) is **unauthenticated**; tool execution resolves caller via agent-native's own request-context | **Yes** — PMO actions are **NOT** in the MCP tool catalog (compact/connector catalog only: `list_apps`, `open_app`, `create_embed_session`, `ask_app`, `ask_app_status`, `tool-search`); `tools/call pmo_query` → `Unknown tool`. Even if a future full-surface token surfaced them, the action still requires `getCallerJwt()` (deputy ALS) → RLS enforces. | AC-602 |
| 3 | A2A JSON-RPC | `POST /_agent-native/a2a` | **Yes** (mounted by `createAgentChatPlugin` → dynamic `mountA2A`) | `message/send` requires a valid caller identity — unauthenticated ⇒ `no authenticated user`; a PMO Supabase jwt is **not** an A2A-signed token ⇒ `Invalid or expired A2A token`. Public A2A skills (`filterPublicAgentActions`) require `publicAgent.expose && readOnly && !requiresAuth && !isConsequential` — **no PMO action opts in**. | **Yes** — no PMO action is a public A2A skill; `message/send` rejects unauthenticated and non-A2A tokens; if reached via a configured `A2A_SECRET` + A2A token, the agent loop invokes PMO actions through the same deputy seam → RLS enforces. | AC-603 |
| 4 | Agent card (public metadata) | `GET /.well-known/agent-card.json` | **Yes** (public, no auth — by design) | None (public discovery doc) | **Yes** — public metadata only; `filterPublicAgentCardSkills` drops per-user/per-org MCP entries (anti-fingerprinting); PMO has **no** public A2A skills, so no PMO tenant data is disclosed. (In the Nitro dev server this path is shadowed by the SPA fallback and serves `text/html`; either way it carries **no** PMO tenant identifier.) | AC-604 |
| 5 | `defineClientAction` (browser) | host-page bridge (not an HTTP route) | **No** — PMO registers **zero** client actions | n/a | **Yes** — the canary (AC-605) **fails on ANY `defineClientAction(`** across `pmo/agent-native/**` source **and** `pmo-portal/src/**` (allow-list empty today), so no client action can slip past it. If a future PMO client action needs PMO data, it MUST round-trip through a server `defineAction` (deputy seam) — client actions run in the browser with no server-confirmed identity. | AC-605 |
| 6 | MCP Connect / OAuth (browser) | `GET /_agent-native/mcp/connect`, `POST /_agent-native/mcp/oauth`, `/.well-known/oauth-*` | **Yes** (explicit `coreRoutes: {}` — **ON, not a default**; positive probe AC-601 asserts `mcp/connect` + oauth-authorization-server metadata respond ≠404) | OAuth device-code / authorization-server metadata; token endpoints are single-use-code / refresh-token gated | **Yes** — these are connection/onboarding + OAuth-metadata routes; they do **not** execute PMO tools. They are session-gated where they approve user access. No PMO business data crosses them. | AC-601 |
| 7 | Resources CRUD | `/_agent-native/resources/**` | **Yes** (explicit `resources: true` — **ON, not a default**) | Framework session gate (401 anon) | **Yes** — operates on agent-native's **own** `agent_native` schema tables (framework resources), **never** PMO's `public` schema. Cross-schema isolation proven by AC-403 gate-5. | AC-601 |
| 8 | Core routes (poll/events/ping/health/app-state/open/embed) | `/_agent-native/{poll,events,ping,health,application-state,open,embed}/**` | **Yes** (explicit `coreRoutes: {}` — **ON, not a default**; positive probe AC-601 asserts `health`=200 + `ping` mounted/gated) | Mixed: `health` public; others session-gated | **Yes** — framework plumbing only; no PMO business path. | AC-601 |
| 9 | Embed fetches (same-origin) | browser → `/_agent-native/**` via `ensureEmbedAuthFetchInterceptor` | **Yes** | Bearer = PMO session jwt, attached same-origin | **Yes** — every embed fetch lands on the routes above; the **global** deputy middleware runs first on all of them, so the same deputy invariant applies. | AC-606 |

**Surfaces NOT mounted** (set **explicitly OFF** in `createAgentNativeEmbeddedPlugin`
— NOT left to upstream defaults): `org` (org management), `onboarding`,
`integrations` (messaging), `terminal`. Each is a **negative probe** in AC-608:
an **authenticated** caller gets **404** on each surface's routes (the global
session gate 401s anon on ALL `/_agent-native/**` — even fake routes — so only
an authenticated 404 proves "not mounted"; the authenticated resources +
defineAction 200s are the control). They stay off until a future issue
explicitly opts in, at which point a new AC-6xx row + gate assertion lands here
**before** enable.

## ADR-0039 — untrusted-output validation boundary (E6 task #3)

ADR-0039 (`docs/adr/0039-pmo-native-agent-untrusted-output-boundary.md`) holds
that **all model-authored output is untrusted until a PMO-owned validator
approves it before render/execute**, and that the validator is enforced
server- **and** client-side.

**Status on the sidecar (E1+E2 surface):** the four PMO actions return **only
plain structured data** — `{ rows }`, `{ row }`, `{ id }`, `{ taskId, status }`.
None emits a render/execute payload (no HTML, no JSX, no SQL, no
`CompositionSpec`/viewspec, no `core.*` action-ui renderer directive). How that
data is *rendered* is **agent-native's own renderer** (the framework's
`action-ui`/`data-widgets`/`McpAppRenderer`) — that is the framework's trust
surface, not PMO's. **agent-native's own rendering is theirs; PMO-controlled
outputs are ours**, and today PMO controls **no** render/execute output through
the sidecar.

- Therefore **no ADR-0039-style validator is needed in the sidecar yet** —
  proven by AC-607 (static scan: PMO actions emit no renderer/composition/HTML
  artifact payload).
- The PMO-controlled composition validator (the I2 `compileCompositionSpec`
  boundary) is owned by **`pmo-portal`** and is tracked separately as the
  plan's **AC-417** (`pmo-portal/src/lib/agent-native/outputValidator.ts`). It
  is out of scope for this sidecar issue.
- **Forward rule (binding):** if a future PMO action begins emitting
  model-authored render/execute output through the sidecar (e.g. a
  composition/artifact/HTML payload), it MUST cross a PMO-owned validator
  before the framework renders it, and a new AC-6xx assertion + this row must
  land in the same PR. AC-607 is the canary that fires if such an output
  appears unvalidated.

## How to re-derive this registry on a pin bump

1. `npm ci` against the new exact pin; `npx tsc --noEmit`.
2. Boot the sidecar (`npm run dev`), then probe every route in the table with
   `curl` (no-auth, fake-bearer, valid-PMO-jwt) — record the status + body.
3. Re-read `dist/server/embedded.js` + `dist/server/agent-chat-plugin.js` to
   confirm which plugins `createAgentNativeEmbeddedPlugin` mounts and whether
   `mountMCP`/`mountA2A` are still invoked by the agent-chat plugin.
4. `npx vitest run` — **both** gate files must stay green. Any RED is a
   regression in the deputy invariant or an unplanned new surface; resolve
   before merging the bump.
