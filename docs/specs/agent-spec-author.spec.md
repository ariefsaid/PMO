# SDD: Agent Spec-Author (I5)
**Feature:** AI-powered composition spec authoring via Supabase Edge Function  
**Spec ID prefix:** AS  
**ADR refs:** ADR-0036 (agent-native architecture), ADR-0037 (compiler/DSL), ADR-0038 (executor dispatch)  
**ADR proposed:** ADR-0039 (PMO-native agent architecture + untrusted-output validation boundary)  
**Status:** Draft — 2026-06-29  
**Author:** Director (Claude Opus 4.8)

---

## 1. Context and Job Story

### Job to be Done (jtbd row to add to `docs/product-expectations.md` §JTBD)

> **When** I know roughly what data I want to see but don't know the DSL,  
> **I want to** describe it in plain English and get a working view composition dropped into the builder,  
> **So I can** review and save it without learning the composition grammar.

### Scope Boundary

This spec covers **I5 only**: the agent that *authors* a `CompositionSpec` from a natural-language prompt and populates the I4 ViewBuilderPage. It does NOT cover:

- The agent-native sidecar (a later, separate ADR)
- Autonomous data-querying agents (outside scope — composition only)
- Auto-saving without user review (explicitly out of scope by policy)

---

## 2. Functional Requirements

### 2.1 Edge Function: `supabase/functions/compose-view/`

**FR-AS-001** (ubiquitous)  
The system SHALL implement a Supabase Edge Function at path `supabase/functions/compose-view/index.ts` (Deno runtime) as the sole server-side call site for the Anthropic API.

**FR-AS-002** (event-driven)  
When the edge function receives a POST request, it SHALL authenticate the caller by verifying the `Authorization: Bearer <supabase-jwt>` header using the Supabase service-role JWT verifier, reject with HTTP 401 if absent or invalid, and extract `user_id` (= `auth.uid()`) from the verified claims before performing any LLM call. **`org_id` is NOT in the MVP JWT** (the JWT carries only `auth.uid()`); the function derives `org_id` from `profiles` **under the caller's JWT** (deputy auth, matching the live `auth_org_id()` RLS function — `0002_rls.sql`), never via `service_role`. *(Director reconciliation #4, plan 2026-06-29.)*

**FR-AS-003** (ubiquitous)  
The system SHALL store the Anthropic API key exclusively in Supabase function secrets (`ANTHROPIC_API_KEY`) and NEVER expose it to the client bundle, environment variables accessible to the browser, or version control.

**FR-AS-004** (event-driven)  
When constructing the LLM prompt, the edge function SHALL inject:
- The complete `ENTITY_WHITELIST` (all entity names, allowed columns, numeric columns, date columns, groupable columns, and requiredFilter constraints) sourced from the shared DSL types
- The complete list of registry primitive names (`DataTable`, `KPITile`, `StatTiles`, `Funnel`, `StatusBarChart`, `ProgressBar`, `Card`)
- The `MAX_PANELS_PER_VIEW` ceiling (20)
- The current `version` (1) for `CompositionSpec`
- The caller's `org_id` as context (for token resolution hints, e.g. `{{current_user}}`)

**FR-AS-005** (ubiquitous)  
The system SHALL use model `claude-opus-4-8` with `thinking: { type: "adaptive" }` and obtain structured output by defining a tool named `compose_view` whose `input_schema` is the `CompositionSpec` JSON schema (version 1), with `tool_choice: { type: "tool", name: "compose_view" }` to force a single structured response. The Anthropic SDK SHALL be called via the `@anthropic-ai/sdk` npm package (pinned in the edge function's `import_map.json` or `deno.json`).

**FR-AS-006** (event-driven)  
When the model returns a `tool_use` block for `compose_view`, the edge function SHALL immediately run `compileCompositionSpec(spec, { userId, orgId })` (the I2 pure validator, imported from shared DSL source). If validation passes, the function SHALL return HTTP 200 with `{ spec: CompositionSpec, repairAttempts: number }`. If validation fails, the function SHALL proceed to the bounded repair loop (FR-AS-007).

**FR-AS-007** (state-driven)  
While the last compile threw a `ValidationError` and repair attempts are fewer than `MAX_REPAIR_ATTEMPTS` (owner decision — see §6 flag AS-OD-001), the edge function SHALL send the single caught error's `code` (and `detail`) back to the model as a follow-up user message, re-invoke the model with `compose_view` tool forced, re-validate the new spec, and increment the attempt counter. If the attempt limit is reached without a valid spec, the function SHALL return HTTP 422 with `{ error: "REPAIR_EXHAUSTED", validationError: { code, detail }, repairAttempts: number }`. *(`compileCompositionSpec` is fail-fast — it THROWS the first `ValidationError`, not an array; the loop feeds one error per round — Director reconciliation #1.)*

**FR-AS-008** (event-driven)  
When the model call fails (Anthropic API error, timeout, or network failure), the edge function SHALL return HTTP 502 with `{ error: "UPSTREAM_ERROR", detail: string }` and log the error to Supabase edge function logs. It SHALL NOT expose the raw Anthropic error body to the client.

**FR-AS-009** (conditional)  
Where a per-user rate guard is configured (owner decision — see §6 flag AS-OD-002), the edge function SHALL enforce it by checking a rate-limit counter in the Supabase `agent_rate_limits` table (or equivalent) before calling the Anthropic API, and return HTTP 429 with `{ error: "RATE_LIMITED", retryAfterSeconds: number }` if exceeded.

**FR-AS-010** (ubiquitous)  
The edge function SHALL use the caller's Supabase JWT (forwarded as `Authorization` header) for any Supabase client calls it makes (e.g., rate-limit record lookups). It SHALL NEVER use the service-role key for business data queries — only for JWT verification.

### 2.2 Request / Response Contract

**FR-AS-011** (ubiquitous)  
The edge function SHALL accept a JSON request body conforming to:

```typescript
interface ComposeViewRequest {
  prompt: string;          // user's natural-language description, max 2000 chars
  orgId: string;           // UUID — must match JWT claim; server re-verifies
  contextHints?: {
    currentUserId?: string;  // for {{current_user}} token resolution
    currentDate?: string;    // ISO-8601, for date token hints
  };
}
```

**FR-AS-012** (ubiquitous)  
The edge function SHALL reject requests where `prompt` is empty, exceeds 2000 characters, or `orgId` does not match the JWT claim, with HTTP 400 and a structured error body.

**FR-AS-013** (ubiquitous)  
On success the edge function SHALL return:

```typescript
interface ComposeViewResponse {
  spec: CompositionSpec;        // validated; version: 1
  repairAttempts: number;       // 0 if first attempt succeeded
  tokensUsed?: number;          // total input+output tokens (informational)
}
```

### 2.3 Client Affordance and Wiring

**FR-AS-014** (event-driven)  
When the `FEATURES.userViews` flag is enabled, the ViewBuilderPage and the My Views list SHALL render an "✨ Compose with AI" button (accessible label: "Compose view with AI"). The button SHALL be hidden (not merely disabled) when `FEATURES.userViews` is false, and SHALL be additionally gated on an optional `FEATURES.aiComposer` sub-flag (owner decision — see §6 flag AS-OD-003).

**FR-AS-015** (event-driven)  
When the user activates the "Compose with AI" button, the client SHALL open a modal (`AIComposerModal`) containing a labelled `<textarea>` (label: "Describe the view you want"), a character counter, a "Generate" submit button, and a "Cancel" button. The modal SHALL trap focus, be dismissible via Escape, and be announced as `role="dialog"` with `aria-modal="true"` and `aria-labelledby` referencing the modal heading.

**FR-AS-016** (event-driven)  
When the user submits the prompt, the client SHALL call the `compose-view` edge function via an authenticated POST (forwarding the current Supabase session JWT as `Authorization: Bearer`), display a loading state in the modal, and handle the response as specified in FR-AS-017 through FR-AS-019.

**FR-AS-017** (event-driven)  
When the edge function returns HTTP 200 with a valid `CompositionSpec`, the client SHALL:
1. Run `compileCompositionSpec(spec, { userId, orgId })` client-side as a defense-in-depth re-validation
2. If re-validation passes: close the modal, populate `ViewBuilderPage`'s `panels` state with `spec.panels`, and display a success toast ("View composed — review and save when ready")
3. If re-validation fails (should not occur in normal operation): display an error in the modal and do NOT populate the builder

**FR-AS-018** (event-driven)  
When the edge function returns HTTP 422 (REPAIR_EXHAUSTED), the client SHALL display a user-facing error in the modal: "Couldn't generate a valid view for that description. Try rephrasing or being more specific." It SHALL NOT populate the builder.

**FR-AS-019** (event-driven)  
When the edge function returns HTTP 429 (RATE_LIMITED), HTTP 502 (UPSTREAM_ERROR), or any other error, the client SHALL display a user-facing error appropriate to the status code and SHALL NOT populate the builder.

**FR-AS-020** (ubiquitous)  
The client SHALL NEVER auto-save a composed spec. The user MUST explicitly press "Save" in the ViewBuilderPage after reviewing the populated panels. The composition flow ends at builder population; save is always a deliberate user action.

**FR-AS-021** (event-driven)  
When the builder is populated from a composed spec, the ViewBuilderPage SHALL add a visible indicator (e.g., "AI-composed draft" label near the view name input) that disappears once the user saves or clears the panels.

### 2.4 Validation and Trust Boundary

**FR-AS-022** (ubiquitous)  
All model output SHALL be treated as untrusted. The validated trust boundary is: a `CompositionSpec` MUST pass `compileCompositionSpec` (zero `ValidationError`s) before it may appear in the builder's panel state or be saved. No model output bypasses this gate.

**FR-AS-023** (ubiquitous)  
`compileCompositionSpec` SHALL be the sole authority for spec validity. Neither the edge function nor the client SHALL implement ad-hoc validity checks in lieu of the compiler; both SHALL import and invoke the shared function from `src/lib/viewspec/compiler.ts`.

**FR-AS-024** (ubiquitous)  
The system prompt injected into the model SHALL constrain it to output only entities, columns, and primitives present in the whitelist. This is defense-in-depth — the compiler remains the enforcement authority (FR-AS-022).

**FR-AS-025** (event-driven)  
When `compileCompositionSpec` returns validation errors during the server-side repair loop (FR-AS-007), the edge function SHALL include only the `code` and `message` fields of each `ValidationError` in the repair feedback message, never raw SQL, internal stack traces, or service-role credentials.

---

## 3. Non-Functional Requirements

### Security

**NFR-AS-SEC-001**  
The Anthropic API key MUST reside exclusively in Supabase function secrets. It MUST NOT appear in any committed file, client bundle, `.env` checked into git, or Supabase Vault row readable by the `authenticated` role.

**NFR-AS-SEC-002**  
The edge function MUST verify the caller's Supabase JWT on every request before calling the Anthropic API or performing any business logic. Unauthenticated requests MUST be rejected with HTTP 401 before any LLM call is made (no prompt injection via unauthenticated callers).

**NFR-AS-SEC-003**  
The `orgId` in the request body MUST be compared against the `org_id` claim in the verified JWT. A mismatch MUST return HTTP 400 before any LLM call. This prevents cross-tenant composition requests.

**NFR-AS-SEC-004**  
Prompt content MUST NOT be logged at any verbosity level that persists to Supabase logs by default, to avoid storing PII or sensitive business context in function logs. Only error codes, attempt counts, and token usage SHOULD be logged.

**NFR-AS-SEC-005**  
The system prompt injected to the model MUST NOT include any data rows, cell values, or user records from the database. It MAY include schema metadata (entity names, column names) only. Data is fetched post-composition by the I3 executor via the RLS-enforced query path.

**NFR-AS-SEC-006**  
The client MUST forward only the user's own Supabase session JWT. It MUST NOT construct, forge, or elevate JWT claims. The edge function verifies the JWT independently.

### Accessibility

**NFR-AS-A11Y-001**  
The `AIComposerModal` MUST trap focus within the dialog while open, restore focus to the trigger button on close, and be fully operable via keyboard (Tab, Shift+Tab, Enter to submit, Escape to cancel).

**NFR-AS-A11Y-002**  
Loading state inside the modal MUST be announced to screen readers via `aria-live="polite"` or `aria-busy="true"` on the submit button region.

**NFR-AS-A11Y-003**  
All error messages MUST be associated with the modal via `aria-describedby` and announced via a live region.

**NFR-AS-A11Y-004**  
The "AI-composed draft" indicator in the ViewBuilderPage MUST have a text label (not icon-only) and MUST be announced when it appears (via `aria-live="polite"`).

### Performance

**NFR-AS-PERF-001**  
The edge function MUST return a response within 30 seconds for a single-attempt compose (p95 target). The Anthropic SDK call MUST use streaming to avoid edge-function timeout on long model responses; the edge function accumulates the stream before validating and returning.

**NFR-AS-PERF-002**  
The client MUST display a loading state within 200 ms of the user pressing "Generate" (before the network response arrives).

**NFR-AS-PERF-003**  
The total round-trip time (client submit → builder populated) MUST be under 45 seconds at p95, accounting for up to `MAX_REPAIR_ATTEMPTS` retries.

---

## 4. Acceptance Criteria

### Edge Function Behaviour

**AC-AS-001** (Unit — Vitest, mocked Anthropic SDK)  
Given a valid JWT and a well-formed prompt  
When the mocked model returns a syntactically valid `CompositionSpec` that passes `compileCompositionSpec`  
Then the edge function handler returns `{ spec, repairAttempts: 0 }` and calls the Anthropic SDK exactly once

**AC-AS-002** (Unit — Vitest, mocked Anthropic SDK)  
Given a valid JWT and a well-formed prompt  
When the mocked model returns an invalid spec on attempt 1 and a valid spec on attempt 2  
Then the edge function handler returns `{ spec, repairAttempts: 1 }` and the repair message sent to the model includes the (single, fail-fast) `ValidationError` `code` (and `detail`) from attempt 1

**AC-AS-003** (Unit — Vitest, mocked Anthropic SDK)  
Given a valid JWT and a well-formed prompt  
When the mocked model returns an invalid spec on every attempt up to `MAX_REPAIR_ATTEMPTS`  
Then the edge function handler returns `{ error: "REPAIR_EXHAUSTED", validationError: { code, detail }, repairAttempts: MAX_REPAIR_ATTEMPTS }` (the last caught error, singular)

**AC-AS-004** (Unit — Vitest, mocked Anthropic SDK)  
Given a request with no `Authorization` header  
When the handler is invoked  
Then it returns HTTP 401 without calling the Anthropic SDK

**AC-AS-005** (Unit — Vitest, mocked Anthropic SDK)  
Given a request where `orgId` in the body does not match the JWT claim  
When the handler is invoked  
Then it returns HTTP 400 without calling the Anthropic SDK

**AC-AS-006** (Unit — Vitest, mocked Anthropic SDK)  
Given a request with a `prompt` longer than 2000 characters  
When the handler is invoked  
Then it returns HTTP 400 without calling the Anthropic SDK

**AC-AS-007** (Unit — Vitest, mocked Anthropic SDK)  
Given a valid request  
When the Anthropic SDK throws a network error  
Then the handler returns HTTP 502 with `{ error: "UPSTREAM_ERROR" }` and does not expose the raw SDK error body

**AC-AS-008** (Unit — Vitest, mocked Anthropic SDK)  
Given a valid request and a rate-limit guard configured  
When the per-user call count exceeds the limit  
Then the handler returns HTTP 429 with `{ error: "RATE_LIMITED", retryAfterSeconds }` without calling the Anthropic SDK

### Prompt Construction

**AC-AS-009** (Unit — Vitest)  
Given the system prompt builder is invoked  
When it assembles the context  
Then the resulting prompt string contains all entity names from `ENTITY_WHITELIST`, all primitive names from `registry.keys()`, and `MAX_PANELS_PER_VIEW`

**AC-AS-010** (Unit — Vitest)  
Given the system prompt builder is invoked with an `org_id`  
When it assembles the context  
Then the resulting prompt includes the `org_id` as context for `{{current_user}}` token resolution hints

### Client Affordance

**AC-AS-011** (Unit — Vitest/RTL, mocked edge function)  
Given `FEATURES.userViews` is true  
When ViewBuilderPage renders  
Then an element with accessible name "Compose view with AI" is present in the document

**AC-AS-012** (Unit — Vitest/RTL, mocked edge function)  
Given `FEATURES.userViews` is false  
When ViewBuilderPage renders  
Then no element with accessible name "Compose view with AI" is present

**AC-AS-013** (Unit — Vitest/RTL, mocked edge function)  
Given the AI Composer button is activated  
When the modal opens  
Then a `role="dialog"` element is present, focus is trapped inside, and the textarea has an associated visible label

**AC-AS-014** (Unit — Vitest/RTL, mocked edge function returns 200 + valid spec)  
Given the user enters a prompt and submits  
When the mocked edge function returns a valid spec  
Then the modal closes and ViewBuilderPage's panel state equals `spec.panels`

**AC-AS-015** (Unit — Vitest/RTL, mocked edge function returns 200 + valid spec)  
Given the builder is populated from a composed spec  
When the panels are displayed  
Then an "AI-composed draft" indicator is visible in the view-name region

**AC-AS-016** (Unit — Vitest/RTL, mocked edge function returns 200 + valid spec)  
Given the builder is populated from a composed spec  
When the user presses Save  
Then `useUserViewMutations().create` (or `.update`) is called with the composed spec and the "AI-composed draft" indicator disappears

**AC-AS-017** (Unit — Vitest/RTL, mocked edge function returns 422)  
Given the user submits a prompt  
When the mocked edge function returns 422 REPAIR_EXHAUSTED  
Then an error message appears in the modal, the builder panels are unchanged, and no save is triggered

**AC-AS-018** (Unit — Vitest/RTL, mocked edge function returns 429)  
Given the user submits a prompt  
When the mocked edge function returns 429 RATE_LIMITED  
Then a rate-limit error message appears in the modal and the builder panels are unchanged

### Validation Trust Boundary

**AC-AS-019** (Unit — Vitest, client-side)  
Given the edge function returns a spec that passes server-side validation  
When the client receives it  
Then the client calls `compileCompositionSpec` inside `try/catch` and only populates the builder if it does **not throw** (the compiler is fail-fast — Director reconciliation #1)

**AC-AS-020** (Unit — Vitest, client-side)  
Given a composed spec that references an unknown entity (simulated tampered response)  
When the client runs `compileCompositionSpec`  
Then it **throws** a `ValidationError` with code `UNKNOWN_ENTITY` and the builder is NOT populated

**AC-AS-021** (Unit — Vitest, client-side)  
Given a composed spec with a `tasks` panel that has no `project_id` filter  
When the client runs `compileCompositionSpec`  
Then it **throws** a `ValidationError` with code `MISSING_REQUIRED_FILTER` and the builder is NOT populated

### End-to-End Journey

**AC-AS-022** (E2E — Playwright, mocked edge function, `e2e/AC-AS-022-ai-compose-to-save.spec.ts`)  
Given the user is authenticated and `FEATURES.userViews` is enabled  
When the user navigates to My Views, activates "Compose with AI", enters "show me at-risk projects and this quarter's contract value", and submits  
And the mocked edge function returns a valid two-panel `CompositionSpec` (a `DataTable` of projects filtered by status and a `KPITile` for contract value)  
Then the ViewBuilderPage opens with both panels visible in the panel list, the "AI-composed draft" label is visible, and the user can press Save to persist the view

---

## 5. Test Layering (ADR-0010)

| AC-###       | Layer        | Tool                      | Notes |
|--------------|--------------|---------------------------|-------|
| AC-AS-001    | Unit         | Vitest (mocked Anthropic SDK) | Test the edge function handler in isolation; import handler directly. **Live Anthropic call and function deploy are NOT runnable in CI.** |
| AC-AS-002    | Unit         | Vitest (mocked Anthropic SDK) | Same setup; mock returns invalid then valid spec |
| AC-AS-003    | Unit         | Vitest (mocked Anthropic SDK) | Same setup; mock always returns invalid |
| AC-AS-004    | Unit         | Vitest (mocked Anthropic SDK) | Auth rejection path |
| AC-AS-005    | Unit         | Vitest (mocked Anthropic SDK) | org_id mismatch path |
| AC-AS-006    | Unit         | Vitest (mocked Anthropic SDK) | Input validation path |
| AC-AS-007    | Unit         | Vitest (mocked Anthropic SDK) | Upstream error path |
| AC-AS-008    | Unit         | Vitest (mocked Anthropic SDK) | Rate-limit path (conditional on AS-OD-002) |
| AC-AS-009    | Unit         | Vitest                    | Pure function: prompt builder |
| AC-AS-010    | Unit         | Vitest                    | Pure function: prompt builder with org_id |
| AC-AS-011    | Unit         | Vitest/RTL                | Component render; mock feature flag |
| AC-AS-012    | Unit         | Vitest/RTL                | Component render; feature flag off |
| AC-AS-013    | Unit         | Vitest/RTL                | Modal accessibility; mock edge function |
| AC-AS-014    | Unit         | Vitest/RTL                | Happy-path populate; mock edge function |
| AC-AS-015    | Unit         | Vitest/RTL                | Draft indicator render |
| AC-AS-016    | Unit         | Vitest/RTL                | Save clears draft indicator |
| AC-AS-017    | Unit         | Vitest/RTL                | 422 error display; mock edge function |
| AC-AS-018    | Unit         | Vitest/RTL                | 429 error display; mock edge function |
| AC-AS-019    | Unit         | Vitest                    | Client-side re-validation (import compiler directly) |
| AC-AS-020    | Unit         | Vitest                    | UNKNOWN_ENTITY client-side gate |
| AC-AS-021    | Unit         | Vitest                    | MISSING_REQUIRED_FILTER client-side gate |
| AC-AS-022    | E2E          | Playwright                | Full journey; **mock edge function via route interception** (no live Anthropic call) |

**CI constraint:** Supabase Edge Functions run in Deno, not Node. The edge function handler MUST be structured so its pure business logic (auth check, prompt build, validation loop, repair loop) is importable as a plain TypeScript module in the Vitest environment (with Anthropic SDK mocked). The actual `Deno.serve(handler)` wrapper is integration-only. This pattern follows the same separation used for the I3 executor. **Do NOT deploy the function or call the live Anthropic API in CI.**

---

## 6. Owner-Decision Flags

| Flag ID    | Decision | Default if deferred | Impact |
|------------|----------|---------------------|--------|
| **AS-OD-001** | `MAX_REPAIR_ATTEMPTS`: how many times to retry a failed validation with model feedback before returning REPAIR_EXHAUSTED | 2 | Higher values improve success rate but increase cost and latency. 2 repair attempts = 3 total model calls maximum. |
| **AS-OD-002** | Per-user rate guard: whether to enforce a request-per-hour or cost-per-day cap at the edge function, and the threshold values | No rate guard in v1 (add if abuse observed) | Mitigates runaway cost in single-tenant MVP; essential before multi-tenant rollout. |
| **AS-OD-003** | `FEATURES.aiComposer` sub-flag: whether to gate the AI Composer separately from `FEATURES.userViews`, or ship it as part of the same flag | Ship as part of `FEATURES.userViews` (no sub-flag) | Sub-flag allows disabling AI Composer without disabling the whole User Views feature (useful if API key is not configured in a given environment). |
| **AS-OD-004** | Streaming to the client: whether the edge function streams the model response token-by-token to the client (SSE) or accumulates server-side and returns a single JSON response | Accumulate server-side (simpler client; streaming adds complexity without UX benefit for a spec JSON payload) | Streaming would show partial output in the modal, but the spec is only useful after full validation — partial JSON has no UX value here. |
| **AS-OD-005** | Prompt stored for debugging: whether to persist the composed prompt + response (redacted of PII) to a `agent_audit_log` table for debugging repair failures | No persistence in v1 | Audit log would help diagnose repair loops but adds storage and PII-handling obligations. |

---

## 7. ADR-0039 Proposal

**Proposed title:** PMO-native Agent Architecture and Untrusted-Output Validation Boundary

**Motivation:** The I5 agent-spec-author introduces the first Anthropic API call in the PMO stack. ADR-0036 through ADR-0038 cover the agent-native tenant sidecar architecture; this ADR covers the PMO-portal-native pattern where a Supabase Edge Function acts as the sole LLM call site.

**Decisions to record:**

1. **Single call site:** The Anthropic API MUST only be called from Supabase Edge Functions. No browser-side, no server-rendered page, no PostgREST hook, no pg_net call. The function verifies the caller's JWT before any LLM call.

2. **Deputy authorization:** The edge function uses the caller's Supabase JWT for any business data access. It MUST NOT use service-role credentials for business queries. (Mirrors ADR-0036 §deputy-auth for the sidecar.)

3. **Untrusted-output validation boundary:** All model output is untrusted until it passes `compileCompositionSpec` with zero errors. This boundary is enforced server-side (in the edge function, before returning to the client) AND client-side (before populating any UI state). Neither layer may skip the compiler in favor of ad-hoc checks.

4. **Bounded repair:** On validation failure, the system MAY re-invoke the model with error feedback, up to `MAX_REPAIR_ATTEMPTS`. Exhausted repair MUST surface an error to the user; it MUST NOT save a partially-valid or unvalidated spec.

5. **Agent-proposes, user-disposes:** No AI-composed spec may be saved without explicit user action. The composition flow ends at populating the builder; save is always a deliberate user step. This is binding across all future PMO-native agent features unless overridden by a subsequent ADR.

6. **Structured output via tool forcing:** Structured model output is obtained by defining a tool with the target JSON schema and setting `tool_choice` to force it. The `response_format` parameter is NOT used (not available for tool-use patterns in this SDK version).

7. **CI test isolation:** Edge function business logic MUST be importable as plain TypeScript in Vitest (Anthropic SDK mocked). The `Deno.serve` wrapper is integration-only. Live Anthropic calls and function deploys are NOT part of CI.

**Supersedes:** nothing. **Relates to:** ADR-0036, ADR-0037, ADR-0038.

---

## 8. Implementation Sketches (non-normative)

### Edge Function Structure

```
supabase/functions/compose-view/
  index.ts          # Deno.serve(handler) wrapper — integration only
  handler.ts        # pure async function, importable in Vitest
  prompt.ts         # buildSystemPrompt(whitelist, registry, orgId) → string
  schema.ts         # CompositionSpec JSON schema for tool input_schema
```

`handler.ts` exports:
```typescript
export async function composeViewHandler(
  req: ComposeViewRequest,
  jwt: VerifiedJWT,
  anthropic: Anthropic,           // injected — mock in tests
  supabase: SupabaseClient,       // injected — mock in tests
): Promise<ComposeViewResponse | ComposeViewError>
```

### Anthropic SDK Call (tool-forcing pattern)

```typescript
import Anthropic from "@anthropic-ai/sdk";

const response = await anthropic.messages.create({
  model: "claude-opus-4-8",
  thinking: { type: "adaptive" },
  max_tokens: 4096,
  system: buildSystemPrompt(ENTITY_WHITELIST, registry.keys(), orgId),
  messages: conversationHistory,
  tools: [{ name: "compose_view", description: "...", input_schema: COMPOSITION_SPEC_SCHEMA }],
  tool_choice: { type: "tool", name: "compose_view" },
});
```

### Client Hook

```typescript
// src/hooks/useAIComposer.ts
export function useAIComposer() {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const session = useSession();

  async function compose(prompt: string): Promise<CompositionSpec | null> {
    setStatus("loading");
    const res = await fetch("/functions/v1/compose-view", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ prompt, orgId: session?.user?.app_metadata?.org_id }),
    });
    // ... handle response, run client-side compileCompositionSpec re-validation
  }

  return { compose, status };
}
```

### Playwright E2E Mock (AC-AS-022)

```typescript
// e2e/AC-AS-022-ai-compose-to-save.spec.ts
test("AC-AS-022 AI compose → populate builder → save", async ({ page }) => {
  await page.route("**/functions/v1/compose-view", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        spec: MOCK_TWO_PANEL_SPEC,  // DataTable + KPITile, pre-validated
        repairAttempts: 0,
      }),
    });
  });
  // ... navigate, click button, submit prompt, assert panels, save
});
```

---

## 9. Out of Scope (explicit exclusions)

- Agent-native sidecar (ADR-0036's separate path — later ADR)
- Autonomous data-querying or data-writing by the model
- Auto-saving composed specs without user review
- Editing the composition spec in natural language after initial compose (future feature)
- Multi-turn conversational refinement in the same modal session (future feature; v1 is single-shot + bounded repair)
- Embeddings, vector search, or retrieval-augmented prompt construction (future)
- Any Anthropic API call outside of `supabase/functions/`
