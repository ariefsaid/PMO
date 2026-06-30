# SDD: Agent Runtime Seam + `agent-chat` deputy loop (A1)

**Feature:** The PMO-owned agent-runtime **port** (`AgentRuntime` + `AgentAction`), the **`PmoNativeRuntime`** client adapter, and a streaming **`agent-chat` Supabase Edge Function** running a multi-turn deputy loop with ONE read-only action over the whitelisted entities.
**Spec ID prefix:** AR
**ADR refs:** ADR-0040 (in-app agent panel — Option A behind a B-shaped agent-runtime seam; the §"Decision (refined…) — A1" governs this spec), ADR-0036 (deputy model §2, four ceilings §3), ADR-0039 (PMO-native agent + untrusted-output boundary — the I5 deputy/handler/CI pattern this spec mirrors), ADR-0010 (test pyramid), ADR-0016/0017 (FE authz + repository seam), ADR-0001 (org_id seam).
**Status:** Draft — 2026-06-30
**Author:** Director (Claude Opus 4.8)

---

## 1. Context and Job Story

### Scope: A1 ONLY (the foundation)

ADR-0040 chose **Option A behind a B-shaped agent-runtime seam** and split the build into A1–A4. This spec
covers **A1 only**: the runtime **port**, the **`AgentAction`** contract, the **`PmoNativeRuntime`** client
adapter, and the streaming **`agent-chat`** edge function exposing **one read-only action**. A1 is **backend
+ port + adapter**, unit-tested with the Anthropic SDK and the network **mocked** (no live LLM call in CI —
exactly the I5 / ADR-0039 decision-7 isolation).

**A1 explicitly does NOT cover** (deferred to later issues):

- The **chat panel UI** (`AssistantPanel` drawer, ⌘J, transcript rendering, token-budget UI) → **A2**.
- **Write** `AgentAction`s through repositories/RPCs + the `confirm:true` → `needs-approval` approve/deny UX → **A3**.
- The **`compose_view`** action wired to the I3 renderer artifact slot → **A4**.
- The **`AgentNativeRuntime`** sidecar adapter (the second adapter behind the same port) → **B-adapter, deferred** (gated on a custom domain + the §8 sidecar decision).
- Conversation **persistence** (a `agent_runs` / transcript table) — A1 keeps a run in-memory for the duration of one HTTP stream; durable run history is a later concern (flagged AR-OD-005).

### Job to be Done (job-story row added to `docs/jtbd.md` — "Agent assistant", "Personal / composed views" group)

> **When** I'm working in PMO and have a question about my own data or want something built,
> **a user (any role)** wants to ask their agent in plain language and have it act within exactly what
> they're allowed to see and do,
> **so they** get answers/actions without leaving the app or exceeding their access.

A1 delivers the **read half** of this job (explore my own data, deputy-bound) and the **seam** every later
half (write, compose) plugs into.

---

## 2. Functional Requirements

Conventions: requirements are **EARS** (ubiquitous / event-driven `When…` / state-driven `While…` /
conditional `Where…` / optional). Tags: **[PORT]** PMO-owned seam · **[FN]** edge function · **[ADAPTER]**
`PmoNativeRuntime` · **[ACT]** the read action.

### 2.1 The runtime port `AgentRuntime` **[PORT]**

**FR-AR-001** (ubiquitous)
The system SHALL define a PMO-owned port module at `pmo-portal/src/lib/agent/runtime/port.ts` exporting the
`AgentRuntime` interface, the `AgentRun` / `AgentRunStatus` / `AgentEvent` / `AgentEventType` types, the
`AgentAction<I>` contract, and the `DeputyContext` / `RunContext` types. **No PMO code outside this directory
SHALL import any concrete adapter (`PmoNativeRuntime`, future `AgentNativeRuntime`) directly** — the panel
(A2) and all callers depend on the `AgentRuntime` interface only (the anti-corruption seam, ADR-0040).

**FR-AR-002** (ubiquitous)
The `AgentRuntime` port SHALL expose exactly these four operations (a clean *superset* of `agent-native`'s
`code-agents-ui` Run/Transcript/Control surface named in ADR-0040):

```ts
type AgentRunStatus = 'queued' | 'running' | 'paused' | 'needs-approval' | 'completed' | 'errored';
interface AgentRun { id: string; title: string; status: AgentRunStatus; progress?: number }

type AgentEventType = 'user' | 'assistant' | 'tool' | 'artifact' | 'status' | 'system'; // ⊇ their set
interface AgentEvent {
  id: string;
  runId: string;
  type: AgentEventType;
  text?: string;
  payload?: unknown;      // tool input/result, artifact spec, status delta — type-narrowed by `type`
  createdAt: string;      // ISO-8601
}

interface RunContext { route?: string; entityId?: string }   // optional UI context hints

interface AgentRuntime {
  createRun(input: { goal: string; context?: RunContext }): Promise<AgentRun>;
  followUp(runId: string, message: string): Promise<void>;
  control(runId: string, cmd: 'pause' | 'resume' | 'cancel' | 'approve' | 'reject'): Promise<void>;
  subscribe(runId: string): AsyncIterable<AgentEvent>;
}
```

**FR-AR-003** (event-driven)
When `createRun` is called, the runtime SHALL return an `AgentRun` whose `status` is `queued` or `running`
and whose `id` is a stable identifier reused by `followUp`, `control`, and `subscribe` for that run.

**FR-AR-004** (event-driven)
When a caller `subscribe`s to a run, the runtime SHALL yield the run's `AgentEvent`s **in causal order**:
the user turn (`type: 'user'`), then the agent's interleaved `assistant` text, `tool` (call + result)
events, and a terminal `status` event whose `payload` carries the final `AgentRunStatus`
(`completed` | `errored`). A1 emits no `artifact` events (deferred to A4) and no `needs-approval` status
(deferred to A3 write actions).

**FR-AR-005** (state-driven)
While a run is in progress, `control(runId, 'cancel')` SHALL request cancellation of that run; the runtime
SHALL emit a terminal `status` event (`errored` or `completed`, implementation-defined for cancel) and stop
yielding further events. In A1, `pause`/`resume`/`approve`/`reject` MAY be accepted as no-ops that resolve
without effect (they become meaningful in A2/A3); `cancel` SHALL be honored.

### 2.2 The `AgentAction` contract **[PORT]**

**FR-AR-006** (ubiquitous)
The system SHALL define the `AgentAction<I>` contract — **one action definition, deputy-bound** (PMO's
invariant) and `defineAction`-shaped (agent-native's idiom, so a future adapter registers the same action):

```ts
import type { ZodType } from 'zod';
interface DeputyContext {
  /** ALWAYS the verified caller JWT (deputy auth). Adapters MUST populate this; never service_role. */
  jwt: string;
  userId: string;          // verified auth.uid()
  orgId: string;           // derived from profiles under the caller JWT (ADR-0039 §2)
  supabase: SupabaseLike;  // a caller-JWT-scoped client — RLS is the ceiling
}
interface AgentAction<I> {
  name: string;
  description: string;
  schema: ZodType<I>;                                  // identical role to agent-native defineAction `schema`
  surfaces?: ('ui' | 'agent' | 'mcp' | 'cli')[];       // A1 ships `['agent']`
  confirm?: boolean;                                   // true → emits `needs-approval` (A3); A1 actions are read-only ⇒ false
  run: (input: I, ctx: DeputyContext) => Promise<unknown>;  // ctx ALWAYS carries the caller JWT
}
```

**FR-AR-007** (ubiquitous)
Every `AgentAction.run` SHALL access business data **only** through `ctx.supabase` (the caller-JWT client) or
through the `repositories` seam invoked under that client. An action SHALL NEVER receive or use a
`service_role` client. (Deputy invariant, ADR-0036 §2 / ADR-0039 §2.)

**FR-AR-008** (event-driven)
When the `agent-chat` loop exposes the registered `AgentAction`s to the model, it SHALL derive each tool's
Anthropic `input_schema` from the action's Zod `schema` (a Zod→JSON-Schema conversion), so the model's tool
catalog is **whitelist/schema-constrained by construction**, and SHALL pass the action `description`
verbatim as the tool description.

### 2.3 The single read action `query_entity` **[ACT]**

**FR-AR-009** (ubiquitous)
A1 SHALL register exactly **one** `AgentAction`: a read-only `query_entity` action whose `schema` accepts a
request constrained to the curated, RLS-scoped data surface — an `entity` that MUST be a key of
`ENTITY_WHITELIST` (`pmo-portal/src/lib/viewspec/types.ts`), a `select` subset of that entity's
`allowedColumns`, optional whitelisted `filters` (column ∈ `allowedColumns`, op ∈ `VALID_FILTER_OPS`), and an
optional `limit`. The shipped entity set is **owner-flagged AR-OD-003** (default: `projects` + `tasks`).

**FR-AR-010** (event-driven)
When `query_entity.run` is invoked, it SHALL validate the input against the entity whitelist (unknown entity
or unknown column → a structured, model-readable error result, **not** a thrown stack/SQL), then read rows
**under `ctx.supabase` (caller JWT)** so RLS scopes the result exactly as the human user, applying:
- a **hard row cap** `AGENT_READ_ROW_CAP` (default **50**, owner flag AR-OD-004) — the effective `limit` is
  `min(input.limit ?? cap, cap)`; the result SHALL never exceed the cap;
- a **statement-timeout intent** (the read is a single bounded query; see NFR-AR-PERF-002) so a runaway read
  cannot hold the function open.

**FR-AR-011** (event-driven)
When `query_entity` returns, the loop SHALL emit a `tool` `AgentEvent` whose `payload` carries the **row
count and the (capped) rows** as the tool result fed back to the model. The action SHALL return only
whitelisted columns; it SHALL NEVER return columns outside the entity's `allowedColumns`.

**FR-AR-012** (ubiquitous)
The `query_entity` action SHALL NOT perform any write, RPC mutation, raw SQL, or cross-entity join. It is a
single-entity, column-whitelisted, row-capped read. (The four ceilings, ADR-0036 §3: data ceiling = RLS,
tool ceiling = whitelist + row-cap + timeout, action ceiling = read-only, surface ceiling = `['agent']`.)

### 2.4 The `agent-chat` edge function (multi-turn deputy loop) **[FN]**

**FR-AR-013** (ubiquitous)
The system SHALL implement a Supabase Edge Function at `supabase/functions/agent-chat/index.ts` (Deno
runtime) as a server-side Anthropic call site, registered in `supabase/config.toml` as
`[functions.agent-chat] verify_jwt = false` (the handler verifies the JWT itself to return a typed 401 —
mirroring `compose-view`).

**FR-AR-014** (event-driven)
When the function receives a POST, the **`index.ts` wrapper** SHALL (mirroring `compose-view/index.ts`):
1. read the `Authorization: Bearer <jwt>` header; reject **401** if absent;
2. verify the JWT using a **service-role client** — `service_role` is used **ONLY** for `auth.getUser(jwt)`,
   never for business data;
3. build a **second, caller-JWT** Supabase client for all business data (deputy auth);
4. read `ANTHROPIC_API_KEY` from `Deno.env` (function secret — never the SPA bundle);
5. parse the body into the request contract (FR-AR-019);
6. delegate to the **pure** `agentChatHandler(req, deps)` with `{ anthropic, supabase: callerClient, userId }` injected;
7. stream the handler's `AgentEvent`s back to the client (transport per AR-OD-001).

**FR-AR-015** (ubiquitous)
The function's business logic SHALL live in a **pure, dependency-injected** module
`supabase/functions/agent-chat/handler.ts` exporting `agentChatHandler` (and helpers `buildSystemPrompt`,
the action registry, the Zod→JSON-Schema builder) — importable in Vitest (Node) with the Anthropic SDK and
Supabase client **mocked**. The `Deno.serve` wrapper (`index.ts`) is **integration-only** and carries no
unit coverage (ADR-0039 decision 7). Unit tests are co-located under `pmo-portal/src/lib/agent/*.test.ts`
and import the edge-function modules by relative path (the Vitest collection root is `pmo-portal/`).

**FR-AR-016** (event-driven)
When `agentChatHandler` runs, it SHALL, **before any model call**, gate in order (each gate returns/emits a
terminal `errored`/`401` before the first Anthropic call):
1. **401** if `userId` is empty (unverified caller);
2. derive `orgId` from `profiles` **under the caller JWT** (`.from('profiles').select('org_id').eq('id', userId).single()`); **400** on lookup failure (matching `compose-view`);
3. (optional) per-user token/turn budget guard (AR-OD-002, default off).

**FR-AR-017** (state-driven)
While the model has not produced a final text answer **and** the loop has not hit its ceilings, the handler
SHALL run a bounded **tool-use loop**: call the Anthropic Messages API (streaming) with the registered
`AgentAction`s as tools; when the model emits a `tool_use` block, dispatch to the matching `AgentAction.run`
with the `DeputyContext` (caller JWT), append the tool result as a `tool_result` turn, and re-invoke; when
the model emits a final text response with no tool call, terminate the run as `completed`.

**FR-AR-018** (ubiquitous)
The handler SHALL enforce a **hard cap on the loop**: `MAX_AGENT_TURNS` (default **8** model calls per run)
**and** `MAX_TOOL_CALLS` (default **8** per run). On reaching either cap the handler SHALL stop, emit a
terminal `status` event (`errored`, reason `TURN_CAP` / `TOOL_CAP`), and SHALL NOT call the model again.
These caps bound runaway cost (the only cost ceiling in v1 unless AR-OD-002 is enabled).

**FR-AR-019** (ubiquitous)
The function SHALL accept a JSON request body and emit a typed event/error contract defined in
`pmo-portal/src/lib/agent/runtime/transport.ts` (shared by handler and `PmoNativeRuntime`):

```ts
interface AgentChatRequest {
  runId?: string;                 // omitted on createRun; present on followUp
  goal?: string;                  // the user's message (createRun)
  message?: string;               // follow-up message (followUp)
  context?: { route?: string; entityId?: string };
}
// The streamed body is a sequence of AgentEvent (FR-AR-002); non-2xx returns a typed AgentChatError:
interface AgentChatError { status: 400 | 401 | 429 | 502; error: 'BAD_REQUEST'|'UNAUTHORIZED'|'RATE_LIMITED'|'UPSTREAM_ERROR'; detail?: string; retryAfterSeconds?: number }
```

**FR-AR-020** (event-driven)
When the Anthropic call fails (API error, timeout, network), the handler SHALL emit a terminal `errored`
status event / return **502 `UPSTREAM_ERROR`** with a generic detail, and SHALL NOT echo the raw SDK error
body to the client (scrubbed, mirroring `compose-view` AC-AS-007).

**FR-AR-021** (event-driven)
When constructing the system prompt, `buildSystemPrompt` SHALL inject only **schema metadata** — the
whitelisted entity names/columns the read action covers (from `ENTITY_WHITELIST`), the row cap, and the
deputy framing ("you act only within what this user can see; you cannot exceed their access"). It SHALL
inject **no data rows, cell values, or other users' records** (NFR-AR-SEC-005).

### 2.5 The `PmoNativeRuntime` adapter **[ADAPTER]**

**FR-AR-022** (ubiquitous)
The system SHALL implement `PmoNativeRuntime` at `pmo-portal/src/lib/agent/runtime/pmoNativeRuntime.ts`
implementing the `AgentRuntime` port. It SHALL be constructed with a function that supplies the current
caller JWT (e.g. from the Supabase session) and the `agent-chat` function URL — it SHALL NOT read or hold
any service-role key or the `ANTHROPIC_API_KEY`.

**FR-AR-023** (event-driven)
When `createRun` / `followUp` is called, `PmoNativeRuntime` SHALL POST to the `agent-chat` function with
`Authorization: Bearer <caller JWT>` and the `AgentChatRequest` body, and SHALL expose `subscribe(runId)` as
an `AsyncIterable<AgentEvent>` that **consumes the streamed response body** and yields each decoded
`AgentEvent` (the parse/transport detail isolated here per AR-OD-001).

**FR-AR-024** (ubiquitous)
`PmoNativeRuntime` SHALL be the ONLY place in the SPA that knows the `agent-chat` transport (URL, stream
framing). The panel (A2) and any other caller depend solely on the `AgentRuntime` port — swapping in
`AgentNativeRuntime` later requires **no change** to callers (FR-AR-001).

**FR-AR-025** (ubiquitous — contract test)
The system SHALL define a **port contract-test suite** (`pmo-portal/src/lib/agent/runtime/runtime.contract.ts`)
parameterized over an `AgentRuntime` factory, asserting the port's behavioral contract (createRun yields a
run id; subscribe yields ordered events ending in a terminal status; cancel terminates; followUp targets the
same run). A1 runs this suite against `PmoNativeRuntime` (with the function mocked). **Any future adapter
(`AgentNativeRuntime`) MUST satisfy the same suite** — this is the seam's enforcement that both runtimes are
interchangeable.

---

## 3. Non-Functional Requirements

### Security — `NFR-AR-SEC-###`

**NFR-AR-SEC-001** — `ANTHROPIC_API_KEY` MUST reside exclusively in the `agent-chat` Supabase function
secret. It MUST NOT appear in any committed file, the SPA/client bundle, a browser-readable env var, or a
Supabase Vault row readable by `authenticated`. A negative grep gate (no `ANTHROPIC_API_KEY` literal in
`pmo-portal/`) is a required check (AC-AR-010).

**NFR-AR-SEC-002** — **Deputy auth.** The handler MUST verify the caller JWT before any model call and reject
unauthenticated callers with 401 (no prompt injection via unauthenticated callers). `service_role` is
permitted for **one** purpose only: `auth.getUser(jwt)` to verify the inbound JWT. It MUST NEVER be used for
business data. All business data (the `profiles` org lookup, every `query_entity` read) goes through the
caller-JWT client. The `agentChatHandler` signature MUST NOT accept a `service_role` client (auditable by
the handler's `HandlerDeps` shape — no service-role parameter).

**NFR-AR-SEC-003** — **RLS is the ceiling.** Every read the agent performs is scoped by the caller's RLS
exactly as the human user. A prompt-injected "show me every org's projects" still hits the caller's RLS and
returns only the caller's rows — a nuisance, not a breach (ADR-0036 §2). The `org_id` tenancy seam (ADR-0001)
is enforced by RLS, not by the model and not by the function.

**NFR-AR-SEC-004** — **Tool resource ceiling.** The `query_entity` read MUST be whitelisted (entity ∈
`ENTITY_WHITELIST`, columns ∈ `allowedColumns`), **row-capped** (`AGENT_READ_ROW_CAP`), and bounded by a
**statement-timeout intent** — the tool ceiling of ADR-0036 §3. No raw SQL, no unbounded read, no cross-entity
join is reachable through the action.

**NFR-AR-SEC-005** — **No prompt/data-row content logged.** The function MUST NOT log prompt text, the user's
message, tool inputs, or any data rows at a verbosity that persists to Supabase logs. Only **event/turn/tool
counts and token usage** MAY be logged (mirrors ADR-0039 NFR-AS-SEC-004). The system prompt MUST contain only
schema metadata, never data rows (FR-AR-021).

**NFR-AR-SEC-006** — **Bounded turns.** The loop MUST terminate within `MAX_AGENT_TURNS` / `MAX_TOOL_CALLS`
(FR-AR-018). There is no code path that calls the model again after a cap is hit.

**NFR-AR-SEC-007** — **Port isolation (anti-corruption seam).** PMO/panel code MUST import only the
`AgentRuntime` port + the `AgentAction` contract; no caller outside `src/lib/agent/runtime/` may import a
concrete adapter. All `agent-native` coupling, when added, lives in `AgentNativeRuntime` (one file). A static
check (AC-AR-011) confirms no adapter leakage.

**NFR-AR-SEC-008** — The client MUST forward only the user's own Supabase session JWT; it MUST NOT construct,
forge, or elevate claims. The function verifies the JWT independently (mirrors ADR-0039 NFR-AS-SEC-006).

### Performance — `NFR-AR-PERF-###`

**NFR-AR-PERF-001** — The Anthropic SDK call MUST use **streaming** server-side so a long model response does
not hit the edge-function timeout; events are emitted as the loop progresses (the client transport is
AR-OD-001). In the mocked unit-test path the streaming helper resolves the mock directly (same result shape).

**NFR-AR-PERF-002** — Each `query_entity` read MUST be a single bounded query with a **statement-timeout
intent** and the hard row cap (FR-AR-010), so no single tool call can hold the function open indefinitely.

**NFR-AR-PERF-003** — The whole run MUST be bounded by `MAX_AGENT_TURNS` × the per-call budget; there is no
unbounded multi-turn path (cost + latency ceiling).

### Accessibility — `NFR-AR-A11Y-###`

**NFR-AR-A11Y-001** — A1 ships **no UI**; there are no a11y obligations in this issue. The transcript/panel
a11y (focus order, live-region announcement of streamed events, keyboard operability) is owned by **A2** and
recorded there. *(Stated explicitly so the gate isn't mistakenly applied to A1.)*

---

## 4. Acceptance Criteria

All AC are Given/When/Then and tagged to their **lowest sufficient owning layer** (ADR-0010). A1's logic
(handler, loop, action, adapter, port contract) is owned by **Vitest** with the SDK + network mocked; the
RLS/tenancy proof of the read path is owned by **pgTAP**; **e2e is deferred to A2** (no rendered surface in
A1) and noted below.

### Handler / deputy gates (Unit — Vitest, mocked Anthropic SDK + Supabase)

**AC-AR-001** (Unit) — *Happy single-turn read.*
Given a verified `userId` and a goal "how many of my projects are active?"
When the mocked model emits a `query_entity` tool call (entity `projects`) then a final text answer
Then `agentChatHandler` dispatches `query_entity` under the caller-JWT client, emits `user` → `tool` →
`assistant` → terminal `completed` `AgentEvent`s in order, and calls the Anthropic SDK exactly twice
(initial + post-tool).

**AC-AR-002** (Unit) — *Empty/unverified userId → 401 before any model call.*
Given a request with empty `userId` (unverified caller)
When the handler is invoked
Then it returns/emits **401 `UNAUTHORIZED`** and the Anthropic SDK is **not** called.

**AC-AR-003** (Unit) — *org lookup failure → 400 before any model call.*
Given the `profiles` org lookup returns an error/no row under the caller JWT
When the handler is invoked
Then it returns **400 `BAD_REQUEST`** (`detail: 'orgId'`) and the Anthropic SDK is **not** called.

**AC-AR-004** (Unit) — *Turn cap enforced.*
Given the mocked model emits a `query_entity` tool call on **every** turn (never a final answer)
When the loop runs
Then the handler stops after `MAX_AGENT_TURNS` model calls, emits a terminal `errored` status
(reason `TURN_CAP`), and the SDK is called exactly `MAX_AGENT_TURNS` times (no more).

**AC-AR-005** (Unit) — *Upstream error scrubbed → 502.*
Given the mocked Anthropic SDK throws `Error('SECRET upstream body')`
When the handler runs
Then it emits/returns **502 `UPSTREAM_ERROR`**, the response JSON does **not** contain `SECRET`, and no
`console` call contains the user's message or any data row (NFR-AR-SEC-005).

**AC-AR-006** (Unit) — *`query_entity` rejects an off-whitelist read (model-readable, no throw to client).*
Given the mocked model emits a `query_entity` call with `entity: 'secret_table'` (or a column ∉ `allowedColumns`)
When the action runs
Then it returns a **structured error tool-result** (not a thrown stack/SQL), the loop feeds it back to the
model, and **no** Supabase read for `secret_table` is attempted.

**AC-AR-007** (Unit) — *Row cap enforced.*
Given the caller-JWT client returns more rows than `AGENT_READ_ROW_CAP` for a `query_entity` read
When the action runs
Then the emitted `tool` result contains **at most `AGENT_READ_ROW_CAP` rows** and only whitelisted columns.

### Action — DI / deputy (Unit — Vitest)

**AC-AR-008** (Unit) — *Action uses the caller-JWT client only.*
Given a `query_entity` action invoked with a `DeputyContext`
When `run` executes
Then every Supabase access goes through `ctx.supabase` (the injected caller-JWT client); the `HandlerDeps` /
`DeputyContext` shape has **no** service-role field (compile-time + assertion), proving the deputy invariant
by construction.

### Adapter + port contract (Unit — Vitest, `agent-chat` mocked)

**AC-AR-009** (Unit) — *`PmoNativeRuntime` satisfies the port contract.*
Given `PmoNativeRuntime` constructed against a mocked `agent-chat` (a fake streamed body of `AgentEvent`s)
When the **shared port contract suite** (FR-AR-025) runs against it
Then createRun yields a run with an id; `subscribe` yields the events in order ending in a terminal status;
`control('cancel')` terminates the stream; `followUp` targets the same run id. *(This same suite is the gate
any future `AgentNativeRuntime` must pass.)*

### Static / build gates

**AC-AR-010** (Unit/CI grep gate) — *No API key in the bundle.*
Given the repo
When a grep for `ANTHROPIC_API_KEY` runs over `pmo-portal/`
Then there are **zero** matches (the key lives only in the `agent-chat` function secret) — NFR-AR-SEC-001.

**AC-AR-011** (Unit/lint gate) — *No adapter leakage.*
Given the SPA source
When a static check scans imports
Then **no module outside `src/lib/agent/runtime/`** imports `pmoNativeRuntime` (or a future
`agentNativeRuntime`) directly; callers import only `port.ts` — NFR-AR-SEC-007.

### RLS / tenancy proof of the read path (Integration — pgTAP)

**AC-AR-012** (Integration — pgTAP) — *The read action cannot exceed RLS (cross-tenant read returns nothing).*
Given two orgs A and B and a user in org A
When a `projects` / `tasks` read is executed under user-A's JWT/role (the exact RLS-scoped path the
`query_entity` action uses) filtered toward org-B rows
Then **zero org-B rows** are returned — RLS is the ceiling regardless of any model-supplied filter
(NFR-AR-SEC-003, ADR-0001 tenancy seam). *(Proven at the DB layer because that is where the guarantee lives;
the action adds no privilege.)*

### Deferred (noted, not owned by A1)

**AC-AR-013** (E2E — **deferred to A2**) — The end-to-end "open the panel, ask a question, see the streamed
answer" journey is owned by **A2** (the panel issue) and authored as `e2e/AC-AR-013-*.spec.ts` there, with
the `agent-chat` function mocked via `page.route` (no live Anthropic). *Listed here for traceability; A1 does
not implement it.*

---

## 5. Test Layering & Traceability (ADR-0010)

Each AC is owned by **one** test at the lowest sufficient layer. The owning test names its `AC-AR-###` in its
title (Vitest `it(...)` / pgTAP leading token) for `grep`-able traceability.

| AC-### | Layer | Tool | Intended owning test file |
|---|---|---|---|
| AC-AR-001 | Unit | Vitest (mocked SDK + Supabase) | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AR-002 | Unit | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AR-003 | Unit | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AR-004 | Unit | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AR-005 | Unit | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-AR-006 | Unit | Vitest | `pmo-portal/src/lib/agent/queryEntityAction.test.ts` |
| AC-AR-007 | Unit | Vitest | `pmo-portal/src/lib/agent/queryEntityAction.test.ts` |
| AC-AR-008 | Unit | Vitest | `pmo-portal/src/lib/agent/queryEntityAction.test.ts` |
| AC-AR-009 | Unit | Vitest (mocked `agent-chat` stream) | `pmo-portal/src/lib/agent/runtime/pmoNativeRuntime.test.ts` (runs `runtime.contract.ts`) |
| AC-AR-010 | Unit/CI | grep gate (script or test) | `pmo-portal/src/lib/agent/noApiKeyInBundle.test.ts` |
| AC-AR-011 | Unit/lint | import-boundary static check | `pmo-portal/src/lib/agent/runtime/portIsolation.test.ts` (or an ESLint `no-restricted-imports` rule) |
| AC-AR-012 | Integration | pgTAP (`supabase test db`) | `supabase/tests/agent_query_entity_rls.test.sql` |
| AC-AR-013 | E2E | Playwright | **deferred to A2** — `e2e/AC-AR-013-*.spec.ts` |

**CI constraint (mirrors ADR-0039 decision 7):** `agent-chat` runs in **Deno**; its handler/action/prompt
modules MUST be pure, DI, importable in Vitest (Node) with the SDK + Supabase mocked. The `Deno.serve`
wrapper (`index.ts`) and `deno.json` are integration-only, excluded from the pmo-portal tsconfig/Vitest
graph. **No live Anthropic call and no function deploy in CI.** `npm run verify` (typecheck + lint + Vitest +
build) is the pre-push gate; the pgTAP read-path proof (AC-AR-012) runs in the PR→`main` `integration` job.

---

## 6. Owner-Decision Flags (defaults applied — nothing blocks the plan)

| Flag | Decision | **Default applied** | Impact |
|---|---|---|---|
| **AR-OD-001** | Stream transport for the run: **SSE** (`text/event-stream`) vs **chunked NDJSON** (one `AgentEvent` JSON per line over a chunked body) | **Chunked NDJSON** | Simpler than SSE to produce in Deno and to parse in the SPA adapter; both are isolated in `PmoNativeRuntime` + `transport.ts`, so swapping to SSE later is a one-file change. (SSE buys auto-reconnect we don't need for a single run.) |
| **AR-OD-002** | Per-user token/turn **budget guard** on/off in v1 (the injected `RateGuard`-style interface) | **Off in v1** (interface present + injectable, like I5's `RateGuard`) | With it off, runaway cost is bounded only by `MAX_AGENT_TURNS` / `MAX_TOOL_CALLS`. Enabling later is config, not a rewrite. Revisit before multi-tenant rollout. |
| **AR-OD-003** | Which **1–2 entities** the `query_entity` read ships with | **`projects` + `tasks`** | The two highest-value "my data" entities for the job story (delivery questions). Adding more = extending the schema list, no code-shape change. `tasks` carries the `requiredFilter: project_id` whitelist rule, exercising that path. |
| **AR-OD-004** | The hard **row cap** `AGENT_READ_ROW_CAP` | **50** | Caps tokens fed back per tool call and bounds blast radius; raise if answers get truncated in the field. |
| **AR-OD-005** | **Persist** runs/transcript to a table in A1 (durable history) vs in-memory per HTTP stream | **In-memory (no persistence) in A1** | A1 keeps a run alive only for one stream; durable `agent_runs`/transcript is a later concern (needed once the panel keeps history across navigation — A2+). Avoids a migration + RLS table in the foundation issue. |

---

## 7. Open Questions for the Director (≤5, each with a recommendation)

1. **Turn/tool cap values (8/8).** Are `MAX_AGENT_TURNS = 8` and `MAX_TOOL_CALLS = 8` the right ceiling for a
   read-only assistant? **Recommendation: ship 8/8** — generous for single-entity reads, still a hard cost
   bound; tune from real transcripts. (Set as named consts so a change is one line.)

2. **`followUp` within one HTTP request vs a new request per turn.** ADR-0040's port has `createRun` +
   `followUp`; with **no persistence in A1 (AR-OD-005)**, a follow-up has no server-side run to resume.
   **Recommendation: in A1, `followUp` opens a fresh `agent-chat` request that replays prior turns from the
   client transcript** (the SPA holds the transcript in A2); durable server-side runs land with AR-OD-005's
   persistence in a later issue. Confirm this is acceptable for A1's port contract.

3. **Zod as a runtime dep in the edge function.** `AgentAction.schema` is a `ZodType`; the Deno function needs
   Zod (via `npm:zod`) to derive `input_schema` and validate tool input. **Recommendation: add `npm:zod` to
   `agent-chat/deno.json`** (Deno-only, NOT `pmo-portal/package.json`) — Zod is already a SPA dep, so the port
   types share it; the Deno function imports it independently, like the Anthropic SDK. Confirm.

4. **Statement-timeout mechanism.** FR-AR-010 states a statement-timeout *intent*; Supabase/PostgREST doesn't
   expose a per-request `statement_timeout` from the JS client cleanly. **Recommendation: realize the ceiling
   in A1 via the hard row cap + the loop's wall-clock bound (the function timeout), and file a follow-up to
   add a DB-side `statement_timeout` on the agent read role if/when the read surface widens.** Confirm this is
   sufficient for the foundation, or require a DB-side timeout now.

5. **Does the read action reuse `compileCompositionSpec`/`querySpec` or a slimmer schema?** The I5 compiler
   already validates a whitelisted `QuerySpec`. **Recommendation: A1 defines a *slim* `query_entity` Zod schema
   (entity + select + filters + limit) validated against `ENTITY_WHITELIST` directly, rather than pulling in
   the full `CompositionSpec` compiler** — the action needs raw rows, not a compiled panel, and a slim schema
   keeps the tool surface (and the model's job) minimal. Confirm, or prefer reusing the compiler's
   `QuerySpec` validation for a single source of truth on column whitelisting.

---

## 8. Out of Scope (explicit — owned by later A-issues)

- Chat panel UI / `AssistantPanel` drawer / ⌘J / transcript rendering / token-budget UI → **A2**.
- Write `AgentAction`s + `confirm:true` → `needs-approval` approve/deny UX (SoD/RLS-enforced) → **A3**.
- `compose_view` action + `artifact` events → I3 renderer slot → **A4**.
- `AgentNativeRuntime` sidecar adapter + its contract-test run → **B-adapter, deferred** (custom domain + sidecar gate).
- Durable run/transcript persistence + history across navigation → later (AR-OD-005).
- Any Anthropic API call outside `supabase/functions/agent-chat/`.
