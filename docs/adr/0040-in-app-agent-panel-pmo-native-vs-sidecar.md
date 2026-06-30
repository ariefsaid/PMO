# ADR-0040 — The in-app agent panel: PMO-native conversational surface vs. `agent-native` sidecar

- **Status:** Proposed (decision-support — owner picks Option A or B before any build)
- **Date:** 2026-06-30
- **Deciders:** Owner, Director
- **Related:** ADR-0016 (FE authz + real-JWT), ADR-0017 (repository/API seam), ADR-0019 (server-enforced SoD), ADR-0030 (build-vs-buy vendoring), ADR-0036 (agent-native user-composed UI — §8 sidecar, §9 spike), ADR-0037 (compiler DSL), ADR-0038 (renderer executor), ADR-0039 (untrusted-output boundary, the I5 edge function).
- **External:** Builder.io `agent-native` (github.com/BuilderIO/agent-native): packages `core` (runtime), `code-agents-ui` (chat/assistant panel), `frame` (browser shell), `dispatch` (routing), `defineAction()` (one action, many surfaces).

## Context

ADR-0036 set out to make a user's agent a **same-class citizen** of PMO. We shipped the *spec-authoring* half
(I1–I5): the trusted core, the renderer (all 7 primitives), the manual builder, and a **single-shot
"Compose with AI" modal** (`AIComposerModal`) that turns one prompt into one validated `CompositionSpec`.

What we did **not** build is the defining surface of "agent-native": a **persistent, conversational agent
panel inside the app** — a place where the user *talks to their agent*, the agent *explores their data and
takes actions* (not just composes a view), and *artifacts render natively* in PMO. In ADR-0036 this was the
**§8 sidecar**, explicitly deferred and gated on the §9 spike (which has since passed: Drizzle `.rls()`
parity ✓, introspect-only schema ✓, session portability ✓).

So today the agent is *a feature* (a button), not *a citizen* (a panel). This ADR compares the two ways to
close that gap and recommends one. **No code is written by this ADR** — it is the decision artifact.

### What "first-class agent panel" must do (the requirement, role-graded against `jtbd.md`)

1. **Converse** — a multi-turn assistant surface, persistent across navigation (a right-side drawer / panel in the app shell), reachable from anywhere (e.g. ⌘J or a Rail entry).
2. **Explore** — answer questions about the user's *own* data ("which of my projects are behind?") via read tools — never exceeding RLS.
3. **Act** — perform real writes through the **same** repository methods / RPCs the UI uses (create, advance, approve) — inheriting SoD + delete gating (ADR-0017/0019).
4. **Compose** — build/propose a view (the I5 path), rendered natively via the I3 renderer; agent-proposes / user-disposes for anything destructive or persisted.
5. **Stay bounded** — the **deputy invariant** (ADR-0036 §2): the agent runs as the user's own JWT; RLS is the ceiling; `service_role` is never handed to it. Prompt injection is a nuisance, not a breach.

### How `agent-native` provides this (verified against the repo)

- It is **a framework you scaffold an app *from*** (`npx @agent-native/core@latest create`), server-first on **Nitro**, DB-agnostic via **Drizzle** — not a library you drop into a React SPA.
- The agent UI = **`code-agents-ui`** (chat panel) hosted by **`frame`** (browser shell), driven by **`core`** + **`dispatch`**.
- Capabilities are **`defineAction({ schema, run })`** — one definition usable from UI click, agent tool, HTTP, MCP, A2A, CLI. One DB, one state, bidirectional.
- It supplies **parity, not tenancy/authorization** — any security guarantee is ours (the §2 deputy rule).

---

## Decision drivers

| Driver | Why it matters here |
|---|---|
| **Deputy invariant must hold** | The agent can now *write*, not just read. A privileged path here is a tenancy breach. |
| **Reuse the foundation we paid for** | RLS, the repository seam, `can()`, the I3 renderer, the I5 edge-function pattern already exist. |
| **Time-to-first-use** | Owner wants to actually click and talk to the agent. |
| **Ops surface & cost** | A second deployable + JWT bridge + a custom domain is real, recurring cost. |
| **Upstream upgradability** | `agent-native` is v0.x, weeks old (ADR-0036 maturity risk). |
| **Hosting reality** | Prod is `pmo-bfb.pages.dev` — a `*.pages.dev` origin. **Cookie-domain SSO needs a custom domain we don't have yet.** |

---

## Option A — PMO-native conversational panel (build the skin on our stack)

A persistent **assistant drawer** in the PMO shell, backed by a **multi-turn** edge function that extends the
I5 `compose-view` pattern from one-shot to a conversation with **tool use** over the curated repositories.

```
   PMO SPA (shell)                         Supabase Edge Fn: agent-chat (Deno)         Supabase (RLS)
  ┌───────────────────────┐   POST msgs   ┌────────────────────────────────────┐
  │  AssistantPanel        │──+caller JWT─►│ verify JWT → caller-JWT client      │
  │  (drawer, ⌘J)          │              │ multi-turn loop:                    │
  │   • message list       │◄─ stream ─────│  Anthropic(tools=[curated actions]) │
  │   • tool-call cards     │              │   ├─ read tool  ──► repository.list ─┼──► RLS reads
  │   • artifact slots ─────┼─► I3 renderer│   ├─ write tool ──► repository.create┼──► RLS + SoD RPC
  │   • approve/deny chips  │              │   └─ compose_view ► compileSpec ─────┤   (the boundary)
  └───────────────────────┘              └────────────────────────────────────┘
   actions surface = src/lib/repositories/* exposed as defineAction-style tools (read = auto, write = user-confirmed)
```

- **UX:** a right-side drawer (mounts in `AppShell` beside `<main>`), opened by ⌘J / a Rail "Assistant" entry; persists across routes. Read answers stream inline; **writes render an approve/deny chip** (agent-proposes / user-disposes); **composed views render in an artifact slot via the I3 renderer** (already built). Reuses `DESIGN.md` tokens → visually native.
- **Security:** identical to I5 — caller-JWT deputy client; `service_role` only verifies the JWT; **every write goes through the existing repository/RPC** so SoD + delete-gating + RLS apply unchanged; tool catalog is curated (no raw SQL); statement-timeout + row-cap on the read tool. The untrusted-output boundary (ADR-0039) still gates any spec.
- **Ops:** **zero new deployables** — one more Supabase Edge Function alongside `compose-view`. No domain, no JWT bridge, no second login.
- **Cost:** Anthropic tokens per turn (tool-use loops cost more than the one-shot composer — needs a per-user budget guard, already stubbed as `RateGuard` in the I5 handler).
- **Effort (rough):** the conversation edge fn (multi-turn + tool dispatch over repositories) + the panel UI (drawer, message list, tool-call/approval cards, artifact slot) + the write-confirmation UX + tests. Larger than one issue — a 3–4 issue mini-epic.
- **Risks:** we own the chat UX and the tool-orchestration loop; write-tools widen the agent's blast radius (mitigated: every write is user-confirmed + RLS/SoD-enforced, never agent-autonomous for destructive ops).

## Option B — `agent-native` sidecar (buy the runtime, §8)

Scaffold `agent-native` whole (its Nitro server + `code-agents-ui` + `frame`) as its own service on
`agent.<domain>`, **config-over-fork**: point Drizzle at PMO's Supabase via `.rls()`, trust PMO's Supabase
JWT, treat Supabase migrations as the single schema source (`drizzle-kit pull`, introspect-only). PMO embeds
**only** the assistant panel (subdomain + shared-cookie SSO); **artifacts still render in PMO** via the I3 renderer.

```
   PMO SPA  ──embeds panel (iframe/subdomain)──►  agent.<domain>  (agent-native: frame + code-agents-ui + core)
      │  shared Supabase session cookie (Domain=.<parent>)            │ Drizzle .rls()  (per-request JWT)
      └──────────────── artifacts render natively in PMO ◄───────────┘        │
                                                                        Supabase (same Postgres, RLS fires)
```

- **UX:** a mature, prebuilt chat panel (`code-agents-ui`) — less UX for us to build; agent capabilities via `defineAction`.
- **Security:** the §2 deputy rule holds **only** under the `.rls()` discipline — a plain (non-`.rls()`) Drizzle query connects privileged and **bypasses RLS**. Requires a lint/test guard so no raw Drizzle query ever ships. The §9 spike validated the happy path; a leak here is a tenancy breach.
- **Ops:** a **second deployable** (Nitro), a **JWT bridge**, **SSO embedding**, `.rls()` + introspect-only discipline. **Blocked today:** cookie-domain SSO needs a custom domain; prod is `*.pages.dev`.
- **Cost:** Anthropic tokens + a second always-on service to run/secure/upgrade; v0.x churn risk.
- **Effort (rough):** the spike is done; remaining = scaffold + configure the sidecar, stand up the domain + SSO cookie, embed the panel, wire `defineAction`s to PMO's data, route artifacts to the I3 renderer.
- **Risks:** young framework in a tenancy-sensitive path; ownership-inversion creep; the domain/SSO prerequisite gates first use.

---

## Side-by-side

| Dimension | A — PMO-native panel | B — `agent-native` sidecar |
|---|---|---|
| Deputy/RLS safety | Same as I5 (caller-JWT, repo/RPC writes) — **by construction** | Holds **only** with `.rls()` discipline + a no-raw-query guard |
| New deployables | **0** (one more edge fn) | **1** (Nitro service) + JWT bridge |
| Hosting prerequisite | none | **custom domain** for SSO cookie (we have none) |
| Chat UX | we build it (drawer + cards) | prebuilt (`code-agents-ui`) |
| Actions model | repositories as tools (exists) | `defineAction` (rebuild PMO's data layer in their idiom) |
| Artifacts | I3 renderer (exists) | I3 renderer (exists) |
| Time to first click | **fast** (no infra) | gated on domain + sidecar stand-up |
| Maturity risk | low (our code) | v0.x framework in prod path |
| Upstream upgrades | n/a | preserved (config-over-fork) |
| Reversibility | high (delete an edge fn + a panel) | medium (a service + domain + bridge) |

## Recommendation

**Option A (PMO-native panel).** It keeps the deputy invariant true *by construction* (the exact pattern I5
already proves), reuses everything we built (repositories, renderer, the edge-function shape), needs **no
second service and no custom domain**, and can ship now. Option B's value — a prebuilt chat UI + `defineAction`
parity — is real but is bought at a second deployable, a JWT bridge, the `.rls()`-or-leak discipline, and a
**domain prerequisite we don't currently meet**, on a v0.x framework. ADR-0030's build-vs-buy posture favors
buying an *engine*, not a *host* — and here the "engine" (the agent loop + tool dispatch) is small, while the
"host" (Nitro + Drizzle + a subdomain) is the expensive part. Revisit B if/when PMO has a custom domain and a
multi-tenant scale that justifies a dedicated agent service.

If A is chosen, the build splits into a mini-epic (each its own SDD → plan → TDD issue):
- **A1** — `agent-chat` edge fn: multi-turn loop + a **read** tool over 1–2 repositories (deputy, row-capped), streamed. (Reuses the I5 handler scaffold.)
- **A2** — `AssistantPanel` shell drawer (⌘J, message list, streaming, tokens budget guard) — design-reviewed.
- **A3** — **write** tools through repositories/RPCs with the **approve/deny** confirmation UX (SoD/RLS enforced).
- **A4** — `compose_view` tool wired to the I3 renderer artifact slot (folds the I5 composer into the conversation).

## Decision (refined per owner direction, 2026-06-30) — Option A behind a B-shaped agent-runtime seam

The choice is **not** "A *or* B" but **A now, B-ready by construction**. Build the panel ourselves (Option A,
inspired by `code-agents-ui`), but place a **ports-and-adapters / anti-corruption seam** between PMO and the
**agent runtime**, deliberately shaped to `agent-native`'s contracts. PMO code depends only on the **PMO-owned
port**; the runtime is a swappable **adapter**. So we run our deputy edge-fn today, can drop in the
`agent-native` sidecar later **without a rewrite**, and absorb upstream protocol churn in one adapter file.

Grounded in `agent-native`'s actual public type surface (`@agent-native/code-agents-ui` types), which models an
agent as **Runs + a Transcript of events + control commands**, not a plain chat: `CodeAgentRun { id, title,
status, progress }` · `CodeAgentRunStatus` (queued | running | paused | **needs-approval** | completed |
errored) · `CodeAgentTranscriptEvent { id, runId, type, text, createdAt }` (type ∈ {user, system, artifact,
status}) · `CodeAgentFollowUpRequest` (multi-turn) · `CodeAgentControlCommand` (pause/resume/cancel) ·
`CodeAgentRemoteConnector*` (the remote-runtime hook). Note `needs-approval` ≙ PMO's agent-proposes/
user-disposes; `artifact` events ≙ generative UI → the I3 renderer.

### The seam (PMO-owned port — a clean *superset* of the above)

```ts
// src/lib/agent/runtime/port.ts  — PMO owns this; nothing else imports an adapter directly.
type AgentRunStatus = 'queued'|'running'|'paused'|'needs-approval'|'completed'|'errored';
interface AgentRun     { id: string; title: string; status: AgentRunStatus; progress?: number }
type AgentEventType = 'user'|'assistant'|'tool'|'artifact'|'status'|'system';   // ⊇ their set
interface AgentEvent   { id: string; runId: string; type: AgentEventType; text?: string; payload?: unknown; createdAt: string }

interface AgentRuntime {                       // the PORT
  createRun(input: { goal: string; context?: RunContext }): Promise<AgentRun>;
  followUp(runId: string, message: string): Promise<void>;
  control(runId: string, cmd: 'pause'|'resume'|'cancel'|'approve'|'reject'): Promise<void>;
  subscribe(runId: string): AsyncIterable<AgentEvent>;        // SSE/stream of transcript events
}
```

```ts
// One action definition, both runtimes — defineAction-compatible (their idiom), deputy-bound (ours).
interface AgentAction<I> {
  name: string;
  description: string;
  schema: ZodType<I>;                          // identical to agent-native defineAction `schema`
  surfaces?: ('ui'|'agent'|'mcp'|'cli')[];
  confirm?: boolean;                           // true → emits a `needs-approval` event (approve/deny chip)
  run: (input: I, ctx: DeputyContext) => Promise<unknown>;   // ctx ALWAYS carries the caller JWT
}
```

### Two adapters behind the one port

```
  AssistantPanel ── depends only on ──►  AgentRuntime (PORT) ◄── implemented by ──┐
  (PMO UI, our build)                                                            │
                                            ┌──────────────────────────────┐    │
   TODAY  ─────────────────────────────────►│ PmoNativeRuntime              │◄───┤
                                            │  → Deno `agent-chat` edge fn  │    │
                                            │  caller JWT · RLS ceiling ·   │    │
                                            │  repo/RPC actions · SSE        │    │
                                            └──────────────────────────────┘    │
                                            ┌──────────────────────────────┐    │
   LATER (no rewrite) ──────────────────────►│ AgentNativeRuntime            │◄───┘
                                            │  → sidecar via CodeAgentRemote │
                                            │  Connector; maps AgentRun↔     │
                                            │  CodeAgentRun, AgentEvent↔     │
                                            │  TranscriptEvent, control↔     │
                                            │  ControlCommand; SSO + .rls()  │
                                            └──────────────────────────────┘
```

- **`PmoNativeRuntime`** (ships in A): POSTs to the Deno `agent-chat` edge fn — multi-turn deputy loop, the
  `AgentAction`s exposed as Anthropic tools, transcript streamed as `AgentEvent`s. Caller JWT, RLS ceiling;
  `confirm` actions surface as `needs-approval`.
- **`AgentNativeRuntime`** (later, isolated): a field-mapping onto `CodeAgentCreateRunRequest` /
  `FollowUpRequest` / `TranscriptSubscriptionBatch` / `ControlCommand` via the `RemoteConnector`; the same
  `AgentAction`s registered through their `defineAction`. Auth rides the SSO cookie + the `.rls()` discipline.

### Why this satisfies the directive
- **Maximise their capability without hindrance:** the port is a *superset* of their Run/Transcript/Action
  model — adopting the sidecar exposes their full surface through the same panel; nothing in PMO blocks it.
- **Follow upstream with abstraction:** PMO/panel import only the PMO-owned port + the `AgentAction` contract.
  All `agent-native` coupling lives in `AgentNativeRuntime` (one file); their v0.x churn is absorbed there, a
  **contract test** pins the mapping, a version bump = update one adapter, not the app.
- **Deputy invariant in both:** `DeputyContext` always carries the real caller JWT; neither adapter ever
  touches `service_role`; RLS caps both runtimes identically.
- **No premature cost:** A ships with `PmoNativeRuntime` only — zero second service, zero domain dependency.
  `AgentNativeRuntime` is built when/if a custom domain + the sidecar are green-lit; the panel is untouched.

### Build order (refined)
- **A1** — the **port** (`AgentRuntime` + `AgentAction`) + `PmoNativeRuntime` + the `agent-chat` edge fn with a
  read-only tool over 1–2 repositories (deputy, row-capped), streamed as `AgentEvent`s. *Contract tests on the
  port are written here* so any future adapter must satisfy them.
- **A2** — the `AssistantPanel` drawer (⌘J, transcript list, streaming, model/budget guard) against the port.
- **A3** — write `AgentAction`s (repo/RPC) with `confirm:true` → `needs-approval` approve/deny UX.
- **A4** — `compose_view` as an `AgentAction`; `artifact` events render via the I3 renderer.
- **B-adapter (deferred)** — `AgentNativeRuntime` + a contract-test suite proving it satisfies the same port;
  gated on a custom domain + the §8 sidecar decision. **No app/panel change required to add it.**

## Open questions for the owner
1. **Approach:** confirm A-with-the-seam (this ADR now recommends exactly that).
2. **Write scope for v1:** start **read-only** (explore + compose), add write-actions (A3) in a follow-up? (Recommended — smallest safe first cut.)
3. **Entry point:** ⌘J + a Rail "Assistant" item, or a floating button? (Recommended: ⌘J + Rail, matching the existing CommandPalette idiom.)
4. **Domain (only if B):** is a custom domain on the near-term roadmap? Without it, B's SSO cannot be exercised.

## Addendum (2026-06-30) — Can Option A reuse `agent-native`'s chat UI / template app? (owner question)

Investigated the published packages directly:

- **`@agent-native/code-agents-ui`** (the chat panel) — **public, v0.1.75**, `react`/`react-dom ^19` *peer* deps
  (PMO is React 19), UI-only direct deps (Radix, Tabler icons, sonner). On its own it looks droppable into a
  Vite SPA. **But** it has a **peer dependency on `@agent-native/core` (>=0.1.0)**.
- **`@agent-native/core`** (the runtime) — **v0.80.10**, ESM, and a **full-stack server framework**: depends on
  **nitro, h3, better-sqlite3, drizzle-orm, @libsql/client, @neondatabase/serverless** (+ express/node-pty in
  dev). It has conditional `browser`/`./client/*` exports, but the package is fundamentally **not
  browser/Vite-safe**.

**Conclusions:**
1. **"Use the template app" = Option B.** The `create` "Chat" template scaffolds a whole **Nitro** app (frame +
   code-agents-ui + core). It assumes it *owns* the app (server-first, Drizzle data). It is **not** a drop-in for
   PMO's existing Vite/Cloudflare SPA — taking it means running it as the sidecar service. So "use their
   template" is literally the §8 sidecar path, with its domain/SSO + second-deployable costs.
2. **The chat UI *component* is technically public but impractical to vendor into Option A.** Consuming
   `code-agents-ui` drags in the `core` server runtime as a peer, its own transport/protocol expectations, and a
   **v0.x, fast-moving API** (UI 0.1.75 vs core 0.80.10 — divergent release lines = high churn). Bolting it into
   PMO would mean shimming/forking around the server peer dep — which **forfeits the very upstream-upgradability
   that motivates reuse**, and lands us in the worst-of-both (their churn + our integration burden + a
   server framework in a browser bundle).
3. **Is Option A "still upstream-upgradable"? No — and that's by design.** Option A **does not depend on
   `agent-native` at all**, so there is no upstream to track: it cannot drift or break under their churn, but it
   also won't inherit their UI work for free. Upstream-upgradability of the agent UI is the distinguishing
   benefit of **Option B**, not something A can bolt on cleanly.

**Net recommendation refinement.** If **owning a stable, dependency-free agent surface now** is the priority →
**Option A** (mirror `code-agents-ui`'s UX patterns as *inspiration*, not as a dependency — it's open source).
If **inheriting Builder.io's evolving agent UI/runtime** is the priority → that is **Option B** (the template/
sidecar), and it should be taken whole (config-over-fork) once PMO has a **custom domain** for the SSO cookie.
A "hybrid" (their UI component + our edge-fn backend) is **not recommended** — the `core` server-runtime peer
dep + v0.x churn make it high-friction and self-defeating on the upgradability goal.

## Verification (of this ADR)
- Owner selects A or B; `docs/README.md` ADR range/Latest updated to include 0040.
- On selection, the chosen option's §"build splits" become SDD specs → plans → TDD issues; the deputy-invariant test (agent path carries the real JWT, denied a cross-tenant read/write) is a required gate on the first issue.
