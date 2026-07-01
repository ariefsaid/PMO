# SPIKE: agent-native as a colocated agent-engine sidecar for PMO

**Date:** 2026-07-01 · **Type:** investigation/design spike (no running PoC — this env can't host a
Nitro server; the deliverable is this doc + a turnkey pilot plan). · **Extends:** ADR-0040 (Option B).
**Question:** Can we adopt Builder.io's **agent-native** *whole* (config-over-fork, upstream-upgradeable)
as a **colocated sidecar** (`pmo/agent-native/`) that gives PMO a first-class **agent citizen** — a peer
interaction surface, not a chatbot — while keeping our stack and the deputy/RLS tenancy invariant?

**Method:** all facts fetched **live 2026-07-01** from `raw.githubusercontent.com/BuilderIO/agent-native`,
`registry.npmjs.org`, and the GitHub API (the marketing docs site 403'd bots; the repo's canonical MDX
source was used instead). Full cited findings: agent research run, this session.

---

## TL;DR RECOMMENDATION

> **Feasible, but a scoped PILOT — not a "config-over-fork, adopt whole" bet.** The deploy target (Node
> VPS behind a same-origin proxy) is first-class, the chat UI embeds as **real in-tree React components**
> (not an iframe, not the coding-agent package we'd mis-scoped), and the **server-side BYOA hook** is
> exactly the seam to verify a Supabase JWT. **But** agent-native runs **its own Drizzle-managed Postgres
> schema** (a second data layer), the deputy invariant is **hand-built** (identity is normalized, not
> raw-JWT-forwarded), and the project churns at **~4 releases/day pre-1.0** — so "upstream-upgradeable"
> means "pin hard and budget for breaking changes," not "free updates." Do the pilot before committing.

Two corrections to our prior mental model (ADR-0040 / last session), both material:
1. **Cloudflare Workers is out** — `@agent-native/core` hard-depends on `better-sqlite3` (native), which
   V8 isolates can't run. Confirms the **Node VPS** target and kills the free-Workers question entirely.
2. **We'd been eyeing the wrong UI.** `code-agents-ui` is a *coding-agent* workspace (Claude-Code-style),
   and is 404 on npm today. The product chat surface is `@agent-native/core/client` — **`<AgentSidebar>` /
   `<AssistantChat>`, in-tree React 19, no iframe.** Embedding is *more* tractable than ADR-0040 assumed.

## Findings (decision-relevant)

### Runtime & deploy — ✅ good fit
- Nitro-based (`nitro 3.x`, `h3 2.x`), Node `>=22`. Deploy presets: **Node (default)**, Vercel, Netlify,
  Cloudflare Pages, AWS Lambda, Deno Deploy. A **Node server on a VPS is explicitly documented**, with a
  **Docker Compose + Caddy self-host runbook** (`node .output/server/index.mjs`, `PORT`, `DATABASE_URL`).
- **Cloudflare Workers ✗** — `better-sqlite3 ^12.8.0` is a **hard** (non-optional) core dep → breaks any
  V8-isolate runtime. (`node-pty` is an optional native peer for the terminal feature — off by default.)
- **Decision: run it as a Node process on the existing VPS, fronted same-origin via a Cloudflare Pages
  Function that proxies `/agent/*` and forwards the `Authorization` header.** No new domain, no Workers.

### Data model — ⚠ a second data layer, not a passthrough
- agent-native is **Drizzle-required for its OWN framework state** (chat threads, settings, extensions,
  action routes, secrets). Even in embedded mode it "uses the configured `DATABASE_URL` to manage its own
  framework tables" — recommended a **dedicated schema/DB**. Dialect auto-detected; **Supabase/Postgres is
  explicitly supported** (point it at a second schema in the same Supabase instance, or a separate DB).
- **Domain data is not forced through Drizzle.** `defineAction`'s `run(args, ctx)` is arbitrary Node — an
  action can call PMO's existing `src/lib/repositories/*` / Supabase client for business data. That's the
  path that keeps PMO the domain-data authority. But it's **application code you write**, not a documented
  "external-data-source adapter."
- **Net cost:** you operate agent-native's own Postgres schema *alongside* PMO's — a real second data layer
  to migrate/back up/secure, even though domain reads/writes still go through PMO.

### Auth & the deputy invariant — ✅ achievable, ⚠ hand-built (this is the security crux)
- **BYOA is first-class:** `createAgentNativeEmbeddedPlugin({ auth: async (event) => ({userId, email,
  orgId, orgRole}) | null })` — a **server-side** hook (the docs are explicit: "Do not pass identity from
  the browser as the source of truth"). **This is where PMO verifies the Supabase JWT and maps its claims.**
- Resolved identity flows into every action as `ctx.userEmail` / `ctx.orgId` / `ctx.caller` (and it is
  "**NEVER** defaulted to a dev identity"). So an action always knows *who* — you enforce per-user scoping
  inside `run()`.
- **But identity is normalized, not the raw JWT.** To act **as the caller against Supabase RLS**, you must
  either (a) stash the raw Supabase JWT in the session during `auth()` and thread it into `run()` to build
  a caller-scoped Supabase client, or (b) mint a Supabase-scoped token from `ctx` per call. Either way the
  **deputy invariant is code you build + must test** — it is not automatic.
- agent-native's `needsApproval` is a **human-in-the-loop UX gate** (fails closed on throw), *not* a
  cryptographic authz boundary — same principle as PMO's `can()` (UX) vs RLS (authority). **RLS remains the
  enforcement ceiling.** This is *safer* than ADR-0040's Option-B fear (their `.rls()`-or-leak Drizzle
  discipline): here PMO's own RLS still guards domain data, because domain calls go through PMO, not their
  Drizzle layer.
- **Required gate on any pilot:** a deputy-invariant test — the agent path carries the real caller identity
  and is **denied a cross-tenant/cross-user read *and* write** — plus a guard that no domain action reaches
  data on a privileged (service-role) path.

### UI embeddability — ✅ better than feared
- Product chat components live in `@agent-native/core/client`, **in-tree React (no iframe):** `<AgentSidebar>`
  (toggle side panel — the 80% case), `<AgentPanel>` (raw tabs), `<AssistantChat>` (custom chrome; accepts a
  **custom `AgentChatRuntime`** — a seam to bring your own agent backend), `<AgentNativeEmbedded>`
  (batteries-included, built on `AgentSidebar`). A separate **iframe** mode exists for arms-length/cross-origin
  sidecars, and the docs actually *recommend iframe-first* for fully decoupled products.
- **Not** the coding-agent `code-agents-ui` package (that's a Claude-Code-style workspace; 404 on npm today).
- Integration risk drops: `<AgentSidebar>` wrapping the PMO shell is a documented "add to existing app" path
  (`embedding-sdk.mdx` "batteries-included plugin") — no "frame owns the whole app" requirement.

### Maturity — ⚠ the dominant strategic risk
- `@agent-native/core` **0.84.7**, published **today**; **509 versions since 2026-03-12** (~4/day; **7 today**).
  MIT. 3.2k★. **Pre-1.0, no stable line.** "config-over-fork, upstream-upgradeable" is optimistic at this
  velocity — treat every release as potentially breaking; **pin exact versions, never track `latest`**;
  budget recurring upgrade toil. This is the single biggest reason to pilot-then-decide, not adopt-whole.

## Why this still clears the bar (the pull is real)

Option A (our shipped edge-fn deputy) is a solid *conversational tool-runner* but it is **not** the
agent-citizen paradigm — the persistent peer surface with its own runtime, skills, dispatch, and evolving
capability. If that paradigm is the goal (owner's stated pull), hand-rolling it is the wrong tool, and
agent-native is the only credible "buy the engine" option (ADR-0030 posture). The findings say the *shape*
fits (Node VPS, in-tree UI, BYOA hook, domain actions → PMO Supabase). The open questions are cost
(second data layer), the hand-built deputy invariant, and churn — all **pilotable**.

## Recommended pilot (time-boxed; the go/no-go gate)

Runs in a **local/VPS session** (not this container). Throwaway until it earns promotion.

1. **Colocate** `pmo/agent-native/` as a Nitro service consuming `@agent-native/core` at a **pinned exact
   version**; point its `DATABASE_URL` at a **dedicated schema** in the local Supabase Postgres.
2. **Deploy shape:** run as a Node process; front it same-origin via a CF Pages Function proxy (`/agent/*`),
   forwarding `Authorization`. (Local: the Vite dev proxy.)
3. **BYOA:** implement `auth(event)` to **verify the Supabase JWT** and map `→ {userId,email,orgId,orgRole}`;
   stash the raw JWT for caller-scoped domain calls.
4. **One deputy-bound action:** a `defineAction` whose `run()` calls an existing `src/lib/repositories/*`
   function **as the caller** (caller-scoped Supabase client). Prove a domain read + a write.
5. **Embed** `<AgentSidebar>` inside a copy of the PMO shell (React 19); confirm it coexists with PMO's nav.
6. **GATE (required):** the deputy-invariant test — real identity carried; **cross-tenant read AND write
   denied**; no service-role domain path. Plus: measure the upgrade toil (bump a week of releases, count breaks).

**Decision after the pilot:** *adopt whole* (colocated, pinned, with an upgrade cadence) vs *cherry-pick the
pattern* (borrow the `AgentChatRuntime`/action shape, keep our edge-fn engine) vs *stop*. Do **not**
pre-commit to whole-adoption before the gate + the churn measurement.

## Open decisions for the owner

- **Green-light the pilot** as the next slice (local/VPS session), or hold?
- **Second data layer** — acceptable to run agent-native's own schema alongside Supabase? (Its framework
  state must live somewhere; there is no zero-DB mode.)
- **Churn appetite** — willing to own a pinned-version upgrade cadence for a 0.x dep on the tenancy-critical
  path? This is the real cost of "stays upgradeable."
