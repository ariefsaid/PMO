# SDD: `ModelClient` — a vendor-neutral seam replacing the Anthropic-SDK-shaped seam (batteries-included A, item 1)

**Feature:** Replace the injectable `AnthropicLike` interface in `supabase/functions/agent-chat/` and
`supabase/functions/compose-view/` with a vendor-neutral `ModelClient` port (OpenAI chat-completions shape,
including tool calls + streaming), and ship an `OpenRouterModelClient` transport as the production
implementation, routed DeepInfra-first with fallbacks allowed.
**Spec ID prefix:** MC
**ADR refs:** ADR-0040 (Option A, 2026-07-03 addendum "Forward plan" item 1 — this spec implements it),
ADR-0039 (single LLM call site, untrusted-output boundary, bounded repair — unchanged, provider-swap must
preserve it), ADR-0041 (model-calling agent-action capability seam — `ComposeActionDeps.anthropic` is
renamed/retyped, not removed), ADR-0010 (test pyramid), ADR-0001 (org_id seam).
**Status:** Draft — 2026-07-03
**Author:** Director (Claude Sonnet 5)

---

## 1. Context and Job Story

### Scope: item (1) of "batteries-included A" ONLY

The agent-native sidecar pilot (PR #209, closed unmerged 2026-07-03 — ADR-0040 addendum) proved one thing
worth porting outright: the sidecar's non-Anthropic model wiring (commit `f6d6eb1`, `pmo/agent-native/`
reference archive) — `deepseek/deepseek-v4-flash` via OpenRouter, live-verified against real PMO data
(`query_entity(entity: "companies")` returned 11 org-scoped rows). PMO-native's own `agent-chat` and
`compose-view` edge functions are still hard-wired to `@anthropic-ai/sdk` (`AnthropicLike`, `messages.create`,
Anthropic content-block/tool-use shapes) at every call site. This issue cuts that cord: introduce a
vendor-neutral `ModelClient` port shaped like OpenAI chat-completions (the shape OpenRouter, DeepInfra, and
most non-Anthropic providers speak natively), implement it against OpenRouter, and default routing to
`deepseek/deepseek-v4-flash`.

**This spec covers ONLY the provider-adapter swap** — the seam, the OpenRouter transport, env config, usage
capture on the wire, and quality-parity proof on the new default model. It explicitly does **not** cover
persistence, metering enforcement, or UI changes (see §8 Out of Scope) — those are items (2)/(3)/(4)+ of the
batteries-included-A program (backlog.md "NEXT BUILD").

### Job to be Done

> **When** PMO operates the in-app agent assistant (chat, read/write tools, compose-a-view) at real usage
> volume, **the Director/owner** wants the model call routed through a vendor-neutral seam to a
> cost-effective provider (OpenRouter → DeepInfra-first, `deepseek/deepseek-v4-flash`) instead of a single
> hard-wired vendor SDK, **so that** provider/model choice is a config change, per-request cost is visible
> for future metering, and the app is not locked to one vendor's request/response shape.

### Why OpenAI chat-completions shape, not a new PMO-invented shape

OpenRouter's API **is** the OpenAI chat-completions shape (`POST /chat/completions`, `messages[]` with
`role`, `tool_calls[]`, `tool_call_id`, `finish_reason`) — modeling `ModelClient` on it means the OpenRouter
transport is a near-direct pass-through (no translation layer inside the transport), and any other
OpenAI-compatible provider (DeepInfra direct, Together, Groq, a future Anthropic-via-OpenAI-shim) can
implement the same port with equally little friction. Anthropic's own shape (top-level `system` string,
`content` block array, `tool_use`/`tool_result` blocks, `stop_reason` enum) becomes the **odd one out**,
confined to an optional fallback adapter (§2.7) if one falls out naturally.

---

## 2. Functional Requirements

Conventions: **EARS** (ubiquitous / event-driven `When…` / state-driven `While…` / conditional `Where…` /
optional). Tags: **[PORT]** the `ModelClient` seam · **[OR]** the OpenRouter transport · **[FN]** the two edge
functions (`agent-chat`, `compose-view`) · **[CFG]** env/config.

### 2.1 The `ModelClient` port **[PORT]**

**FR-MC-001** (ubiquitous)
The system SHALL define a vendor-neutral `ModelClient` port, co-located with the existing seam so both edge
functions can import it without a Deno/Node split — `supabase/functions/_shared/modelClient.ts` (NEW shared
directory; today neither function has one, each defines `AnthropicLike` locally). The port SHALL replace
`AnthropicLike` at every one of its current usage sites: `supabase/functions/agent-chat/handler.ts` (2 call
sites: the main loop L344 and `runLoop` L775, both `deps.anthropic.messages.create(...)`) and
`supabase/functions/compose-view/composeSpec.ts` (1 call site: `callModel` L109,
`anthropic.messages.create(...)`).

**FR-MC-002** (ubiquitous)
`ModelClient` SHALL expose a single method shaped as an OpenAI chat-completions request/response:

```ts
// supabase/functions/_shared/modelClient.ts
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ModelToolCall[];      // present on assistant messages that call a tool
  tool_call_id?: string;             // present on role:'tool' messages (the result)
  name?: string;                     // present on role:'tool' messages (tool name echo)
}

export interface ModelToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };   // arguments = JSON-encoded string (OpenAI shape)
}

export interface ModelTool {
  type: 'function';
  function: { name: string; description: string; parameters: object };  // JSON Schema
}

export interface ModelClientParams {
  model: string;
  max_tokens: number;
  messages: ModelMessage[];           // system prompt is messages[0] with role:'system' (NOT a top-level field)
  tools?: ModelTool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };  // forced-tool = FR-MC-004
  stream?: boolean;                   // NFR-MC-PERF-001 — transport-level streaming; the port's single
                                       // create() call always resolves ONE accumulated ModelResponse
                                       // regardless of stream, mirroring the pre-existing accumulate-
                                       // server-side rule (ADR-0039 dec 6) — no client-visible partial state.
}

export interface ModelUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** USD cost for this request, when the provider reports it (OpenRouter does). Absent for providers that don't. */
  total_cost?: number;
}

export interface ModelResponse {
  /** OpenAI finish_reason vocabulary: 'stop' | 'tool_calls' | 'length' | 'content_filter'. */
  finish_reason: string;
  /** The assistant's reply message — content and/or tool_calls. */
  message: { role: 'assistant'; content: string | null; tool_calls?: ModelToolCall[] };
  usage?: ModelUsage;
  /** Echo of the model actually served (OpenRouter may route to a fallback — NFR-MC-OBS-001). */
  model: string;
}

export interface ModelClient {
  create(params: ModelClientParams): Promise<ModelResponse>;
}
```

**FR-MC-003** (event-driven)
When either edge function builds its outbound message list, it SHALL express the system prompt as
`messages[0] = { role: 'system', content: <prompt> }` (OpenAI convention) rather than the Anthropic top-level
`system` string field. All Anthropic-specific fields (`system` as a sibling of `messages`, `content` as a
block array on request messages) SHALL NOT appear in `ModelClientParams`.

**FR-MC-004** (event-driven)
When `compose-view`'s `composeSpec` needs to force the model to call exactly one tool (the structured-output
pattern, ADR-0039 decision 6), it SHALL set
`tool_choice: { type: 'function', function: { name: 'compose_view' } }` — the OpenAI tool-forcing shape —
replacing Anthropic's `tool_choice: { type: 'tool', name: 'compose_view' }`. The **semantics are unchanged**:
exactly one tool is offered and forced; the model MUST return a `tool_calls[0]` matching that tool.

**FR-MC-005** (event-driven)
When a `ModelResponse.finish_reason` is `'tool_calls'`, callers SHALL read the tool invocation from
`message.tool_calls[0]` — `{ id, function: { name, arguments } }` where `arguments` is a **JSON-encoded
string** (OpenAI shape — unlike Anthropic's `input` which is already a parsed object). Both edge functions
SHALL `JSON.parse(tool_calls[0].function.arguments)` before validating/dispatching the tool input.

**FR-MC-006** (event-driven)
When either edge function appends a tool result to the running conversation for the next turn, it SHALL push
**one** `ModelMessage` with `role: 'tool'`, `tool_call_id` matching the originating call's `id`, `name` set to
the tool name, and `content` the JSON-stringified result — replacing Anthropic's two-message pattern
(`assistant` echo of the `tool_use` block + a `user` message wrapping a `tool_result` content block). This is
a **protocol simplification**, not a behavior change: the conversation's causal tool-call → tool-result
pairing is preserved; only the wire representation changes (OpenAI does not require echoing the assistant's
tool-call turn as a separate message — the `assistant` message with `tool_calls` IS that turn).

**FR-MC-007** (ubiquitous)
The finish-reason mapping from Anthropic's `stop_reason` vocabulary to OpenAI's `finish_reason` vocabulary
SHALL be:

| Old (`AnthropicResponse.stop_reason`) | New (`ModelResponse.finish_reason`) | Branch in handler/composeSpec |
|---|---|---|
| `'tool_use'` | `'tool_calls'` | dispatch the tool |
| `'end_turn'` | `'stop'` | terminal `completed` |
| `'max_tokens'` | `'length'` | terminal `completed` with "response truncated" (unchanged text) |

Both edge functions' branch conditions (`agent-chat/handler.ts` L362/L369/L793/L798,
`compose-view/composeSpec.ts` — implicit via `callModel`'s tool-use-block search) SHALL be updated to test
against the new vocabulary; the **behavioral consequence of each branch is unchanged** (this is a rename of
the sentinel values the existing logic already branches on, not new logic).

### 2.2 The OpenRouter transport **[OR]**

**FR-MC-008** (ubiquitous)
The system SHALL implement `OpenRouterModelClient` at `supabase/functions/_shared/openRouterModelClient.ts`
implementing `ModelClient`, calling `POST https://openrouter.ai/api/v1/chat/completions` with
`Authorization: Bearer ${OPENROUTER_API_KEY}` and `Content-Type: application/json`. Because OpenRouter's API
**is** the OpenAI chat-completions shape, the transport SHALL pass `ModelClientParams` through with minimal
translation: `messages`, `tools`, `tool_choice`, `model`, `max_tokens` map 1:1 to the OpenRouter request body.

**FR-MC-009** (event-driven)
When `OpenRouterModelClient` builds a request, it SHALL include a `provider` routing field:
`{ order: ["DeepInfra"], allow_fallbacks: true }` (the owner-decided default — DeepInfra-first, fallback
chain **TBD**, owner to supply the fallback provider list; `allow_fallbacks: true` ships now with an
empty/unspecified secondary order until the owner provides one — an empty/single-entry `order` array with
`allow_fallbacks:true` is valid OpenRouter usage and degrades gracefully to OpenRouter's own default routing
if DeepInfra is unavailable). This directly resolves the pilot's dead end (ADR-0040 addendum: "DeepInfra
pin infeasible" was an `agent-native` **settings-store** limitation — the ai-sdk engine forwarded no
provider-routing option; calling the OpenRouter API directly, as this spec does, has no such limitation).

**FR-MC-010** (event-driven)
When the OpenRouter HTTP response is not `2xx`, `OpenRouterModelClient.create` SHALL throw an `Error`
carrying the HTTP status and a scrubbed message (never the raw response body verbatim if it could contain
`OPENROUTER_API_KEY` — it cannot, by construction, since the key is a request header, not echoed in error
bodies, but the transport SHALL NOT log the full response body regardless, per NFR-MC-SEC-004). Both edge
functions' existing `catch` blocks (`agent-chat/handler.ts` L536, `compose-view/composeSpec.ts` L219, and
`compose-view/handler.ts` L180) already map any thrown error from the client to `502 UPSTREAM_ERROR` with a
scrubbed detail — this SHALL continue to work unchanged (the swap is transparent to the error-mapping layer,
proving the seam's isolation).

**FR-MC-011** (event-driven)
When the OpenRouter response includes `usage` (`prompt_tokens`, `completion_tokens`, `total_tokens`) and/or
OpenRouter's cost-accounting extension (`usage.cost` in the response when the request includes
`usage: { include: true }`, per OpenRouter's API), `OpenRouterModelClient.create` SHALL populate
`ModelResponse.usage` = `{ prompt_tokens, completion_tokens, total_tokens, total_cost? }`. The transport
SHALL request `usage: { include: true }` in every outbound request so cost is present whenever OpenRouter
reports it. Absence of `total_cost` (a provider that doesn't report cost) SHALL NOT be an error — the field
is optional (FR-MC-002).

**FR-MC-012** (ubiquitous)
`OpenRouterModelClient` SHALL echo the actually-served `model` string from the OpenRouter response
(`response.model` — may differ from the requested `model` if a fallback fired) into `ModelResponse.model`,
so a future consumer (item 3's usage ledger) can distinguish "asked for deepseek-v4-flash, got the fallback"
without additional plumbing.

### 2.3 Env config **[CFG]**

**FR-MC-013** (ubiquitous)
The system SHALL read exactly these Supabase function secrets/env vars (both `agent-chat` and `compose-view`
functions; documented in `supabase/functions/.env.example`):
- `OPENROUTER_API_KEY` (required — replaces `ANTHROPIC_API_KEY` as the function secret name; NFR-MC-SEC-001).
- `AGENT_MODEL_DEFAULT` (optional, default `deepseek/deepseek-v4-flash` if unset — the owner-decided default
  model id, in OpenRouter's `vendor/model` id format).
- Per-action model-map overrides, optional, env-configurable, one var per action family:
  `AGENT_MODEL_CHAT` (agent-chat's read/write tool-use loop; falls back to `AGENT_MODEL_DEFAULT`) and
  `AGENT_MODEL_COMPOSE` (compose-view / `compose_view` action's structured-output call; falls back to
  `AGENT_MODEL_DEFAULT`). Both edge functions currently hardcode `model: 'claude-opus-4-8'` at every call
  site (`agent-chat/handler.ts` L345,L776; `compose-view/composeSpec.ts` L110) — these SHALL be replaced by
  the resolved env value.

**FR-MC-014** (event-driven)
When `index.ts` (either function) constructs its `ModelClient`, it SHALL read `OPENROUTER_API_KEY` from
`Deno.env` and construct `new OpenRouterModelClient({ apiKey })`, replacing
`new Anthropic({ apiKey })` (`agent-chat/index.ts` L85, `compose-view/index.ts` L83). The existing
"missing key → 502 `UPSTREAM_ERROR` before any model call" gate (both `index.ts` files, checking
`if (!apiKey)`) SHALL be preserved unchanged, reading `OPENROUTER_API_KEY` instead of `ANTHROPIC_API_KEY`.

**FR-MC-015** (event-driven)
When `agentChatHandler` or `composeSpec` resolves which model id to send, it SHALL apply
`AGENT_MODEL_CHAT ?? AGENT_MODEL_DEFAULT ?? 'deepseek/deepseek-v4-flash'` (agent-chat) and
`AGENT_MODEL_COMPOSE ?? AGENT_MODEL_DEFAULT ?? 'deepseek/deepseek-v4-flash'` (compose-view) respectively. The
resolved model id SHALL be injected via `HandlerDeps`/`ComposeSpecDeps` (a new `model: string` field on each,
constructed by `index.ts` from `Deno.env`), **not** read from `Deno.env` inside the pure handler — preserving
the pure/DI/importable-in-Vitest constraint (ADR-0039 decision 7) unchanged.

### 2.4 `agent-chat` integration **[FN]**

**FR-MC-016** (ubiquitous)
`supabase/functions/agent-chat/handler.ts` SHALL replace its `HandlerDeps.anthropic: AnthropicLike` field
with `HandlerDeps.modelClient: ModelClient` (a rename, not a widening — the field remains exactly one
injected client) and its local `AnthropicLike`/`AnthropicCreateParams`/`AnthropicResponse`/
`AnthropicContentBlock` interface definitions (L50–77) SHALL be deleted, replaced by an
`import type { ModelClient, ModelResponse, ... } from '../_shared/modelClient'`.

**FR-MC-017** (event-driven)
When the tool-use loop (both the main loop and `runLoop`) builds its Anthropic `tools` array
(`{ name, description, input_schema }` per action), it SHALL instead build a `ModelTool[]` array
(`{ type: 'function', function: { name, description, parameters: <the same JSON Schema> } }` — the JSON
Schema itself is unchanged; only the wrapper shape changes, per FR-MC-002).

**FR-MC-018** (ubiquitous)
The A4 model-calling-action seam (ADR-0041) SHALL be preserved with its Anthropic-specific member renamed:
`ComposeActionDeps.anthropic: AnthropicLike` → `ComposeActionDeps.modelClient: ModelClient`
(`supabase/functions/agent-chat/actions.ts` L288-291), and `runComposeView`'s call into `composeSpec`
(`actions.ts` L320-324) SHALL pass `{ modelClient: deps.modelClient, userId: ctx.userId }`. The handler's
dispatch branch (`handler.ts` L381-386, curries `{ anthropic: deps.anthropic }`) SHALL curry
`{ modelClient: deps.modelClient }` instead. **The seam's shape and rationale (ADR-0041) are otherwise
unchanged**: the port/`DeputyContext` gain no model-client member; only the handler-curried extra-deps bag's
member is renamed/retyped.

### 2.5 `compose-view` integration **[FN]**

**FR-MC-019** (ubiquitous)
`supabase/functions/compose-view/composeSpec.ts` SHALL replace `ComposeSpecDeps.anthropic: AnthropicLike`
with `ComposeSpecDeps.modelClient: ModelClient`, delete its local Anthropic-shaped interfaces (L38–67),
and import `ModelClient` from `../_shared/modelClient`. `callModel` (L104-139) SHALL build a `ModelTool[]`
single-entry array + `tool_choice: { type: 'function', function: { name: 'compose_view' } }` (FR-MC-004) and
read the tool call from `response.message.tool_calls?.[0]` (FR-MC-005), `JSON.parse`-ing
`.function.arguments` into the `CompositionSpec` candidate before it reaches `compileCompositionSpec`
(the untrusted-output boundary, ADR-0039 decision 3 — **unchanged**: the parsed-but-uncompiled JSON is still
untrusted until it passes the compiler).

**FR-MC-020** (event-driven)
When `composeSpec`'s repair loop (L177-217) re-invokes the model with validation feedback, it SHALL append
the repair turn as `{ role: 'user', content: repairFeedback }` (a plain user-role text message — OpenAI has
no equivalent of Anthropic's placeholder `tool_use` echo block requirement per FR-MC-006's simplification);
the placeholder `{ role: 'assistant', content: [{ type: 'tool_use', id: 'repair_placeholder', ... }] }`
push (L211-213) SHALL be removed as unnecessary under the new message-shape rules. **The repair semantics are
unchanged**: `MAX_REPAIR_ATTEMPTS` (2), the single caught `ValidationError.{code,detail}` fed back per
attempt, and `REPAIR_EXHAUSTED` after exhaustion all carry over byte-for-byte (ADR-0039 decision 4).

**FR-MC-021** (ubiquitous)
`compose-view/handler.ts`'s HTTP gate order, error-code mapping (400/401/422/429/502), and logging discipline
(`{errorCode, repairAttempts, tokensUsed}` only — NFR-AS-SEC-004) SHALL be unchanged; its only edit is the
`HandlerDeps.anthropic` → `HandlerDeps.modelClient` rename threaded through to `composeSpec`.

### 2.6 Usage capture on the wire (feeds future metering — item 3) **[FN]**

**FR-MC-022** (event-driven)
When `agentChatHandler` completes a model call (each round of the tool-use loop, and the compose_view
dispatch), it SHALL emit the model/usage data it already has in hand — `{ model, prompt_tokens,
completion_tokens, total_cost? }` sourced from `ModelResponse.model` / `.usage` — on the existing `status`
`AgentEvent` stream, as an additive field on the `payload` of the run's terminal `status` event (`completed`
/ `errored`) and, where useful, on intermediate `tool` events for the compose_view artifact (which already
carries `tokensUsed` — `handler.ts` L416). This is **read/observe only**: no new persistence, no new table,
no server-side aggregation (that is item 3, `agent_usage`). The event schema addition SHALL NOT change any
existing terminal-status field already relied upon by A2/A3 UI code (`status`, `error`, `pendingId`, etc. —
purely additive).

**FR-MC-023** (event-driven)
When `composeViewHandler` returns its `200` body, the existing `tokensUsed` field (already returned,
`ComposeViewResponse.tokensUsed`) SHALL continue to be populated from `ModelResponse.usage` (now sourced from
OpenRouter's usage block instead of Anthropic's `usage.input_tokens + usage.output_tokens`); the response body
MAY additionally carry `model` and `totalCost` fields (additive, optional) sourced from FR-MC-011/012, for the
same "feeds future metering, not persisted here" reason as FR-MC-022.

### 2.7 Anthropic fallback adapter (optional, not required) **[PORT]**

**FR-MC-024** (optional — "Where")
Where implementing `ModelClient` against the existing `@anthropic-ai/sdk` (an `AnthropicModelClient`
translating `ModelClientParams` ↔ Anthropic's shape) falls out naturally as a byproduct of extracting the
port cleanly, the system MAY ship it alongside `OpenRouterModelClient` as a second `ModelClient`
implementation. This is explicitly **not required** by this issue — `deno.json`'s
`"@anthropic-ai/sdk": "npm:@anthropic-ai/sdk@^0.54.0"` dependency and the `Anthropic` import MAY be removed
entirely from both functions' `index.ts`/`deno.json` if no fallback adapter is built, with no loss of
required scope.

---

## 3. Non-Functional Requirements

### Security — `NFR-MC-SEC-###`

**NFR-MC-SEC-001** — `OPENROUTER_API_KEY` MUST reside exclusively in Supabase function secrets for
`agent-chat` and `compose-view`. It MUST NOT appear in any committed file, the SPA/client bundle, a
browser-readable env var, or a Vault row readable by `authenticated`. The existing negative-grep gate
pattern (`noApiKeyInBundle.test.ts`, currently asserting zero `ANTHROPIC_API_KEY` literals under
`pmo-portal/`) SHALL be extended/duplicated to also assert zero `OPENROUTER_API_KEY` literals under
`pmo-portal/` (AC-MC-010).

**NFR-MC-SEC-002** — The `ModelClient`/`OpenRouterModelClient` swap MUST NOT alter the deputy-authorization
boundary already proven for both functions (ADR-0039 §2, ADR-0040 §"deputy invariant"): `service_role` usage
remains confined to `auth.getUser(jwt)` in each `index.ts`; all business-data access continues through the
caller-JWT client. The provider swap touches **only** the model-call seam, never the Supabase client
construction.

**NFR-MC-SEC-003** — The untrusted-output validation boundary (ADR-0039 decision 3) MUST be unchanged: every
`compose_view` tool-call result — whichever provider produced it — is parsed (`JSON.parse` of
`tool_calls[0].function.arguments`) and MUST pass `compileCompositionSpec` (fail-fast, throws) before
reaching an `artifact` event or a 200 response. A provider-agnostic seam does not weaken this: the compiler,
not the transport, remains the sole authority.

**NFR-MC-SEC-004** — Logging discipline (mirrors NFR-AS-SEC-004/NFR-AR-SEC-005) MUST be preserved: neither
function may log prompt text, tool-call arguments, spec contents, or the raw OpenRouter response body. Only
`{ errorCode, repairAttempts | round, tokensUsed }`-shaped summaries may be logged. The `OpenRouterModelClient`
error path (FR-MC-010) MUST NOT log the full OpenRouter response body verbatim (it may carry the prompt
echoed back by some providers' error payloads).

**NFR-MC-SEC-005** — Timeouts: `OpenRouterModelClient.create` MUST bound its `fetch` call with a timeout
(`AbortController`, default **30s** — generous for a tool-forced single-turn call, bounded well under the
edge-function wall-clock ceiling) so a hung upstream cannot hold the function open indefinitely; a timeout
MUST surface as the same thrown-`Error` → `502 UPSTREAM_ERROR` path as any other upstream failure
(FR-MC-010), not a distinct code.

### Performance — `NFR-MC-PERF-###`

**NFR-MC-PERF-001** — `OpenRouterModelClient` SHOULD use OpenRouter's streaming response mode internally (as
the existing Anthropic path did — ADR-0039 decision 6: "internally the SDK call streams to avoid the
edge-function timeout") to avoid the function timeout on long completions, while still resolving the port's
`create()` call as **one accumulated `ModelResponse`** — no client-visible partial state, preserving the
existing "accumulate server-side, no SSE of partial JSON" rule (AS-OD-004, unchanged). Where accumulating a
non-streamed response is simpler and still comfortably within the timeout for `deepseek/deepseek-v4-flash`
(a fast model), a non-streaming request MAY be used instead — this is an implementation choice, not a
contract; either way the port's external behavior (one resolved `ModelResponse`) is identical.

**NFR-MC-PERF-002** — Tool-use loop parity: `MAX_TOOL_ROUNDS` (= 8, `agent-chat/handler.ts`) and
`MAX_REPAIR_ATTEMPTS` (= 2, `compose-view/composeSpec.ts`) MUST be numerically unchanged by the provider
swap — these are cost/latency ceilings independent of which model answers the call.

### Observability — `NFR-MC-OBS-###`

**NFR-MC-OBS-001** — Every successful `ModelClient.create()` call MUST yield a `ModelResponse.model` echoing
the model that actually served the request (FR-MC-012), so a fallback-routed call is distinguishable from a
DeepInfra-served call — required raw material for item 3's usage ledger and for validating the
"DeepInfra-first, fallback allowed" routing decision empirically (owner may want to know how often fallback
fires).

---

## 4. Acceptance Criteria

All AC are Given/When/Then, tagged to their **lowest sufficient owning layer** (ADR-0010). This issue is
**unit-only** — the seam, the transport, and the two edge-function integrations are all pure/DI and
importable in Vitest with the network mocked (ADR-0039 decision 7, unchanged). No new pgTAP surface (no
schema change). No new curated e2e journey — the existing `AC-AR-013`/panel e2e already mocks the edge
function via `page.route` (ADR-0039 decision 7 / agent-runtime-seam.spec.md AC-AR-013) and is untouched by a
server-side provider swap; it is not re-authored here.

### `ModelClient` port + OpenRouter transport (Unit — Vitest, `fetch` mocked)

**AC-MC-001** (Unit) — *OpenRouter request shape.*
Given `OpenRouterModelClient` constructed with an `apiKey`
When `.create({ model, max_tokens, messages, tools, tool_choice })` is called
Then the underlying `fetch` is called with `POST https://openrouter.ai/api/v1/chat/completions`,
`Authorization: Bearer <apiKey>`, and a JSON body containing `provider: { order: ['DeepInfra'],
allow_fallbacks: true }` and `usage: { include: true }` alongside the passed-through `model`/`messages`/
`tools`/`tool_choice`/`max_tokens`.

**AC-MC-002** (Unit) — *Response mapping — text-only completion.*
Given a mocked OpenRouter response with `choices[0].finish_reason: 'stop'`,
`choices[0].message: { role: 'assistant', content: 'answer text' }`, and a `usage` block
When `.create(...)` resolves
Then the returned `ModelResponse` has `finish_reason: 'stop'`, `message.content: 'answer text'`,
`message.tool_calls: undefined`, and `usage` populated with `prompt_tokens`/`completion_tokens`/
`total_tokens` from the response.

**AC-MC-003** (Unit) — *Response mapping — tool call.*
Given a mocked OpenRouter response with `finish_reason: 'tool_calls'` and
`message.tool_calls: [{ id, type:'function', function:{ name:'query_entity', arguments:'{"entity":"projects"}' } }]`
When `.create(...)` resolves
Then `ModelResponse.finish_reason === 'tool_calls'` and `message.tool_calls[0].function.arguments` is the
**JSON-encoded string** unchanged (parsing is the caller's job — FR-MC-005), not pre-parsed by the transport.

**AC-MC-004** (Unit) — *Usage cost surfaced when present, absent when not.*
Given two mocked responses, one with `usage.cost: 0.0004` and one without a `cost` field
When `.create(...)` resolves for each
Then the first `ModelResponse.usage.total_cost === 0.0004` and the second `ModelResponse.usage.total_cost`
is `undefined` (no thrown error, no fabricated zero).

**AC-MC-005** (Unit) — *Non-2xx upstream → thrown Error, scrubbed.*
Given a mocked `fetch` resolving with status `500` and a body containing a hypothetical secret-looking string
When `.create(...)` is called
Then it throws an `Error`, and no `console.*` call in the transport contains the raw response body verbatim
(NFR-MC-SEC-004).

**AC-MC-006** (Unit) — *Timeout bounds the call.*
Given a mocked `fetch` that never resolves
When `.create(...)` is called
Then it rejects within the configured timeout window (NFR-MC-SEC-005), not indefinitely.

**AC-MC-007** (Unit) — *Model echo for fallback visibility.*
Given a mocked response with `model: 'deepseek/deepseek-v4-flash'` (server-reported, possibly differing from
the requested model on fallback)
When `.create(...)` resolves
Then `ModelResponse.model` equals the server-reported value, not the request's `params.model`.

### `agent-chat` integration (Unit — Vitest, `ModelClient` mocked)

**AC-MC-008** (Unit) — *Tool-use loop parity: happy read path, same event order.*
Given a mocked `ModelClient` emitting a `query_entity` tool call then a final text answer (the OpenRouter/
OpenAI shape)
When `agentChatHandler` runs
Then it dispatches `query_entity`, emits `user` → `tool` → `assistant` → terminal `completed` `AgentEvent`s in
the same order as the pre-swap Anthropic-mocked test (AC-AR-001 parity), and calls `modelClient.create`
exactly twice.

**AC-MC-009** (Unit) — *`MAX_TOOL_ROUNDS` unchanged.*
Given a mocked `ModelClient` that always returns a tool call, never a final answer
When the loop runs
Then it stops after exactly 8 calls (`MAX_TOOL_ROUNDS`, unchanged) and emits `completed` with "reached step
limit" (AC-AR-004 parity — proves the round cap survived the provider swap).

**AC-MC-010** (Unit/CI grep gate) — *No `OPENROUTER_API_KEY` literal in the bundle.*
Given the repo
When a grep for `OPENROUTER_API_KEY` runs over `pmo-portal/`
Then there are zero matches (NFR-MC-SEC-001), mirroring the existing `AC-AR-010` gate.

**AC-MC-011** (Unit) — *A3 approve/deny gating survives the swap.*
Given a mocked `ModelClient` emitting a `create_activity` (`confirm:true`) tool call
When the loop runs
Then it emits `needs-approval` and ends the stream **without** dispatching the write (AC-AW-001-class
parity, unchanged by provider swap — proves the approval gate is orthogonal to which model called the tool).

**AC-MC-012** (Unit) — *Per-round usage surfaced on the status event.*
Given a mocked `ModelClient` response carrying `usage: { prompt_tokens: 120, completion_tokens: 40,
total_cost: 0.0002 }`
When the loop completes a round
Then the terminal `status` `AgentEvent`'s `payload` includes `{ model, prompt_tokens: 120,
completion_tokens: 40, total_cost: 0.0002 }` (FR-MC-022) — additive, and all pre-existing `payload` fields
(`status`, etc.) are still present unchanged.

### `compose-view` / `compose_view` action integration (Unit — Vitest, `ModelClient` mocked)

**AC-MC-013** (Unit) — *Tool-forcing parity: single forced call, valid spec.*
Given a mocked `ModelClient` whose single call returns a `tool_calls[0]` with `function.name: 'compose_view'`
and `arguments` = a JSON-encoded valid `CompositionSpec`
When `composeSpec(prompt, orgId, deps)` runs
Then it calls `modelClient.create` exactly once with `tool_choice: { type:'function', function:{
name:'compose_view' } }`, `JSON.parse`s the arguments, `compileCompositionSpec` succeeds, and it returns
`{ spec, repairAttempts: 0, tokensUsed }` (AC-AS-001 parity).

**AC-MC-014** (Unit) — *Bounded repair: one ValidationError fed back per attempt, same contract.*
Given the first call returns an invalid spec (compiler throws `ValidationError{code,detail}`) and the second
call (after repair feedback) returns a valid spec
When `composeSpec` runs
Then it calls `modelClient.create` exactly twice, the second call's `messages` include a `{role:'user',
content}` turn carrying the single `{code, detail}` (never raw SQL/stack), and it returns
`repairAttempts: 1` (AC-AS-002 parity — proves ADR-0039 decision 4's repair contract survived the provider
swap).

**AC-MC-015** (Unit) — *Repair exhaustion → `REPAIR_EXHAUSTED`, same as before.*
Given every call (initial + 2 repairs) returns an invalid spec
When `composeSpec` runs
Then it throws `ComposeSpecError('REPAIR_EXHAUSTED', 2, tokensUsed, {code, detail})` after exactly 3
`modelClient.create` calls, and `composeViewHandler` maps this to `422` (AC-AS-003 parity).

**AC-MC-016** (Unit) — *Upstream error → `UPSTREAM_ERROR`/502, scrubbed.*
Given the mocked `ModelClient` throws `Error('secret-looking upstream body')`
When `composeSpec`/`composeViewHandler` runs
Then it returns `502 UPSTREAM_ERROR`, the response body does not contain the raw error text, and no log
statement contains it either (AC-AS-007 parity, NFR-MC-SEC-004).

**AC-MC-017** (Unit) — *ADR-0041 model-calling-action seam preserved under the rename.*
Given the agent-chat handler dispatches a `compose_view` tool call
When it curries the extra deps into `runComposeView`
Then it passes `{ modelClient: deps.modelClient }` (not `anthropic`), `composeViewAction.run` is still never
invoked directly (the guard-stub throw is unreachable, per ADR-0041), and the port/`DeputyContext` types gain
no model-client member (asserted by the existing `portIsolation.test.ts`, which SHALL be extended to also
assert no `modelClient` leakage into `DeputyContext`).

### Env / model resolution (Unit — Vitest)

**AC-MC-018** (Unit) — *Default model resolution.*
Given no `AGENT_MODEL_DEFAULT`, `AGENT_MODEL_CHAT`, or `AGENT_MODEL_COMPOSE` env var set
When either function resolves its model id
Then it resolves to `'deepseek/deepseek-v4-flash'` (FR-MC-015).

**AC-MC-019** (Unit) — *Per-action override wins over the default.*
Given `AGENT_MODEL_DEFAULT=some/other-model` and `AGENT_MODEL_COMPOSE=deepseek/deepseek-v4-flash` both set
When `compose-view` resolves its model id
Then it resolves to `AGENT_MODEL_COMPOSE`'s value (`deepseek/deepseek-v4-flash`), proving per-action
overrides take precedence (FR-MC-013/015).

### Quality gate — across-the-board parity on the new default model (Unit, live-run evidence where a key is available)

**AC-MC-020** (Unit, mocked — always runs in CI) — *Chat answer quality — read tool, deterministic fixture.*
Given a mocked `ModelClient` fixture recorded from (or shaped identically to) a real
`deepseek/deepseek-v4-flash` response to "how many of my projects are active?" (a `query_entity` call
followed by a coherent text answer referencing the returned row count)
When `agentChatHandler` runs against the fixture
Then the assistant's final text event is non-empty, references the tool result (not a hallucinated number),
and the run terminates `completed` — proving the harness correctly carries a realistic deepseek-shaped
response end to end.

**AC-MC-021** (Unit, mocked — always runs in CI) — *Write-tool call correctness, approve-gated, deterministic fixture.*
Given a mocked `ModelClient` fixture shaped identically to a real `deepseek/deepseek-v4-flash` response
calling `update_task_status` with well-formed arguments
When `agentChatHandler` runs against the fixture
Then the tool input validates, a `needs-approval` event is emitted with a correct `humanSummary` and
`structuredArgs`, and no write is dispatched pre-approval (parity with AC-MC-011, on a deepseek-shaped
fixture specifically).

**AC-MC-022** (Unit, mocked — always runs in CI) — *`compose_view` structured-output validity, deterministic fixture.*
Given a mocked `ModelClient` fixture shaped identically to a real `deepseek/deepseek-v4-flash` tool-forced
response producing a `CompositionSpec` for a simple prompt ("show my projects by status")
When `composeSpec` runs against the fixture
Then `compileCompositionSpec` succeeds on the **first** attempt (`repairAttempts: 0`) — recording, as a code
comment/fixture provenance note, whether the fixture came from a live call or a hand-shaped equivalent
(AC-MC-023 governs the live-run requirement).

**AC-MC-023** (Unit, live-run — gated on `OPENROUTER_API_KEY` availability, NOT required for CI green) —
*Live quality evidence on the real default model, recorded once.*
Given a local/dev session with a real `OPENROUTER_API_KEY` available (per `docs/environments.md` Edge
Functions local-dev flow)
When the Director (or an implementer) runs the three scenarios above (AC-MC-020/021/022) against the **live**
OpenRouter API with `model: 'deepseek/deepseek-v4-flash'`
Then the live responses are recorded (redacted of any row content per NFR-MC-SEC-004) as the fixture
provenance for AC-MC-020/021/022, and any live-run divergence from the mocked-fixture expectation (e.g. the
model doesn't call the tool, or produces an invalid spec on the first attempt more than transiently) is
reported to the Director **before** this issue's PR is opened — this is the "quality gate BEFORE any
stronger-model fallback is added" the backlog specifies. **This AC is evidence-gathering, not a CI-blocking
test** (no key in CI, ADR-0039 decision 7 unchanged) — its pass/fail judgment is recorded in the plan's
verification notes, not asserted by an automated `expect()`.

---

## 5. Test Layering & Traceability (ADR-0010)

| AC-### | Layer | Tool | Intended owning test file |
|---|---|---|---|
| AC-MC-001 | Unit | Vitest (`fetch` mocked) | `supabase/functions/_shared/openRouterModelClient.test.ts`* |
| AC-MC-002 | Unit | Vitest | `supabase/functions/_shared/openRouterModelClient.test.ts`* |
| AC-MC-003 | Unit | Vitest | `supabase/functions/_shared/openRouterModelClient.test.ts`* |
| AC-MC-004 | Unit | Vitest | `supabase/functions/_shared/openRouterModelClient.test.ts`* |
| AC-MC-005 | Unit | Vitest | `supabase/functions/_shared/openRouterModelClient.test.ts`* |
| AC-MC-006 | Unit | Vitest | `supabase/functions/_shared/openRouterModelClient.test.ts`* |
| AC-MC-007 | Unit | Vitest | `supabase/functions/_shared/openRouterModelClient.test.ts`* |
| AC-MC-008 | Unit | Vitest (mocked `ModelClient`) | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-MC-009 | Unit | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-MC-010 | Unit/CI | grep gate | `pmo-portal/src/lib/agent/noApiKeyInBundle.test.ts` (extended) |
| AC-MC-011 | Unit | Vitest | `pmo-portal/src/lib/agent/agentWriteActions.test.ts` |
| AC-MC-012 | Unit | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` |
| AC-MC-013 | Unit | Vitest | `pmo-portal/src/lib/agent/composeSpec.test.ts` |
| AC-MC-014 | Unit | Vitest | `pmo-portal/src/lib/agent/composeSpec.test.ts` |
| AC-MC-015 | Unit | Vitest | `pmo-portal/src/lib/agent/composeSpec.test.ts` |
| AC-MC-016 | Unit | Vitest | `pmo-portal/src/lib/agent/composeSpec.test.ts` |
| AC-MC-017 | Unit | Vitest | `pmo-portal/src/lib/agent/composeViewAction.test.ts` + `portIsolation.test.ts` |
| AC-MC-018 | Unit | Vitest | `pmo-portal/src/lib/agent/modelResolution.test.ts` (NEW, small) |
| AC-MC-019 | Unit | Vitest | `pmo-portal/src/lib/agent/modelResolution.test.ts` (NEW, small) |
| AC-MC-020 | Unit (mocked, CI-required) | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.deepseekQuality.test.ts` (NEW) |
| AC-MC-021 | Unit (mocked, CI-required) | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.deepseekQuality.test.ts` (NEW) |
| AC-MC-022 | Unit (mocked, CI-required) | Vitest | `pmo-portal/src/lib/agent/composeSpec.deepseekQuality.test.ts` (NEW) |
| AC-MC-023 | Unit (live, NOT CI-required) | manual/Director-run script + recorded note in the plan | N/A — evidence recorded in `docs/plans/<date>-agent-model-client.md` verification section, not a repo test file |

\* `supabase/functions/_shared/` is NEW. It is Deno-native but, per the ADR-0039 decision-7 pattern already
used for `agent-chat`/`compose-view`, its pure logic (`OpenRouterModelClient`, no `Deno.*` globals — `fetch`
is a Web-standard global available in both Deno and Node/Vitest, unlike `Deno.env`) is importable directly
in Vitest. If it needs any Deno-only construct, it MUST follow the existing split (a thin Deno wrapper +
pure logic co-located under `pmo-portal/src/lib/agent/` per the established convention) — the plan (not this
spec) fixes the exact file location; this spec's requirement is only that the module be unit-testable in
Vitest with `fetch` mocked, consistent with every other handler in this codebase.

**No pgTAP surface.** This issue makes no schema change and touches no RLS policy — the deputy/RLS proof
already established by `AC-AR-012` (agent-runtime-seam.spec.md) is unaffected by a server-side model-provider
swap and is not re-run here.

**No new curated e2e.** The existing agent-panel e2e journeys mock `agent-chat` at the HTTP boundary via
`page.route` (ADR-0039 decision 7) — they assert on `AgentEvent` shapes the SPA already consumes, which are
unchanged by this issue (FR-MC-022's usage fields are additive). No `e2e/AC-MC-*.spec.ts` is added.

---

## 6. Owner-Decision Flags (already decided — recorded for traceability, not open)

| Flag | Decision | Source |
|---|---|---|
| **MC-OD-001** | PMO-central OpenRouter key (function secret); BYO-key per-org is a later, enterprise-tier concern, not this issue. | backlog.md 2026-07-03 "NEXT BUILD" item (1), owner-decided |
| **MC-OD-002** | Default model `deepseek/deepseek-v4-flash`, routed `provider: { order: ['DeepInfra'] }` with fallbacks allowed; exact fallback chain **TBD** (owner to supply) — ships with `allow_fallbacks:true` and an unspecified/empty secondary order until then. | backlog.md, same item |
| **MC-OD-003** | Seam is named `ModelClient` (not `AgentModelClient`/`LlmClient`/etc.) and is OpenAI chat-completions-shaped. | backlog.md, same item |
| **MC-OD-004** | Per-action model map stays env-configurable (`AGENT_MODEL_CHAT`, `AGENT_MODEL_COMPOSE`), not a DB table — matches the existing `AGENT_MODEL_DEFAULT`-style config posture (no new persistence for a config value). | backlog.md, same item; Director default (no simpler alternative surfaced) |
| **MC-OD-005** | Per-request usage capture is wire-level only (additive `AgentEvent`/response fields); persistence is explicitly item (3) — this issue does not create `agent_usage` or any table. | backlog.md, explicit scope note |
| **MC-OD-006** | An Anthropic fallback adapter (`AnthropicModelClient`) is optional — built only if it "falls out naturally," not a required deliverable. | Task brief, explicit |

---

## 7. Open Questions for the Director (≤5, each with a recommendation)

1. **Exact location of `_shared/`.** Neither edge function currently has a shared directory; each defines its
   Anthropic types locally (some duplication already exists — `agent-chat/handler.ts` and
   `compose-view/composeSpec.ts` each independently declare `AnthropicLike`/`AnthropicCreateParams`/
   `AnthropicResponse`). **Recommendation: create `supabase/functions/_shared/modelClient.ts` +
   `openRouterModelClient.ts`** as proposed in FR-MC-001/008 — both functions already import across each
   other's directories via relative paths (`agent-chat/actions.ts` imports `../compose-view/composeSpec`), so
   a sibling `_shared/` import is consistent with the existing relative-import discipline (no `.ts` extension
   issues, no new Deno import-map entries beyond what each function's `deno.json` already needs). Confirm, or
   prefer duplicating the port file into each function directory (avoids a new shared dir, costs a
   drift-guard test to keep the two copies in sync) if `_shared/` proves awkward for Deno's per-function
   dependency isolation model.

2. **Streaming vs non-streaming OpenRouter call (NFR-MC-PERF-001).** The existing Anthropic path streamed
   internally to dodge the edge-function timeout even though the SDK's public contract accumulates one
   response. `deepseek/deepseek-v4-flash` is fast; the tool-forced `compose_view` call and typical
   `query_entity` turns are short. **Recommendation: start with a plain (non-streaming) `fetch` call** in
   `OpenRouterModelClient` — simpler, and OpenRouter's typical latency for a fast model is well under the
   Supabase Edge Function timeout for these short exchanges — and add streaming only if real usage shows
   timeout pressure (a contained, one-file change since the port's external shape doesn't change either way,
   per NFR-MC-PERF-001's explicit "implementation choice, not a contract" framing). Confirm.

3. **Fixture provenance for AC-MC-020/021/022 (mocked "quality gate" tests).** These are unit tests that must
   be CI-green without a live key, but the brief asks for "recorded live-run evidence where a key is
   available." **Recommendation: author the mocked fixtures by hand first** (a plausible deepseek-shaped
   response), ship them as the CI-required tests, **then** run AC-MC-023 live in a local session (per
   `docs/environments.md` Edge Functions local-dev) and if the live response diverges meaningfully from the
   hand-shaped fixture, update the fixture to match the *real* shape observed (keeping the mocked test
   CI-stable but now grounded in an actual response) — recording the live-run note in the plan either way.
   Confirm this ordering, or prefer blocking fixture-authoring until AC-MC-023 runs (slower, but the fixture
   is real-response-derived from the start).

4. **`AGENT_MODEL_DEFAULT` scope: repo-wide single var or per-function.** FR-MC-013/015 propose one
   `AGENT_MODEL_DEFAULT` shared by both functions plus two narrower per-action overrides
   (`AGENT_MODEL_CHAT`/`AGENT_MODEL_COMPOSE`). **Recommendation: keep the single shared default** — it's the
   simplest form that still satisfies "per-action model map stays env-configurable" (the two narrower vars
   are the map; the default is the fallback), and avoids inventing a 3rd naming scheme. Confirm, or prefer
   naming them `AGENT_MODEL_AGENT_CHAT`/`AGENT_MODEL_COMPOSE_VIEW` to mirror the function directory names
   exactly (more verbose, more literal).

5. **Whether to build the optional `AnthropicModelClient` fallback adapter (FR-MC-024) in this issue at all,
   or defer entirely.** The brief says "MAY... ONLY if it falls out naturally — not required." Building it
   costs real effort (translating both directions of FR-MC-003 through FR-MC-007) for a fallback that has no
   current caller (nothing selects it). **Recommendation: do NOT build it in this issue** — remove
   `@anthropic-ai/sdk` from both `deno.json`s and both `index.ts`s entirely (FR-MC-024's explicit permission),
   keeping the issue's surface area to exactly the OpenRouter swap. If a future issue needs a vendor fallback,
   the now-clean `ModelClient` port makes adding `AnthropicModelClient` a self-contained follow-up. Confirm.

---

## 8. Out of Scope (explicit — owned by later batteries-included-A items or other work)

- **Credits/metering persistence and enforcement** — item (3), `agent_usage` ledger + per-user credit balance
  at the `RateGuard` injection point. This issue only makes the raw usage data available on the wire
  (FR-MC-022/023); it does not persist, aggregate, or enforce against it.
- **Thread/event persistence** — issue 2 / ADR-0043 (`agent_threads`/`agent_events`). Out of scope here; the
  in-memory single-HTTP-stream run model (AR-OD-005) is unchanged by a provider swap.
- **Any UI change beyond surfacing model/usage in existing status events.** The `AssistantPanel` (A2) is not
  touched; if/when it wants to *display* `model`/`total_cost` to the user, that is a follow-up UI issue
  consuming the now-available `AgentEvent.payload` fields — not this issue.
- **PostHog observability wiring** — item (4). Not touched here.
- **Automations/notifications** — ADR-0044/0045. Unrelated.
- **A stronger-model fallback tier above `deepseek/deepseek-v4-flash`.** The backlog is explicit: the
  quality gate (AC-MC-020/021/022 + the live evidence of AC-MC-023) must pass **before** any stronger-model
  fallback is even considered as a follow-up decision — this issue does not add one.
- **BYO-key / per-org OpenRouter keys.** MC-OD-001 — PMO-central key only; multi-tenant key management is a
  later, enterprise-tier concern.
- **Changing `MAX_TOOL_ROUNDS` / `MAX_REPAIR_ATTEMPTS` values.** These ceilings are proven unchanged
  (NFR-MC-PERF-002), not retuned — retuning for a different model's behavior (if warranted) is a follow-up
  informed by real usage, not a day-one change bundled into a provider swap.

---

## 9. Contradictions / conflicts flagged against existing code & locked decisions

None found. The existing seam (`AnthropicLike`) was already designed as an injectable interface
specifically so a swap like this would be a **contained, mechanical rename** (ADR-0039 decision 7's
pure/DI discipline exists exactly for this reason) — every FR above traces to a concrete existing call site
with an exact line reference, and no FR requires touching `DeputyContext`, RLS, the compiler boundary
(ADR-0039 decision 3), the repair-attempt cap, the tool-round cap, or the A3 approval gate. The one place
this spec **adds** a field where none existed (`HandlerDeps.model: string`, FR-MC-015) is additive and
optional-with-default, not a breaking change to any existing test's mock shape beyond the mechanical
`anthropic` → `modelClient` rename already core to this issue.
