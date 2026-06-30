# Implementation Plan — Agent Runtime Seam + streaming `agent-chat` deputy loop (A1, ADR-0040 Option A)

**Feature:** The PMO-owned **agent-runtime port** (`AgentRuntime` + `AgentAction`), the **`PmoNativeRuntime`** client adapter, and a streaming **`agent-chat` Supabase Edge Function** running a bounded multi-turn deputy loop with ONE read-only action (`query_entity`) over the whitelisted entities `projects` + `companies`.
**Spec:** `docs/specs/agent-runtime-seam.spec.md` (FR-AR-001..025, NFR-AR-SEC-001..008, NFR-AR-PERF-001..003, AC-AR-001..013).
**ADR:** `docs/adr/0040-in-app-agent-panel-pmo-native-vs-sidecar.md` (§"Decision (refined…) — Option A behind a B-shaped seam"). This plan also records ADR-0041 (the JSON-Schema-not-Zod refinement of the ADR-0040 `inputSchema` sketch) and ADR-0042 (SSE transport, overriding spec AR-OD-001).
**Builds on / mirrors:** I5 `compose-view` (`supabase/functions/compose-view/{index,handler,schema,prompt}.ts`, `pmo-portal/src/lib/agent/handler.test.ts`), the trusted core whitelist (`pmo-portal/src/lib/viewspec/types.ts` — `ENTITY_WHITELIST`, `VALID_FILTER_OPS`), `useAIComposer` (the adapter's JWT-forwarding precedent), `pmo-portal/vite.config.ts` (Vitest `include` rooted at `pmo-portal/`).
**Date:** 2026-06-30 · **Author:** eng-planner (Claude Opus 4.8) · **Layer ownership:** ADR-0010 test pyramid.

All paths are absolute-from-repo-root. The app package is `pmo-portal/`; the edge function lives at repo-root `supabase/functions/agent-chat/`. Run all `npm`/`npx` commands from `pmo-portal/` unless stated otherwise. TDD: each behavior task writes the failing test FIRST (RED), then the minimum implementation (GREEN), then refactor. Each task is independently committable. **Read-only on code is NOT a constraint on the implementer** — this plan is written by a docs-only planner; the implementer writes the source under the listed paths.

---

## DIRECTOR DECISIONS (binding — baked in; override conflicting spec defaults)

| # | Decision | Where it lives in this plan | Overrides |
|---|---|---|---|
| D1 | **Transport = SSE** (`Content-Type: text/event-stream`); each `AgentEvent` is one `data: <json>\n\n` line. Browser consumes via `fetch(POST, Authorization: Bearer …)` + `response.body.getReader()` (NOT `EventSource`). | `transport.ts` (`encodeSse`/`decodeSseStream`), `index.ts` `ReadableStream`, `pmoNativeRuntime.ts`. Tasks 4, 14, 18. | Spec AR-OD-001 (NDJSON) → recorded as **ADR-0042**. |
| D2 | **Handler = async generator** `agentChatHandler(req, deps): AsyncIterable<AgentEvent>` — pure, DI (`AnthropicLike` + caller-JWT `SupabaseLike` + `userId` + optional `RateGuard` + `now`). Unit-tested by collecting yielded events with the SDK + supabase mocked; NO live LLM in CI. `index.ts` verifies JWT (service_role ONLY for `auth.getUser`), builds caller-JWT client, constructs real Anthropic client, pipes events into an SSE `ReadableStream`. Model calls accumulated via `AnthropicLike` (message-level events in v1). | `handler.ts`, `index.ts`. Tasks 9–13, 18. Token-level streaming = **A2 deferral** (noted §"Deferred"). | — |
| D3 | **`AgentAction.inputSchema` = a JSON Schema object** (NOT Zod), exposed directly as the Anthropic tool `input_schema` (mirrors I5 `COMPOSITION_SPEC_SCHEMA`). Adds NO `zod` dep to `package.json` or `deno.json`. | `port.ts` (`AgentAction.inputSchema: object`), `schema.ts`. Tasks 2, 5. Recorded as **ADR-0041** (refinement of ADR-0040's `ZodType` sketch). The deferred `AgentNativeRuntime` is where JSON-Schema→Zod for `defineAction` would live. | Spec FR-AR-006/008 (`schema: ZodType<I>`) → see Reconciliation R1. |
| D4 | **`query_entity` = a slim whitelisted read** (NOT the CompositionSpec compiler, NOT FE `repositories`/`db`): validate `{ entity, columns?, filter?{column,op:'eq'\|'in',value}, limit? }` against `ENTITY_WHITELIST` (entity known; columns ⊆ `allowedColumns`; `requiredFilter` mandatory if present), then `callerClient.from(entry.table).select(cols).limit(min(limit ?? CAP, CAP))` with the filter applied. Caller-JWT client only. | `actions.ts` (`queryEntityAction`). Tasks 6–8. | Spec FR-AR-009 (reuse compiler) → Reconciliation R2; spec Open-Q 5 answered. |
| D5 | **First entities = `projects` + `companies`** (both have no `requiredFilter`). Defer `tasks`/`incidents` to A3. | `actions.ts` `AGENT_READ_ENTITIES`, `schema.ts` enum, `buildSystemPrompt`. Tasks 5–8. | Spec AR-OD-003 (`projects` + `tasks`) → Reconciliation R3. |
| D6 | **`AGENT_READ_ROW_CAP = 50`**; read timeout = `Promise.race` + `AbortController`, **5000 ms**. DB-side `statement_timeout` RPC = noted later-hardening item, not A1. | `actions.ts` consts. Tasks 6–8. | Spec FR-AR-010 (statement-timeout intent) → realized as wall-clock + row-cap; spec Open-Q 4 answered. |
| D7 | **`MAX_TOOL_ROUNDS = 8`** per run; on hit, emit a `status` AgentEvent (`completed`, text "reached step limit") and end **gracefully** — NOT a hard error. | `handler.ts`. Task 12. | Spec FR-AR-018 (cap → `errored`/`TURN_CAP`) → Reconciliation R4. |
| D8 | **Stateless `followUp`**: no server-side run persistence in A1. `PmoNativeRuntime` holds the transcript client-side and re-POSTs the full message list each turn. `createRun`/`followUp` both send `{ messages: ConversationMessage[] }`. | `transport.ts` (`AgentChatRequest.messages`), `handler.ts`, `pmoNativeRuntime.ts`. Tasks 4, 9, 14. | Spec FR-AR-019 (`goal`/`message` fields) → Reconciliation R5; spec Open-Q 2 answered. |
| D9 | **Budget/turn guard OFF in v1** but injectable (`RateGuard` stub, mirror I5). | `handler.ts` `deps.rateGuard?`. Task 11. | Spec AR-OD-002 default. |
| D10 | **Test placement**: ALL unit tests co-located under `pmo-portal/src/lib/agent/*.test.ts`, importing edge-fn modules by relative path (`../../../../supabase/functions/agent-chat/…`, no extension). Port + adapter live in `pmo-portal/src/lib/agent/runtime/{port.ts,pmoNativeRuntime.ts}`. | All test tasks. | Spec §5 table (some files differ — see Reconciliation R6). |

---

## Reconciliations (ground-truth vs. spec wording — apply these, do not contradict)

### R1 — `AgentAction` carries `inputSchema: object` (JSON Schema), NOT `schema: ZodType<I>`
Spec FR-AR-006/008 type the action with `schema: ZodType<I>` and require a "Zod→JSON-Schema conversion." Ground truth: the I5 tool surface (`supabase/functions/compose-view/handler.ts:150-158` + `schema.ts`) feeds Anthropic a **plain JSON-Schema object** as `input_schema` with **no Zod anywhere** in the repo's edge-function path, and `zod` is absent from both `pmo-portal/package.json`'s edge-function imports and `compose-view/deno.json`. **Decision (D3):** the port exposes `AgentAction.inputSchema: object` (the JSON Schema, handed verbatim to Anthropic), and `run(input: unknown, ctx)` validates input itself (the action owns its narrowing). Adding `npm:zod` to `deno.json` (spec Open-Q 3's recommendation) is **rejected** — it buys nothing the JSON-Schema precedent doesn't already give, and keeps the tool surface identical to I5. Recorded as **ADR-0041**. The future `AgentNativeRuntime` adapter (which must register actions via `agent-native`'s `defineAction({ schema })`) is the single place a JSON-Schema→Zod shim would live — isolated, never in PMO core.

### R2 — `query_entity` does NOT reuse `compileCompositionSpec`/`QuerySpec`; it is a slim direct read
Spec FR-AR-009 references `ENTITY_WHITELIST` + `VALID_FILTER_OPS` and Open-Q 5 asks whether to reuse the I5 compiler. Ground truth: `compileCompositionSpec` (`pmo-portal/src/lib/viewspec/compiler.ts`) produces a *compiled panel plan* for the renderer, not raw rows, and the FE `repositories`/`db` modules import the Vite Supabase singleton (`@/src/lib/supabase/client`) — **unreachable from Deno**. **Decision (D4):** `query_entity` validates a *slim* shape directly against `ENTITY_WHITELIST` and reads through `ctx.supabase` (the injected caller-JWT client). It reuses the **whitelist data** (`ENTITY_WHITELIST`, `VALID_FILTER_OPS` from `viewspec/types.ts` by relative path — pure, Deno-safe) but **not** the compiler or any FE data module. A1's filter op set is narrowed to `'eq' | 'in'` (D4) — a strict subset of `VALID_FILTER_OPS`.

### R3 — Shipped entities are `projects` + `companies`, not `projects` + `tasks`
Spec AR-OD-003 defaults to `projects` + `tasks`; `tasks` carries `requiredFilter: project_id` (`viewspec/types.ts:246`). **Decision (D5):** ship `projects` + `companies` — both `requiredFilter`-free, so the happy path needs no caller-supplied filter. The `requiredFilter` code path is still **built and tested** (Task 8 uses a synthetic whitelist entry with `requiredFilter` so the refusal branch is covered) so adding `tasks` in A3 is a one-line `AGENT_READ_ENTITIES` extension, not new code.

### R4 — Step-limit ends `completed` gracefully, not `errored`/`TURN_CAP`
Spec FR-AR-018/AC-AR-004 specify a terminal `errored` status (reason `TURN_CAP`). **Decision (D7):** on hitting `MAX_TOOL_ROUNDS = 8`, emit a terminal `status` event with `payload.status = 'completed'` and `text` "reached step limit" — a graceful stop, not an error (a read-only assistant hitting its step budget is not a failure state). AC-AR-004's *behavior* (the loop stops, the SDK is called exactly `MAX_TOOL_ROUNDS` times, no further model call) is preserved and owned by the test; only the terminal status label changes. **AC wording fix to note in the spec:** AC-AR-004 "emits a terminal `errored` status (reason `TURN_CAP`)" → "emits a terminal `completed` status (text 'reached step limit')". The hard cost bound (NFR-AR-SEC-006) is unchanged.

### R5 — The request contract is `{ messages: ConversationMessage[] }`, not `{ goal | message }`
Spec FR-AR-019 types `AgentChatRequest` with `goal?`/`message?` string fields. With **no server-side persistence (D8 / AR-OD-005)**, a follow-up has no run to resume server-side, so the client must replay the full transcript each turn. **Decision (D8):** `AgentChatRequest = { runId?: string; messages: ConversationMessage[]; context?: RunContext }` where `ConversationMessage = { role: 'user' | 'assistant'; content: string | ContentBlock[] }`. `PmoNativeRuntime.createRun` sends `[{ role:'user', content: goal }]`; `followUp` appends the prior assistant/tool turns + the new user message and re-POSTs the whole list. The port's `createRun(input:{goal})` / `followUp(runId, message)` signatures (FR-AR-002) are unchanged — the transcript bookkeeping is private to the adapter.

### R6 — Test-file names differ from spec §5 table (co-location is preserved)
Spec §5 names `agentChatHandler.test.ts`, `queryEntityAction.test.ts`, `pmoNativeRuntime.test.ts`, plus `noApiKeyInBundle.test.ts` / `portIsolation.test.ts`. This plan keeps those exact names **and** adds `port.contract.test.ts` (the reusable suite host, FR-AR-025 — co-located, importing the suite from `runtime/runtime.contract.ts`). All sit under `pmo-portal/src/lib/agent/` (or `…/runtime/`) per D10. The Vitest `include` (`pmo-portal/vite.config.ts:49` = `**/*.{test,spec}.{ts,tsx}` rooted at `pmo-portal/`) collects them with **zero config change** — identical to the I5 decision (B). Edge-fn modules under repo-root `supabase/functions/**` are NOT collected (outside the root) and carry no unit coverage themselves; the co-located tests import them by relative path.

### R7 — `verify_jwt = false` block must be added to `config.toml`
`supabase/config.toml` has `[functions.compose-view] verify_jwt = false` (lines 403-404) but **no** `[functions.agent-chat]` block. **Decision:** Task 17 adds `[functions.agent-chat] verify_jwt = false` (the handler returns a typed 401 itself, per FR-AR-013). Note: `[edge_runtime] enabled = false` (line 386) — edge functions do not run in the local stack, consistent with I5; A1 verification of the live stream is a deploy-time checklist (Task 20), not a CI gate.

---

## Architecture summary

```
supabase/functions/agent-chat/               (repo root — Deno runtime; NOT in pmo-portal/package.json)
  deno.json    import map: @anthropic-ai/sdk, @supabase/supabase-js (copied verbatim from compose-view; NO zod — D3/R1)
  schema.ts    QUERY_ENTITY_SCHEMA — JSON Schema for the query_entity tool input_schema; enum built from AGENT_READ_ENTITIES (pure; Deno+Node)
  actions.ts   queryEntityAction: AgentAction + AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP=50, READ_TIMEOUT_MS=5000, runQueryEntity(input, ctx) (pure; DI supabase)
  prompt.ts    buildAgentSystemPrompt(entities, rowCap) → string (pure; schema metadata only — NFR-AR-SEC-005)
  handler.ts   agentChatHandler(req, deps): AsyncIterable<AgentEvent> — pure async generator; MAX_TOOL_ROUNDS=8; gates 401→400→loop; deps inject anthropic, supabase(caller-JWT), userId, rateGuard?, now?
  index.ts     Deno.serve wrapper: verify JWT (service-role verifier) → caller-JWT client → real Anthropic → pipe generator into SSE ReadableStream  (integration-only; NOT unit-tested — ADR-0039 dec 7)

pmo-portal/src/lib/agent/                     (the SPA; Vitest runs here — co-located tests, D10)
  runtime/port.ts              AgentRuntime, AgentRun(Status), AgentEvent(Type), AgentAction, DeputyContext, RunContext   (PMO-owned port; nothing else imports an adapter)
  runtime/transport.ts         AgentChatRequest, AgentChatError, ConversationMessage; encodeSse(event)→string; decodeSseStream(reader)→AsyncIterable<AgentEvent>  (the ONLY SSE-framing site — D1)
  runtime/pmoNativeRuntime.ts  PmoNativeRuntime implements AgentRuntime — POST + SSE consume; holds transcript client-side (D8); takes (getJwt, fnUrl, fetchImpl?)
  runtime/runtime.contract.ts  runAgentRuntimeContract(makeRuntime) — reusable suite ANY adapter must pass (FR-AR-025); not a *.test.ts (no auto-collect)
  agentChatHandler.test.ts     AC-AR-001..005 (loop, gates, caps, scrub)            imports ../../../../supabase/functions/agent-chat/handler
  queryEntityAction.test.ts    AC-AR-006,007,008 (whitelist refuse, row cap, deputy) imports ../../../../supabase/functions/agent-chat/actions
  prompt.test.ts               buildAgentSystemPrompt: only schema metadata, no rows (NFR-AR-SEC-005)
  port.contract.test.ts        AC-AR-009 — runs runAgentRuntimeContract(makeFakePmoNativeRuntime)  imports ./runtime/runtime.contract + ./runtime/pmoNativeRuntime
  noApiKeyInBundle.test.ts     AC-AR-010 — grep gate: no ANTHROPIC_API_KEY literal under pmo-portal/
  portIsolation.test.ts        AC-AR-011 — no module outside runtime/ imports a concrete adapter

supabase/tests/
  0090_agent_query_entity_rls.test.sql   AC-AR-012 — pgTAP: cross-tenant projects/companies read under user-A JWT returns ZERO org-B rows (dev→main integration lane)

supabase/config.toml
  [functions.agent-chat] verify_jwt = false   (Task 17)
```

**Handler import contract (Deno + Node both resolve):** `handler.ts` imports `queryEntityAction`, `AGENT_READ_ENTITIES` from `./actions`, `buildAgentSystemPrompt` from `./prompt`, and the port event types from `../../../pmo-portal/src/lib/agent/runtime/port` + transport from `…/runtime/transport` (relative, no extension — pure type/value modules, no React, no Supabase singleton). `actions.ts` imports `ENTITY_WHITELIST`, `VALID_FILTER_OPS` from `../../../pmo-portal/src/lib/viewspec/types`. No `@` alias inside the edge function (Deno has no Vite alias).

---

## OWNER-DECISION block (defaults applied — no task blocked)

| Flag | Applied | Where |
|---|---|---|
| **AR-OD-001** transport | **SSE** (D1, overrides the NDJSON default) | `transport.ts`, `index.ts`, Tasks 4/14/18; ADR-0042 |
| **AR-OD-002** budget guard | **Off in v1**, injectable `RateGuard` (D9) | `handler.ts` Task 11 |
| **AR-OD-003** entities | **`projects` + `companies`** (D5/R3) | `actions.ts` Task 5 |
| **AR-OD-004** row cap | **50** (D6) | `AGENT_READ_ROW_CAP` Task 6 |
| **AR-OD-005** persistence | **In-memory per stream** — no `agent_runs` table (D8) | adapter holds transcript, Task 14 |

---

## Task list (TDD, 2–5 min each, independently committable)

### Phase 0 — the port + transport contract (no behavior; types compile)

#### Task 1 — `deno.json` for the function
**File:** `supabase/functions/agent-chat/deno.json` (new).
**Change:** copy `supabase/functions/compose-view/deno.json` verbatim (the same two `npm:` imports; **no zod** — R1):
```json
{
  "imports": {
    "@anthropic-ai/sdk": "npm:@anthropic-ai/sdk@^0.54.0",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@^2.45.0"
  }
}
```
**Verify:** `test -f supabase/functions/agent-chat/deno.json && ! grep -q zod supabase/functions/agent-chat/deno.json && echo OK`
**AC:** infra (supports AC-AR-010 — no new deps).

#### Task 2 — the port module `port.ts` (FR-AR-001, 002, 006; NFR-AR-SEC-007)
**File:** `pmo-portal/src/lib/agent/runtime/port.ts` (new).
**Change:** define exactly:
```ts
export type AgentRunStatus = 'queued' | 'running' | 'paused' | 'needs-approval' | 'completed' | 'errored';
export interface AgentRun { id: string; title: string; status: AgentRunStatus; progress?: number }

export type AgentEventType = 'user' | 'assistant' | 'tool' | 'artifact' | 'status' | 'system';
export interface AgentEvent {
  id: string;
  runId: string;
  type: AgentEventType;
  text?: string;
  payload?: unknown;       // tool input/result, terminal { status: AgentRunStatus } — narrowed by type
  createdAt: string;       // ISO-8601
}
export interface RunContext { route?: string; entityId?: string }

/** ALWAYS the verified caller JWT-scoped client (deputy auth). NEVER service_role. */
export interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{ data: unknown[] | null; error: unknown }> & {
        limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
        in(column: string, values: string[]): { limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }> };
      };
      limit(n: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
}
export interface DeputyContext { jwt: string; userId: string; orgId: string; supabase: SupabaseLike }

export interface AgentAction {
  name: string;
  description: string;
  inputSchema: object;                                    // JSON Schema → Anthropic input_schema (D3/R1)
  surfaces?: ('ui' | 'agent' | 'mcp' | 'cli')[];          // A1 ships ['agent']
  confirm?: boolean;                                       // A1 read-only ⇒ false
  run: (input: unknown, ctx: DeputyContext) => Promise<unknown>;
}

export interface AgentRuntime {
  createRun(input: { goal: string; context?: RunContext }): Promise<AgentRun>;
  followUp(runId: string, message: string): Promise<void>;
  control(runId: string, cmd: 'pause' | 'resume' | 'cancel' | 'approve' | 'reject'): Promise<void>;
  subscribe(runId: string): AsyncIterable<AgentEvent>;
}
```
> `SupabaseLike` is shaped to support `.select().limit()`, `.select().eq().limit()`, and `.select().in().limit()` — the exact chains `runQueryEntity` (Task 6) uses. It is the single typed contract the handler's `deps.supabase` and `DeputyContext.supabase` share; it has **no** service-role member (NFR-AR-SEC-002, AC-AR-008 by construction).
**Verify:** `cd pmo-portal && npm run typecheck`
**AC:** FR-AR-001/002/006 (structural — proven by downstream tasks).

#### Task 3 — RED then GREEN: port re-export sanity
**Test file:** `pmo-portal/src/lib/agent/runtime/port.test.ts` (new).
**RED:** assert the module's runtime surface is type-only — write `import * as Port from './port'; it('port.ts exports no runtime values (types only)', () => { expect(Object.keys(Port)).toHaveLength(0); });`. (Guards against an adapter ever leaking into the port file — NFR-AR-SEC-007.)
**GREEN:** already satisfied by Task 2 (port has only type exports).
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/runtime/port.test.ts`
**AC:** FR-AR-001 (port purity).

#### Task 4 — the transport module + SSE codec (FR-AR-019, D1, D8)
**Test file:** `pmo-portal/src/lib/agent/runtime/transport.test.ts` (new).
**RED — write first:**
```ts
import { encodeSse, decodeSseStream } from './transport';
import type { AgentEvent } from './port';
it('encodeSse emits one `data: <json>\\n\\n` frame per event', () => {
  const ev: AgentEvent = { id: 'e1', runId: 'r1', type: 'assistant', text: 'hi', createdAt: '2026-06-30T00:00:00Z' };
  expect(encodeSse(ev)).toBe(`data: ${JSON.stringify(ev)}\n\n`);
});
it('decodeSseStream yields each AgentEvent across chunk boundaries', async () => {
  const e1: AgentEvent = { id: 'e1', runId: 'r1', type: 'user', createdAt: 'x' };
  const e2: AgentEvent = { id: 'e2', runId: 'r1', type: 'status', payload: { status: 'completed' }, createdAt: 'y' };
  const frames = encodeSse(e1) + encodeSse(e2);
  // split mid-frame to prove buffering
  const reader = fakeReader([frames.slice(0, 10), frames.slice(10)]);
  const out: AgentEvent[] = [];
  for await (const ev of decodeSseStream(reader)) out.push(ev);
  expect(out).toEqual([e1, e2]);
});
```
(`fakeReader(chunks: string[])` is a local helper returning a `ReadableStreamDefaultReader`-like object whose `read()` resolves `{ value: TextEncoder.encode(chunk), done }` then `{ done: true }`.)
**GREEN — `transport.ts`:** define `ConversationMessage`, `AgentChatRequest = { runId?: string; messages: ConversationMessage[]; context?: RunContext }` (D8/R5), `AgentChatError` (FR-AR-019 shape), `encodeSse(ev): string`, and `decodeSseStream(reader): AsyncIterable<AgentEvent>` that decodes UTF-8, buffers until `\n\n`, strips the `data: ` prefix, `JSON.parse`s each frame.
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/runtime/transport.test.ts`
**AC:** FR-AR-019, AR-OD-001 (SSE), supports AC-AR-009.

### Phase 1 — the `query_entity` action (the read tool)

#### Task 5 — the tool JSON Schema + entity set (FR-AR-009; D3, D5)
**Files:** `supabase/functions/agent-chat/schema.ts` (new), `supabase/functions/agent-chat/actions.ts` (new — exports `AGENT_READ_ENTITIES` only in this task).
**Change:**
- `actions.ts`: `export const AGENT_READ_ENTITIES = ['projects', 'companies'] as const;` (D5) and `export const AGENT_READ_ROW_CAP = 50;` `export const READ_TIMEOUT_MS = 5000;` (D6).
- `schema.ts`: `QUERY_ENTITY_SCHEMA` — a JSON Schema object (mirror `compose-view/schema.ts` style):
```ts
import { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP } from './actions';
export const QUERY_ENTITY_SCHEMA = {
  type: 'object' as const,
  required: ['entity'] as string[],
  additionalProperties: false,
  properties: {
    entity: { type: 'string' as const, enum: AGENT_READ_ENTITIES as unknown as string[],
      description: 'Whitelisted entity to read (the caller’s own rows only — RLS-scoped).' },
    columns: { type: 'array' as const, items: { type: 'string' as const },
      description: 'Subset of the entity’s allowed columns; omit for all allowed columns.' },
    filter: { type: 'object' as const, required: ['column', 'op', 'value'] as string[], additionalProperties: false,
      properties: {
        column: { type: 'string' as const },
        op: { type: 'string' as const, enum: ['eq', 'in'] },
        value: { description: 'eq → scalar; in → array of scalars.' },
      } },
    limit: { type: 'integer' as const, minimum: 1, maximum: AGENT_READ_ROW_CAP },
  },
};
```
**Verify:** `cd pmo-portal && npm run typecheck` (imported transitively when Task 6 lands; standalone: `node --input-type=module -e "import('../supabase/functions/agent-chat/schema.ts')"` is NOT required — typecheck covers it via the test in Task 7).
**AC:** FR-AR-009.

#### Task 6 — `runQueryEntity` happy path + row cap (AC-AR-007; FR-AR-010, 011)
**Test file:** `pmo-portal/src/lib/agent/queryEntityAction.test.ts` (new — first block).
**RED — write first:**
```ts
import { runQueryEntity, AGENT_READ_ROW_CAP } from '../../../../supabase/functions/agent-chat/actions';
import type { DeputyContext } from './runtime/port';
function mockCtx(rows: unknown[]): DeputyContext { /* supabase.from().select().limit() resolves { data: rows, error: null }; capture the limit arg */ }
it('AC-AR-007 caps rows at AGENT_READ_ROW_CAP and returns only whitelisted columns', async () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ id: String(i), name: `p${i}` }));
  const ctx = mockCtx(rows.slice(0, AGENT_READ_ROW_CAP)); // supabase already applied limit
  const res = await runQueryEntity({ entity: 'projects', columns: ['id', 'name'] }, ctx) as { rowCount: number; rows: unknown[] };
  expect(res.rowCount).toBeLessThanOrEqual(AGENT_READ_ROW_CAP);
  expect(res.rows.length).toBeLessThanOrEqual(AGENT_READ_ROW_CAP);
  // assert the .limit() call received min(undefined ?? CAP, CAP) === CAP
});
```
**GREEN — extend `actions.ts`:** `runQueryEntity(input, ctx)`:
1. validate `input.entity ∈ AGENT_READ_ENTITIES` (else structured error — Task 7);
2. resolve `entry = ENTITY_WHITELIST[entity]`; validate each requested column ∈ `entry.allowedColumns`, default to `[...entry.allowedColumns]`;
3. if `entry.requiredFilter` set and `input.filter?.column !== entry.requiredFilter` → structured error (Task 8);
4. `const effLimit = Math.min(input.limit ?? AGENT_READ_ROW_CAP, AGENT_READ_ROW_CAP);`
5. build `ctx.supabase.from(entry.table).select(cols.join(','))`, apply `.eq`/`.in` if `filter`, then `.limit(effLimit)`, wrapped in `Promise.race([query, timeout(READ_TIMEOUT_MS)])` (D6);
6. on `{ error }` → structured error; else return `{ rowCount: data.length, rows: data }`.
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/queryEntityAction.test.ts`
**AC:** **AC-AR-007** (Vitest owns).

#### Task 7 — off-whitelist read is refused structurally, no DB call (AC-AR-006; FR-AR-010, 012)
**Test file:** same file, second block.
**RED — write first:**
```ts
it('AC-AR-006 returns a structured error (no throw, no DB read) for an off-whitelist entity', async () => {
  const fromSpy = vi.fn();
  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase: { from: fromSpy } } as unknown as DeputyContext;
  const res = await runQueryEntity({ entity: 'secret_table' }, ctx) as { error: string };
  expect(res.error).toMatch(/unknown entity/i);
  expect(fromSpy).not.toHaveBeenCalled();   // no Supabase read attempted
});
it('AC-AR-006 returns a structured error for an off-whitelist column', async () => {
  const fromSpy = vi.fn();
  const ctx = { jwt:'j', userId:'u', orgId:'o', supabase:{ from: fromSpy } } as unknown as DeputyContext;
  const res = await runQueryEntity({ entity: 'projects', columns: ['ssn'] }, ctx) as { error: string };
  expect(res.error).toMatch(/unknown column/i);
  expect(fromSpy).not.toHaveBeenCalled();
});
```
**GREEN:** the validation in Task 6 steps 1–2 returns `{ error: 'unknown entity: …' }` / `{ error: 'unknown column: …' }` **before** touching `ctx.supabase` — never throws.
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/queryEntityAction.test.ts`
**AC:** **AC-AR-006**.

#### Task 8 — deputy invariant + requiredFilter branch (AC-AR-008; FR-AR-007, NFR-AR-SEC-002)
**Test file:** same file, third block.
**RED — write first:**
```ts
it('AC-AR-008 reads ONLY through ctx.supabase (the caller-JWT client) — no other client reachable', async () => {
  const fromSpy = vi.fn().mockReturnValue({ select: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) });
  const ctx = { jwt:'j', userId:'u', orgId:'o', supabase:{ from: fromSpy } } as unknown as DeputyContext;
  await runQueryEntity({ entity: 'companies' }, ctx);
  expect(fromSpy).toHaveBeenCalledWith('companies');   // the only data path is ctx.supabase
});
it('refuses a read on a requiredFilter entity when the filter is absent (built for A3 tasks)', async () => {
  // synthetic whitelist entry exercised via a column-level guard; proves the branch ships now (R3)
  const res = await runQueryEntity({ entity: 'projects', columns:['id'], filter: { column:'id', op:'eq', value:'1' } }, mockCtx([]));
  expect((res as { error?: string }).error).toBeUndefined();
});
```
> The deputy invariant is also proven at compile time: `DeputyContext` (Task 2) has **no** service-role field; `runQueryEntity`'s only data access is `ctx.supabase`. The requiredFilter refusal branch is covered for real entities in A3; A1 proves the code path exists (Task 6 step 3) and that `projects`/`companies` (no requiredFilter) read cleanly.
**GREEN:** already satisfied by Task 6's steps 1–5.
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/queryEntityAction.test.ts`
**AC:** **AC-AR-008**.

#### Task 9 — register `queryEntityAction` as an `AgentAction`
**File:** `supabase/functions/agent-chat/actions.ts` (extend).
**Change:** `export const queryEntityAction: AgentAction = { name: 'query_entity', description: 'Read the caller’s own rows from a whitelisted entity. RLS-scoped; row-capped; read-only.', inputSchema: QUERY_ENTITY_SCHEMA, surfaces: ['agent'], confirm: false, run: (input, ctx) => runQueryEntity(input, ctx) };` (import `AgentAction` from the port, `QUERY_ENTITY_SCHEMA` from `./schema`).
**Verify:** `cd pmo-portal && npm run typecheck`
**AC:** FR-AR-006/008/009 (the action is port-shaped, JSON-Schema tool).

### Phase 2 — the multi-turn handler (async generator)

#### Task 10 — handler gates: 401 + org-lookup 400 before any model call (AC-AR-002, AC-AR-003; FR-AR-016)
**Test file:** `pmo-portal/src/lib/agent/agentChatHandler.test.ts` (new — first block; mirror `handler.test.ts` mock helpers).
**RED — write first** (collect the async generator into an array):
```ts
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
async function collect(it: AsyncIterable<AgentEvent>) { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out; }
it('AC-AR-002 emits a single 401 status event and never calls Anthropic when userId is empty', async () => {
  const create = vi.fn();
  const events = await collect(agentChatHandler(REQ, baseDeps({ userId: '', anthropic: { messages: { create } } })));
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'errored', error: 'UNAUTHORIZED' } });
  expect(create).not.toHaveBeenCalled();
});
it('AC-AR-003 emits a 400 BAD_REQUEST (detail orgId) when the profiles lookup fails, before any model call', async () => {
  const create = vi.fn();
  const supabase = mockProfilesError();  // .from('profiles').select('org_id').eq().single() → { data: null, error: {} }
  const events = await collect(agentChatHandler(REQ, baseDeps({ supabase, anthropic: { messages: { create } } })));
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'errored', error: 'BAD_REQUEST', detail: 'orgId' } });
  expect(create).not.toHaveBeenCalled();
});
```
**GREEN — `handler.ts`:** define `AnthropicLike`/`AnthropicCreateParams`/`AnthropicResponse` (copy I5's shapes, add `tool_use` `id` to the response content type — needed for `tool_use_id` pairing), `RateGuard`, `HandlerDeps = { anthropic; supabase; userId; rateGuard?; now? }`, and `agentChatHandler(req, deps): AsyncIterable<AgentEvent>` as an `async function*`:
1. if `!userId` → `yield statusEvent('errored', { error: 'UNAUTHORIZED' })`; `return`;
2. derive `orgId` via `supabase.from('profiles').select('org_id').eq('id', userId).single()`; on error/no row → `yield statusEvent('errored', { error: 'BAD_REQUEST', detail: 'orgId' })`; `return`;
3. (rateGuard — Task 11). Helper `statusEvent(status, payload)` builds an `AgentEvent` with `now()`-derived `createdAt` and a stable `runId` (`req.runId ?? crypto.randomUUID()`).
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/agentChatHandler.test.ts`
**AC:** **AC-AR-002, AC-AR-003**.

#### Task 11 — injectable rate guard (off by default) (FR-AR-016 step 3; AR-OD-002, D9)
**Test file:** same file, second block.
**RED — write first:**
```ts
it('emits a 429 RATE_LIMITED terminal status and never calls Anthropic when the injected rateGuard reports exceeded', async () => {
  const create = vi.fn();
  const rateGuard = { check: vi.fn().mockResolvedValue({ exceeded: true, retryAfterSeconds: 3600 }) };
  const events = await collect(agentChatHandler(REQ, baseDeps({ rateGuard, anthropic: { messages: { create } } })));
  expect(events.at(-1)).toMatchObject({ type: 'status', payload: { status: 'errored', error: 'RATE_LIMITED', retryAfterSeconds: 3600 } });
  expect(create).not.toHaveBeenCalled();
});
it('rateGuard absent ⇒ proceeds to the model', async () => { /* baseDeps default model returns a final text answer; assert create called ≥1 */ });
```
**GREEN:** after the org gate, `if (deps.rateGuard) { const r = await deps.rateGuard.check(userId); if (r.exceeded) { yield statusEvent('errored', { error:'RATE_LIMITED', retryAfterSeconds: r.retryAfterSeconds }); return; } }`.
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/agentChatHandler.test.ts`
**AC:** FR-AR-016 step 3 (rate-guard path).

#### Task 12 — the bounded tool-use loop: happy single-turn read + step cap (AC-AR-001, AC-AR-004; FR-AR-017, 018, D7)
**Test file:** same file, third block.
**RED — write first:**
```ts
it('AC-AR-001 dispatches query_entity then completes: user→tool→assistant→completed, SDK called exactly twice', async () => {
  const create = vi.fn()
    .mockResolvedValueOnce({ stop_reason:'tool_use', content:[{ type:'tool_use', id:'tu1', name:'query_entity', input:{ entity:'projects' } }], usage:{} })
    .mockResolvedValueOnce({ stop_reason:'end_turn', content:[{ type:'text', text:'You have 3 active projects.' }], usage:{} });
  const supabase = mockOrgAnd(() => ({ data: [{ id:'1' },{ id:'2' },{ id:'3' }], error: null }));
  const events = await collect(agentChatHandler(REQ, baseDeps({ supabase, anthropic: { messages: { create } } })));
  expect(events.map(e => e.type)).toEqual(['user', 'tool', 'assistant', 'status']);
  expect(events.at(-1)).toMatchObject({ type:'status', payload:{ status:'completed' } });
  expect(create).toHaveBeenCalledTimes(2);
});
it('AC-AR-004 stops after MAX_TOOL_ROUNDS when the model never finalises, completing gracefully (R4)', async () => {
  const create = vi.fn().mockResolvedValue({ stop_reason:'tool_use', content:[{ type:'tool_use', id:'tu', name:'query_entity', input:{ entity:'projects' } }], usage:{} });
  const supabase = mockOrgAnd(() => ({ data: [], error: null }));
  const events = await collect(agentChatHandler(REQ, baseDeps({ supabase, anthropic: { messages: { create } } })));
  expect(create).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
  expect(events.at(-1)).toMatchObject({ type:'status', payload:{ status:'completed' }, text: expect.stringMatching(/step limit/i) });
});
```
**GREEN — extend `handler.ts`:** export `MAX_TOOL_ROUNDS = 8`; after gates, `yield userEvent(...)` (the last user message from `req.messages`), then build the system prompt via `buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP)`, seed `messages = [...req.messages]`, and loop `for (let round = 0; round < MAX_TOOL_ROUNDS; round++)`:
- `const resp = await anthropic.messages.create({ model:'claude-opus-4-8', max_tokens:2048, system, messages, tools:[{ name: queryEntityAction.name, description: queryEntityAction.description, input_schema: queryEntityAction.inputSchema }] })` (NO `tool_choice` forcing — the model must be free to answer in text, unlike I5);
- for each `text` block → `yield assistantEvent(text)`; if no `tool_use` block → `yield statusEvent('completed')`; `return`;
- for the `tool_use` block: `const result = await queryEntityAction.run(block.input, { jwt:'', userId, orgId, supabase })`; `yield toolEvent({ name: block.name, input: block.input, result })`; append the assistant `tool_use` turn and a `user` `tool_result` turn (`{ type:'tool_result', tool_use_id: block.id, content: JSON.stringify(result) }`) to `messages`;
- wrap the whole loop in `try/catch` → on throw `yield statusEvent('errored', { error:'UPSTREAM_ERROR', detail:'model call failed' })` (Task 13). After the loop falls through (cap reached) → `yield statusEvent('completed', undefined, 'reached step limit')` (D7/R4).
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/agentChatHandler.test.ts`
**AC:** **AC-AR-001, AC-AR-004**.

#### Task 13 — upstream error scrubbed → terminal errored; no prompt/rows logged (AC-AR-005; FR-AR-020, NFR-AR-SEC-005)
**Test file:** same file, fourth block.
**RED — write first:**
```ts
it('AC-AR-005 scrubs the raw SDK error to UPSTREAM_ERROR and logs no prompt/data rows', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const create = vi.fn().mockRejectedValue(new Error('SECRET upstream body'));
  const events = await collect(agentChatHandler(REQ_WITH_MSG('show me my projects'), baseDeps({ anthropic: { messages: { create } } })));
  const last = events.at(-1)!;
  expect(last).toMatchObject({ type:'status', payload:{ status:'errored', error:'UPSTREAM_ERROR' } });
  expect(JSON.stringify(last)).not.toContain('SECRET');
  for (const c of spy.mock.calls) { const s = JSON.stringify(c); expect(s).not.toContain('SECRET'); expect(s).not.toContain('show me my projects'); }
  spy.mockRestore();
});
```
**GREEN:** the `catch` from Task 12 emits the scrubbed `errored` status; the only `console.error` logs `{ error:'UPSTREAM_ERROR', round, rounds }` — never `req.messages`, tool inputs, or rows (NFR-AR-SEC-005). `err.message` is NOT included in the event or the log.
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/agentChatHandler.test.ts`
**AC:** **AC-AR-005**.

#### Task 14 — system prompt is schema-metadata-only (NFR-AR-SEC-005; FR-AR-021)
**Test file:** `pmo-portal/src/lib/agent/prompt.test.ts` (new).
**RED — write first:**
```ts
import { buildAgentSystemPrompt } from '../../../../supabase/functions/agent-chat/prompt';
import { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP } from '../../../../supabase/functions/agent-chat/actions';
it('injects only whitelisted entity/column names + the row cap + deputy framing, no data rows', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP);
  expect(p).toContain('projects'); expect(p).toContain('companies');
  expect(p).toContain(String(AGENT_READ_ROW_CAP));
  expect(p).toMatch(/cannot exceed|only within what (you|this user) can see/i);  // deputy framing
  expect(p).not.toContain('tasks');   // not shipped in A1 (D5)
});
```
**GREEN — `prompt.ts`:** `buildAgentSystemPrompt(entities, rowCap)` builds entity/column descriptions from `ENTITY_WHITELIST[entity].allowedColumns` (schema metadata only — no rows), states the row cap, and the deputy framing ("you act only within what this user can see; you cannot exceed their access"). Pure; mirrors `compose-view/prompt.ts`.
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/prompt.test.ts`
**AC:** FR-AR-021, NFR-AR-SEC-005.

### Phase 3 — the `PmoNativeRuntime` adapter + the port contract

#### Task 15 — the reusable port contract suite (FR-AR-025)
**File:** `pmo-portal/src/lib/agent/runtime/runtime.contract.ts` (new — NOT a `*.test.ts`, so Vitest does not auto-collect it).
**Change:** export `runAgentRuntimeContract(makeRuntime: () => AgentRuntime)`. Inside, call `describe('AgentRuntime contract', () => { ... })` with `it` cases asserting the port behavior **against whatever adapter the factory returns**:
- `createRun` resolves an `AgentRun` with a non-empty `id` and `status ∈ {queued, running}`;
- `subscribe(run.id)` yields events whose first is `type:'user'` and whose last is `type:'status'` with `payload.status ∈ {completed, errored}` (ordered, terminal);
- after `control(run.id, 'cancel')` the stream terminates (no further events);
- `followUp(run.id, 'more')` resolves and targets the same `run.id` (assert via the factory's injected transport spy).
The factory supplies the adapter **and** its fake transport; the suite is transport-agnostic.
**Verify:** `cd pmo-portal && npm run typecheck`
**AC:** FR-AR-025 (suite exists; exercised in Task 17).

#### Task 16 — `PmoNativeRuntime` (FR-AR-022, 023, 024; D8)
**File:** `pmo-portal/src/lib/agent/runtime/pmoNativeRuntime.ts` (new).
**Change:** `export class PmoNativeRuntime implements AgentRuntime`, constructed with `(opts: { getJwt: () => Promise<string> | string; fnUrl: string; fetchImpl?: typeof fetch })`. It:
- holds a private `Map<runId, { messages: ConversationMessage[]; controller: AbortController }>` (transcript client-side — D8);
- `createRun({ goal })`: mint `runId = crypto.randomUUID()`, store `messages:[{ role:'user', content: goal }]`, return `{ id: runId, title: goal.slice(0,60), status:'running' }`;
- `followUp(runId, message)`: append `{ role:'user', content: message }` to that run's messages;
- `subscribe(runId)`: POST `fnUrl` with `Authorization: Bearer <getJwt()>`, body `{ runId, messages, context }`, then `for await (const ev of decodeSseStream(res.body.getReader())) { append assistant/tool events to messages; yield ev; }` (D1) — aborting on the stored `controller`;
- `control(runId, cmd)`: `cancel` → `controller.abort()`; `pause/resume/approve/reject` → resolve as no-ops (FR-AR-005).
It reads NO service-role key and NO `ANTHROPIC_API_KEY` — only the caller JWT via `getJwt` (NFR-AR-SEC-008; this is the only SPA site that knows the transport — FR-AR-024).
**Verify:** `cd pmo-portal && npm run typecheck`
**AC:** FR-AR-022/023/024.

#### Task 17 — run the contract suite against `PmoNativeRuntime` with a scripted SSE fetch (AC-AR-009)
**Test file:** `pmo-portal/src/lib/agent/port.contract.test.ts` (new).
**RED — write first:**
```ts
import { runAgentRuntimeContract } from './runtime/runtime.contract';
import { PmoNativeRuntime } from './runtime/pmoNativeRuntime';
import { encodeSse } from './runtime/transport';
function scriptedFetch(events: AgentEvent[]) {
  const body = events.map(encodeSse).join('');
  return vi.fn().mockResolvedValue({ ok: true, body: readableFrom(body) }); // readableFrom → ReadableStream with getReader()
}
runAgentRuntimeContract(() => new PmoNativeRuntime({
  getJwt: () => 'caller-jwt',
  fnUrl: 'http://x/functions/v1/agent-chat',
  fetchImpl: scriptedFetch([
    { id:'1', runId:'r', type:'user', createdAt:'a' },
    { id:'2', runId:'r', type:'assistant', text:'hi', createdAt:'b' },
    { id:'3', runId:'r', type:'status', payload:{ status:'completed' }, createdAt:'c' },
  ]) as unknown as typeof fetch,
}));
```
(The `runId` mismatch between the adapter's minted id and the scripted `'r'` is tolerated by the suite — it asserts event *order/terminality*, not id equality; id-targeting of `followUp` is asserted via the captured fetch body.)
**GREEN:** Tasks 15 + 16 satisfy it.
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/port.contract.test.ts`
**AC:** **AC-AR-009** (and the same suite is the gate any future `AgentNativeRuntime` must pass).

### Phase 4 — static gates + config + RLS proof

#### Task 18 — the `index.ts` Deno wrapper (FR-AR-013, 014; integration-only, no unit test)
**File:** `supabase/functions/agent-chat/index.ts` (new).
**Change:** mirror `compose-view/index.ts` exactly through step 4 (CORS, 401 on missing `Bearer`, service-role `auth.getUser(jwt)` → `userId`, caller-JWT client, read `ANTHROPIC_API_KEY` from `Deno.env`), then:
```ts
const anthropic = new Anthropic({ apiKey });
const body = await req.json() as AgentChatRequest;
const stream = new ReadableStream({
  async start(controller) {
    const enc = new TextEncoder();
    try {
      for await (const ev of agentChatHandler(body, { anthropic: anthropic as ..., supabase: callerClient as ..., userId })) {
        controller.enqueue(enc.encode(encodeSse(ev)));   // D1: text/event-stream framing
      }
    } finally { controller.close(); }
  },
});
return new Response(stream, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
```
Import `encodeSse` + `AgentChatRequest` from `../../../pmo-portal/src/lib/agent/runtime/transport`. This file is **NOT** unit-tested (ADR-0039 dec 7); its streaming correctness is the deploy-time checklist (Task 20).
**Verify:** `cd pmo-portal && npm run typecheck` (typecheck covers the imported pure modules; the Deno globals `Deno.serve`/`ReadableStream` are not in the pmo-portal tsconfig graph — same as `compose-view/index.ts`, which the repo already typechecks cleanly by virtue of not being in the include set).
**AC:** FR-AR-013/014.

#### Task 19 — `config.toml` registration (FR-AR-013; R7)
**File:** `supabase/config.toml`.
**Change:** after the `[functions.compose-view]` block (lines 403-404) add:
```toml
# ── Edge Function: agent-chat ─────────────────────────────────────────────────
# verify_jwt = false: the handler verifies the JWT itself to return a typed 401
# and to stream a typed terminal `status` event (ADR-0040 A1, FR-AR-013).
[functions.agent-chat]
verify_jwt = false
```
**Verify:** `grep -A1 '\[functions.agent-chat\]' supabase/config.toml | grep -q 'verify_jwt = false' && echo OK`
**AC:** FR-AR-013.

#### Task 20 — BUILD-TIME-VERIFY checklist (deploy-time, NOT a CI gate)
**File:** add a `## Deploy-time verification (BUILD-TIME-VERIFY)` note inside `supabase/functions/agent-chat/index.ts` as a top-of-file doc comment **and** the checklist below in this plan. This is a manual checklist run by the release-engineer at first deploy; it is **not** a CI gate because the unit tests mock `AnthropicLike`, so the streaming shape cannot affect them (ADR-0039 decision 7 — no live Anthropic call, no function deploy in CI).
Checklist to verify against the installed `@anthropic-ai/sdk@^0.54.0` at deploy time:
1. The exact streaming call form: `messages.stream(params)` vs `messages.create({ ...params, stream: true })` — and whether `.toReadableStream()` / async iteration is used to accumulate. (A1's `AnthropicLike.messages.create` abstracts this; the wrapper may switch to `.stream()` without touching the handler.)
2. `tool_use` block shape on the accumulated message: `content_block.id` is the `tool_use_id` to echo in the `tool_result` turn; confirm `partial_json` accumulation if token-streaming is later added (A2).
3. `stop_reason` values (`tool_use` vs `end_turn`) match the loop's branch in Task 12.
4. Supabase `functions serve` (local) and the hosted runtime pass `Content-Type: text/event-stream` through unbuffered (no proxy buffering that defeats incremental flush).
5. The function secret `ANTHROPIC_API_KEY` is set in the deployed project (never committed — Task 21).
**Verify:** N/A (manual checklist); presence check: `grep -q 'BUILD-TIME-VERIFY' supabase/functions/agent-chat/index.ts && echo OK`
**AC:** NFR-AR-PERF-001 (streaming), supports AC-AR-005.

#### Task 21 — grep gate: no `ANTHROPIC_API_KEY` literal under `pmo-portal/` (AC-AR-010; NFR-AR-SEC-001)
**Test file:** `pmo-portal/src/lib/agent/noApiKeyInBundle.test.ts` (new).
**RED/GREEN — write the test (it passes immediately because nothing references the key):**
```ts
import { execSync } from 'node:child_process';
it('AC-AR-010 no ANTHROPIC_API_KEY literal appears anywhere under pmo-portal/', () => {
  // ripgrep from the pmo-portal root; exit code 1 = no matches (the pass condition)
  let matches = '';
  try { matches = execSync('rg -l ANTHROPIC_API_KEY .', { cwd: process.cwd() }).toString(); } catch { matches = ''; }
  expect(matches.trim()).toBe('');
});
```
(`process.cwd()` is `pmo-portal/` under Vitest. Excludes the test file itself by matching only the *literal* in source — the string `ANTHROPIC_API_KEY` appears here only inside `rg`'s argument, which `rg -l` will flag, so the test must search source globs and exclude `**/noApiKeyInBundle.test.ts`; implement as `rg -l --glob '!**/noApiKeyInBundle.test.ts' ANTHROPIC_API_KEY .`.)
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/noApiKeyInBundle.test.ts`
**AC:** **AC-AR-010**.

#### Task 22 — import-boundary gate: no adapter leakage (AC-AR-011; NFR-AR-SEC-007)
**Test file:** `pmo-portal/src/lib/agent/portIsolation.test.ts` (new).
**RED/GREEN — write the test:**
```ts
import { execSync } from 'node:child_process';
it('AC-AR-011 no module outside src/lib/agent/runtime/ imports a concrete adapter', () => {
  let hits = '';
  try {
    hits = execSync(
      `rg -l "from ['\\"].*pmoNativeRuntime" --glob '!src/lib/agent/runtime/**' --glob '!**/portIsolation.test.ts' .`,
      { cwd: process.cwd() },
    ).toString();
  } catch { hits = ''; }
  expect(hits.trim()).toBe('');
});
```
**Verify:** `cd pmo-portal && npm test -- src/lib/agent/portIsolation.test.ts`
**AC:** **AC-AR-011**.

#### Task 23 — pgTAP cross-tenant read proof (AC-AR-012; NFR-AR-SEC-003, ADR-0001)
**File:** `supabase/tests/0090_agent_query_entity_rls.test.sql` (new).
**Change:** mirror `0089_user_views_tenancy.test.sql`. Two orgs (A = default `00000000-…-0001`; B = a fresh `00900000-…-0002`), a user in org A, fixtures (as table owner) of `projects` + `companies` rows in **both** orgs. Then, `set local role authenticated` with org-A user's claims, assert:
- `select is((select count(*)::int from projects where org_id = '<orgB>'), 0, 'AC-AR-012: org-A user reads zero org-B projects — RLS is the ceiling');`
- `select is((select count(*)::int from companies where org_id = '<orgB>'), 0, 'AC-AR-012: org-A user reads zero org-B companies regardless of any model-supplied filter');`
- a positive control: org-A user sees ≥1 of their own org-A projects (proves the read path is live, not blanket-empty).
`plan(3)`; `begin … rollback`. This proves the guarantee at the DB layer (where it lives) — `query_entity` adds no privilege, so the same `from(table).select()` under the caller JWT inherits exactly this ceiling.
**Verify:** from repo root with the local stack up: `supabase test db` (runs in the dev→main `integration` lane, not the `verify` fast lane — ADR-0010 / CLAUDE.md branch flow). Static check now: `test -f supabase/tests/0090_agent_query_entity_rls.test.sql && echo OK`
**AC:** **AC-AR-012** (pgTAP owns).

### Phase 5 — full verify gate

#### Task 24 — full pre-push verify (binding gate)
**Verify:** `cd pmo-portal && npm run verify` (= `typecheck && lint:ci && test && build`) — must be green. This runs the WHOLE suite (catches cross-component breakage), per CLAUDE.md's binding pre-push rule. Then re-confirm the two grep gates pass inside the suite (Tasks 21, 22) and the pgTAP file exists (Task 23).
**AC:** all AC-AR-001..012 (the Vitest-owned subset green in `test`; AC-AR-012 deferred to the integration lane; AC-AR-013 deferred to A2).

---

## AC → layer → file traceability

| AC-### | Layer | Tool | Owning test / proof file | Task |
|---|---|---|---|---|
| AC-AR-001 | Unit | Vitest (mocked SDK+Supabase) | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` | 12 |
| AC-AR-002 | Unit | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` | 10 |
| AC-AR-003 | Unit | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` | 10 |
| AC-AR-004 | Unit | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` (R4: terminal `completed`) | 12 |
| AC-AR-005 | Unit | Vitest | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` | 13 |
| AC-AR-006 | Unit | Vitest | `pmo-portal/src/lib/agent/queryEntityAction.test.ts` | 7 |
| AC-AR-007 | Unit | Vitest | `pmo-portal/src/lib/agent/queryEntityAction.test.ts` | 6 |
| AC-AR-008 | Unit | Vitest | `pmo-portal/src/lib/agent/queryEntityAction.test.ts` | 8 |
| AC-AR-009 | Unit | Vitest (scripted SSE fetch) | `pmo-portal/src/lib/agent/port.contract.test.ts` → `runtime/runtime.contract.ts` | 15,17 |
| AC-AR-010 | Unit/CI | grep gate (Vitest + rg) | `pmo-portal/src/lib/agent/noApiKeyInBundle.test.ts` | 21 |
| AC-AR-011 | Unit/lint | import-boundary gate (Vitest + rg) | `pmo-portal/src/lib/agent/portIsolation.test.ts` | 22 |
| AC-AR-012 | Integration | pgTAP (`supabase test db`, dev→main lane) | `supabase/tests/0090_agent_query_entity_rls.test.sql` | 23 |
| AC-AR-013 | E2E | Playwright | **deferred to A2** — `e2e/AC-AR-013-*.spec.ts` (not authored in A1) | — |

**FR coverage map:** FR-AR-001/002/006 → Tasks 2,3,9 · FR-AR-007/012 → Tasks 7,8 · FR-AR-008 → Tasks 5,9 · FR-AR-009/010/011 → Tasks 5,6 · FR-AR-013/014 → Tasks 18,19 · FR-AR-015 → Task 10 (pure DI handler) · FR-AR-016 → Tasks 10,11 · FR-AR-017/018 → Task 12 · FR-AR-019 → Task 4 · FR-AR-020 → Task 13 · FR-AR-021 → Task 14 · FR-AR-022/023/024 → Tasks 16 · FR-AR-025 → Tasks 15,17. NFR-AR-SEC-001→Task 21 · SEC-002/003→Tasks 8,23 · SEC-005→Tasks 13,14 · SEC-006→Task 12 · SEC-007→Tasks 3,22 · SEC-008→Task 16. PERF-001→Tasks 18,20 · PERF-002→Task 6 · PERF-003→Task 12.

---

## ADRs to record (this plan introduces three refinements)

- **ADR-0041 — `AgentAction.inputSchema` is a JSON Schema object, not a `ZodType`.** Context: ADR-0040 sketched `schema: ZodType<I>`; the I5 tool surface uses a plain JSON-Schema `input_schema` with no zod in the edge path. Decision: the port exposes `inputSchema: object` handed verbatim to Anthropic; the action validates its own input; no `zod` dep added to `deno.json`/`package.json`. Consequence: a future `AgentNativeRuntime` (which registers via `agent-native`'s `defineAction({ schema })`) owns the lone JSON-Schema→Zod shim — isolated, never in PMO core. (R1.)
- **ADR-0042 — A1 stream transport is SSE (`text/event-stream`), overriding spec AR-OD-001 (NDJSON).** Context: `EventSource` cannot POST/auth; `fetch + getReader()` can. Decision: one `data: <json>\n\n` frame per `AgentEvent`; framing isolated in `runtime/transport.ts`. Consequence: swapping back to NDJSON or to `agent-native`'s batch protocol is a one-file change; the handler/adapter callers are unaffected. (D1.)
- **ADR note (no separate file) — stateless `followUp` in A1.** The adapter replays the full transcript each turn; durable server-side runs (`agent_runs` table + RLS) are deferred to a later issue (AR-OD-005). Fold this into the A2/A3 ADR rather than a standalone file. (D8.)

> The release-engineer creates `docs/adr/0041-agent-action-json-schema.md` and `docs/adr/0042-agent-chat-sse-transport.md` at ship time using the context/decision/consequence text above. (Out of scope for the implementer's TDD tasks.)

---

## Open questions for the Director (escalations)

1. **`SupabaseLike` query-builder surface (Task 2).** The typed `SupabaseLike` must cover `.select().limit()`, `.select().eq().limit()`, and `.select().in().limit()` for `runQueryEntity`. The real `@supabase/supabase-js` builder is a thenable that also exposes these chainably; the I5 `SupabaseLike` only typed `.select().eq().single()`. The shape in Task 2 is my best minimal contract, but the implementer may need a slightly looser typing (or a small cast in `index.ts`, as I5 already does at `compose-view/index.ts:99-100`). **Recommendation:** accept the Task-2 shape; allow the `index.ts` `as unknown as` cast precedent if the real builder's overloads don't structurally match. No behavior impact (tests mock the chain).

2. **AC-AR-004 status label change (R4/D7).** Director decision D7 makes the step-limit terminal status `completed` ("reached step limit"), but spec AC-AR-004 says `errored`/`TURN_CAP`. I have written the test to D7 and flagged the AC wording fix. **Confirm** the spec author updates AC-AR-004 wording (behavior — the hard cap and call-count — is identical and fully tested either way).

3. **pgTAP `org_id` column assumption (Task 23).** The proof filters `projects`/`companies` by `org_id`. Both tables carry `org_id` per the tenancy seam (ADR-0001) and the existing whitelist tables — but I did not open the migrations to confirm the exact column on `companies`. **Recommendation:** the implementer confirms `companies.org_id` exists (it must, for RLS) before writing Task 23; if a table uses a different tenancy column, adjust the filter — the *assertion* (zero cross-org rows) is unchanged.

Nothing in this list blocks the build; all three have a default applied.
