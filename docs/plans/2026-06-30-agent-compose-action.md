# Plan — A4: compose-a-view as an agent action

**Date:** 2026-06-30
**Feature:** `compose_view` `AgentAction` (ADR-0040 Option A, the final A-slice of the in-app agent)
**Spec:** `docs/specs/agent-compose-action.spec.md` (prefix **CV**)
**ADRs:** ADR-0040 (Option A behind a B-shaped seam), ADR-0039 (untrusted-output boundary), ADR-0036
(deputy model / I2 compiler / I3 renderer), ADR-0010 (test pyramid), ADR-0017 (repository seam),
ADR-0001 (org_id seam). **New:** ADR-0041 (see Task 0 — the model-calling-action capability seam).
**Author:** eng-planner (Claude Opus 4.8)
**Status:** Ready to build

---

## 0. What this plan builds (and what it explicitly does NOT)

A4 wires the existing I5 compose-and-repair logic into the A1 `agent-chat` deputy loop as a
`compose_view` `AgentAction`, emits a server-validated `CompositionSpec` as an `artifact` `AgentEvent`,
renders it inline in the `AssistantPanel` via the I3 `HydratedPrimitive` machinery, and offers a
**Save to My Views** affordance routing through the existing `useUserViewMutations`. Agent proposes;
user disposes. **No second validator, no service_role, no auto-persist** (Director D-A4-1..4).

**Out of scope (do NOT build — spec §10):** a `save_view` agent action, the `AgentNativeRuntime`
sidecar adapter, durable transcript/artifact persistence, multi-artifact layout, artifact edit/refine.

---

## 1. Design decisions (brainstormed, one at a time; the load-bearing ones)

### D1 — The compose action needs the Anthropic SDK, but `DeputyContext` does not carry it (ARCHITECTURAL → ADR-0041)

`AgentAction.run(input, ctx: DeputyContext)` (`port.ts`) receives only `{ jwt, userId, orgId, supabase }`.
`queryEntityAction` needs nothing more. But `compose_view` must call the model (`composeSpec` needs an
`AnthropicLike`), which lives in `agentChatHandler`'s `HandlerDeps.anthropic`, NOT in `DeputyContext`.

Three options were considered:

- **(a) Add `anthropic?` to `DeputyContext`.** Pollutes the port — every action and both adapters would
  carry a model client they don't need; weakens the "deputy = caller JWT + supabase, nothing else"
  invariant (NFR-AR-SEC-002 / port-isolation tests). Rejected.
- **(b) Special-case `compose_view` in the handler's dispatch:** the handler owns `deps.anthropic`;
  when it sees a `compose_view` tool-use block it calls `composeSpec(prompt, orgId, { anthropic, userId })`
  directly (not via the generic `action.run`). `composeViewAction` still exists in the catalog (for the
  tool schema + name + `confirm:false`), and exposes a thin `run` that the handler invokes with an
  injected `anthropic` via a typed `ComposeActionDeps`. **Chosen.** It keeps the port pure, keeps the
  model client server-only, and matches how the handler already special-cases the single tool today.
- **(c) Bake the SDK into the action module.** Breaks the "no SDK in pmo-portal" + DI/testability rules
  (the whole edge fn is pure-with-injected-IO). Rejected.

**Decision (D1):** `composeViewAction` is a `ComposeAction` — an `AgentAction` whose `run` takes an extra
typed deps bag `{ anthropic, now? }` curried in by the handler at dispatch:
`runComposeView(input, ctx, deps) → { spec, repairAttempts, tokensUsed, title } | { error, code }`. The
exported `composeViewAction.run(input, ctx)` closes over a handler-provided `anthropic` (set when the
handler builds its catalog). The port type is unchanged. Recorded as **ADR-0041**.

### D2 — Extract `composeSpec` from `composeViewHandler` (spec FR-CV-004, §6)

`composeViewHandler` (compose-view/handler.ts) inlines the model-call + compile + bounded-repair loop and
returns it only inside the 200 body. Extract that loop into a pure
`composeSpec(prompt, orgId, deps): Promise<{ spec, repairAttempts, tokensUsed }>` (throws
`ComposeSpecError` on exhaustion/upstream). `composeViewHandler` keeps its gates (401/400/429/502) and
calls `composeSpec`; `runComposeView` calls the same `composeSpec`. Zero new compose logic; one shared path
(D-A4-1, NFR-CV-SEC-001). Gate (3) org-match stays in the HTTP handler only (CV-OQ-002: trust `ctx.orgId`
in the agent path — `agentChatHandler` already validated org at its Gate 2).

### D3 — `composeSpec` must surface `repairAttempts` + `tokensUsed` (not just the spec)

Current handler tracks `repairAttempts`/`totalTokensUsed` locally. The extracted `composeSpec` returns
them so the artifact payload (FR-CV-007) can carry `repairAttempts` + `tokensUsed`, and so the error path
can report them. `ComposeSpecError` carries `{ code: 'REPAIR_EXHAUSTED' | 'UPSTREAM_ERROR', repairAttempts,
tokensUsed }`.

### D4 — Test files co-locate under `pmo-portal/src/lib/agent/*.test.ts`, NOT `supabase/functions/**` (RECONCILIATION)

The spec's traceability table names `supabase/functions/agent-chat/handler.test.ts` etc. The **actual repo
convention** (and the brief) is that edge-fn unit tests live at `pmo-portal/src/lib/agent/*.test.ts` and
import the Deno modules by relative path (Option B — e.g. `agentChatHandler.test.ts`,
`queryEntityAction.test.ts` already do exactly this). All A4 edge-fn tests follow that convention. This is
the single largest reconciliation; see §6.

### D5 — Extract `HydratedPrimitive` to a shared module (spec CV-OD-003 / CV-OQ-003)

`HydratedPrimitive` is a local (un-exported) function inside the route component
`pages/UserViewRenderer.tsx`. `ArtifactSlot` must reuse it verbatim (FR-CV-013 — no fork). Move it +
its `categoryMetricCols` helper to `src/components/dashboard/HydratedPrimitive.tsx`, re-export from
`UserViewRenderer.tsx` so no existing import/test breaks. Behavior-preserving move (charter: quality
upgrade, no behavior change).

### D6 — The artifact slot owns its own per-panel fetch (mirror I3, not fork it)

`UserViewRenderer`'s fetch+state machinery is route-coupled (`useUserView`, `useParams`, `navigate`,
page skeletons). `ArtifactSlot` reuses the **leaf** pieces (`compileCompositionSpec`, `executeCompiledQuery`,
`HydratedPrimitive`, `ChartFrame`) but owns a compact `Promise.allSettled` fetch + per-panel
loading/empty/error state (FR-CV-013/014, NFR-CV-PERF-002). The shared state logic lives in the
`useComposeArtifact` hook (FR-CV-012) so the component stays thin and the validation/save logic is unit-
testable headless.

### D7 — Flag gating is AND(`agentAssistant`, `aiComposer`) at TWO points (FR-CV-024/025)

(1) the handler's catalog only includes the `compose_view` tool when both flags are on; (2) the panel only
renders `ArtifactSlot` when both flags are on (else the `artifact` event is silently skipped). The handler
runs in Deno (no `import.meta.env` Vite shim) — so the flag check **for the catalog** is passed into the
handler as `req.context` or a deps boolean, NOT read from `FEATURES` inside Deno. See Task 7 note.

### D8 — Title derivation (CV-OD-002 / CV-OQ-001): derive from the prompt, no schema change

`deriveTitle(prompt)` = trim + capitalize + first ≤60 chars (no model round-trip, no schema change). The
tool input schema stays `{ prompt: string }`. User can rename on Save (default scope `'private'`,
CV-OD-005).

---

## 2. File tree (what changes)

```
supabase/functions/compose-view/
  composeSpec.ts                         NEW  — extracted composeSpec() + ComposeSpecError + ComposeSpecDeps (D2/D3)
  handler.ts                             EDIT — refactor: call composeSpec(); gates + 422/502 mapping stay (Task 2)

supabase/functions/agent-chat/
  actions.ts                             EDIT — + composeViewAction (ComposeAction) + runComposeView() + deriveTitle() (Task 5)
  schema.ts                              EDIT — re-export COMPOSITION_SPEC_SCHEMA for the compose_view tool (Task 4)
  handler.ts                             EDIT — register compose_view in catalog (flag-gated via deps); dispatch branch;
                                                emit artifact / assistant-error event; inject deps.anthropic (Task 6/7/8)

pmo-portal/src/lib/agent/                (Option-B co-located unit tests — D4)
  composeSpec.test.ts                    NEW  — AC-CV-005-adjacent: extracted composeSpec unit behavior
  composeViewAction.test.ts              NEW  — AC-CV-004, AC-CV-016
  agentChatHandler.compose.test.ts       NEW  — AC-CV-001, AC-CV-002, AC-CV-003

supabase/functions/compose-view/        (existing suite — regression gate; co-located test lives in pmo-portal)
  (handler.test analog)                  RUN-ONLY — AC-CV-005: existing compose-view handler tests stay green

pmo-portal/src/components/dashboard/
  HydratedPrimitive.tsx                  NEW  — extracted from UserViewRenderer (D5); categoryMetricCols moves too
pmo-portal/pages/
  UserViewRenderer.tsx                   EDIT — import HydratedPrimitive from the new module; re-export it (Task 9)

pmo-portal/src/hooks/
  useComposeArtifact.ts                  NEW  — client re-validate + save state (FR-CV-012; Task 11)
  useComposeArtifact.test.ts             NEW  — AC-CV-006, AC-CV-007

pmo-portal/src/components/panel/
  ArtifactSlot.tsx                       NEW  — artifact renderer + Save affordance (FR-CV-013..020; Task 13)
  TranscriptItem.tsx                     EDIT — route 'artifact'+kind:'compose_view' to <ArtifactSlot> (replace stub; Task 14)
  AssistantPanel.test.tsx                NEW  — AC-CV-008, 009, 010, 011, 012, 013, 014

pmo-portal/e2e/
  AC-CV-015-compose-view-artifact-journey.spec.ts   NEW — the one curated cross-stack journey (Task 16)

docs/adr/
  0041-model-calling-agent-action-capability-seam.md   NEW (Task 0)
```

No migration, no RLS change: A4 adds no server-side trust boundary beyond ADR-0039 (the `user_views`
write path already exists with its RLS WITH CHECK; the org_id seam is enforced by existing column defaults).

---

## 3. Tasks (TDD, 2–5 min each; RED before GREEN)

> Verify commands run from `pmo-portal/`. Vitest picks up `pmo-portal/src/lib/agent/*.test.ts` and
> `pmo-portal/src/{hooks,components}/**/*.test.{ts,tsx}` automatically.

### Task 0 — ADR-0041 (architectural; no code) — D1

**WRITE** `docs/adr/0041-model-calling-agent-action-capability-seam.md` with: Context (compose_view needs
the Anthropic SDK; `DeputyContext` is intentionally minimal — caller JWT + supabase only; NFR-AR-SEC-002);
Decision (a **model-calling action** receives an extra typed `ComposeActionDeps { anthropic; now? }`
curried by the handler at dispatch; the port and `DeputyContext` are unchanged; the SDK never enters
`pmo-portal` and never reaches the client); Consequences (one more action shape; both runtime adapters
unaffected; future model-calling actions follow this seam). Reference D-A4-1/D-A4-3, NFR-CV-SEC-005.
**Verify:** `test -f ../docs/adr/0041-model-calling-agent-action-capability-seam.md`

---

### Task 1 — RED: `composeSpec` extraction contract (FR-CV-004/005, D2/D3)

**WRITE** `pmo-portal/src/lib/agent/composeSpec.test.ts` importing
`composeSpec`, `ComposeSpecError`, `MAX_REPAIR_ATTEMPTS` from
`../../../../supabase/functions/compose-view/composeSpec`. Use a mock `AnthropicLike` (the same shape the
existing compose-view handler test uses) and the **real** `compileCompositionSpec`.

- `it('composeSpec returns { spec, repairAttempts:0, tokensUsed } on a first-try valid spec', ...)`:
  mock returns one `tool_use` block named `compose_view` with a valid one-`KPITile` spec
  (`{ version:1, panels:[{ id:'p1', primitive:'KPITile', querySpec:{ entity:'projects', select:['id'],
  aggregate:{ fn:'count', column:'id', alias:'count' } } }] }`). Assert `result.spec.version === 1`,
  `result.repairAttempts === 0`, `result.tokensUsed >= 0`.
- `it('composeSpec repairs once then succeeds (repairAttempts:1)', ...)`: first call returns an
  invalid spec (`entity:'secret_salaries'` → UNKNOWN_ENTITY), second returns a valid spec. Assert
  `repairAttempts === 1` and the mock was called twice.
- `it('composeSpec throws ComposeSpecError REPAIR_EXHAUSTED after MAX_REPAIR_ATTEMPTS', ...)`: every call
  returns an invalid spec. Assert it rejects with `ComposeSpecError`, `err.code === 'REPAIR_EXHAUSTED'`,
  `err.repairAttempts === MAX_REPAIR_ATTEMPTS` (=2), and the mock was called 3 times.
- `it('composeSpec throws ComposeSpecError UPSTREAM_ERROR when the SDK throws', ...)`: mock `create`
  rejects. Assert `err.code === 'UPSTREAM_ERROR'`.

**Verify (RED):** `npm test -- composeSpec.test` → fails (module not found).

### Task 2 — GREEN: create `composeSpec.ts`, refactor `handler.ts` (FR-CV-004/005, AC-CV-005)

**WRITE** `supabase/functions/compose-view/composeSpec.ts`:
- Move the model-call helper (`callModel`), the `AnthropicLike`/`AnthropicCreateParams`/`AnthropicResponse`
  interfaces, `MAX_REPAIR_ATTEMPTS`, and the compile+repair `while` loop out of `handler.ts` into here.
- Export:
  ```ts
  export interface ComposeSpecDeps { anthropic: AnthropicLike }
  export class ComposeSpecError extends Error {
    code: 'REPAIR_EXHAUSTED' | 'UPSTREAM_ERROR';
    repairAttempts: number;
    tokensUsed: number;
    validationError?: { code: string; detail?: string };
  }
  export async function composeSpec(
    prompt: string, orgId: string, deps: ComposeSpecDeps,
  ): Promise<{ spec: CompositionSpec; repairAttempts: number; tokensUsed: number }>
  ```
  Build `system` via `buildSystemPrompt(ENTITY_WHITELIST, registry.keys(), orgId, MAX_PANELS_PER_VIEW)` and
  `ctx = { userId: '', orgId }` — wait: `compileCompositionSpec` needs a real `userId` for token
  resolution. Pass `userId` through `ComposeSpecDeps` too: `ComposeSpecDeps { anthropic; userId }` and
  `ctx = { userId: deps.userId, orgId }` (matches Recon #2 + the existing handler's `ctx`). On
  `REPAIR_EXHAUSTED`/upstream throw, raise `ComposeSpecError` with `repairAttempts`/`tokensUsed`. Keep the
  logging discipline (log only `{ errorCode, repairAttempts, tokensUsed }`; NFR-CV-SEC-006).
- **EDIT** `supabase/functions/compose-view/handler.ts`: keep gates (1)-(4); replace the inline loop with
  `try { const { spec, repairAttempts, tokensUsed } = await composeSpec(req.prompt, req.orgId, { anthropic, userId }); return { status:200, body:{ spec, repairAttempts, tokensUsed } }; } catch (e) {`
  map `ComposeSpecError.code === 'REPAIR_EXHAUSTED'` → 422 (`validationError` from `e.validationError`,
  `repairAttempts: e.repairAttempts`) and any other → 502. Re-export `MAX_REPAIR_ATTEMPTS` from
  `composeSpec` for any external importer.

**Verify (GREEN):** `npm test -- composeSpec.test` passes AND the existing compose-view handler suite
stays green — `npm test -- compose-view` (AC-CV-005, the regression gate). Then `npm run typecheck`.

---

### Task 3 — RED: `deriveTitle` (CV-OD-002, FR-CV-007 title)

**WRITE** in `pmo-portal/src/lib/agent/composeViewAction.test.ts` (created here, extended in Task 5):
- `it('deriveTitle capitalizes and truncates the prompt to <=60 chars', ...)`: import `deriveTitle` from
  `../../../../supabase/functions/agent-chat/actions`; assert `deriveTitle('show me active projects by
  status') === 'Show me active projects by status'`; assert a 90-char prompt yields a ≤60-char string.

**Verify (RED):** `npm test -- composeViewAction.test` → fails (export missing).

### Task 4 — GREEN: re-export the compose tool schema for agent-chat (FR-CV-001, D-A4-1)

**EDIT** `supabase/functions/agent-chat/schema.ts`: add
`export { COMPOSITION_SPEC_SCHEMA } from '../compose-view/schema';` (reuse the EXACT existing schema —
no second schema; D-A4-1, NFR-CV-SEC-001).
**Verify:** `npm run typecheck` (no test yet; consumed by Task 5).

### Task 5 — GREEN: `composeViewAction` + `runComposeView` + `deriveTitle` (FR-CV-001/003/006, AC-CV-004/016)

**Extend** `composeViewAction.test.ts` with the RED cases first, then implement:
- `it('AC-CV-004 runComposeView returns { error, code:REPAIR_EXHAUSTED } when composeSpec exhausts repair', ...)`:
  mock `composeSpec` (via `vi.mock` of the composeSpec module) to throw `ComposeSpecError REPAIR_EXHAUSTED`;
  call `runComposeView({ prompt:'x' }, ctx, { anthropic, userId:'u' })`; assert
  `{ error: <string>, code:'REPAIR_EXHAUSTED' }` and that it does NOT throw.
- `it('AC-CV-016 runComposeView returns { error, code:UPSTREAM_ERROR } when composeSpec throws upstream', ...)`:
  mock throws `ComposeSpecError UPSTREAM_ERROR`; assert `{ error, code:'UPSTREAM_ERROR' }`.
- `it('runComposeView returns { spec, repairAttempts, tokensUsed, title } on success', ...)`: mock resolves
  `{ spec, repairAttempts:0, tokensUsed:42 }`; assert the result includes `title: deriveTitle('...')` and
  the spec passes through unchanged.

**EDIT** `supabase/functions/agent-chat/actions.ts`:
```ts
import { COMPOSITION_SPEC_SCHEMA } from './schema';
import { composeSpec, ComposeSpecError } from '../compose-view/composeSpec';
import type { AnthropicLike } from '../compose-view/composeSpec';

export interface ComposeActionDeps { anthropic: AnthropicLike }
export type ComposeResult =
  | { spec: CompositionSpec; repairAttempts: number; tokensUsed: number; title: string }
  | { error: string; code: 'REPAIR_EXHAUSTED' | 'UPSTREAM_ERROR' };

export function deriveTitle(prompt: string): string { /* trim, capitalize, slice(0,60) */ }

export async function runComposeView(
  input: { prompt: string }, ctx: DeputyContext, deps: ComposeActionDeps,
): Promise<ComposeResult> {
  try {
    const { spec, repairAttempts, tokensUsed } =
      await composeSpec(input.prompt, ctx.orgId, { anthropic: deps.anthropic, userId: ctx.userId });
    return { spec, repairAttempts, tokensUsed, title: deriveTitle(input.prompt) };
  } catch (e) {
    const code = e instanceof ComposeSpecError ? e.code : 'UPSTREAM_ERROR';
    return { error: 'compose failed', code };
  }
}

export const composeViewAction: AgentAction = {
  name: 'compose_view',
  description: "Compose a validated dashboard view from the user's natural-language request.",
  inputSchema: COMPOSITION_SPEC_SCHEMA,   // wait — see note below
  surfaces: ['agent'],
  confirm: false,
  run: () => { throw new Error('compose_view is dispatched by the handler with injected anthropic deps'); },
};
```
> **NOTE (load-bearing):** the `compose_view` **tool input schema** the model sees is `{ prompt: string }`
> (the action's INPUT), NOT `COMPOSITION_SPEC_SCHEMA` (which is the spec the model AUTHORS *inside*
> `composeSpec`). So `composeViewAction.inputSchema` must be a small `COMPOSE_VIEW_INPUT_SCHEMA =
> { type:'object', required:['prompt'], additionalProperties:false, properties:{ prompt:{ type:'string',
> description:'...' } } }` defined in `agent-chat/schema.ts`. `COMPOSITION_SPEC_SCHEMA` is reused *inside*
> `composeSpec` (already is). Fix Task 4 to export BOTH: re-export `COMPOSITION_SPEC_SCHEMA` (used by
> composeSpec) and define `COMPOSE_VIEW_INPUT_SCHEMA` (the action tool schema). `composeViewAction.run`
> is a guard stub — the handler never calls it (D1); it calls `runComposeView` with injected deps.

**Verify (GREEN):** `npm test -- composeViewAction.test` passes; `npm run typecheck`.

---

### Task 6 — RED: catalog includes `compose_view` only when flags on (FR-CV-002/024, AC-CV-001/002)

**WRITE** `pmo-portal/src/lib/agent/agentChatHandler.compose.test.ts` importing `agentChatHandler` +
`HandlerDeps` from `../../../../supabase/functions/agent-chat/handler` (same harness as
`agentChatHandler.test.ts` — reuse its `mockOrgAnd`/`baseDeps` patterns, copy the helpers locally).
- `it('AC-CV-001 includes a compose_view tool with a { prompt } input schema when composeEnabled', ...)`:
  spy on `anthropic.messages.create`; pass `deps.composeEnabled = true`; assert the `tools` array of the
  first `create` call contains an entry `name === 'compose_view'` whose `input_schema.required` includes
  `'prompt'` and whose order is `[query_entity, compose_view]` (FR-CV-002).
- `it('AC-CV-002 omits compose_view from the catalog when composeEnabled is false', ...)`:
  `deps.composeEnabled = false` (or undefined); assert tools contains only `query_entity`.

**Verify (RED):** `npm test -- agentChatHandler.compose` → fails (no `composeEnabled` on deps; tool absent).

### Task 7 — GREEN: flag-gated catalog + injected anthropic in the handler (FR-CV-002/024, D7)

**EDIT** `supabase/functions/agent-chat/handler.ts`:
- Add to `HandlerDeps`: `composeEnabled?: boolean;` (D7 — the flag AND-result is computed in the SPA /
  `index.ts` and passed in, because Deno can't read Vite `FEATURES`; `index.ts` reads
  `Deno.env.get('FEATURES_COMPOSE_VIEW') === 'true'` OR is always-on at the edge since the SPA already
  gates the panel — see index.ts note in Task 8). Import `composeViewAction`, `runComposeView` from
  `./actions`.
- Build `const tools = [queryTool]; if (deps.composeEnabled) tools.push({ name: composeViewAction.name,
  description: composeViewAction.description, input_schema: composeViewAction.inputSchema });`
  Pass `tools` to every `messages.create` call (FR-CV-002 catalog order `[query_entity, compose_view]`).

**Verify (GREEN):** `npm test -- agentChatHandler.compose` passes (AC-CV-001/002); `npm run typecheck`.

### Task 8 — RED then GREEN: dispatch `compose_view` → emit artifact / assistant-error (FR-CV-006/007/008, AC-CV-003/004/016)

**Extend** `agentChatHandler.compose.test.ts`:
- `it('AC-CV-003 emits an artifact event after assistant text and before completed on a successful compose', ...)`:
  scripted mock — round 1 returns `stop_reason:'tool_use'` with a `text` block "Here's a view:" + a
  `tool_use` block `{ name:'compose_view', input:{ prompt:'active projects by status' } }`; mock
  `runComposeView`/`composeSpec` (via `vi.mock`) to resolve a valid `{ spec, repairAttempts:0, tokensUsed,
  title }`; round 2 returns `stop_reason:'end_turn'`. Collect events; assert exactly one event with
  `type:'artifact'`, `payload.kind:'compose_view'`, `payload.spec.version===1`, `payload.repairAttempts===0`,
  `payload.title` truthy; assert its index is AFTER the `assistant` "Here's a view:" event and BEFORE the
  terminal `status:'completed'` (FR-CV-008).
- `it('AC-CV-004 emits an assistant error event (not an artifact) when compose exhausts repair', ...)`:
  `runComposeView` resolves `{ error, code:'REPAIR_EXHAUSTED' }`; assert one `assistant` event with text
  matching /wasn.t able to compose|try rephrasing/i, ZERO `artifact` events, and a terminal
  `status:'completed'` (NOT errored — FR-CV-006).
- `it('AC-CV-016 emits an assistant error event (not an artifact) on an upstream compose error', ...)`:
  `{ error, code:'UPSTREAM_ERROR' }`; assert one `assistant` error event, zero artifacts, terminal
  `completed`.

**EDIT** `supabase/functions/agent-chat/handler.ts` dispatch branch: when `toolBlock.name === 'compose_view'`:
```ts
const out = await runComposeView(toolBlock.input as { prompt: string },
  { jwt:'', userId: deps.userId, orgId, supabase: deps.supabase as unknown as SupabaseLike },
  { anthropic: deps.anthropic });
if ('error' in out) {
  yield emit('assistant', { text: "I wasn't able to compose a valid view — try rephrasing your request." });
  yield emit('tool', { payload:{ name:'compose_view', input:toolBlock.input, result:{ error: out.error } } });
  // feed a tool_result so the loop can continue/close, then let the model end the turn
} else {
  yield emit('artifact', { payload:{ kind:'compose_view', spec: out.spec,
    repairAttempts: out.repairAttempts, title: out.title, tokensUsed: out.tokensUsed } });
  yield emit('tool', { payload:{ name:'compose_view', input:toolBlock.input,
    result:{ ok:true, panels: out.spec.panels.length } } });
}
```
Keep the existing tool_use/tool_result message append so the loop terminates with `completed`. The
`query_entity` path is unchanged (still via `queryEntityAction.run`).
> Emit order satisfies FR-CV-008: assistant `text` blocks are yielded earlier in the same round (existing
> code yields text blocks before the tool dispatch); the `artifact` event is yielded at dispatch; the
> terminal `completed` is yielded when `stop_reason !== 'tool_use'` in a later round.

**Verify (GREEN):** `npm test -- agentChatHandler.compose` passes (AC-CV-003/004/016); `npm run typecheck`.

### Task 8b — index.ts wiring (BUILD-TIME-VERIFY, no unit test — ADR-0039 dec 7 / D7)

**EDIT** `supabase/functions/agent-chat/index.ts`: pass `composeEnabled: true` into the `agentChatHandler`
deps (the SPA already AND-gates panel rendering + the artifact slot on `agentAssistant && aiComposer`, so
the edge fn enabling the tool is harmless when the SPA never renders it; if the function secret
`ANTHROPIC_API_KEY` is unset the existing 502 guard already fires). Real `anthropic` already constructed
here flows into `deps.anthropic` → `runComposeView`. **This file is integration-only (not unit-tested,
ADR-0039 dec 7).** Add to its BUILD-TIME-VERIFY checklist: *"compose_view tool input schema = { prompt };
artifact event JSON-serializable; streaming tool-use block id used as tool_use_id."*
**Verify:** `npm run typecheck` (index.ts is type-checked, not unit-run).

---

### Task 9 — Extract `HydratedPrimitive` to a shared module (D5, CV-OD-003) — behavior-preserving

**WRITE** `pmo-portal/src/components/dashboard/HydratedPrimitive.tsx`: move `categoryMetricCols` and the
`HydratedPrimitive` function verbatim out of `UserViewRenderer.tsx`; `export function HydratedPrimitive(...)`
and `export { categoryMetricCols }`. Carry over the same imports (KPITile, DataTable, StatTiles, Funnel,
StatusBarChart, ProgressBar, Card, chartTheme, registry, types, IconName).
**EDIT** `pmo-portal/pages/UserViewRenderer.tsx`: delete the moved code; add
`import { HydratedPrimitive } from '@/src/components/dashboard/HydratedPrimitive';` and re-export
`export { HydratedPrimitive };` (so any existing relative importer/test still resolves — no contract break).
**Verify:** `npm test -- UserViewRenderer` (existing I3 renderer suite stays green — the regression gate on
the move); `npm run typecheck`.

---

### Task 10 — RED: `useComposeArtifact` client re-validation (FR-CV-010/012, AC-CV-006/007)

**WRITE** `pmo-portal/src/hooks/useComposeArtifact.test.ts` — render the hook via `@testing-library/react`
`renderHook`; mock `useUserViewMutations` (`vi.mock('@/src/hooks/useUserViews')`) and `useAuth` to supply
`{ id:'u', org_id:'o' }`; use the **real** `compileCompositionSpec`.
- `it('AC-CV-006 returns compiledPanels and null validationError for a valid spec', ...)`: pass a valid
  one-`KPITile` spec; assert `result.current.compiledPanels` is a non-null array of length 1 and
  `validationError === null`.
- `it('AC-CV-007 returns null compiledPanels and an UNKNOWN_ENTITY validationError for an unknown entity', ...)`:
  pass `{ version:1, panels:[{ id:'p', primitive:'KPITile', querySpec:{ entity:'secret_salaries',
  select:['id'] } }] }`; assert `compiledPanels === null` and `validationError.code === 'UNKNOWN_ENTITY'`.

**Verify (RED):** `npm test -- useComposeArtifact.test` → fails (module not found).

### Task 11 — GREEN: `useComposeArtifact` (FR-CV-012, AC-CV-006/007, FR-CV-018/020)

**WRITE** `pmo-portal/src/hooks/useComposeArtifact.ts`:
```ts
export interface UseComposeArtifactResult {
  compiledPanels: CompiledPanel[] | null;
  validationError: ValidationError | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  savedViewId: string | null;
  save: (name: string, scope?: 'private' | 'shared_org') => Promise<void>;
}
export function useComposeArtifact(spec: CompositionSpec): UseComposeArtifactResult
```
- `useMemo` over `spec`: `try { compileCompositionSpec(spec, { userId: currentUser?.id ?? '', orgId:
  currentUser?.org_id ?? '' }) → compiledPanels } catch (e instanceof ValidationError) → validationError`.
  Imports ONLY `compileCompositionSpec`+types from `@/src/lib/viewspec/*`, `useUserViewMutations` from
  `@/src/hooks/useUserViews`, `useAuth` (NFR-CV-SEC-007 port isolation — no PmoNativeRuntime/adapter).
- `save(name, scope='private')`: set `saveStatus:'saving'`; `await create.mutateAsync({ name, spec,
  scope })` (FR-CV-018, default `'private'` CV-OD-005); on success `saveStatus:'saved'`, store
  `savedViewId = row.id`; on error `saveStatus:'error'`, `saveError = classifyMutationError(e)` message
  (FR-CV-020). Never auto-call `save` (FR-CV-019).

**Verify (GREEN):** `npm test -- useComposeArtifact.test`; `npm run typecheck`.

---

### Task 12 — RED: `ArtifactSlot` render + save (AC-CV-008/009/011/012/013/014)

**WRITE** `pmo-portal/src/components/panel/AssistantPanel.test.tsx` — render `<ArtifactSlot>` directly
(headless of the panel, for the slot-specific cases) AND through the panel for the flag/integration cases.
Mock `executeCompiledQuery` (`vi.mock('@/src/lib/viewspec/executor')` → resolves `[{ count: 7 }]`), mock
`useUserViewMutations`, mock `useAuth`, mock `FEATURES`/`isFeatureEnabled`.
- `it('AC-CV-008 renders the slot with HydratedPrimitive output and an enabled Save button for a valid spec', ...)`:
  valid one-`KPITile` spec + `executeCompiledQuery` → `[{ count:7 }]`; assert a `region` named after the
  title is present, the KPI value `7` (or its testid) renders, and a `button` /save/i is enabled.
- `it('AC-CV-009 renders an inline error notice and NO Save button for an invalid spec', ...)`: unknown-
  entity spec; assert text /couldn.t be validated/i present, no HydratedPrimitive output, no /save/i button.
- `it('AC-CV-011 Save calls create.mutateAsync with { spec, scope:private } and shows a saved state', ...)`:
  `create.mutateAsync` resolves `{ id:'new-view-id' }`; click Save; assert it was called with an object
  containing `spec` (===payload.spec) and `scope:'private'`; assert a /saved/i state + a link mentioning
  the view (CV-OD-004).
- `it('AC-CV-012 disables the Save button while a save is in flight', ...)`: `create.mutateAsync` = a
  never-resolving promise; click Save; assert the button is `disabled` (or `aria-disabled`).
- `it('AC-CV-013 never auto-saves (mutateAsync not called before user interaction)', ...)`: render a valid
  slot; assert `create.mutateAsync` was NOT called.
- `it('AC-CV-014 ArtifactSlot has zero axe violations', ...)`: render the valid slot; `expect(await
  axe(container)).toHaveNoViolations()` (jest-axe).

**Verify (RED):** `npm test -- AssistantPanel.test` → fails (ArtifactSlot not found).

### Task 13 — GREEN: `ArtifactSlot` component (FR-CV-013..020, NFR-CV-A11Y-001/002/PERF-002)

**WRITE** `pmo-portal/src/components/panel/ArtifactSlot.tsx`:
- Props: `{ payload: { kind:'compose_view'; spec: CompositionSpec; title: string; repairAttempts: number;
  tokensUsed: number } }`.
- `const { compiledPanels, validationError, saveStatus, saveError, savedViewId, save } =
  useComposeArtifact(payload.spec)`.
- If `validationError` → render the inline error notice (FR-CV-011; dev-only detail behind
  `import.meta.env.VITE_APP_ENV !== 'prod'`, mirroring `UserViewRenderer`); no Save (FR-CV-011).
- Else: own per-panel fetch — `Promise.allSettled(compiledPanels.map(p =>
  executeCompiledQuery(p.compiledQuery)))` in an effect, per-panel `{ loading, data, error }` state,
  render each in a `<ChartFrame>` + `<HydratedPrimitive panel data />` (FR-CV-013/014, NFR-CV-PERF-002).
- Container: `<section aria-label={`Composed view: ${payload.title}`}>` (NFR-CV-A11Y-001) with a title
  heading (FR-CV-016), DESIGN.md tokens (border/bg/spacing, FR-CV-015 — `rounded-lg border border-border
  bg-card`).
- Save button: `aria-label="Save composed view"`; `disabled`/`aria-busy` while `saveStatus==='saving'`
  (FR-CV-020, NFR-CV-A11Y-002); on `saved` show "Saved" + a link chip to `/views/${savedViewId}` and an
  `aria-live` announce (FR-CV-018, CV-OD-004); on `error` show `saveError` and re-enable.

**Verify (GREEN):** `npm test -- AssistantPanel.test` passes the slot-headless cases; `npm run typecheck`.

### Task 14 — GREEN: route the artifact event to `ArtifactSlot`, flag-gated (FR-CV-013/025, AC-CV-008/010)

**EDIT** `pmo-portal/src/components/panel/TranscriptItem.tsx` `case 'artifact'`: replace the stub with —
```tsx
case 'artifact': {
  const payload = event.payload as { kind?: string } | undefined;
  if (payload?.kind !== 'compose_view') return null;
  if (!isFeatureEnabled('agentAssistant') || !isFeatureEnabled('aiComposer')) return null; // FR-CV-025
  return <ArtifactSlot payload={event.payload as ArtifactSlotPayload} />;
}
```
Import `isFeatureEnabled` from `@/src/lib/features` and `ArtifactSlot`.
- **Extend** `AssistantPanel.test.tsx`:
  - `it('AC-CV-008 (panel) renders ArtifactSlot for an artifact event when both flags are on', ...)`:
    feed the panel/transcript a scripted `artifact` event; assert the slot region renders.
  - `it('AC-CV-010 silently skips the artifact event when aiComposer is off', ...)`: mock
    `isFeatureEnabled` so `aiComposer` is false; feed an artifact event; assert no `region`/ArtifactSlot,
    and surrounding assistant entries still render.

**Verify (GREEN):** `npm test -- AssistantPanel.test` (all unit AC-CV pass); `npm run typecheck`.

---

### Task 15 — RED: the e2e journey scaffold (AC-CV-015)

**WRITE** `pmo-portal/e2e/AC-CV-015-compose-view-artifact-journey.spec.ts` with `test('AC-CV-015 ask in
panel → artifact renders → Save → appears in My Views', ...)` and the `page.route` mocks per spec §5.5:
- `**/functions/v1/agent-chat` → a mocked `text/event-stream` body of the four `data: {...}\n\n` frames
  (`user`, `assistant`, `artifact` with the `StatusBarChart` spec, `status:completed`).
- `**/rest/v1/projects*` → `[{ status:'active', count:5 }, { status:'on_hold', count:2 }]`.
- `**/rest/v1/user_views*` POST → `[{ id:'saved-view-1', name:'Active projects by status', ... }]`;
  count POSTs via a request listener for the no-auto-save assertion.
Set `VITE_FEATURES_AGENT_ASSISTANT=true`, `VITE_FEATURES_AI_COMPOSER=true` (test env / existing e2e fixture
pattern — mirror `AC-AS-022-ai-compose-to-save.spec.ts`).

**Verify (RED):** `npx playwright test AC-CV-015` → fails (assertions unmet until Tasks 1-14 are wired).

### Task 16 — GREEN: complete the e2e journey assertions (AC-CV-015)

Implement the journey + assertions per spec §5.5 steps 1-13: open panel (⌘J), type + Enter, assistant
bubble, `getByRole('region', { name:/active projects by status/i })`, chart content visible, Save enabled
→ click → in-flight disabled → "Saved" + link → navigate `/views` → row "Active projects by status"
present → click → `/views/saved-view-1` renders via I3. **No-auto-save:** assert the `user_views` POST
count is 0 between the artifact render and the Save click.

**Verify (GREEN):** `npx playwright test AC-CV-015` passes.

---

### Task 17 — Full verify gate (binding, charter)

**Verify:** from `pmo-portal/` run `npm run verify` (`typecheck && lint:ci && test && build`) — must be
fully green before PR. (Targeted `npm test -- <file>` runs in the inner loop above MISS cross-component
breakage; the whole-suite run is the phase gate.)

---

## 4. Traceability (AC → layer → owning test file) — ADR-0010

| AC-### | Layer | Owning test file (ACTUAL path — see D4 reconciliation) | Task |
|---|---|---|---|
| AC-CV-001 | Unit (Vitest) | `pmo-portal/src/lib/agent/agentChatHandler.compose.test.ts` | 6/7 |
| AC-CV-002 | Unit (Vitest) | `pmo-portal/src/lib/agent/agentChatHandler.compose.test.ts` | 6/7 |
| AC-CV-003 | Unit (Vitest) | `pmo-portal/src/lib/agent/agentChatHandler.compose.test.ts` | 8 |
| AC-CV-004 | Unit (Vitest) | `pmo-portal/src/lib/agent/composeViewAction.test.ts` (+ handler emit in `…compose.test.ts`) | 5/8 |
| AC-CV-005 | Unit (Vitest) | existing compose-view handler suite (unmodified) — regression gate | 2 |
| AC-CV-006 | Unit (RTL) | `pmo-portal/src/hooks/useComposeArtifact.test.ts` | 10/11 |
| AC-CV-007 | Unit (RTL) | `pmo-portal/src/hooks/useComposeArtifact.test.ts` | 10/11 |
| AC-CV-008 | Unit (RTL) | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` | 12/13/14 |
| AC-CV-009 | Unit (RTL) | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` | 12/13 |
| AC-CV-010 | Unit (RTL) | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` | 14 |
| AC-CV-011 | Unit (RTL) | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` | 12/13 |
| AC-CV-012 | Unit (RTL) | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` | 12/13 |
| AC-CV-013 | Unit (RTL) | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` | 12/13 |
| AC-CV-014 | Unit (RTL+axe) | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` | 12/13 |
| AC-CV-015 | E2E (Playwright) | `pmo-portal/e2e/AC-CV-015-compose-view-artifact-journey.spec.ts` | 15/16 |
| AC-CV-016 | Unit (Vitest) | `pmo-portal/src/lib/agent/composeViewAction.test.ts` (+ handler emit in `…compose.test.ts`) | 5/8 |

**CI placement:** AC-CV-001..014 + 016 in `npm run verify` (PR→`dev` fast lane). AC-CV-015 Playwright on
the same fast lane (Vite dev server; `agent-chat` + Supabase mocked via `page.route`; no live Anthropic, no
edge-fn deploy). All rerun in PR→`main` integration. Coverage ≥80% lines on all new files
(`composeSpec.ts`, `runComposeView`/`deriveTitle` in `actions.ts`, `useComposeArtifact.ts`,
`ArtifactSlot.tsx`, `HydratedPrimitive.tsx`).

---

## 5. BUILD-TIME-VERIFY items deferred to deploy (ADR-0039 dec 7 — units mock the SDK)

These are NOT covered by unit tests (the SDK + streaming + Deno serve are integration-only); verify at
deploy on the `agent-chat` function:
1. The streaming tool-use response shape — `content_block.id` used as `tool_use_id` in the synthetic
   tool_result turn (already on the index.ts checklist; A4 adds the `compose_view` branch).
2. `compose_view` tool input schema reaches the model as `{ prompt }` (Task 5 NOTE).
3. The `artifact` `AgentEvent` is JSON-serializable end to end (FR-CV-009) — no class instance in
   `payload.spec` (it's a plain `CompositionSpec`/`QuerySpec`).
4. `ANTHROPIC_API_KEY` function secret present (existing 502 guard) and `composeEnabled` wiring in
   `index.ts` (Task 8b).

---

## 6. Reconciliations (spec ↔ repo) — for the Director

1. **Test file paths (largest).** Spec §5/§8 name `supabase/functions/agent-chat/handler.test.ts`,
   `…/actions.test.ts`, `…/compose-view/handler.test.ts`. The repo convention + brief place edge-fn unit
   tests at `pmo-portal/src/lib/agent/*.test.ts` importing the Deno modules by relative path (Option B —
   `agentChatHandler.test.ts`, `queryEntityAction.test.ts`, `composeSpec.test.ts` already do this). This
   plan uses the ACTUAL paths (see §4). **Spec amendment recommended:** update the spec §5 test-file lines
   and the §8 table to the `pmo-portal/src/lib/agent/*` paths. No behavior change — paths only.
2. **The action tool schema is `{ prompt }`, not `COMPOSITION_SPEC_SCHEMA`.** Spec FR-CV-001 says the
   action `inputSchema` accepts `{ prompt: string }` (correct) but D-A4-1 / §6 sometimes read as if the
   action's tool schema = `COMPOSITION_SPEC_SCHEMA`. Clarified: `COMPOSITION_SPEC_SCHEMA` is reused
   *inside* `composeSpec` (the spec the model AUTHORS); the **action's** Anthropic tool input schema is a
   small `COMPOSE_VIEW_INPUT_SCHEMA = { prompt }` (Task 5 NOTE). Both reuse the same compiler validation —
   the boundary is unchanged (NFR-CV-SEC-001). No spec wording change strictly required, but recommend a
   one-line clarification on FR-CV-001.
3. **The model-calling-action capability seam (D1 → ADR-0041).** Spec §6 shows `composeViewAction.run`
   reading `deps.anthropic`, but `AgentAction.run(input, ctx)` (port.ts) has no `deps`/`anthropic`. The
   handler curries `{ anthropic }` into `runComposeView`; `composeViewAction.run` is a guard stub. This is
   a new architectural fact → ADR-0041. Not a spec defect, but the plan makes it explicit.
4. **`composeSpec` needs `userId` (not just `orgId`).** Spec §6 `ComposeSpecDeps = { anthropic, userId }`
   — confirmed: `compileCompositionSpec` resolves `$current_user` from `ctx.userId`, so `composeSpec`
   takes `userId` in its deps and builds `ctx = { userId, orgId }`. Plan matches the spec's §6 note.
5. **`scope` value.** `useUserViewMutations().create` takes `scope?: string`; the slot passes `'private'`
   (CV-OD-005). `UseComposeArtifactResult.save` types `scope?: 'private' | 'shared_org'` for the call site;
   the DAL accepts the string. No conflict.

No spec AC wording needs to change to make the plan buildable; items 1-2 are recommended doc clarifications
for traceability hygiene.

---

## 7. Open questions for the Director (escalations)

- **OQ-A4-1 (CV-OQ-004 — rate limiting).** Spec flags whether each `compose_view` tool call should share
  the I5 `RateGuard` bucket (a 10-view conversation = 10× tokens). The A1 handler already accepts an
  optional `rateGuard` (disabled by default). **Recommendation:** out of scope for A4's build (the guard
  is stubbed and disabled per AR-OD-002 / AS-OD-002); add a per-compose-tool-call `rateGuard.check` in the
  handler dispatch as a fast follow if token spend warrants. Flagging, not building, unless you say
  otherwise.
- **OQ-A4-2 (`composeEnabled` source at the edge — D7/Task 8b).** The SPA AND-gates the panel + slot on
  `agentAssistant && aiComposer`, so I default the edge fn to `composeEnabled: true` (harmless — the SPA
  never renders an artifact when its flags are off, FR-CV-025). Alternative: gate the edge fn on a
  `FEATURES_COMPOSE_VIEW` function secret too (belt-and-suspenders, one env var). **Recommendation:**
  default `true`; add the secret only if you want the tool catalog itself flag-controlled server-side.
  Confirm the default.
