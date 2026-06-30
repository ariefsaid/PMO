# ADR-0041 — Model-calling agent actions: a capability seam beyond `DeputyContext`

- **Status:** Accepted
- **Date:** 2026-06-30
- **Deciders:** Director, eng-planner
- **Related:** ADR-0040 (Option A behind the B-shaped seam), ADR-0039 (untrusted-output boundary),
  ADR-0036 (deputy invariant), ADR-0017 (repository seam).
- **Scope:** the A4 `compose_view` `AgentAction`; the pattern for any future agent action that must
  itself call the model (or another privileged capability the deputy context deliberately excludes).

## Context

`AgentAction.run(input, ctx: DeputyContext)` (`pmo-portal/src/lib/agent/runtime/port.ts`) receives only
`DeputyContext = { jwt, userId, orgId, supabase }`. This is intentional and load-bearing: the deputy
context is the caller's JWT + an RLS-scoped Supabase client and **nothing else** (NFR-AR-SEC-002), so an
action can never reach a privileged capability by construction. The `query_entity` action needs nothing
more.

The A4 `compose_view` action breaks this assumption in one specific way: to author a `CompositionSpec` it
must call the Anthropic model (`composeSpec(prompt, orgId, { anthropic, userId })`). The Anthropic client
lives in `agentChatHandler`'s `HandlerDeps.anthropic` (server-only, constructed in `index.ts` from the
`ANTHROPIC_API_KEY` function secret) — **not** in `DeputyContext`, and it must never enter `pmo-portal` or
reach the browser (NFR-CV-SEC-005).

Three ways to give the action the model client were considered:

1. **Add `anthropic?` to `DeputyContext`.** Every action and both runtime adapters (`PmoNativeRuntime`,
   future `AgentNativeRuntime`) would then carry a model client they do not need; it weakens the "deputy =
   caller JWT + supabase, nothing else" invariant and the port-isolation tests. Rejected.
2. **Special-case the model-calling action in the handler dispatch**, injecting an extra typed deps bag at
   dispatch time. The port and `DeputyContext` are unchanged; the SDK stays server-only. Chosen.
3. **Import the SDK inside the action module.** Breaks the "no SDK in `pmo-portal`" + dependency-injection
   testability rules (the whole edge fn is pure-with-injected-IO). Rejected.

## Decision

A **model-calling action** is an `AgentAction` whose execution requires a capability deliberately excluded
from `DeputyContext`. Such an action exposes a handler-invoked function with an **extra typed deps
parameter** curried by the handler at dispatch:

```ts
// supabase/functions/agent-chat/actions.ts
export interface ComposeActionDeps { anthropic: AnthropicLike }

export async function runComposeView(
  input: { prompt: string },
  ctx: DeputyContext,           // caller JWT + supabase + orgId/userId — unchanged
  deps: ComposeActionDeps,      // the extra capability, server-only, injected by the handler
): Promise<ComposeResult>;
```

- The `composeViewAction: AgentAction` entry still exists in the catalog to supply `name`, `description`,
  the `{ prompt }` tool `inputSchema`, `surfaces:['agent']`, and `confirm:false`. Its `run` is a guard
  stub that throws — the handler **never** dispatches `compose_view` through the generic `action.run(input,
  ctx)` path; it calls `runComposeView(input, ctx, { anthropic: deps.anthropic })` directly.
- The `port.ts` `AgentAction` / `DeputyContext` types are **unchanged**. The deputy invariant holds
  identically: `ctx` still carries only the caller JWT + RLS-scoped client; the model client is an
  orthogonal server-side capability that never touches tenancy.

## Consequences

- **Positive.** The port stays pure and minimal; both runtime adapters are unaffected; the Anthropic SDK
  never enters `pmo-portal` or the client bundle; the action remains unit-testable with the SDK mocked
  (ADR-0039 dec 7). Future model-calling actions (e.g. a summarize/explain action) follow the same seam.
- **Cost.** A second action shape exists (model-calling vs. plain). The handler's tool-dispatch `switch`
  must branch on the model-calling action by name rather than treating all actions uniformly. This is a
  small, explicit, named cost localized to the handler.
- **Boundary unchanged.** A4 adds no new server-side trust boundary: the composed spec passes
  `compileCompositionSpec` server-side (in `composeSpec`) before any `artifact` event, and again
  client-side (in `useComposeArtifact`) before any render or save (ADR-0039, NFR-CV-SEC-001). No
  `service_role`, no auto-persist (D-A4-2/D-A4-3).

## Verification

- The port-isolation test (`pmo-portal/src/lib/agent/portIsolation.test.ts`) continues to assert no
  adapter/SDK leakage into the port; `DeputyContext` gains no `anthropic` member.
- `pmo-portal/src/lib/agent/composeViewAction.test.ts` exercises `runComposeView` with a mocked
  `anthropic`/`composeSpec`, proving the curried-deps dispatch (no SDK import in the test's app graph).
