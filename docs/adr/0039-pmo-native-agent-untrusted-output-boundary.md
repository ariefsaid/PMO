# ADR-0039 — PMO-native Agent Architecture and the Untrusted-Output Validation Boundary

- **Status:** Proposed (owner accepts at merge of the I5 agent-spec-author PR)
- **Date:** 2026-06-29
- **Deciders:** Director, eng-planner (owner sign-off pending at merge)
- **Related:** ADR-0036 (agent-native deputy model + declarative-artifact rule), ADR-0037 (compiler/DSL, ENTITY_WHITELIST), ADR-0038 (renderer executor), ADR-0016 (FE authz + real-JWT), ADR-0017 (repository seam), ADR-0010 (test pyramid), ADR-0001 (org_id seam), ADR-0030 (QA portfolio).
- **Implements:** ADR-0036 §10.5 (build-sequence step 5 — agent spec-author), the PMO-native branch of the §9 gate.
- **Spec:** `docs/specs/agent-spec-author.spec.md` (FR-AS-*, NFR-AS-SEC-*, AC-AS-*).
- **Plan:** `docs/plans/2026-06-29-agent-spec-author.md`.

---

## Context

The I5 agent-spec-author introduces the **first Anthropic API call in the entire PMO stack**. ADR-0036
established the agent-native architecture and its §9 spike gate, with two viable paths for the agent that
*authors* a `CompositionSpec`: (a) the `agent-native` Nitro **sidecar** (config-over-fork), or (b) a
**PMO-native** implementation on the existing Supabase stack against the §4 trusted core
(registry + compiler + executor + `user_views`). The spike passed, so the sidecar is *viable* — but for the
single, bounded job of "turn a natural-language prompt into a validated composition spec and drop it into
the I4 builder," standing up a second deployable (Nitro + Drizzle + JWT bridge + SSO embedding) is
disproportionate. ADR-0036 §9 is explicit that §4–§7 (the trusted core) stand alone and that the agent
spec-author may be built **PMO-native** without the sidecar.

This ADR records the PMO-native pattern: a **single Supabase Edge Function** (`compose-view`, Deno runtime)
is the sole server-side LLM call site, and the I2 compiler (`compileCompositionSpec`) is the **untrusted-output
validation boundary** that every model output must cross — enforced both server-side (in the function) and
client-side (in the hook) — before any spec can reach the builder or be saved.

Three facts from the codebase shape the decisions:

1. **`compileCompositionSpec(spec, ctx)` is fail-fast: it THROWS a `ValidationError` on the first violation**
   (`pmo-portal/src/lib/viewspec/compiler.ts`), it does not return an error array. The boundary is honored by
   `try/catch`; the repair loop feeds the single thrown `{ code, detail }` back to the model per attempt.
2. **The MVP JWT carries only `auth.uid()`** — `org_id` is derived from `profiles` (`auth_org_id()` in
   `supabase/migrations/0002_rls.sql`), not from a JWT claim. The function derives org under the caller's JWT.
3. **Edge functions run in Deno, not Node.** The Anthropic SDK is imported via `npm:@anthropic-ai/sdk` in the
   Deno entry, **not** added to `pmo-portal/package.json`. To keep CI on Node, the business logic must be a
   pure module with all I/O injected.

## Decision

Tags: **[AN]** = an `agent-native` convention adopted as-is; **[PMO]** = a PMO addition/extension.

### 1. Single LLM call site — the Supabase Edge Function. **[PMO]**
The Anthropic API MUST be called **only** from a Supabase Edge Function (`supabase/functions/compose-view/`).
No browser-side call, no server-rendered page, no PostgREST/pg_net hook, no client bundle ever holds the API
key. The function authenticates the caller's Supabase JWT **before any LLM call** (FR-AS-002, NFR-AS-SEC-002).
The `ANTHROPIC_API_KEY` lives exclusively in Supabase function secrets (NFR-AS-SEC-001/003).

### 2. Deputy authorization — caller's JWT for all business data; service_role only to verify the JWT. **[PMO]** (mirrors ADR-0036 §2)
The function uses the **caller's Supabase JWT** for every business-data access (e.g. the `profiles` lookup
that derives `org_id`), so RLS scopes it exactly as the human. It MUST NOT use `service_role` for business
queries. `service_role` is permitted for **one** purpose: verifying the inbound JWT (`auth.getUser(jwt)`).
Because the MVP JWT carries only `auth.uid()`, `org_id` is derived from `profiles` **under the caller's JWT**
and compared to the request's `orgId` (NFR-AS-SEC-003, FR-AS-010/012). A mismatch returns HTTP 400 before any
LLM call. This is the deputy invariant from ADR-0036 §2: *a deputy carrying the user's badge, never a master
key.*

### 3. Untrusted-output validation boundary — server AND client, the compiler is the sole authority. **[PMO]**
All model output is **untrusted** until it passes `compileCompositionSpec` with no thrown error
(FR-AS-022/023, ADR-0036 §5). This boundary is enforced **twice**: server-side in the edge function (before
returning to the client) and client-side in `useAIComposer` (before populating any UI state). Neither layer
may substitute an ad-hoc validity check for the compiler. Because the compiler **throws** (fail-fast — fact #1),
the boundary is expressed as `try { compileCompositionSpec(spec, ctx) } catch (ValidationError) { reject }`.
The compiler — not the prompt — is the enforcement authority; the system prompt's whitelist constraint
(FR-AS-024) is defense-in-depth only.

### 4. Bounded repair. **[PMO]**
On validation failure the function MAY re-invoke the model with the **single** caught `ValidationError`
`{ code, detail }` (never raw SQL, stack traces, or credentials — FR-AS-025/NFR-AS-SEC-004) as follow-up
feedback, up to `MAX_REPAIR_ATTEMPTS` (default **2** ⇒ 3 model calls maximum; owner flag AS-OD-001). Exhausted
repair returns HTTP 422 `REPAIR_EXHAUSTED` with the **last** `validationError` (singular — fact #1) and MUST
NOT save or return a partially-valid spec.

### 5. Agent-proposes, user-disposes. **[PMO]** (binding across future PMO-native agent features)
No AI-composed spec may be saved without an explicit user action. The composition flow ends at **populating
the I4 builder** with a visible "AI-composed draft" indicator; **Save is always a deliberate user step**
(FR-AS-020/021). This rule is binding on all future PMO-native agent features unless a later ADR overrides it.

### 6. Structured output via tool forcing — not `response_format`. **[PMO]** uses **[AN]** parity-at-the-action idea
Structured model output is obtained by defining a single tool (`compose_view`) whose `input_schema` is the
`CompositionSpec` JSON schema (built from `registry.keys()` + `Object.keys(ENTITY_WHITELIST)` so the schema
itself is whitelist-constrained — FR-AS-024), with `tool_choice: { type: 'tool', name: 'compose_view' }`
forcing that tool. `response_format` is NOT used. The exact `thinking` parameter shape and streaming API are
**verified against the installed `@anthropic-ai/sdk` at build time** (the model id `claude-opus-4-8` is
fixed); since all unit tests mock the SDK, the param shape affects only the live call. The response is
**accumulated server-side** into one JSON body (no client streaming — owner flag AS-OD-004); internally the
SDK call streams to avoid the edge-function timeout (NFR-AS-PERF-001).

### 7. CI test isolation — handler importable in Vitest; no live calls, no deploy in CI. **[PMO]**
The function's business logic (`composeViewHandler`, `buildSystemPrompt`, `COMPOSITION_SPEC_SCHEMA`) MUST be
**pure, dependency-injected TypeScript modules importable in Vitest (Node)** with the Anthropic client and
Supabase client mocked. The `Deno.serve` wrapper (`index.ts`) — which performs JWT verification and key
loading — is **integration-only** and carries no unit coverage. Live Anthropic calls and function deploys are
**NOT** part of CI (verify/lint/typecheck/build run on PR→dev; pgTAP + e2e on PR→main; the e2e mocks the edge
function via `page.route` — no live Anthropic). The Vitest unit tests for the handler are **co-located under
`pmo-portal/src/lib/agent/*.test.ts`** and import the edge-function modules by relative path, because Vitest's
collection root is `pmo-portal/` and does not reach the repo-root `supabase/functions/` tree — this needs no
`vitest.config` change.

## Consequences

**Positive**
- The first LLM call lands behind the **deputy + RLS** foundation PMO already paid for: prompt injection is a
  nuisance, not a breach (an injected "show all orgs" still hits the caller's RLS).
- The untrusted-output boundary is the **existing I2 compiler** — no new trust surface; the same code that
  guards the manual builder guards the agent. Enforced server- and client-side.
- No second deployable, no Nitro/Drizzle/SSO. PMO-native is the minimal path for the bounded I5 job; the
  sidecar option (ADR-0036 §8) remains available for a later, larger agent surface.
- The handler is fully unit-testable in CI with the SDK mocked; no live API cost or flakiness in CI; no deploy
  coupling. The `agent-proposes/user-disposes` rule keeps the human in the loop by construction.
- A `FEATURES.aiComposer` sub-flag lets any environment without the API key ship User Views without AI, at no
  code cost.

**Negative / costs**
- The **first Deno surface in the repo** — a new toolchain corner (`deno.json`, `config.toml` function
  registration, `npm:`-style imports) that the team must learn and keep importable from Node.
- The handler/wrapper split is a discipline: any business logic that leaks into `index.ts` loses unit
  coverage. Reviewers must enforce the pure-handler boundary.
- `org_id`-from-`profiles` (not a JWT claim) is one extra RLS-scoped query per request; acceptable, and a
  one-line switch when the JWT later carries `app_metadata.org_id`.
- No rate guard and no audit log in v1 (owner flags AS-OD-002/005). The rate guard is built as an injected,
  testable interface (FR-AS-009/AC-AS-008) so enabling it later is config, not a rewrite; runaway-cost
  exposure is bounded only by `MAX_REPAIR_ATTEMPTS` until then — revisit before multi-tenant rollout.

## Alternatives considered

- **`agent-native` Nitro sidecar (ADR-0036 §8).** Viable per the §9 spike, but disproportionate for the single
  bounded job of spec-authoring: a second deployable + JWT bridge + SSO embedding + `.rls()` discipline. Kept
  available for a future, larger agent surface; rejected for I5.
- **Call Anthropic from the browser / a server-rendered page.** Rejected: exposes the API key and bypasses the
  deputy boundary; an unauthenticated caller could drive the LLM (NFR-AS-SEC-002 violation).
- **Add a non-throwing `collectCompositionSpecErrors()` collect-all validator to the trusted core.** Rejected
  for v1: adds surface to the security-sensitive core for marginal benefit; feeding the single fail-fast error
  per repair round converges within `MAX_REPAIR_ATTEMPTS` in practice. Revisit only if repair success rate is
  poor in the field. (An open question is flagged in the plan for the Director.)
- **`service_role` for the `profiles`/org lookup.** Rejected: violates the deputy invariant (ADR-0036 §2) —
  `service_role` bypasses RLS. The caller's JWT is sufficient and correct.
- **Stream the spec to the client (SSE).** Rejected (owner flag AS-OD-004): partial JSON has no UX value; the
  spec is useful only after full validation. Accumulate server-side.
- **Trust the prompt's whitelist as the enforcement boundary.** Rejected: the prompt is defense-in-depth only;
  the compiler is the authority (FR-AS-022/023). Skipping the compiler would let a tampered/hallucinated spec
  reach the builder.

## Verification

- **Decision-level (this ADR):** owner sign-off at I5 merge → Status → Accepted; `docs/README.md` ADR
  range/Latest updated to include `0039` (Proposed); cross-refs to ADR-0036/0037/0038/0016/0017 resolve.
- **Handler boundary:** Vitest unit tests (SDK + Supabase mocked) prove AC-AS-001..008 — happy path, bounded
  repair (single error fed back), repair-exhausted 422, 401 (no userId), 400 (org mismatch / prompt length),
  502 (upstream error scrubbed), 429 (injected rate guard). The 401/400/429 paths assert Anthropic is **not**
  called.
- **Untrusted-output boundary:** `clientValidation.test.ts` imports the compiler directly and proves tampered
  specs (unknown entity, missing required filter) **throw** and never populate the builder (AC-AS-019/020/021).
- **Deputy invariant:** the handler signature has no `service_role` parameter; the `profiles` lookup runs on
  the injected caller-JWT client; a negative grep gate confirms no `ANTHROPIC_API_KEY` literal in `pmo-portal/`
  or the client bundle (NFR-AS-SEC-001).
- **CI isolation:** `npm run verify` (typecheck + lint + Vitest + build) is green with the SDK mocked; the Deno
  `index.ts`/`deno.json` are excluded from the pmo-portal tsconfig/Vitest graph; the e2e (AC-AS-022) mocks the
  edge function via `page.route` — no live Anthropic call, no function deploy in CI.
