# Implementation Plan — Agent Spec-Author (I5, ADR-0036 §10.5)

**Feature:** AI-powered composition-spec authoring via a Supabase Edge Function (the FIRST Anthropic API call site in the repo).
**Spec:** `docs/specs/agent-spec-author.spec.md` (FR-AS-001..025, NFR-AS-SEC-001..006, AC-AS-001..022).
**ADR:** `docs/adr/0039-pmo-native-agent-untrusted-output-boundary.md` (Proposed — this plan; owner accepts at merge).
**Builds on:** I2 trusted core (`src/lib/viewspec/{types,compiler,registry,executor}.ts`), I4 builder (`pages/ViewBuilderPage.tsx`, `pages/MyViewsPage.tsx`, `src/components/builder/*`), I1 hook (`src/hooks/useUserViews.ts` → `useUserViewMutations`).
**Date:** 2026-06-29 · **Author:** eng-planner (Claude Opus 4.8) · **Layer ownership:** ADR-0010 test pyramid.

All paths are absolute-from-repo-root. The app package is `pmo-portal/`; the edge function lives at repo-root `supabase/functions/`. Run all `npm`/`npx` commands from `pmo-portal/` unless stated otherwise. TDD: each behavior task writes the failing test FIRST (RED), then the minimum implementation (GREEN), then refactor if needed. Each task is independently committable.

---

## OWNER-DECISION block (documented defaults applied; no task is blocked)

These are taken at the spec §6 default. Each is flagged here because flipping it later changes scope. None blocks the build.

| Flag | Applied default | Where it lives in this plan |
|---|---|---|
| **AS-OD-001** `MAX_REPAIR_ATTEMPTS` | **2** (= 3 total model calls max) | Exported const `MAX_REPAIR_ATTEMPTS = 2` in `supabase/functions/compose-view/handler.ts`; covered by AC-AS-002/003 (Task 9–10). |
| **AS-OD-002** per-user rate guard | **Off in v1**, but built as a **config-gated, testable path** (FR-AS-009/AC-AS-008). The handler accepts an injected `rateGuard?: RateGuard` (undefined = disabled). When undefined the 429 path is never taken; when provided the test injects a stub that reports "exceeded". No `agent_rate_limits` table is created in v1 (the guard is an interface, not a migration). | Task 11. |
| **AS-OD-003** `FEATURES.aiComposer` sub-flag | **INTRODUCE the sub-flag** (recommended — diverges from the "no sub-flag" default). Reason: this is the first feature whose server dependency (the `ANTHROPIC_API_KEY` function secret) may be **unset per-environment**; a cheap sub-flag lets us ship User Views without AI in any env where the key is absent, with zero code change. It is cheap: one line in `FEATURES`, gated AND-wise with `userViews`. | Task 16. |
| **AS-OD-004** streaming to client | **Accumulate server-side**, single JSON response (no SSE). `NFR-AS-PERF-001` still mandates the Anthropic SDK call use streaming *internally* to avoid the edge-function timeout; the handler accumulates the stream before validating. The client receives one JSON body. | Tasks 8, 18. |
| **AS-OD-005** prompt/response audit log | **No persistence in v1.** `NFR-AS-SEC-004` forbids logging prompt content; only error codes / attempt counts / token usage are logged. No `agent_audit_log` table. | Task 8 (logging discipline) + the trust-boundary tests. |

**One additional OWNER-DECISION surfaced during planning (org_id source) — see Reconciliation #4 below.** Default applied: derive `org_id` from `profiles` under the caller's JWT (matches the live `auth_org_id()` RLS function), NOT from a JWT claim. This is a correctness fix, not a scope change.

---

## Reconciliations (ground-truth vs. spec wording — apply these, do not contradict)

### #1 — `compileCompositionSpec` THROWS; it does not return `ValidationError[]`
`compileCompositionSpec(spec, ctx)` (`pmo-portal/src/lib/viewspec/compiler.ts:282`) returns `CompiledPanel[]` and **throws a `ValidationError` on the first failure** (fail-fast; verified at lines 291, 297-298, 308-313). The spec's FR-AS-006/007 and AC-AS-019/020/021 read as if it returns a list of errors.

**Decision (a) — catch-the-throw, feed ONE error per repair attempt.** We do NOT add a collect-all variant. The handler wraps each compile in `try/catch`; the caught `ValidationError` carries `.code` (a `ValidationErrorCode`) and optional `.detail` (`pmo-portal/src/lib/viewspec/types.ts:294-306`). The repair loop feeds the single thrown `{ code, detail }` back to the model per attempt. This matches the current compiler exactly, adds no surface to the security-sensitive trusted core, and is sufficient: feeding the first error per round and re-running converges in practice within `MAX_REPAIR_ATTEMPTS`.

**AC wording fixes required (note in spec; the AC *behavior* is owned by the tests below):**
- **AC-AS-002:** "the repair message sent to the model includes the `ValidationError` codes from attempt 1" → reword to "includes the `ValidationError` **code** (and detail) from attempt 1" (singular — fail-fast yields one).
- **AC-AS-003 / FR-AS-007 / FR-AS-013:** the 422 body field `validationErrors: ValidationError[]` → reword to `validationError: { code, detail }` (the single last-seen error). The handler returns the **last** caught error, not an array. Tests assert the single-error shape.
- **AC-AS-019/020/021:** "re-runs `compileCompositionSpec` … only populates if the result has zero validation errors" → reword to "calls `compileCompositionSpec` inside try/catch and only populates if it does **not throw**." Behavior is identical; wording matches the throwing API.

### #2 — `CompilerContext` shape
`CompilerContext = { userId: string; orgId: string; teamId?: string; projectId?: string }` (`types.ts:125`). Both the handler's compile and the client's re-validation pass the real shape `{ userId, orgId }` (teamId/projectId optional, omitted — matches ViewBuilderPage's existing call at `ViewBuilderPage.tsx:193`). The sketch's `{ userId, orgId }` is fine as a subset; do **not** invent extra fields.

### #3 — `MAX_PANELS_PER_VIEW` is duplicated, not shared
There is **no shared `MAX_PANELS_PER_VIEW` constant**. `ViewBuilderPage.tsx:49` declares a local `const MAX_PANELS_PER_VIEW = 20;` (and its comment says it "mirrors UserViewRenderer's constant"). FR-AS-004 needs the prompt to inject the same ceiling.

**Decision: introduce ONE shared constant in the trusted core and have all consumers reference it.** Add `export const MAX_PANELS_PER_VIEW = 20;` to `pmo-portal/src/lib/viewspec/types.ts` (the existing single source for whitelist/registry constants). Task 5 wires the prompt builder to it. We do **not** invent a second cap. Re-pointing `ViewBuilderPage.tsx:49` to the shared const is a behavior-preserving cleanup but is **out of scope for this READ-ONLY-on-code plan as a hard requirement**; it is listed as an OPTIONAL refactor task (Task 22) the implementer SHOULD take to remove the duplication (the value is identical — 20 — so behavior is unchanged either way).

### #4 — `org_id` is NOT in the JWT (MVP) — derive it from `profiles` under the caller's JWT
`supabase/migrations/0002_rls.sql:6` shows `auth_org_id()` derives org from `profiles where id = auth.uid()` — **"MVP: from profiles; later: from JWT app_metadata.org_id."** The JWT carries only `auth.uid()` (ADR-0036 §9 confirms). So the spec's FR-AS-002 ("extract org_id from the verified claims") and the sketch's `session?.user?.app_metadata?.org_id` are **wrong for the current schema**.

**Decision:** the handler verifies the JWT to obtain `userId` (= `auth.uid()`), then derives `orgId` by querying `profiles` **through the injected caller-JWT `supabase` client** (`supabase.from('profiles').select('org_id').eq('id', userId).single()`) — RLS-scoped, deputy auth, no service_role. It compares the derived `orgId` to `req.orgId` for the NFR-AS-SEC-003 match (400 on mismatch). The client, likewise, must source `orgId` from `useAuth().currentUser.org_id` (the loaded `profiles` row), **not** from `session.user.app_metadata`. This keeps deputy-auth pure and matches how every other query resolves org today. (When the JWT later carries `app_metadata.org_id`, the handler can read the claim directly — a one-line change behind the same comparison.)

---

## Architecture summary

```
supabase/functions/compose-view/          (repo root — Deno runtime; NOT in pmo-portal/package.json)
  schema.ts    COMPOSITION_SPEC_SCHEMA — JSON Schema for the compose_view tool input_schema
  prompt.ts    buildSystemPrompt(whitelist, primitiveNames, orgId, maxPanels) → string   (pure)
  handler.ts   composeViewHandler(req, deps) — pure; deps inject anthropic, supabase, rateGuard, now
  index.ts     Deno.serve wrapper: verify JWT (service-role verifier) → build caller-JWT client → call handler  (integration-only; NOT unit-tested)
  deno.json    import map: anthropic via npm:@anthropic-ai/sdk; viewspec via ../../../pmo-portal/src/lib/viewspec/*

pmo-portal/                                 (the SPA; Vitest runs here)
  src/lib/agent/handler.test.ts             unit tests for composeViewHandler (AC-AS-001..008)
  src/lib/agent/prompt.test.ts              unit tests for buildSystemPrompt   (AC-AS-009..010)
  src/lib/agent/clientValidation.test.ts    trust-boundary tests              (AC-AS-019..021)
  src/hooks/useAIComposer.ts (+ .test.ts)   client hook: POST edge fn + client-side compile re-validation
  src/components/builder/AIComposerModal.tsx (+ .test.tsx)  a11y modal       (AC-AS-013, 017, 018)
  pages/ViewBuilderPage.tsx (+ test)         "Compose with AI" button + draft indicator (AC-AS-011,012,014,015,016)
  pages/MyViewsPage.tsx                      "Compose with AI" entry on the list
  src/lib/features.ts                        FEATURES.aiComposer sub-flag
  e2e/AC-AS-022-ai-compose-to-save.spec.ts   Playwright journey (mock edge fn via page.route)
```

**Test-file placement decision (critical):** Vitest's `include` (`pmo-portal/vite.config.ts:49`) is `['**/*.{test,spec}.{ts,tsx}']` rooted at `pmo-portal/`, and `exclude` lists `e2e/**`. A test file under repo-root `supabase/functions/**` is **outside** `pmo-portal/` and will NOT be collected. Two options:
- (A) add `'../supabase/functions/**/*.test.ts'` to the Vitest `include` and adjust `root`; OR
- (B) **co-locate the handler/prompt unit tests under `pmo-portal/src/lib/agent/*.test.ts`** and have them import the handler/prompt from the edge function via a relative path (`../../../../supabase/functions/compose-view/handler.ts`).

**We choose (B).** It needs **zero vitest.config change**, keeps the Vitest root unchanged, and the handler's own imports (`compileCompositionSpec`) resolve back into `pmo-portal/src/lib/viewspec` via the `deno.json` import map for Deno and via the relative chain for Node. The handler stays a plain TS module with all I/O injected, so Node/Vitest imports it cleanly with the Anthropic SDK mocked. No `@` alias is used inside the edge function (Deno has no Vite alias); the edge function imports the compiler by **relative path** so the same source compiles under both Deno and Node.

> Handler import contract (so #1's try/catch and #2's ctx shape are honored): `handler.ts` imports `compileCompositionSpec` and `ValidationError` from `../../../pmo-portal/src/lib/viewspec/compiler.ts` / `.../types.ts` by relative path, and `ENTITY_WHITELIST` from `types.ts`. `prompt.ts` imports `ENTITY_WHITELIST`, `MAX_PANELS_PER_VIEW` from `types.ts` and `registry` from `registry.ts`. These are pure modules (no React, no Supabase singleton) — safe under Deno.

---

## Task list (TDD, 2–5 min each, independently committable)

### Phase 0 — shared constant + types

**Task 1 — Add the shared `MAX_PANELS_PER_VIEW` constant to the trusted core.** *(no behavior; enables FR-AS-004)*
- File: `pmo-portal/src/lib/viewspec/types.ts`.
- RED: in `pmo-portal/src/lib/viewspec/types.test.ts` (create if absent) add `it('MAX_PANELS_PER_VIEW is 20 (shared cap, FR-AS-004)', () => { expect(MAX_PANELS_PER_VIEW).toBe(20); })`.
- GREEN: add after the `ENTITY_WHITELIST` block: `/** Shared panel ceiling — builder (ViewBuilderPage), renderer, and the AI prompt all reference this (FR-AS-004). */\nexport const MAX_PANELS_PER_VIEW = 20;`
- Verify: `npm test -- src/lib/viewspec/types.test.ts`

**Task 2 — Define the request/response/error contract types (shared by handler + client).**
- File: `pmo-portal/src/lib/agent/types.ts` (new dir `src/lib/agent/`).
- Content: `ComposeViewRequest` (`{ prompt: string; orgId: string; contextHints?: { currentUserId?: string; currentDate?: string } }`), `ComposeViewResponse` (`{ spec: CompositionSpec; repairAttempts: number; tokensUsed?: number }`), `ComposeViewError` (discriminated union: `{ status: 400|401|422|429|502; error: 'BAD_REQUEST'|'UNAUTHORIZED'|'REPAIR_EXHAUSTED'|'RATE_LIMITED'|'UPSTREAM_ERROR'; detail?: string; validationError?: { code: string; detail?: string }; retryAfterSeconds?: number }`). Import `CompositionSpec` from `../viewspec/types`. **Reconciliation #1:** `validationError` is singular.
- RED: `src/lib/agent/types.test.ts` — a compile-time `satisfies` assertion that a sample `ComposeViewResponse` literal type-checks (`it('contract types compile', () => { expect(true).toBe(true); })` plus a `// @ts-expect-error` line for a bad-status error).
- Verify: `npm run typecheck && npm test -- src/lib/agent/types.test.ts`

### Phase 1 — JSON schema for tool input (schema.ts)

**Task 3 — RED: schema shape test.**
- File: `pmo-portal/src/lib/agent/schema.test.ts` (imports the schema from the edge function by relative path `../../../../supabase/functions/compose-view/schema.ts`).
- Test 1 `it('COMPOSITION_SPEC_SCHEMA describes version literal 1 and a panels array', ...)`: assert `schema.type === 'object'`, `schema.required` includes `'version'` and `'panels'`, `schema.properties.version.const === 1`, `schema.properties.panels.type === 'array'`, `schema.properties.panels.maxItems === 20`.
- Test 2 `it('panel items enumerate only registry primitives and whitelist entities', ...)`: assert the panel `primitive` enum equals `registry.keys()` and the querySpec `entity` enum equals `Object.keys(ENTITY_WHITELIST)`.
- Verify (expected RED): `npm test -- src/lib/agent/schema.test.ts`

**Task 4 — GREEN: write `schema.ts`.**
- File: `supabase/functions/compose-view/schema.ts`.
- Export `COMPOSITION_SPEC_SCHEMA` — a JSON Schema object literal for `CompositionSpec`: `version` (const 1), `panels` (array, `maxItems: MAX_PANELS_PER_VIEW`, items = a panel object with `id` string, `primitive` enum `= registry.keys()`, `querySpec` object with `entity` enum `= Object.keys(ENTITY_WHITELIST)`, `select` string[], optional `filters`/`groupBy`/`aggregate`/`timeRange`/`limit`/`orderBy`, `layout`, `props`). Import `registry` from `../../../pmo-portal/src/lib/viewspec/registry.ts`, `ENTITY_WHITELIST` + `MAX_PANELS_PER_VIEW` from `../../../pmo-portal/src/lib/viewspec/types.ts`. Build the enums **from those imports** (no hardcoded primitive/entity name — FR-AS-024 defense-in-depth: the tool schema itself constrains the model to whitelist values).
- Verify (expected GREEN): `npm test -- src/lib/agent/schema.test.ts`

### Phase 2 — system prompt builder (prompt.ts) — AC-AS-009, AC-AS-010

**Task 5 — RED: prompt builder tests (AC-AS-009, AC-AS-010).**
- File: `pmo-portal/src/lib/agent/prompt.test.ts` (imports `buildSystemPrompt` from `../../../../supabase/functions/compose-view/prompt.ts`).
- `it('AC-AS-009 prompt includes every entity, every primitive, and the panel cap', ...)`: call `buildSystemPrompt(ENTITY_WHITELIST, registry.keys(), 'org-1', 20)`; assert the returned string `.includes` each key of `ENTITY_WHITELIST`, each name in `registry.keys()`, and `'20'`.
- `it('AC-AS-010 prompt includes org_id context for {{current_user}} token hints', ...)`: assert the string includes the passed `orgId` and a mention of `$current_user`/`$current_org` token resolution.
- Verify (expected RED): `npm test -- src/lib/agent/prompt.test.ts`

**Task 6 — GREEN: write `prompt.ts`.**
- File: `supabase/functions/compose-view/prompt.ts`.
- Export `buildSystemPrompt(whitelist: typeof ENTITY_WHITELIST, primitiveNames: string[], orgId: string, maxPanels: number): string`. Compose a string that: states the task (author a `CompositionSpec` v1), lists each entity with its allowed/numeric/date/groupable columns and any `requiredFilter` (e.g. tasks→project_id), lists the primitive names, states the `maxPanels` ceiling, lists the `$current_*` tokens and notes `org_id` (`orgId`) resolves `$current_org`, and states **"output only entities/columns/primitives in this list" (FR-AS-024)** and **"never include data rows — schema only" (NFR-AS-SEC-005)**. Pure function; no I/O. **No data rows** — only `whitelist`/`registry` metadata (NFR-AS-SEC-005).
- Verify (expected GREEN): `npm test -- src/lib/agent/prompt.test.ts`

### Phase 3 — handler.ts (pure, injected deps) — AC-AS-001..008

The handler signature (honoring the spec's injection + Reconciliation #4):
```ts
export const MAX_REPAIR_ATTEMPTS = 2;          // AS-OD-001
export interface RateGuard { check(userId: string): Promise<{ exceeded: boolean; retryAfterSeconds: number }> }
export interface HandlerDeps {
  anthropic: AnthropicLike;        // injected — mocked in tests; minimal interface { messages: { create(...) } }
  supabase: SupabaseLike;          // injected caller-JWT client — mocked in tests
  userId: string;                  // from verified JWT (index.ts does the verify; handler trusts it)
  rateGuard?: RateGuard;           // undefined ⇒ guard disabled (AS-OD-002)
  now?: () => Date;                // injectable clock (default () => new Date())
}
export async function composeViewHandler(req: ComposeViewRequest, deps: HandlerDeps): Promise<{ status: 200; body: ComposeViewResponse } | { status: number; body: ComposeViewError }>
```
> `index.ts` (Task 14) owns JWT verification and passes the verified `userId` into `deps`. The handler is auth-gated on `deps.userId` being present (a missing/empty `userId` ⇒ 401), which keeps the handler unit-testable without a Deno JWT verifier. AC-AS-004 is tested by invoking the handler with `userId: ''`.

**Task 7 — RED: happy path (AC-AS-001).**
- File: `pmo-portal/src/lib/agent/handler.test.ts` (imports `composeViewHandler`, `MAX_REPAIR_ATTEMPTS` from `../../../../supabase/functions/compose-view/handler.ts`).
- Build a mock `anthropic` whose `messages.create` resolves a `tool_use` block returning a **valid** `CompositionSpec` (one `KPITile` panel on `projects`, no required-filter entity). Build a mock `supabase` whose `from('profiles').select().eq().single()` resolves `{ data: { org_id: 'org-1' }, error: null }`.
- `it('AC-AS-001 returns {spec, repairAttempts:0} and calls Anthropic exactly once on first-pass valid spec', ...)`: call with `req={prompt:'show projects', orgId:'org-1'}`, `deps={anthropic, supabase, userId:'u-1'}`; assert `status===200`, `body.repairAttempts===0`, `body.spec` deep-equals the mock spec, and `anthropic.messages.create` called once.
- Verify (expected RED): `npm test -- src/lib/agent/handler.test.ts`

**Task 8 — GREEN: handler core (auth gate → input validation → org match → prompt → model call → compile → 200/502).**
- File: `supabase/functions/compose-view/handler.ts`.
- Implement, in order: (1) if `!deps.userId` → `{status:401, body:{status:401,error:'UNAUTHORIZED'}}`. (2) input validation: `prompt` empty or `>2000` chars → `{status:400,error:'BAD_REQUEST',detail:'prompt'}`. (3) **org match (Recon #4):** `const { data } = await deps.supabase.from('profiles').select('org_id').eq('id', deps.userId).single()`; if `data?.org_id !== req.orgId` → `{status:400,error:'BAD_REQUEST',detail:'orgId'}`. (4) optional rate guard (Task 11). (5) build `system = buildSystemPrompt(ENTITY_WHITELIST, registry.keys(), req.orgId, MAX_PANELS_PER_VIEW)`. (6) call the model (Task 12 extracts the call) forcing the `compose_view` tool; **accumulate the stream** (AS-OD-004) into a single spec object. (7) `compileCompositionSpec(spec, { userId: deps.userId, orgId: req.orgId })` inside try/catch (Recon #1, #2); on success return `{status:200, body:{spec, repairAttempts:0}}`. (8) on `ValidationError` → enter the repair loop (Task 9). (9) wrap the whole model-call section so any thrown SDK/network error → `{status:502, body:{status:502,error:'UPSTREAM_ERROR', detail:'model call failed'}}` — **never** echo the raw error body (FR-AS-008, AC-AS-007). Logging discipline: log only `{ error code, repairAttempts, tokensUsed }` — **never** `req.prompt` or spec contents (NFR-AS-SEC-004).
- Verify (expected GREEN): `npm test -- src/lib/agent/handler.test.ts`

**Task 9 — RED+GREEN: bounded repair loop (AC-AS-002).**
- RED: in `handler.test.ts`, `it('AC-AS-002 returns repairAttempts:1 and feeds the attempt-1 ValidationError code/detail back to the model', ...)`: mock `anthropic.messages.create` to resolve an **invalid** spec (e.g. a `tasks` panel with no `project_id` filter → `MISSING_REQUIRED_FILTER`) on call 1 and a **valid** spec on call 2. Assert `status===200`, `body.repairAttempts===1`, `create` called twice, and the **second** call's `messages` array contains a user message whose text includes `'MISSING_REQUIRED_FILTER'` (Recon #1 — single code/detail).
- GREEN: implement the loop in `handler.ts`: while caught `ValidationError` and `attempts < MAX_REPAIR_ATTEMPTS`, append a user message `Validation failed: ${err.code}${err.detail ? ' — ' + err.detail : ''}. Fix and re-emit a valid CompositionSpec.` (only `code`+`detail`, never SQL/stack — FR-AS-025/NFR-AS-SEC-004), re-invoke the model (tool forced), re-compile, increment `attempts`. On success return `{spec, repairAttempts: attempts}`.
- Verify: `npm test -- src/lib/agent/handler.test.ts`

**Task 10 — RED+GREEN: repair exhausted → 422 (AC-AS-003).**
- RED: `it('AC-AS-003 returns 422 REPAIR_EXHAUSTED with the last validationError after MAX_REPAIR_ATTEMPTS', ...)`: mock `create` to **always** return an invalid spec. Assert `status===422`, `body.error==='REPAIR_EXHAUSTED'`, `body.repairAttempts===MAX_REPAIR_ATTEMPTS`, `body.validationError.code` is set (Recon #1 — singular), and `create` called `MAX_REPAIR_ATTEMPTS + 1` times.
- GREEN: after the loop exits without success, return `{status:422, body:{status:422, error:'REPAIR_EXHAUSTED', repairAttempts: MAX_REPAIR_ATTEMPTS, validationError: { code: lastErr.code, detail: lastErr.detail }}}`.
- Verify: `npm test -- src/lib/agent/handler.test.ts`

**Task 11 — RED+GREEN: rate guard 429 (AC-AS-008, FR-AS-009 behind config).**
- RED: `it('AC-AS-008 returns 429 RATE_LIMITED without calling Anthropic when the injected rateGuard reports exceeded', ...)`: inject `rateGuard = { check: async () => ({ exceeded: true, retryAfterSeconds: 3600 }) }`. Assert `status===429`, `body.error==='RATE_LIMITED'`, `body.retryAfterSeconds===3600`, and `anthropic.messages.create` **not** called. Add a second assertion `it('rate guard absent ⇒ no 429, model is called', ...)` with `rateGuard` undefined.
- GREEN: in `handler.ts`, after the org-match step and before building the prompt: `if (deps.rateGuard) { const r = await deps.rateGuard.check(deps.userId); if (r.exceeded) return {status:429, body:{status:429, error:'RATE_LIMITED', retryAfterSeconds: r.retryAfterSeconds}}; }`. (No table; the guard is an injected interface — AS-OD-002 default keeps it undefined in prod v1.)
- Verify: `npm test -- src/lib/agent/handler.test.ts`

**Task 12 — RED+GREEN: 401 + org-mismatch + prompt-length + upstream-error gates (AC-AS-004, 005, 006, 007).**
- RED: add four `it` cases to `handler.test.ts`:
  - `it('AC-AS-004 returns 401 without calling Anthropic when userId is empty', ...)` — `deps.userId=''`; assert 401, `create` not called.
  - `it('AC-AS-005 returns 400 without calling Anthropic when body orgId ≠ profile org_id', ...)` — profile mock returns `org_id:'org-2'`, `req.orgId='org-1'`; assert 400 detail `'orgId'`, `create` not called.
  - `it('AC-AS-006 returns 400 without calling Anthropic when prompt > 2000 chars', ...)` — `prompt='x'.repeat(2001)`; assert 400 detail `'prompt'`, `create` not called.
  - `it('AC-AS-007 returns 502 UPSTREAM_ERROR and hides the raw SDK error', ...)` — `create` rejects `new Error('SECRET anthropic 500 body')`; assert 502, `body.error==='UPSTREAM_ERROR'`, and `JSON.stringify(body)` does **not** include `'SECRET'`.
- GREEN: these paths are implemented in Task 8; this task confirms each gate orders **before** the model call and the 502 path scrubs the message. Adjust ordering if any test reveals a gate runs after the call.
- Verify: `npm test -- src/lib/agent/handler.test.ts`

### Phase 4 — Anthropic call extraction + Deno wrapper (integration-only)

**Task 13 — Extract the model call into a tool-forcing helper (build-time SDK verification flagged).**
- File: `supabase/functions/compose-view/handler.ts` (internal `callModel(anthropic, system, messages)` helper) — keep it injected-`anthropic`-driven so tests mock it.
- Specify the call as: `anthropic.messages.create({ model: 'claude-opus-4-8', max_tokens: 4096, system, messages, tools: [{ name: 'compose_view', description: 'Author a validated CompositionSpec v1', input_schema: COMPOSITION_SPEC_SCHEMA }], tool_choice: { type: 'tool', name: 'compose_view' } })`, **streaming the response and accumulating** (AS-OD-004 / NFR-AS-PERF-001), then extract the `tool_use` block whose `name === 'compose_view'` and read its `.input` as the `CompositionSpec`.
- **BUILD-TIME VERIFICATION TASK (do at implementation, not now):** confirm against the installed `@anthropic-ai/sdk` version (a) the exact `thinking` parameter shape — the spec sketch uses `thinking: { type: 'adaptive' }`; **do not hard-commit it** — verify whether the installed SDK accepts that shape and add it only if valid; (b) the streaming accumulation API (`anthropic.messages.stream(...)` vs `create({stream:true})`); (c) the `tool_use` block accessor. Because all unit tests **mock** the SDK, the exact param shape does not affect them — only the live call. Record the verified shape in a one-line code comment.
- Verify (unit, SDK mocked): `npm test -- src/lib/agent/handler.test.ts`

**Task 14 — Write the Deno wrapper `index.ts` (integration-only; NOT unit-tested).**
- File: `supabase/functions/compose-view/index.ts`.
- `Deno.serve(async (req) => {...})`: read `Authorization: Bearer <jwt>`; if absent → 401. Verify the JWT by constructing a Supabase client with the **service-role key** *solely* to call `auth.getUser(jwt)` (NFR-AS-SEC-002 — service_role used ONLY for JWT verify, never business data). Extract `userId = user.id`. Construct a **second** Supabase client bound to the **caller's JWT** (`global.headers.Authorization`) for business data (the `profiles` lookup) — deputy auth, NFR-AS-SEC-001/006, FR-AS-010. Read `ANTHROPIC_API_KEY` from `Deno.env` (function secret — NFR-AS-SEC-001) and construct `anthropic = new Anthropic({ apiKey })`. Parse the JSON body into `ComposeViewRequest`. Call `composeViewHandler(req, { anthropic, supabase: callerClient, userId })`. Return `new Response(JSON.stringify(result.body), { status: result.status, headers: {'content-type':'application/json'} })`.
- File: `supabase/functions/compose-view/deno.json` — import map pinning `@anthropic-ai/sdk` to `npm:@anthropic-ai/sdk@<pin>` and Supabase to `npm:@supabase/supabase-js@<pin>`; no `pmo-portal/package.json` change (NFR per ground-truth #4).
- File: `supabase/config.toml` — add `[functions.compose-view]` with `verify_jwt = false` (the handler verifies the JWT itself so it can return the typed 401 body; Supabase's built-in gate would 401 with a non-typed body). **BUILD-TIME:** confirm `config.toml` exists / create it if this is the first function; confirm the `[functions.<name>]` block is the correct registration syntax for the installed CLI.
- Verify (typecheck of the Node-importable parts only; `index.ts` is Deno and is NOT in the Vitest/tsc graph): `npm run typecheck` (must stay green — `index.ts`/`deno.json` are excluded from the pmo-portal tsconfig; confirm they are not picked up, add to `tsconfig` exclude if needed). No CI deploy, no live call (per ADR-0039 decision 7).

### Phase 5 — client hook + trust-boundary re-validation — AC-AS-019, 020, 021

**Task 15 — RED+GREEN: `useAIComposer` hook with client-side compile re-validation (AC-AS-019).**
- RED: `pmo-portal/src/hooks/useAIComposer.test.ts`. Mock `fetch` to resolve `{status:200, json: () => ({ spec: VALID_SPEC, repairAttempts: 0 })}`. Render the hook (or call its `compose`) inside an `AuthProvider` mock supplying `session.access_token='jwt'` and `currentUser={ id:'u-1', org_id:'org-1' }`. `it('AC-AS-019 compose() re-runs compileCompositionSpec and returns the spec only when it does not throw', ...)`: assert `compose('x')` resolves the spec and the hook called `fetch` with `Authorization: Bearer jwt` and a body `{prompt:'x', orgId:'org-1'}` (Recon #4 — orgId from currentUser, NOT app_metadata).
- GREEN: `pmo-portal/src/hooks/useAIComposer.ts`. `useAIComposer()` returns `{ compose, status, error }`. `compose(prompt)`: set status `loading`; `fetch(\`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/compose-view\`, {method:'POST', headers:{'Content-Type':'application/json', Authorization:\`Bearer ${session?.access_token}\`}, body: JSON.stringify({ prompt, orgId: currentUser?.org_id })})`. On 200: parse `{spec}`, then **defense-in-depth** `try { compileCompositionSpec(spec, { userId: currentUser.id, orgId: currentUser.org_id }); return spec; } catch { setError('...'); return null; }` (Recon #1/#2). On 422/429/502/other: set the mapped error message, return null. Use `useAuth()` for session + currentUser (Recon #4).
- Verify: `npm test -- src/hooks/useAIComposer.test.ts`

**Task 16 — Introduce `FEATURES.aiComposer` sub-flag (AS-OD-003).**
- File: `pmo-portal/src/lib/features.ts`. Add `aiComposer: import.meta.env.VITE_FEATURES_AI_COMPOSER === 'true' || false,` to `FEATURES`. RED: `pmo-portal/src/lib/features.test.ts` (create if absent) `it('aiComposer flag defaults to false (FR-AS-014, AS-OD-003)', () => expect(isFeatureEnabled('aiComposer')).toBe(false))`.
- Verify: `npm run typecheck && npm test -- src/lib/features.test.ts`

**Task 17 — RED+GREEN: trust-boundary client tests on the compiler directly (AC-AS-020, AC-AS-021).**
- File: `pmo-portal/src/lib/agent/clientValidation.test.ts` (imports `compileCompositionSpec`, `ValidationError` from `../viewspec/compiler` / `../viewspec/types`). These prove the SAME compiler the hook calls rejects tampered specs (no hook/network needed — lowest sufficient layer).
- `it('AC-AS-020 a composed spec referencing an unknown entity throws UNKNOWN_ENTITY', ...)`: build a spec with `querySpec.entity:'secrets'`; assert `compileCompositionSpec(spec, ctx)` throws a `ValidationError` with `code==='UNKNOWN_ENTITY'`.
- `it('AC-AS-021 a tasks panel with no project_id filter throws MISSING_REQUIRED_FILTER', ...)`: build a `tasks` panel with empty filters; assert throws `code==='MISSING_REQUIRED_FILTER'`.
- GREEN: no code change (the compiler already enforces this — this task locks the trust boundary as a regression test and proves Recon #1's "throws, not returns" contract). If a test fails, the bug is in the test's spec literal, not the compiler.
- Verify: `npm test -- src/lib/agent/clientValidation.test.ts`

### Phase 6 — AIComposerModal (a11y) — AC-AS-013, 017, 018

**Task 18 — RED+GREEN: `AIComposerModal` open/accessibility (AC-AS-013).**
- RED: `pmo-portal/src/components/builder/AIComposerModal.test.tsx`. Render `<AIComposerModal open onClose={} onComposed={} />` (mock `useAIComposer`). `it('AC-AS-013 renders role=dialog, aria-modal, a labelled textarea, traps focus', ...)`: assert `getByRole('dialog')` with `aria-modal="true"` and `aria-labelledby` resolving to the heading; assert `getByLabelText('Describe the view you want')` is a `<textarea>`; assert focus moves into the dialog on open and Escape calls `onClose`.
- GREEN: `pmo-portal/src/components/builder/AIComposerModal.tsx`. Mirror `ConfirmDialog`'s a11y contract (`pmo-portal/src/components/ui/ConfirmDialog.tsx`): `createPortal`, `role="dialog"`, `aria-modal`, `aria-labelledby` (heading `useId`), `aria-describedby` (error region), Escape→onClose, focus-trap on Tab/Shift+Tab, focus restore on close. Contents: heading "Compose with AI", labelled `<textarea>` "Describe the view you want" with a live character counter (max 2000), a `aria-live="polite"` loading/error region (NFR-AS-A11Y-002/003), "Generate" submit (calls `useAIComposer().compose`), "Cancel". On compose success → `onComposed(spec)` + close; on null → show the hook's error in the live region.
- Verify: `npm test -- src/components/builder/AIComposerModal.test.tsx`

**Task 19 — RED+GREEN: modal error states 422 / 429 (AC-AS-017, AC-AS-018).**
- RED: in `AIComposerModal.test.tsx`: `it('AC-AS-017 shows the rephrase error and does not call onComposed when compose returns null (422)', ...)` — mock `useAIComposer` so `compose` resolves `null` with `error: "Couldn't generate a valid view for that description. Try rephrasing or being more specific."`; submit; assert the error text is in the live region and `onComposed` not called. `it('AC-AS-018 shows a rate-limit error (429)', ...)` — `error: 'You've reached the AI compose limit. Try again later.'`; assert shown, `onComposed` not called.
- GREEN: ensure the modal renders `error` from the hook in the `aria-describedby` live region and never calls `onComposed` when `compose` returns null. (The status→message mapping lives in `useAIComposer` per Task 15; the modal just displays `error`.)
- Verify: `npm test -- src/components/builder/AIComposerModal.test.tsx`

### Phase 7 — ViewBuilderPage + MyViewsPage wiring — AC-AS-011, 012, 014, 015, 016

**Task 20 — RED+GREEN: "Compose with AI" button visibility + draft indicator + populate (AC-AS-011, 012, 014, 015).**
- RED: extend `pmo-portal/src/components/builder/ViewBuilderPage.test.tsx`:
  - `it('AC-AS-011 renders a "Compose view with AI" button when userViews+aiComposer are enabled', ...)` — mock `FEATURES` `{userViews:true, aiComposer:true}`; assert `getByRole('button', { name: 'Compose view with AI' })`.
  - `it('AC-AS-012 hides the button when userViews is false', ...)` — `{userViews:false}`; assert `queryByRole('button', { name: 'Compose view with AI' })` is null. Add a third case for `aiComposer:false` ⇒ hidden (AND-gating).
  - `it('AC-AS-014 populating from a composed spec sets panels to spec.panels and closes the modal', ...)` — open modal, mock `onComposed` flow to deliver a 2-panel spec; assert `PanelList` shows 2 panels.
  - `it('AC-AS-015 shows the "AI-composed draft" indicator after populate', ...)` — assert `getByText('AI-composed draft')` is visible near the name input with `aria-live="polite"` (NFR-AS-A11Y-004).
- GREEN: in `ViewBuilderPage.tsx`: render the button when `isFeatureEnabled('userViews') && isFeatureEnabled('aiComposer')` (button hidden, not disabled, when off — FR-AS-014); on click open `<AIComposerModal>`; `onComposed(spec)` → `setPanels(spec.panels)` + set a new `aiDraft` state true + close modal + `toast('View composed', 'Review and save when ready', 'success')` (FR-AS-017). Render an `AI-composed draft` label (text, `aria-live="polite"`) near the name field while `aiDraft` is true.
- Verify: `npm test -- src/components/builder/ViewBuilderPage.test.tsx`

**Task 21 — RED+GREEN: save clears the draft indicator and calls the mutation (AC-AS-016).**
- RED: `it('AC-AS-016 pressing Save calls useUserViewMutations().create with the composed spec and clears the AI-composed draft indicator', ...)` — populate from a composed spec, fill name, press Save; assert `create.mutateAsync` called with `spec.panels` inside `spec` and the `AI-composed draft` label is gone after save resolves.
- GREEN: in `ViewBuilderPage.tsx` `handleSave` success path, set `aiDraft=false` (the indicator already disappears on navigate; also clear it explicitly so the test sees it removed before navigation in create mode). No change to the existing `create/update` call (`useUserViewMutations` is already wired at `ViewBuilderPage.tsx:69`).
- Verify: `npm test -- src/components/builder/ViewBuilderPage.test.tsx`

**Task 22 — (OPTIONAL, behavior-preserving) de-duplicate `MAX_PANELS_PER_VIEW`.**
- File: `pmo-portal/pages/ViewBuilderPage.tsx`. Replace the local `const MAX_PANELS_PER_VIEW = 20;` (line 49) with `import { MAX_PANELS_PER_VIEW } from '@/src/lib/viewspec/types';`. Value is identical (20) ⇒ behavior unchanged; removes the duplicate cap (Recon #3). Also wire `MyViewsPage` "Compose with AI" entry (Task 23) to the same modal.
- Verify: `npm test -- src/components/builder/ViewBuilderPage.test.tsx && npm run typecheck`

**Task 23 — RED+GREEN: "Compose with AI" on the My Views list (FR-AS-014).**
- RED: `pmo-portal/pages/MyViewsPage.test.tsx` (create if absent): `it('renders a "Compose view with AI" action when userViews+aiComposer enabled and routes into the builder with the composed spec', ...)`; assert the button is present (flags on) / absent (flags off).
- GREEN: in `MyViewsPage.tsx`, add a secondary `primaryAction` button "Compose with AI" (gated `userViews && aiComposer`) that opens `<AIComposerModal>`; on `onComposed(spec)` navigate to `/views/new` carrying the spec via router state, and `ViewBuilderPage` reads `location.state?.composedSpec` to seed panels + the draft indicator (reuse Task 20's populate path).
- Verify: `npm test -- pages/MyViewsPage.test.tsx`

### Phase 8 — E2E + full verify

**Task 24 — E2E journey (AC-AS-022).**
- File: `pmo-portal/e2e/AC-AS-022-ai-compose-to-save.spec.ts`. `test('AC-AS-022 AI compose → populate builder → save', ...)`: `page.route('**/functions/v1/compose-view', route => route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ spec: MOCK_TWO_PANEL_SPEC, repairAttempts: 0 }) }))` where `MOCK_TWO_PANEL_SPEC` is a pre-validated `DataTable` of `projects` filtered by `status` + a `KPITile` summing `contract_value` (must pass `compileCompositionSpec` — no required-filter entity). Authenticate, navigate to `/views` (My Views), click "Compose with AI", type "show me at-risk projects and this quarter's contract value", submit; assert the builder opens with **both** panels in `PanelList`, the "AI-composed draft" label is visible, then press Save and assert the view persists (toast + navigation to `/views/:id`). **No live Anthropic call** (route is mocked). Flags: run with `VITE_FEATURES_USERVIEWS=true VITE_FEATURES_AI_COMPOSER=true`.
- Verify (local / CI integration lane only — e2e runs on PR→main, never deploys the function): `npx playwright test e2e/AC-AS-022-ai-compose-to-save.spec.ts`

**Task 25 — Update `docs/README.md` ADR line to include 0039 (Proposed).**
- File: `/home/user/PMO/docs/README.md`. In the `adr/` source-of-truth row (line ~14), extend the range to `0001–0039` and append to the Latest list: `; \`0039\` PMO-native agent architecture + untrusted-output validation boundary (the I5 agent spec-author's single LLM call site) — **Proposed**`. *(Owner/Director will apply the literal edit; this task specifies it.)*
- Verify: `grep -n "0039" /home/user/PMO/docs/README.md`

**Task 26 — FINAL GATE: full verify.**
- Run from `pmo-portal/`: `npm run verify` (= `typecheck && lint:ci && test && build`). Must be green. The edge function (`supabase/functions/compose-view/index.ts`, `deno.json`) is Deno-only and excluded from the pmo-portal tsconfig/Vitest graph — confirm `npm run typecheck` does not try to compile it (add to `tsconfig` `exclude` if it does). **No function deploy, no live Anthropic call** anywhere in CI (ADR-0039 decision 7). e2e + pgTAP run in the CI integration lane on PR→main only.
- Verify: `npm run verify`

---

## Traceability table (AC-### → owning layer → file)

Each AC is owned at its **lowest sufficient layer** (ADR-0010). "Recon" flags an AC whose spec wording is corrected per Reconciliation #1.

| AC-### | Owning layer | Owning test file (`it`/`test` title leads with the AC-id) | Recon |
|---|---|---|---|
| AC-AS-001 | Unit (Vitest, SDK mocked) | `pmo-portal/src/lib/agent/handler.test.ts` | — |
| AC-AS-002 | Unit | `pmo-portal/src/lib/agent/handler.test.ts` | #1 (single code/detail) |
| AC-AS-003 | Unit | `pmo-portal/src/lib/agent/handler.test.ts` | #1 (`validationError` singular) |
| AC-AS-004 | Unit | `pmo-portal/src/lib/agent/handler.test.ts` | — |
| AC-AS-005 | Unit | `pmo-portal/src/lib/agent/handler.test.ts` | #4 (org from profiles) |
| AC-AS-006 | Unit | `pmo-portal/src/lib/agent/handler.test.ts` | — |
| AC-AS-007 | Unit | `pmo-portal/src/lib/agent/handler.test.ts` | — |
| AC-AS-008 | Unit | `pmo-portal/src/lib/agent/handler.test.ts` | — |
| AC-AS-009 | Unit | `pmo-portal/src/lib/agent/prompt.test.ts` | — |
| AC-AS-010 | Unit | `pmo-portal/src/lib/agent/prompt.test.ts` | — |
| AC-AS-011 | Unit (RTL) | `pmo-portal/src/components/builder/ViewBuilderPage.test.tsx` | — |
| AC-AS-012 | Unit (RTL) | `pmo-portal/src/components/builder/ViewBuilderPage.test.tsx` | — |
| AC-AS-013 | Unit (RTL) | `pmo-portal/src/components/builder/AIComposerModal.test.tsx` | — |
| AC-AS-014 | Unit (RTL) | `pmo-portal/src/components/builder/ViewBuilderPage.test.tsx` | — |
| AC-AS-015 | Unit (RTL) | `pmo-portal/src/components/builder/ViewBuilderPage.test.tsx` | — |
| AC-AS-016 | Unit (RTL) | `pmo-portal/src/components/builder/ViewBuilderPage.test.tsx` | — |
| AC-AS-017 | Unit (RTL) | `pmo-portal/src/components/builder/AIComposerModal.test.tsx` | — |
| AC-AS-018 | Unit (RTL) | `pmo-portal/src/components/builder/AIComposerModal.test.tsx` | — |
| AC-AS-019 | Unit (Vitest) | `pmo-portal/src/hooks/useAIComposer.test.ts` | #1 (does-not-throw) + #4 (orgId source) |
| AC-AS-020 | Unit (Vitest) | `pmo-portal/src/lib/agent/clientValidation.test.ts` | #1 (throws UNKNOWN_ENTITY) |
| AC-AS-021 | Unit (Vitest) | `pmo-portal/src/lib/agent/clientValidation.test.ts` | #1 (throws MISSING_REQUIRED_FILTER) |
| AC-AS-022 | E2E (Playwright) | `pmo-portal/e2e/AC-AS-022-ai-compose-to-save.spec.ts` | — |

**NFR coverage map (proving tests):**
- NFR-AS-SEC-001 (key only in function secrets): Task 14 reads `Deno.env.get('ANTHROPIC_API_KEY')`; **proved negatively** by a grep gate — no `ANTHROPIC_API_KEY` literal in `pmo-portal/` or client bundle (add to Task 26's verify or a CI grep). The key never enters the handler signature.
- NFR-AS-SEC-002 (verify JWT before LLM): AC-AS-004 (Task 12) — empty `userId` ⇒ 401 before `create`.
- NFR-AS-SEC-003 (org match before LLM): AC-AS-005 (Task 12).
- NFR-AS-SEC-004 (no prompt logging): Task 8 logging discipline; assert in handler tests that no `console.*` receives `req.prompt` (add a `vi.spyOn(console,'log')` assertion in Task 12's 502 case).
- NFR-AS-SEC-005 (no data rows in prompt): Task 6 — `prompt.test.ts` asserts the prompt is built only from `ENTITY_WHITELIST`/`registry` metadata; add `it('prompt contains no row data — only schema metadata')`.
- NFR-AS-SEC-006 (client forwards only its own JWT): Task 15 asserts the hook sends `Authorization: Bearer ${session.access_token}` and never constructs claims; orgId from `currentUser` not from a forged claim.
- NFR-AS-A11Y-001..004: Tasks 18, 19, 20 (focus-trap, aria-live loading/error, draft-indicator label + announce).
- NFR-AS-PERF-001 (internal streaming): Task 13 (accumulate the SDK stream). NFR-AS-PERF-002 (loading <200ms): Task 18 (modal sets loading state synchronously on submit, before fetch resolves).

---

## Sequencing / commit boundaries

Tasks are ordered so each is independently committable: shared const (1) → contract types (2) → schema (3–4) → prompt (5–6) → handler core + all gates (7–13) → Deno wrapper (14) → client hook + trust boundary (15–17) → modal (18–19) → page wiring (20–23) → e2e (24) → docs (25) → full verify (26). The handler unit tests (Phase 3) are green before any UI work, so the trust boundary is locked first. The Deno `index.ts` (14) carries no unit coverage by design (ADR-0039 decision 7) and lands once the handler it wraps is proven.

## Open questions for the Director
1. **AC wording fixes (Recon #1):** AC-AS-002/003 and FR-AS-007/013 describe `compileCompositionSpec` returning `ValidationError[]`; the real compiler throws one error (fail-fast). The plan implements the throwing contract and returns a singular `validationError`. **Confirm the spec should be amended** (cosmetic; the tests own the behavior) — or whether the Director wants a non-throwing `collectCompositionSpecErrors()` collect-all wrapper added to the viewspec lib (Recon #1 option (b)). Recommendation: amend the wording, keep option (a).
2. **org_id source (Recon #4):** the plan derives org from `profiles` under the caller's JWT (matching live `auth_org_id()`), not from a JWT claim, because the MVP JWT carries only `auth.uid()`. This diverges from FR-AS-002's "extract org_id from the verified claims." Confirm this is acceptable (it is the only correct option today; a one-line switch when the JWT later carries `app_metadata.org_id`).
3. **`config.toml` `verify_jwt = false`:** the handler verifies the JWT itself to return a typed 401 body. Confirm we don't want Supabase's built-in gate (which returns a non-typed 401). Recommendation: handler-owned verify (typed errors, AC-AS-004).
