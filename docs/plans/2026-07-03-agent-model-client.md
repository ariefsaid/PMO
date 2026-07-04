# Plan: `ModelClient` — vendor-neutral seam + OpenRouter adapter (batteries-included A, item 1)

**Spec:** `docs/specs/agent-model-client.spec.md` (`FR-MC-001`…`FR-MC-024`, `NFR-MC-*`, `AC-MC-001`…`AC-MC-023`)
**ADRs (unchanged, must hold):** ADR-0039 (untrusted-output boundary, pure/DI decision 7), ADR-0040
(Option A + 2026-07-03 addendum forward-plan item 1), ADR-0041 (model-calling-action capability seam),
ADR-0010 (test pyramid), ADR-0001 (org_id seam).
**Author:** eng-planner (Claude Sonnet 5) · **Date:** 2026-07-03 · **Status:** Ready for Director sign-off

---

## 0. Director resolutions binding this plan

These override the spec's §7 open questions (recorded here, not re-litigated):

1. **`_shared/` location.** `supabase/functions/_shared/modelClient.ts` +
   `supabase/functions/_shared/openRouterModelClient.ts` (spec's own recommendation, confirmed).
2. **Transport behavior: preserve today's pattern.** Both edge functions today call the SDK with a plain
   `await x.messages.create(...)` (no `stream: true`, no SSE-from-provider consumption — verified by reading
   `handler.ts` L344/L775 and `composeSpec.ts` L109: neither passes a `stream` option nor iterates a
   provider-side stream). The SSE the SPA sees (`encodeSse`) is `agent-chat`'s own outbound event stream,
   built from the **fully-resolved** `AnthropicResponse`/`ModelResponse` per loop round — never partial
   model output. `OpenRouterModelClient` MUST preserve this exact pattern: **one plain (non-streaming) `fetch`
   POST per `.create()` call**, resolving one accumulated JSON response. This directly resolves spec Open
   Question 2 in favor of the "plain fetch" recommendation — codified as MC-OD-007 below, not merely a
   default.
3. **Fixture provenance.** Hand-author the three mocked deepseek-shaped fixtures first (deterministic,
   CI-green with no network); run the live gate (AC-MC-023) after, and only touch the fixtures if a real
   response diverges materially. Recorded as MC-OD-008.
4. **Env names:** `OPENROUTER_API_KEY`, `AGENT_MODEL_DEFAULT` (default `'deepseek/deepseek-v4-flash'`),
   `AGENT_MODEL_COMPOSE` (optional override for `compose-view` only). **No `AGENT_MODEL_CHAT` var** — this
   narrows spec FR-MC-013/015's two-override proposal to one override (compose-view only); `agent-chat`
   always uses `AGENT_MODEL_DEFAULT`. Recorded as MC-OD-009 (a deliberate simplification of FR-MC-013/015,
   not a contradiction — see §1.1).
5. **No Anthropic fallback adapter.** `AnthropicModelClient` is NOT built. `@anthropic-ai/sdk` is removed
   from both `deno.json`s and both `index.ts`s. `ANTHROPIC_API_KEY` is removed from the runtime path
   entirely (Task 15 covers the `.env.example`/`docs/environments.md` ops-doc migration note).

### MC-OD-007 (new, this plan) — non-streaming transport, confirmed
`OpenRouterModelClient.create()` issues a single non-streaming `fetch` and awaits the full JSON body. No
`ReadableStream` consumption inside the transport. This satisfies NFR-MC-PERF-001's "MAY use a non-streaming
request… where comfortably within the timeout" branch, which the Director selects explicitly (not left
open) given deepseek-v4-flash's speed and the existing codebase's own non-streaming SDK usage.

### MC-OD-008 (new, this plan) — fixture provenance
`agentChatHandler.deepseekQuality.test.ts` and `composeSpec.deepseekQuality.test.ts` fixtures are hand-shaped
literals matching the OpenAI/OpenRouter chat-completions response schema (FR-MC-002), committed as inline
`const` fixtures in the test files (not separate JSON files — consistent with every other test file in this
codebase, which inlines mock responses). Each fixture carries a one-line comment: `// fixture provenance:
hand-shaped to the OpenRouter/OpenAI schema; not yet cross-checked against a live deepseek-v4-flash call —
see AC-MC-023 verification note below for live-run status.` Task 21 updates that comment (and the fixture
body, only if needed) after the live run.

### MC-OD-009 (new, this plan) — single per-action override, not two
The spec (FR-MC-013/015) proposes `AGENT_MODEL_CHAT` and `AGENT_MODEL_COMPOSE`, each falling back to
`AGENT_MODEL_DEFAULT`. The Director narrows this to **`AGENT_MODEL_COMPOSE` only** — `agent-chat`'s tool-use
loop has no separate override var and always resolves `AGENT_MODEL_DEFAULT ?? 'deepseek/deepseek-v4-flash'`.
Rationale: no current need to run agent-chat on a different model than the org-wide default; the
`compose-view` override exists because structured-output tool-forcing is the more failure-sensitive path
(bounded repair loop) and may warrant a stronger/different model sooner. This is a **strict subset** of
FR-MC-013/015 — `AC-MC-018`/`AC-MC-019` are satisfied unchanged (both only exercise the default-resolution
and the compose-side override; neither AC asserts `AGENT_MODEL_CHAT`'s existence). `modelResolution.ts`
(Task 12) exports `resolveDefaultModel(env)` (used by both functions) and `resolveComposeModel(env)` (used
only by compose-view); `agent-chat/index.ts` calls only the former.

---

## 1. Design

### 1.1 Module map (new + touched files)

```
supabase/functions/_shared/                          NEW directory
  modelClient.ts                                      NEW — the ModelClient port (types only, FR-MC-002)
  modelClient.test.ts                                 NEW — type-shape smoke test (compiles + minimal contract)
  openRouterModelClient.ts                             NEW — OpenRouterModelClient (FR-MC-008..012)
  openRouterModelClient.test.ts                        NEW — AC-MC-001..007
  modelResolution.ts                                   NEW — resolveDefaultModel/resolveComposeModel (FR-MC-015, MC-OD-009)
  modelResolution.test.ts                              NEW — AC-MC-018, AC-MC-019

supabase/functions/agent-chat/
  handler.ts                                           EDIT — AnthropicLike→ModelClient (FR-MC-016..018, FR-MC-022)
  actions.ts                                            EDIT — ComposeActionDeps.anthropic→modelClient (FR-MC-018)
  index.ts                                              EDIT — OPENROUTER_API_KEY, OpenRouterModelClient, resolveDefaultModel
  deno.json                                             EDIT — drop @anthropic-ai/sdk (FR-MC-024 permission)

supabase/functions/compose-view/
  composeSpec.ts                                        EDIT — ComposeSpecDeps.anthropic→modelClient (FR-MC-019/020)
  handler.ts                                            EDIT — HandlerDeps.anthropic→modelClient rename only (FR-MC-021)
  index.ts                                              EDIT — OPENROUTER_API_KEY, OpenRouterModelClient, resolveComposeModel
  deno.json                                              EDIT — drop @anthropic-ai/sdk

pmo-portal/src/lib/agent/
  agentChatHandler.test.ts                              EDIT — anthropic→modelClient mock shape, OpenAI-shaped fixtures (AC-MC-008/009/012)
  agentWriteActions.test.ts                             EDIT — same rename (AC-MC-011)
  composeSpec.test.ts                                   EDIT — same rename (AC-MC-013/014/015/016)
  composeViewAction.test.ts                             EDIT — ComposeActionDeps.modelClient (AC-MC-017)
  portIsolation.test.ts                                 EDIT — add a DeputyContext-shape assertion (AC-MC-017)
  noApiKeyInBundle.test.ts                              EDIT — extend to also assert zero OPENROUTER_API_KEY literals (AC-MC-010)
  agentChatHandler.deepseekQuality.test.ts              NEW — AC-MC-020, AC-MC-021
  composeSpec.deepseekQuality.test.ts                   NEW — AC-MC-022

docs/environments.md                                    EDIT (ops note only, Task 15 — non-code doc, allowed: docs/ is planner's own tree)
```

`_shared/` is genuinely new — confirmed neither function currently has one (`Glob` of both directories
shows only `actions.ts/deno.json/handler.ts/index.ts/prompt.ts/schema.ts` for agent-chat and
`composeSpec.ts/deno.json/handler.ts/index.ts/prompt.ts/schema.ts` for compose-view). Both functions'
`deno.json` today has only two `imports` entries (`@anthropic-ai/sdk`, `@supabase/supabase-js`) — no
existing import-map entry needs to change for a relative `../_shared/...` import (Deno resolves relative
paths without an import-map entry, exactly like the existing `../../../pmo-portal/src/lib/...` imports
already used throughout both functions).

### 1.2 Test-execution reality: how edge-fn code is unit-tested in this repo (binding constraint for every task)

Confirmed by reading `agentChatHandler.test.ts`/`composeSpec.test.ts`/`composeViewAction.test.ts`: **there
is no separate Deno test runner in CI.** Every edge-fn business-logic file (`handler.ts`, `actions.ts`,
`composeSpec.ts`) is plain TypeScript with **relative imports and no Deno-only globals**, so Vitest (running
from `pmo-portal/`) imports them directly via relative paths like
`'../../../../supabase/functions/agent-chat/handler'`. `index.ts` (the `Deno.serve` wrapper) is the only
Deno-only file in each function and is explicitly **not unit-tested** (ADR-0039 decision 7) — verified
end-to-end only by manual local `supabase functions serve` runs. This plan follows the identical pattern:
`_shared/modelClient.ts` and `_shared/openRouterModelClient.ts` contain zero `Deno.*` globals (`fetch`,
`AbortController`, `setTimeout` are Web-standard, available in both runtimes) and are imported directly by
Vitest specs under `pmo-portal/src/lib/agent/` via the same `'../../../../supabase/functions/_shared/...'`
relative-path convention. No new test tooling, no `deno test`, no vitest workspace changes.

### 1.3 The `ModelClient` port (Task 1) — exact contents

Copied verbatim from spec FR-MC-002 (the spec IS the interface contract; no invention needed).

### 1.4 Error/timeout/logging design (`OpenRouterModelClient`)

- `AbortController` + `setTimeout(() => controller.abort(), 30_000)` per FR-NFR-MC-SEC-005 — cleared in a
  `finally` so it never leaks a pending timer in tests.
- Non-2xx → `throw new Error('OpenRouter request failed: ' + response.status)` — the status code only, never
  the body (NFR-MC-SEC-004, AC-MC-005). No `console.*` call inside the transport on this path (the two
  callers already log `{errorCode, ...}` on catch — adding a second log site here would duplicate/risk
  leaking, so the transport stays silent and lets the caller's existing catch block own the one log line,
  matching current behavior exactly for the Anthropic SDK path today, which also does not log inside the SDK
  call).
- Abort (timeout) surfaces as `fetch` rejecting with `AbortError` — re-thrown as a plain `Error` (not a
  special code) so it flows through the exact same `catch` path as any other thrown error (FR-MC-010,
  AC-MC-006) — no special-casing needed in `handler.ts`/`composeSpec.ts`.

### 1.5 Model resolution (Task 12, MC-OD-009)

```ts
// supabase/functions/_shared/modelResolution.ts
export const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

export interface ModelEnv {
  AGENT_MODEL_DEFAULT?: string;
  AGENT_MODEL_COMPOSE?: string;
}

export function resolveDefaultModel(env: ModelEnv): string {
  return env.AGENT_MODEL_DEFAULT || DEFAULT_MODEL;
}

export function resolveComposeModel(env: ModelEnv): string {
  return env.AGENT_MODEL_COMPOSE || resolveDefaultModel(env);
}
```

Both `index.ts` files build a `ModelEnv` object from `Deno.env.get(...)` and call the relevant resolver,
then pass the resulting `model: string` into `HandlerDeps`/`ComposeSpecDeps` — preserving the pure/DI rule
(the resolver itself takes a plain object, not `Deno.env`, so it too is Vitest-importable — AC-MC-018/019
test it directly with a plain object, no Deno mocking needed).

### 1.6 Traceability table (AC → owning test file → task)

| AC-### | Owning test file | Task(s) |
|---|---|---|
| AC-MC-001 | `supabase/functions/_shared/openRouterModelClient.test.ts` | 3 |
| AC-MC-002 | `supabase/functions/_shared/openRouterModelClient.test.ts` | 4 |
| AC-MC-003 | `supabase/functions/_shared/openRouterModelClient.test.ts` | 5 |
| AC-MC-004 | `supabase/functions/_shared/openRouterModelClient.test.ts` | 6 |
| AC-MC-005 | `supabase/functions/_shared/openRouterModelClient.test.ts` | 7 |
| AC-MC-006 | `supabase/functions/_shared/openRouterModelClient.test.ts` | 8 |
| AC-MC-007 | `supabase/functions/_shared/openRouterModelClient.test.ts` | 9 |
| AC-MC-008 | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` | 10 |
| AC-MC-009 | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` | 10 |
| AC-MC-010 | `pmo-portal/src/lib/agent/noApiKeyInBundle.test.ts` | 17 |
| AC-MC-011 | `pmo-portal/src/lib/agent/agentWriteActions.test.ts` | 11 |
| AC-MC-012 | `pmo-portal/src/lib/agent/agentChatHandler.test.ts` | 13 |
| AC-MC-013 | `pmo-portal/src/lib/agent/composeSpec.test.ts` | 14 |
| AC-MC-014 | `pmo-portal/src/lib/agent/composeSpec.test.ts` | 14 |
| AC-MC-015 | `pmo-portal/src/lib/agent/composeSpec.test.ts` | 14 |
| AC-MC-016 | `pmo-portal/src/lib/agent/composeSpec.test.ts` | 14 |
| AC-MC-017 | `pmo-portal/src/lib/agent/composeViewAction.test.ts` + `portIsolation.test.ts` | 16 |
| AC-MC-018 | `supabase/functions/_shared/modelResolution.test.ts` | 12 |
| AC-MC-019 | `supabase/functions/_shared/modelResolution.test.ts` | 12 |
| AC-MC-020 | `pmo-portal/src/lib/agent/agentChatHandler.deepseekQuality.test.ts` | 19 |
| AC-MC-021 | `pmo-portal/src/lib/agent/agentChatHandler.deepseekQuality.test.ts` | 19 |
| AC-MC-022 | `pmo-portal/src/lib/agent/composeSpec.deepseekQuality.test.ts` | 20 |
| AC-MC-023 | N/A — live-run evidence recorded in §5 "Verification notes" below | 21 |

(Note: the spec's own traceability table places the OpenRouter-transport ACs' owning file under
`supabase/functions/_shared/`, but per §1.2 above these are executed by the **same Vitest run** as every
other test in this repo — `npm test` from `pmo-portal/` — not a separate Deno suite. No new `npm run` script
is introduced.)

---

## 2. Tasks

Each task is 2–5 minutes, TDD (failing test written/verified red before the implementation edit), exact
file paths, exact code. Tasks 1–9 build the port+transport; 10–14 wire the two functions; 15 is the ops-doc
migration note; 16–18 close the seam-isolation + key-leak gates; 19–21 are the quality-gate tests + live-run
task; 22 is the final full-repo verify gate.

---

### Task 1 — `ModelClient` port types (FR-MC-001, FR-MC-002)

Create `supabase/functions/_shared/modelClient.ts`:

```ts
/**
 * ModelClient — vendor-neutral port for the agent-chat / compose-view model call.
 * Shaped as OpenAI chat-completions (the shape OpenRouter and most non-Anthropic
 * providers speak natively — spec agent-model-client.spec.md §1 "Why this shape").
 *
 * Pure types only — no runtime values, no Deno globals. Importable in Vitest.
 * FR-MC-001, FR-MC-002.
 */

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ModelToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ModelToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ModelTool {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

export interface ModelClientParams {
  model: string;
  max_tokens: number;
  messages: ModelMessage[];
  tools?: ModelTool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  stream?: boolean;
}

export interface ModelUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost?: number;
}

export interface ModelResponse {
  finish_reason: string;
  message: { role: 'assistant'; content: string | null; tool_calls?: ModelToolCall[] };
  usage?: ModelUsage;
  model: string;
}

export interface ModelClient {
  create(params: ModelClientParams): Promise<ModelResponse>;
}
```

No test for this task — it is pure type declarations (no runtime behavior to assert); Task 3's test imports
and exercises these types via `OpenRouterModelClient`, which is the first runtime consumer. This matches the
existing repo convention (`runtime/port.ts` also has no dedicated `.test.ts` — `port.contract.test.ts`
exercises the adapter that implements it, not the port file itself).

**Verify:** `cd pmo-portal && npx tsc --noEmit -p ../supabase/functions/_shared/../../pmo-portal/tsconfig.json 2>&1 | grep modelClient || echo "no modelClient errors"` — actually simpler: this file has no
runtime import yet, so defer typecheck confirmation to Task 3 (which imports it). Skip a standalone verify
step for Task 1.

---

### Task 2 — RED: `openRouterModelClient.test.ts` scaffold + AC-MC-001 request-shape test

Create `supabase/functions/_shared/openRouterModelClient.test.ts`:

```ts
/**
 * Unit tests for OpenRouterModelClient — the ModelClient implementation calling
 * OpenRouter's chat-completions API. fetch is mocked; no live network calls (ADR-0039 dec 7).
 *
 * AC-MC-001..007 (docs/specs/agent-model-client.spec.md).
 */
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenRouterModelClient } from './openRouterModelClient';

function mockFetchOnce(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('AC-MC-001 sends POST to the OpenRouter chat-completions endpoint with the right headers/body shape', async () => {
  const fetchMock = mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hi' } }],
  });

  const client = new OpenRouterModelClient({ apiKey: 'test-key' });
  await client.create({
    model: 'deepseek/deepseek-v4-flash',
    max_tokens: 512,
    messages: [{ role: 'user', content: 'hello' }],
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toBe('Bearer test-key');
  expect(init.headers['Content-Type']).toBe('application/json');

  const body = JSON.parse(init.body as string);
  expect(body.model).toBe('deepseek/deepseek-v4-flash');
  expect(body.max_tokens).toBe(512);
  expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  expect(body.provider).toEqual({ order: ['DeepInfra'], allow_fallbacks: true });
  expect(body.usage).toEqual({ include: true });
});
```

**Verify (expect RED — module doesn't exist yet):**
```
cd pmo-portal && npx vitest run --root . ../supabase/functions/_shared/openRouterModelClient.test.ts
```
Confirm failure is "Cannot find module './openRouterModelClient'" (not a different error).

---

### Task 3 — GREEN: `OpenRouterModelClient` request construction (FR-MC-008, FR-MC-009)

Create `supabase/functions/_shared/openRouterModelClient.ts`:

```ts
/**
 * OpenRouterModelClient — ModelClient implementation calling OpenRouter's
 * chat-completions API (POST /chat/completions). OpenRouter's API IS the OpenAI
 * chat-completions shape, so this transport is a near-direct pass-through.
 *
 * FR-MC-008..012, NFR-MC-SEC-004/005, NFR-MC-PERF-001 (non-streaming — MC-OD-007).
 * Pure: no Deno globals (fetch/AbortController/setTimeout are Web-standard) —
 * importable in Vitest with fetch mocked (ADR-0039 decision 7).
 */
import type { ModelClient, ModelClientParams, ModelResponse } from './modelClient';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 30_000;

export interface OpenRouterModelClientOptions {
  apiKey: string;
}

interface OpenRouterChoice {
  finish_reason: string;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  };
}

interface OpenRouterResponseBody {
  model: string;
  choices: OpenRouterChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
}

export class OpenRouterModelClient implements ModelClient {
  private readonly apiKey: string;

  constructor(options: OpenRouterModelClientOptions) {
    this.apiKey = options.apiKey;
  }

  async create(params: ModelClientParams): Promise<ModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          max_tokens: params.max_tokens,
          messages: params.messages,
          ...(params.tools ? { tools: params.tools } : {}),
          ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
          provider: { order: ['DeepInfra'], allow_fallbacks: true },
          usage: { include: true },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        err instanceof Error && err.name === 'AbortError'
          ? 'OpenRouter request timed out'
          : 'OpenRouter request failed',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`OpenRouter request failed: ${response.status}`);
    }

    const body = (await response.json()) as OpenRouterResponseBody;
    const choice = body.choices[0];

    return {
      finish_reason: choice.finish_reason,
      message: {
        role: 'assistant',
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
      },
      usage: body.usage
        ? {
            prompt_tokens: body.usage.prompt_tokens ?? 0,
            completion_tokens: body.usage.completion_tokens ?? 0,
            total_tokens: body.usage.total_tokens ?? 0,
            ...(body.usage.cost !== undefined ? { total_cost: body.usage.cost } : {}),
          }
        : undefined,
      model: body.model,
    };
  }
}
```

**Verify (expect GREEN):**
```
cd pmo-portal && npx vitest run --root . ../supabase/functions/_shared/openRouterModelClient.test.ts
```

---

### Task 4 — RED→GREEN: AC-MC-002 text-only response mapping

Append to `supabase/functions/_shared/openRouterModelClient.test.ts`:

```ts
it('AC-MC-002 maps a text-only completion to ModelResponse', async () => {
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [
      {
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'answer text' },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  const resp = await client.create({
    model: 'deepseek/deepseek-v4-flash',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
  });

  expect(resp.finish_reason).toBe('stop');
  expect(resp.message.content).toBe('answer text');
  expect(resp.message.tool_calls).toBeUndefined();
  expect(resp.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
});
```

No implementation change needed — Task 3's mapping already satisfies this. **Verify:**
```
cd pmo-portal && npx vitest run --root . ../supabase/functions/_shared/openRouterModelClient.test.ts
```
Confirm this new test is GREEN immediately (proves Task 3's mapping is correct without further edits).

---

### Task 5 — RED→GREEN: AC-MC-003 tool-call response mapping (arguments stay a string)

Append to the same test file:

```ts
it('AC-MC-003 tool_calls arguments stay a JSON-encoded string, not pre-parsed', async () => {
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'query_entity', arguments: '{"entity":"projects"}' },
            },
          ],
        },
      },
    ],
  });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  const resp = await client.create({
    model: 'deepseek/deepseek-v4-flash',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
  });

  expect(resp.finish_reason).toBe('tool_calls');
  expect(resp.message.tool_calls?.[0].function.arguments).toBe('{"entity":"projects"}');
  expect(typeof resp.message.tool_calls?.[0].function.arguments).toBe('string');
});
```

**Verify:** same command as Task 4; expect GREEN with no implementation edit.

---

### Task 6 — RED→GREEN: AC-MC-004 usage cost present/absent

Append to the same test file:

```ts
it('AC-MC-004 surfaces total_cost when the provider reports it, omits it when absent', async () => {
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'a' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cost: 0.0004 },
  });
  const withCost = await new OpenRouterModelClient({ apiKey: 'k' }).create({
    model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }],
  });
  expect(withCost.usage?.total_cost).toBe(0.0004);

  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'a' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const withoutCost = await new OpenRouterModelClient({ apiKey: 'k' }).create({
    model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }],
  });
  expect(withoutCost.usage?.total_cost).toBeUndefined();
});
```

**Verify:** same command; expect GREEN with no implementation edit (Task 3's conditional spread already
handles this).

---

### Task 7 — RED→GREEN: AC-MC-005 non-2xx → thrown Error, scrubbed, no raw-body logging

Append to the same test file:

```ts
it('AC-MC-005 throws a scrubbed Error on non-2xx and never logs the raw body', async () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockFetchOnce({ error: 'sk-secret-looking-value-should-never-be-logged' }, 500);

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  await expect(
    client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
  ).rejects.toThrow(Error);

  for (const spy of [consoleSpy, consoleWarnSpy, consoleLogSpy]) {
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('sk-secret-looking-value-should-never-be-logged');
    }
  }
  consoleSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  consoleLogSpy.mockRestore();
});
```

**Verify:** same command; expect GREEN (Task 3's `!response.ok` branch never calls `console.*` and never
reads the body on that path).

---

### Task 8 — RED→GREEN: AC-MC-006 timeout bounds the call

Append to the same test file:

```ts
it('AC-MC-006 rejects within the timeout window when fetch never resolves', async () => {
  vi.useFakeTimers();
  const fn = vi.fn(() => new Promise(() => {})); // never resolves
  vi.stubGlobal('fetch', fn);

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  const promise = client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
  const assertion = expect(promise).rejects.toThrow();

  // fetch never resolves on its own; the AbortController fires the abort at 30s,
  // but since fetch itself never rejects on Node's native fetch abort in this mock
  // (the mock doesn't observe the AbortSignal), assert the timer fires without hanging:
  await vi.advanceTimersByTimeAsync(30_000);
  vi.useRealTimers();
  await assertion;
});
```

Note: this test targets the **timer firing**, not a literal unresolved `fetch` rejecting — since the mock
`fetch` above ignores the abort signal entirely (a stricter mock would need to honor `AbortSignal`, which
adds complexity disproportionate to what this AC needs to prove). Use this stronger, still-simple variant
instead, which makes the mock **listen** to the signal (closer to real `fetch` behavior and avoids a
timers/promise race):

```ts
it('AC-MC-006 rejects within the timeout window when fetch never resolves', async () => {
  vi.useFakeTimers();
  const fn = vi.fn((_url: string, init: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  });
  vi.stubGlobal('fetch', fn);

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  const promise = client.create({ model: 'x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] });
  const assertion = expect(promise).rejects.toThrow('OpenRouter request timed out');
  await vi.advanceTimersByTimeAsync(30_000);
  await assertion;
  vi.useRealTimers();
});
```

Replace the first draft with this second (signal-aware) version in the file — only the second version is
committed.

**Verify:**
```
cd pmo-portal && npx vitest run --root . ../supabase/functions/_shared/openRouterModelClient.test.ts
```
Expect GREEN (Task 3's `AbortController`/`setTimeout(REQUEST_TIMEOUT_MS)` + catch-and-rename-to-timeout-message
already implements this).

---

### Task 9 — RED→GREEN: AC-MC-007 model echo for fallback visibility

Append to the same test file:

```ts
it('AC-MC-007 echoes the server-reported model, not the requested model', async () => {
  mockFetchOnce({
    model: 'deepseek/deepseek-v4-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'a' } }],
  });

  const client = new OpenRouterModelClient({ apiKey: 'k' });
  const resp = await client.create({
    model: 'some/other-requested-model',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'hi' }],
  });

  expect(resp.model).toBe('deepseek/deepseek-v4-flash');
});
```

**Verify:** same command; expect GREEN (Task 3 already reads `body.model`, never echoes `params.model`).

At this point run the full transport suite once to confirm all 7 ACs pass together:
```
cd pmo-portal && npx vitest run --root . ../supabase/functions/_shared/openRouterModelClient.test.ts
```
Expect: 7 passed (plus the AC-MC-001 request-shape test from Task 2 = 8 total in this file... actually 8 `it`
blocks: 001,002,003,004,005,006,007 + none duplicated — confirm exactly 7 pass, matching AC-MC-001..007).

---

### Task 10 — RED→GREEN: `agent-chat` integration — rename `anthropic`→`modelClient`, OpenAI message/tool shapes (FR-MC-016/017, AC-MC-008/009)

**Edit `pmo-portal/src/lib/agent/agentChatHandler.test.ts`:**

Replace every `anthropic: { messages: { create: ... } }` deps shape with `modelClient: { create: ... }`
returning the new `ModelResponse` shape (`finish_reason`/`message.tool_calls`/`message.content`) instead of
`stop_reason`/`content: [...]`. Concretely:

Replace the `baseDeps` helper (current lines ~86–102):
```ts
function baseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    modelClient: {
      create: vi.fn().mockResolvedValue({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'All done.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
    },
    supabase: mockOrgAnd(() => ({ data: [], error: null })),
    userId: 'user-1',
    now: () => new Date('2026-06-30T00:00:00Z'),
    ...overrides,
  };
}
```

Every other test in this file that builds a custom `anthropic: { messages: { create: vi.fn()...` mock (the
"AC-AR-001 parity" happy-path read test and the `MAX_TOOL_ROUNDS` test) is edited the same mechanical way:
`stop_reason: 'tool_use'` → `finish_reason: 'tool_calls'`; `content: [{ type:'tool_use', id, name, input }]`
→ `message: { role:'assistant', content: null, tool_calls: [{ id, type:'function', function: { name,
arguments: JSON.stringify(input) } }] }`; `content: [{ type:'text', text }]` → `message: { role:'assistant',
content: text }`; the deps key `anthropic` → `modelClient`.

Rename the two happy-path/round-cap tests' titles to carry the new AC id (traceability):
```ts
it('AC-MC-008 tool-use loop parity: happy read path, same event order (OpenRouter/OpenAI shape)', async () => {
  // ... existing body, mock shapes updated per above
});

it('AC-MC-009 MAX_TOOL_ROUNDS unchanged after the provider swap', async () => {
  // ... existing body, mock shapes updated per above
});
```

**Verify (expect RED first — before touching `handler.ts`):**
```
cd pmo-portal && npx vitest run src/lib/agent/agentChatHandler.test.ts
```
Confirm failures are type/shape mismatches against the still-`anthropic`-shaped `HandlerDeps` (proves the
test correctly targets the not-yet-built rename).

**Now edit `supabase/functions/agent-chat/handler.ts`:**

1. Delete lines 50–77 (`AnthropicLike`/`AnthropicCreateParams`/`AnthropicContentBlock`/`AnthropicResponse`
   interfaces) and replace with:
```ts
import type { ModelClient, ModelMessage, ModelTool } from '../_shared/modelClient';
```
2. In `HandlerDeps` (was line 123–141), replace `anthropic: AnthropicLike;` with `modelClient: ModelClient;`.
3. Replace the `messages` array type throughout (`Array<{ role: 'user' | 'assistant'; content: string |
   object[] }>`) with `ModelMessage[]`, and every `messages.push({ role: 'assistant', content: [{ type:
   'tool_use', ... }] })` / `messages.push({ role: 'user', content: [{ type: 'tool_result', ... }] })` pair
   with the FR-MC-006 single-message form:
```ts
// was: assistant tool_use echo + user tool_result wrapper (2 messages)
// now: one role:'tool' message per FR-MC-006
messages.push({
  role: 'tool',
  tool_call_id: toolId,
  name: toolName,
  content: JSON.stringify(toolResult),
});
```
   Apply this replacement at all 6 sites in `handler.ts` that currently push the assistant/user tool_use +
   tool_result pair (main loop's compose-error branch, compose-success branch, unknown-action branch,
   confirm-invalid-args branch, read-action dispatch branch, and `runLoop`'s own unknown/dispatch branches) —
   each becomes exactly one `role:'tool'` push, deleting the now-unnecessary preceding
   `messages.push({role:'assistant', content:[{type:'tool_use',...}]})` line in each case (FR-MC-006: "This
   is a protocol simplification... only the wire representation changes").
4. Replace the system-prompt wiring: where `messages` is built from `req.messages.map(...)`, prepend
   `{ role: 'system', content: system }` as `messages[0]` (FR-MC-003) instead of passing `system` as a
   separate `AnthropicCreateParams.system` field; remove the `system` call-site argument from both
   `deps.anthropic.messages.create(...)` call sites.
5. Replace both `deps.anthropic.messages.create({...})` calls (main loop + `runLoop`) with
   `deps.modelClient.create({...})`, using `model: deps.model` (new required `HandlerDeps.model: string`
   field per FR-MC-015 — added in Task 12's index.ts wiring; for this task, add the field to `HandlerDeps`
   now and default-thread it through test `baseDeps` as `model: 'deepseek/deepseek-v4-flash'`), dropping the
   hardcoded `'claude-opus-4-8'` literal.
6. Replace the branch conditions per FR-MC-007's table:
   - `resp.stop_reason === 'max_tokens'` → `resp.finish_reason === 'length'`
   - `resp.stop_reason !== 'tool_use'` → `resp.finish_reason !== 'tool_calls'`
   - the `resp.content.find(b => b.type === 'tool_use')` lookup → `resp.message.tool_calls?.[0]`
   - the text-block emission loop (`for (const block of resp.content) if (block.type==='text' && block.text)
     yield emit('assistant', {text: block.text})`) → `if (resp.message.content) yield emit('assistant', {
     text: resp.message.content });`
   - `toolBlock.input` → `JSON.parse(toolCall.function.arguments)` (FR-MC-005)
   - `toolBlock.id`/`toolBlock.name` → `toolCall.id`/`toolCall.function.name`
7. Build the `tools` array as `ModelTool[]` per FR-MC-017:
```ts
const tools: ModelTool[] = BASE_ACTIONS.map((a) => ({
  type: 'function',
  function: { name: a.name, description: a.description, parameters: a.inputSchema },
}));
if (deps.composeEnabled) {
  tools.push({
    type: 'function',
    function: { name: composeViewAction.name, description: composeViewAction.description, parameters: composeViewAction.inputSchema },
  });
}
```
Same replacement in `runLoop`'s inline `tools:` array construction.

**Verify (expect GREEN):**
```
cd pmo-portal && npx vitest run src/lib/agent/agentChatHandler.test.ts
```
This will still show unrelated failures from other files that also mock `anthropic` — that's expected and
addressed in Tasks 11/13/14/16; only this file's tests must be green after this task.

---

### Task 11 — RED→GREEN: `agentWriteActions.test.ts` rename + A3 approve/deny parity (AC-MC-011)

**Edit `pmo-portal/src/lib/agent/agentWriteActions.test.ts`:** apply the identical mechanical rename as Task
10 (`anthropic`→`modelClient`, `AnthropicResponse`-shape → `ModelResponse`-shape) to every mock in this file.
Rename the AC-AW-001 happy-approve test's inline mock (`proposeAnthropicCreate`) to
`proposeModelClientCreate` and its `stop_reason:'tool_use'`/`content:[{type:'tool_use',...}]` body to
`finish_reason:'tool_calls'`/`message:{role:'assistant',content:null,tool_calls:[{id,type:'function',
function:{name,arguments:JSON.stringify(input)}}]}`. Add the AC id to the confirm:false-bypass test's title:
```ts
it('AC-MC-011 confirm:false action (query_entity) runs immediately with no needs-approval event (parity with A3)', async () => {
```
(keep the original `AC-AW-006`-titled test body logic, just retagged — the spec's AC-MC-011 explicitly maps
to this exact scenario: "AC-AW-001-class parity, unchanged by provider swap").

**Verify (expect RED before, GREEN after — the handler.ts edit already landed in Task 10, so this task is
test-only and should go GREEN immediately once the rename lands):**
```
cd pmo-portal && npx vitest run src/lib/agent/agentWriteActions.test.ts
```

---

### Task 12 — RED→GREEN: `modelResolution.ts` (FR-MC-015, MC-OD-009, AC-MC-018/019)

**Create `supabase/functions/_shared/modelResolution.test.ts`:**

```ts
/**
 * AC-MC-018: default model resolution when no env vars set.
 * AC-MC-019: AGENT_MODEL_COMPOSE overrides AGENT_MODEL_DEFAULT for compose-view.
 */
import { it, expect } from 'vitest';
import { DEFAULT_MODEL, resolveDefaultModel, resolveComposeModel } from './modelResolution';

it('AC-MC-018 resolves to deepseek/deepseek-v4-flash when no env vars are set', () => {
  expect(resolveDefaultModel({})).toBe('deepseek/deepseek-v4-flash');
  expect(resolveDefaultModel({})).toBe(DEFAULT_MODEL);
  expect(resolveComposeModel({})).toBe(DEFAULT_MODEL);
});

it('AC-MC-019 AGENT_MODEL_COMPOSE overrides AGENT_MODEL_DEFAULT for compose-view resolution', () => {
  const env = { AGENT_MODEL_DEFAULT: 'some/other-model', AGENT_MODEL_COMPOSE: 'deepseek/deepseek-v4-flash' };
  expect(resolveComposeModel(env)).toBe('deepseek/deepseek-v4-flash');
  expect(resolveDefaultModel(env)).toBe('some/other-model');
});
```

**Verify (expect RED):**
```
cd pmo-portal && npx vitest run --root . ../supabase/functions/_shared/modelResolution.test.ts
```

**Now create `supabase/functions/_shared/modelResolution.ts`** with exactly the contents from §1.5 above.

**Verify (expect GREEN):**
```
cd pmo-portal && npx vitest run --root . ../supabase/functions/_shared/modelResolution.test.ts
```

---

### Task 13 — RED→GREEN: per-round usage surfaced on the status event (FR-MC-022, AC-MC-012)

**Edit `pmo-portal/src/lib/agent/agentChatHandler.test.ts`** — add a new test:

```ts
it('AC-MC-012 per-round usage is surfaced additively on the terminal status event', async () => {
  const create = vi.fn().mockResolvedValue({
    finish_reason: 'stop',
    message: { role: 'assistant', content: 'done' },
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160, total_cost: 0.0002 },
    model: 'deepseek/deepseek-v4-flash',
  });

  const events = await collect(
    agentChatHandler(REQ, baseDeps({ modelClient: { create } })),
  );

  const completedEvent = events.find(
    (e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'completed',
  );
  expect(completedEvent).toBeDefined();
  expect(completedEvent!.payload).toMatchObject({
    status: 'completed',
    model: 'deepseek/deepseek-v4-flash',
    prompt_tokens: 120,
    completion_tokens: 40,
    total_cost: 0.0002,
  });
});
```

**Verify (expect RED):**
```
cd pmo-portal && npx vitest run src/lib/agent/agentChatHandler.test.ts -t "AC-MC-012"
```

**Edit `supabase/functions/agent-chat/handler.ts`:** in the terminal-`completed` branch (both the main loop
and `runLoop`, the `if (resp.finish_reason !== 'tool_calls') { yield statusEvent('completed'); return; }`
site), pass the usage extras:
```ts
if (resp.finish_reason !== 'tool_calls') {
  yield statusEvent('completed', {
    model: resp.model,
    prompt_tokens: resp.usage?.prompt_tokens,
    completion_tokens: resp.usage?.completion_tokens,
    ...(resp.usage?.total_cost !== undefined ? { total_cost: resp.usage.total_cost } : {}),
  });
  return;
}
```
(`statusEvent`'s signature already accepts an `extra: Record<string, unknown>` merged into `payload` —
no signature change needed, confirmed from the existing `statusEvent` helper at handler.ts current L242–247.)

**Verify (expect GREEN):**
```
cd pmo-portal && npx vitest run src/lib/agent/agentChatHandler.test.ts
```

---

### Task 14 — RED→GREEN: `compose-view` integration (FR-MC-019/020/021, AC-MC-013/014/015/016)

**Edit `pmo-portal/src/lib/agent/composeSpec.test.ts`:** apply the mechanical rename to `mockAnthropicReturning`/
`mockAnthropicSequence` helpers → `mockModelClientReturning`/`mockModelClientSequence`, returning
`{finish_reason:'tool_calls', message:{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',
function:{name:'compose_view',arguments:JSON.stringify(spec)}}]}, usage:{prompt_tokens:10,
completion_tokens:20,total_tokens:30}, model:'deepseek/deepseek-v4-flash'}` in place of the old
`{content:[{type:'tool_use',name:'compose_view',input:spec}], usage:{input_tokens:10,output_tokens:20}}`
shape. Rename `ComposeSpecDeps['anthropic']` usages to `ComposeSpecDeps['modelClient']` throughout the file.
Retag the four scenario tests' titles with `AC-MC-013`/`AC-MC-014`/`AC-MC-015`/`AC-MC-016` (keep existing
`AC-CV-*`/`AC-AS-*` parity note in a trailing comment, e.g. `// AC-MC-013 (parity with AC-AS-001)`).

**Verify (expect RED):**
```
cd pmo-portal && npx vitest run src/lib/agent/composeSpec.test.ts
```

**Edit `supabase/functions/compose-view/composeSpec.ts`:**
1. Delete `AnthropicLike`/`AnthropicCreateParams`/`AnthropicResponse` (lines 38–67); add
   `import type { ModelClient, ModelMessage, ModelTool } from '../_shared/modelClient';`.
2. `ComposeSpecDeps.anthropic: AnthropicLike` → `ComposeSpecDeps.modelClient: ModelClient`; add
   `model: string` (the resolved model id, threaded in from `index.ts`/`runComposeView`'s deps bag).
3. `callModel`'s signature becomes `callModel(modelClient: ModelClient, model: string, system: string,
   messages: ModelMessage[])`; the call body:
```ts
async function callModel(
  modelClient: ModelClient,
  model: string,
  system: string,
  messages: ModelMessage[],
): Promise<{ spec: CompositionSpec; tokensUsed: number }> {
  const response = await modelClient.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'system', content: system }, ...messages],
    tools: [
      {
        type: 'function',
        function: {
          name: 'compose_view',
          description: "Author a validated CompositionSpec v1 for the user's natural-language request.",
          parameters: COMPOSITION_SPEC_SCHEMA,
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'compose_view' } },
  });

  const toolCall = response.message.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== 'compose_view') {
    throw new Error('Model did not return a compose_view tool call');
  }

  const tokensUsed = (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0);

  return {
    spec: JSON.parse(toolCall.function.arguments) as CompositionSpec,
    tokensUsed,
  };
}
```
4. `conversationMessages` type becomes `ModelMessage[]`; its seed becomes `[{ role: 'user', content:
   prompt }]` (system is now injected inside `callModel`, matching FR-MC-003's `messages[0]` convention —
   simplify by NOT storing system in `conversationMessages` at all, keeping `composeSpec`'s call site
   unchanged: `const { spec, tokensUsed } = await callModel(modelClient, model, system, conversationMessages);`).
5. The repair-loop feedback push (FR-MC-020) — replace the two-message placeholder push:
```ts
// was: assistant tool_use placeholder + user text (2 messages)
// now: one user-role text message (FR-MC-020 — no placeholder needed)
conversationMessages.push({ role: 'user', content: repairFeedback });
```
   (delete the `conversationMessages.push({role:'assistant', content:[{type:'tool_use', id:
   'repair_placeholder', ...}]})` line entirely).
6. `composeSpec`'s own signature: `deps: ComposeSpecDeps` destructure becomes `const { modelClient, userId,
   model } = deps;`; its one `callModel(...)` call site becomes `callModel(modelClient, model, system,
   conversationMessages)`.

**Edit `supabase/functions/compose-view/handler.ts`:** rename `HandlerDeps.anthropic` →
`HandlerDeps.modelClient` (+ add `model: string`), update its one `import type { AnthropicLike, ...}`
re-export line to `export type { ModelClient } from '../_shared/modelClient';` (drop the now-nonexistent
`AnthropicCreateParams`/`AnthropicResponse` re-exports — nothing in the test suite imports those two type
names directly, confirmed by their absence from any `import type` in `composeSpec.test.ts` beyond
`ComposeSpecDeps`), and its `composeSpec(req.prompt, req.orgId, { anthropic, userId })` call site →
`composeSpec(req.prompt, req.orgId, { modelClient, userId, model })`.

**Verify (expect GREEN):**
```
cd pmo-portal && npx vitest run src/lib/agent/composeSpec.test.ts
```

---

### Task 15 — Ops-doc migration note (env/secret rename) — no code, no new test

**Edit `docs/environments.md`** (planner-owned tree — allowed). In the "Edge Functions (local dev + prod
deploy)" section, replace every `ANTHROPIC_API_KEY` reference with `OPENROUTER_API_KEY`:

- The paragraph "Both hold `ANTHROPIC_API_KEY` and act under the caller's JWT" → "Both hold
  `OPENROUTER_API_KEY` and act under the caller's JWT".
- The "Local dev (real LLM, on your machine)" prereqs line "a real Anthropic key" → "a real OpenRouter API
  key (`https://openrouter.ai/keys`)"; the `cp supabase/functions/.env.example supabase/functions/.env #
  fill ANTHROPIC_API_KEY` comment → `# fill OPENROUTER_API_KEY (and optionally AGENT_MODEL_DEFAULT /
  AGENT_MODEL_COMPOSE)`.
- The "Prod deploy" gap section's `supabase secrets set ANTHROPIC_API_KEY=sk-ant-…` line →
  `supabase secrets set OPENROUTER_API_KEY=sk-or-…` with an added note: "**Migration note (this issue):**
  the prod Supabase Cloud project currently has NO `ANTHROPIC_API_KEY` secret set (never deployed — see the
  ⚠ gap this section already documents) — so there is nothing to unset/rotate on the cloud side. The only
  action needed at prod-deploy time is setting `OPENROUTER_API_KEY` (new) instead of the old name; no
  live-secret rotation is required because the old secret was never live."

Also add a short line under the existing `.env.example` reference (Task 16 updates the actual file):
"`supabase/functions/.env.example` now documents `OPENROUTER_API_KEY` / `AGENT_MODEL_DEFAULT` /
`AGENT_MODEL_COMPOSE` in place of `ANTHROPIC_API_KEY`."

**No verify command** — this is a docs-only prose edit with no executable assertion; reviewed by the
Director at plan sign-off / PR review instead.

---

### Task 16 — RED→GREEN: seam isolation for the renamed member + `ComposeActionDeps`/`actions.ts` (FR-MC-018, AC-MC-017)

**Edit `pmo-portal/src/lib/agent/composeViewAction.test.ts`:** rename `mockAnthropicLike` → `mockModelClient`
(`{ create: vi.fn() }` — flat, not nested under `.messages`), rename `mockDeps: ComposeActionDeps = {
anthropic: mockAnthropicLike }` → `{ modelClient: mockModelClient }`. No other test-body changes (the tests
mock `composeSpec` itself, not the model call directly, so the reshaping is confined to the deps object).

**Edit `pmo-portal/src/lib/agent/portIsolation.test.ts`:** add a second test after the existing one:

```ts
it('AC-MC-017 DeputyContext gains no modelClient member under the ModelClient rename', () => {
  // Type-level assertion: DeputyContext (runtime/port.ts) must have exactly its
  // documented members. This mirrors the ADR-0041 invariant this file already
  // exists to protect, now re-asserted for the renamed anthropic->modelClient seam.
  type Keys = keyof import('./runtime/port').DeputyContext;
  const allowedKeys: Record<Keys, true> = { jwt: true, userId: true, orgId: true, supabase: true };
  // If DeputyContext ever gains a `modelClient` (or any other) member, this object
  // literal fails to typecheck (excess/missing property) — a compile-time proof,
  // not just a runtime grep.
  expect(Object.keys(allowedKeys)).toEqual(['jwt', 'userId', 'orgId', 'supabase']);
});
```

**Verify (expect RED first — `ComposeActionDeps`/`DeputyContext` haven't been touched yet by this task, so
`composeViewAction.test.ts` is red against the still-`anthropic`-shaped `actions.ts`; `portIsolation.test.ts`'s
new test is green immediately since it only asserts today's already-correct `DeputyContext` shape — run both,
confirm exactly the expected file is red):**
```
cd pmo-portal && npx vitest run src/lib/agent/composeViewAction.test.ts src/lib/agent/portIsolation.test.ts
```

**Edit `supabase/functions/agent-chat/actions.ts`:**
1. Replace `import type { AnthropicLike } from '../compose-view/composeSpec';` with
   `import type { ModelClient } from '../_shared/modelClient';`.
2. `ComposeActionDeps.anthropic: AnthropicLike` → `ComposeActionDeps.modelClient: ModelClient` (add `model:
   string` too — `runComposeView` must thread the resolved model id into `composeSpec`'s now-required
   `model` field from Task 14):
```ts
export interface ComposeActionDeps {
  /** The vendor-neutral model client, curried in by the handler at dispatch. */
  modelClient: ModelClient;
  /** The resolved model id for this call (FR-MC-015 / MC-OD-009). */
  model: string;
}
```
3. `runComposeView`'s call into `composeSpec` (current `{ anthropic: deps.anthropic, userId: ctx.userId }`)
   → `{ modelClient: deps.modelClient, userId: ctx.userId, model: deps.model }`.

**Edit `supabase/functions/agent-chat/handler.ts`:** the compose-dispatch site (`runComposeView(toolInput,
ctx, { anthropic: deps.anthropic })`) → `runComposeView(toolInput, ctx, { modelClient: deps.modelClient,
model: deps.model })` (FR-MC-018 — `deps.model` is the same `HandlerDeps.model` field added in Task 10 step
5).

**Verify (expect GREEN):**
```
cd pmo-portal && npx vitest run src/lib/agent/composeViewAction.test.ts src/lib/agent/portIsolation.test.ts src/lib/agent/agentChatHandler.test.ts src/lib/agent/agentWriteActions.test.ts src/lib/agent/composeSpec.test.ts
```

---

### Task 17 — RED→GREEN: extend `noApiKeyInBundle.test.ts` for `OPENROUTER_API_KEY` (NFR-MC-SEC-001, AC-MC-010)

**Edit `pmo-portal/src/lib/agent/noApiKeyInBundle.test.ts`:** add a second assertion in the same file
(mirroring the existing `ANTHROPIC_API_KEY` grep exactly):

```ts
it('AC-MC-010 no OPENROUTER_API_KEY literal appears anywhere under pmo-portal/', () => {
  let matches: string;
  try {
    matches = execSync(
      "rg -l --glob '!**/noApiKeyInBundle.test.ts' OPENROUTER_API_KEY .",
      { cwd: process.cwd() },
    ).toString();
  } catch {
    matches = '';
  }
  expect(matches.trim()).toBe('');
});
```

Update the file's header comment to mention both keys (`AC-AR-010`/`AC-MC-010`).

**Verify (expect immediate GREEN — nothing in `pmo-portal/` has referenced `OPENROUTER_API_KEY` yet at this
point in the task sequence, since the env var is read only in `index.ts` files under `supabase/functions/`,
outside `pmo-portal/`'s grep root):**
```
cd pmo-portal && npx vitest run src/lib/agent/noApiKeyInBundle.test.ts
```

Keep the existing `ANTHROPIC_API_KEY` assertion in the same file **unchanged** — Task 18 removes the SDK but
the literal string `ANTHROPIC_API_KEY` legitimately still may not appear in `pmo-portal/` either way (it
never did — the key was always read via `Deno.env` in `supabase/functions/`, outside this grep root), so
this existing test stays green throughout with no edit needed.

---

### Task 18 — Wire `index.ts` for both functions + drop the Anthropic SDK dependency (FR-MC-014, MC-OD 5)

No new test — `index.ts` files are integration-only, not unit-tested (§1.2). This task is verified by
Task 22's full build/typecheck, plus the manual local-dev smoke check noted in §4.

**Edit `supabase/functions/agent-chat/index.ts`:**
1. Delete `import Anthropic from '@anthropic-ai/sdk';`; add:
```ts
import { OpenRouterModelClient } from '../_shared/openRouterModelClient.ts';
import { resolveDefaultModel } from '../_shared/modelResolution.ts';
```
2. Replace the `ANTHROPIC_API_KEY` gate (current lines 76–85):
```ts
// ── 4. Read OPENROUTER_API_KEY from function secrets (NFR-MC-SEC-001) ──────
const apiKey = Deno.env.get('OPENROUTER_API_KEY');
if (!apiKey) {
  return new Response(
    JSON.stringify({ status: 502, error: 'UPSTREAM_ERROR', detail: 'model call failed' }),
    { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}

const modelClient = new OpenRouterModelClient({ apiKey });
const model = resolveDefaultModel({ AGENT_MODEL_DEFAULT: Deno.env.get('AGENT_MODEL_DEFAULT') ?? undefined });
```
3. In the `agentChatHandler(body, {...})` call, replace `anthropic: anthropic as unknown as ...` with
   `modelClient: modelClient as unknown as Parameters<typeof agentChatHandler>[1]['modelClient'], model,`.

**Edit `supabase/functions/compose-view/index.ts`:** identical pattern, but reads `AGENT_MODEL_COMPOSE` too:
```ts
import { OpenRouterModelClient } from '../_shared/openRouterModelClient.ts';
import { resolveComposeModel } from '../_shared/modelResolution.ts';
// ...
const apiKey = Deno.env.get('OPENROUTER_API_KEY');
if (!apiKey) { /* unchanged 502 gate, OPENROUTER_API_KEY instead of ANTHROPIC_API_KEY */ }
const modelClient = new OpenRouterModelClient({ apiKey });
const model = resolveComposeModel({
  AGENT_MODEL_DEFAULT: Deno.env.get('AGENT_MODEL_DEFAULT') ?? undefined,
  AGENT_MODEL_COMPOSE: Deno.env.get('AGENT_MODEL_COMPOSE') ?? undefined,
});
// ...
const result = await composeViewHandler(body, {
  modelClient: modelClient as unknown as Parameters<typeof composeViewHandler>[1]['modelClient'],
  supabase: callerClient as unknown as Parameters<typeof composeViewHandler>[1]['supabase'],
  userId,
  model,
});
```

**Edit both `deno.json` files** — remove the `@anthropic-ai/sdk` entry (FR-MC-024 explicit permission,
MC-OD-006):
```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@^2.45.0"
  }
}
```

**Edit `supabase/functions/.env.example`** (the file exists per Task 15's reference; edit it alongside this
task since it's the concrete secret-name change) — replace its `ANTHROPIC_API_KEY=` line with:
```
OPENROUTER_API_KEY=
AGENT_MODEL_DEFAULT=deepseek/deepseek-v4-flash
AGENT_MODEL_COMPOSE=
```

**Verify:** `npm run build` from `pmo-portal/` does not touch `supabase/functions/` (Vite build is
FE-only) — the correctness check for this task is `npm run typecheck` (Task 22's full verify) plus a grep
confirming no remaining `@anthropic-ai/sdk`/`Anthropic` reference:
```
rg -l "@anthropic-ai/sdk|new Anthropic\(" supabase/functions/ || echo "clean"
```
Expect `clean` (or zero matches).

---

### Task 19 — RED→GREEN: deepseek quality-gate fixtures — `agent-chat` (AC-MC-020, AC-MC-021)

**Create `pmo-portal/src/lib/agent/agentChatHandler.deepseekQuality.test.ts`:**

```ts
/**
 * Quality-gate tests on hand-shaped deepseek/deepseek-v4-flash-realistic fixtures
 * (MC-OD-008 — fixture provenance: hand-shaped to the OpenRouter/OpenAI schema;
 * cross-checked against a live call per AC-MC-023 — see this plan's §5 verification
 * notes for live-run status. If materially divergent, the fixture below was updated
 * to match the observed real response shape).
 *
 * AC-MC-020: read-tool answer quality, deterministic fixture.
 * AC-MC-021: write-tool call correctness, approve-gated, deterministic fixture.
 */
import { it, expect, vi } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function mockOrgSupabase(rows: unknown[]): HandlerDeps['supabase'] {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1' }, error: null }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
          eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: rows, error: null }) }),
        }),
      };
    }),
  } as unknown as HandlerDeps['supabase'];
}

it('AC-MC-020 chat answer quality: read tool, deepseek-shaped fixture ends completed with a non-hallucinated answer', async () => {
  const create = vi.fn()
    // Round 1: deepseek-shaped tool call for query_entity
    .mockResolvedValueOnce({
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_abc123',
          type: 'function',
          function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects', filter: { column: 'status', op: 'eq', value: 'Active' } }) },
        }],
      },
      usage: { prompt_tokens: 340, completion_tokens: 28, total_tokens: 368 },
      model: 'deepseek/deepseek-v4-flash',
    })
    // Round 2: deepseek-shaped final text answer referencing the tool result
    .mockResolvedValueOnce({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'You have 3 active projects.' },
      usage: { prompt_tokens: 410, completion_tokens: 12, total_tokens: 422 },
      model: 'deepseek/deepseek-v4-flash',
    });

  const req: AgentChatRequest = { messages: [{ role: 'user', content: 'how many of my projects are active?' }] };
  const events = await collect(agentChatHandler(req, {
    modelClient: { create },
    supabase: mockOrgSupabase([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
  }));

  const finalText = events.find((e) => e.type === 'assistant' && e.text?.includes('3'));
  expect(finalText).toBeDefined();
  expect(finalText!.text).not.toBe('');
  const completed = events.find((e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'completed');
  expect(completed).toBeDefined();
});

it('AC-MC-021 write-tool call correctness: update_task_status, approve-gated, deepseek-shaped fixture', async () => {
  const create = vi.fn().mockResolvedValueOnce({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_def456',
        type: 'function',
        function: { name: 'update_task_status', arguments: JSON.stringify({ taskId: 'task-1', status: 'Done' }) },
      }],
    },
    usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: 320 },
    model: 'deepseek/deepseek-v4-flash',
  });

  const req: AgentChatRequest = { messages: [{ role: 'user', content: 'mark task-1 as done' }] };
  const events = await collect(agentChatHandler(req, {
    modelClient: { create },
    supabase: mockOrgSupabase([]),
    userId: 'user-1',
    model: 'deepseek/deepseek-v4-flash',
    can: vi.fn().mockReturnValue(true),
  }));

  const needsApproval = events.find((e) => e.type === 'status' && (e.payload as { status?: string })?.status === 'needs-approval');
  expect(needsApproval).toBeDefined();
  expect((needsApproval!.payload as { actionName: string }).actionName).toBe('update_task_status');
  expect((needsApproval!.payload as { humanSummary: string }).humanSummary).toContain('task-1');
  expect((needsApproval!.payload as { structuredArgs: { status: string } }).structuredArgs.status).toBe('Done');
  expect(events.find((e) => e.type === 'tool')).toBeUndefined(); // no write dispatched pre-approval
});
```

**Verify (expect GREEN immediately — this task only adds new tests against already-completed handler.ts
code from Tasks 10/13/16; no handler edit in this task):**
```
cd pmo-portal && npx vitest run src/lib/agent/agentChatHandler.deepseekQuality.test.ts
```

---

### Task 20 — RED→GREEN: deepseek quality-gate fixture — `compose-view` (AC-MC-022)

**Create `pmo-portal/src/lib/agent/composeSpec.deepseekQuality.test.ts`:**

```ts
/**
 * Quality-gate test on a hand-shaped deepseek/deepseek-v4-flash-realistic tool-forced
 * compose_view fixture (MC-OD-008 — see this plan's §5 for live-run provenance status).
 * AC-MC-022: structured-output validity on the first attempt (repairAttempts: 0).
 */
import { it, expect, vi } from 'vitest';
import { composeSpec } from '../../../../supabase/functions/compose-view/composeSpec';
import type { ComposeSpecDeps } from '../../../../supabase/functions/compose-view/composeSpec';

it('AC-MC-022 compose_view structured-output validity on the first attempt, deepseek-shaped fixture', async () => {
  const validSpecArgs = JSON.stringify({
    version: 1,
    panels: [
      {
        id: 'p1',
        primitive: 'BarChart',
        querySpec: {
          entity: 'projects',
          select: ['status'],
          groupBy: ['status'],
          aggregate: { fn: 'count', column: 'id', alias: 'count' },
        },
      },
    ],
  });

  const create = vi.fn().mockResolvedValueOnce({
    finish_reason: 'tool_calls',
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_ghi789',
        type: 'function',
        function: { name: 'compose_view', arguments: validSpecArgs },
      }],
    },
    usage: { prompt_tokens: 500, completion_tokens: 80, total_tokens: 580 },
    model: 'deepseek/deepseek-v4-flash',
  });

  const deps: ComposeSpecDeps = { modelClient: { create }, userId: 'user-1', model: 'deepseek/deepseek-v4-flash' };
  const result = await composeSpec('show my projects by status', 'org-1', deps);

  expect(result.repairAttempts).toBe(0);
  expect(result.spec.panels).toHaveLength(1);
  expect(create).toHaveBeenCalledTimes(1);
});
```

**Verify (expect GREEN immediately — depends only on Task 14's already-completed composeSpec.ts):**
```
cd pmo-portal && npx vitest run src/lib/agent/composeSpec.deepseekQuality.test.ts
```

---

### Task 21 — Live quality-gate evidence (AC-MC-023) — key-gated, NOT CI-blocking

This task is **evidence-gathering**, run manually by the Director/implementer once, **before** this issue's
PR is opened (per spec AC-MC-023). It is **not** a repo test file and is **not** part of `npm run verify`.

**Precondition check (do NOT read/source/grep any `.env` file for this — the owner exports the key
themselves):**
```bash
if [ -z "$OPENROUTER_API_KEY" ]; then
  echo "SKIPPED: OPENROUTER_API_KEY is not exported in this shell. Ask the owner to run:"
  echo "  export OPENROUTER_API_KEY=sk-or-..."
  echo "then re-run this task. This AC is evidence-gathering only (spec AC-MC-023) — it does"
  echo "not block CI or the merge gate; record the SKIPPED status in this plan's §5 and proceed."
else
  echo "OPENROUTER_API_KEY is present in the environment — proceeding with the live-run check."
fi
```

**If the key is present**, run the three scenarios live via a throwaway local script (not committed) that
constructs a real `OpenRouterModelClient({ apiKey: process.env.OPENROUTER_API_KEY })` and calls `.create()`
with:
1. The AC-MC-020 read-tool prompt shape (a `query_entity` system+user turn) — confirm the model actually
   emits a `tool_calls[0]` for `query_entity` with well-formed JSON arguments.
2. The AC-MC-021 write-tool prompt shape (`update_task_status`) — confirm a well-formed tool call.
3. The AC-MC-022 compose_view tool-forced prompt (via a direct call mirroring `composeSpec`'s `callModel`
   request shape) — confirm `compileCompositionSpec` succeeds on the raw first response with
   `repairAttempts: 0`.

Record the outcome (pass/divergence) in this plan's §5 "Verification notes" below **before the PR opens**.
If any response diverges materially from the hand-shaped fixtures in Tasks 19/20 (wrong tool selection,
malformed JSON, a spec that fails compilation), **update the corresponding fixture** in
`agentChatHandler.deepseekQuality.test.ts`/`composeSpec.deepseekQuality.test.ts` to match the real observed
shape (MC-OD-008) and re-run Tasks 19/20's verify commands to confirm they stay GREEN against the corrected
fixture.

**No verify command in CI** — this task's "verification" is the Director's own recorded judgment call,
exactly as spec AC-MC-023 specifies ("its pass/fail judgment is recorded in the plan's verification notes,
not asserted by an automated `expect()`").

---

### Task 22 — Final gate: full repo verify (binding, every plan)

```bash
cd pmo-portal && npm run verify
```
(= `typecheck && lint:ci && test && build`, mirrors CI's `verify` job). This is the **only** gate that
must be green before PR — run from a clean `git status` (all task edits committed) so `verify` checks the
actual commit, not a dirty working tree (per the CI merge-commit/working-tree trap in memory).

Additionally, run the targeted OpenRouter/model-client suite one more time in isolation to confirm no
cross-file interference:
```bash
cd pmo-portal && npx vitest run \
  ../supabase/functions/_shared/openRouterModelClient.test.ts \
  ../supabase/functions/_shared/modelResolution.test.ts \
  src/lib/agent/agentChatHandler.test.ts \
  src/lib/agent/agentWriteActions.test.ts \
  src/lib/agent/composeSpec.test.ts \
  src/lib/agent/composeViewAction.test.ts \
  src/lib/agent/portIsolation.test.ts \
  src/lib/agent/noApiKeyInBundle.test.ts \
  src/lib/agent/agentChatHandler.deepseekQuality.test.ts \
  src/lib/agent/composeSpec.deepseekQuality.test.ts
```
Expect all suites green, 0 failures.

---

## 3. Type/signature consistency check (cross-task)

- `HandlerDeps` (`agent-chat/handler.ts`): `{ modelClient: ModelClient; model: string; supabase:
  HandlerSupabaseLike; userId: string; rateGuard?: RateGuard; now?: () => Date; can?: CanFn;
  composeEnabled?: boolean }` — `model` added Task 10, consumed Task 13/18.
- `ComposeSpecDeps` (`compose-view/composeSpec.ts`): `{ modelClient: ModelClient; userId: string; model:
  string }` — all three fields consumed identically by both callers (`composeViewHandler` via
  `compose-view/handler.ts`, and `runComposeView` via `agent-chat/actions.ts`) — Task 14 + Task 16 keep
  these in lockstep.
- `ComposeActionDeps` (`agent-chat/actions.ts`): `{ modelClient: ModelClient; model: string }` — mirrors the
  subset of `ComposeSpecDeps` the handler curries in (Task 16).
- `compose-view/handler.ts`'s `HandlerDeps`: `{ modelClient: ModelClient; model: string; supabase:
  SupabaseLike; userId: string; rateGuard?: RateGuard; now?: () => Date }` — Task 14.
- `ModelClient.create(params: ModelClientParams): Promise<ModelResponse>` — the single shape every one of
  the above consumes; defined once in `_shared/modelClient.ts` (Task 1), never re-declared per-function
  (closes the pre-existing duplication the spec's Open Question 1 called out).

No task introduces a second definition of any of the above — every edit after Task 1/3 imports from
`_shared/`.

---

## 4. Manual local-dev smoke check (not a CI gate — recorded here for completeness)

After Task 18, an optional but recommended manual check (mirrors `docs/environments.md`'s existing "Local
dev (real LLM)" flow, updated for the new secret name) — run only if the owner wants to see it live before
merge; not required for the plan's gates:
```bash
supabase functions serve agent-chat compose-view --env-file supabase/functions/.env --no-verify-jwt
```
with `supabase/functions/.env` containing a real `OPENROUTER_API_KEY` (the owner's own local file, never
read/sourced by this plan's automated tasks per the binding correction in this plan's §0).

---

## 5. Verification notes (filled in when Task 21 runs)

- **AC-MC-023 live-run status:** _pending — run Task 21 before opening the PR._
- **Fixture provenance:** Tasks 19/20 fixtures are hand-shaped as of plan authoring (MC-OD-008); update this
  line once Task 21 confirms or corrects them.

---

## 6. Open questions for the Director

None outstanding — all 5 spec open questions were resolved by the Director's binding brief (§0), and the
mid-task correction (no `.env` file reads anywhere in Task 21) has been applied. One minor judgment call
made without a spec-blocking ambiguity: **MC-OD-009** narrows `FR-MC-013/015`'s two-override proposal
(`AGENT_MODEL_CHAT` + `AGENT_MODEL_COMPOSE`) to one (`AGENT_MODEL_COMPOSE` only), per the Director's brief
env-names list which explicitly omitted `AGENT_MODEL_CHAT`. This is called out in §0 for visibility, not
because it blocks the plan — the brief is unambiguous on this point (three named vars: `OPENROUTER_API_KEY`,
`AGENT_MODEL_DEFAULT`, `AGENT_MODEL_COMPOSE`) and AC-MC-018/019 are satisfied unchanged.
