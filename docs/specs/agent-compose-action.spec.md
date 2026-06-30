# SDD: Compose-View as an AgentAction — A4

**Feature:** Wire the `compose_view` `AgentAction` into the `agent-chat` deputy loop so that the
`AssistantPanel` conversation can produce a validated `CompositionSpec` as an **artifact** event,
rendered inline via the I3 `UserViewRenderer`/`HydratedPrimitive` machinery, with a **Save**
affordance that routes into the I4 `user_views` save path. Agent-proposes / user-disposes.
**Spec ID prefix:** CV
**ADR refs:** ADR-0040 (Option A behind a B-shaped seam; A4 = "`compose_view` as an `AgentAction`;
`artifact` events render via the I3 renderer"), ADR-0039 (untrusted-output boundary — the I5
compose-view edge fn; A4 reuses this, never weakens it), ADR-0036 (deputy model, four ceilings,
I2 compiler, I3 renderer), ADR-0037 (compiler DSL), ADR-0038 (renderer executor), ADR-0010
(test pyramid), ADR-0016 (FE authz / real JWT), ADR-0017 (repository seam), ADR-0001 (org_id seam).
**Layer ownership (ADR-0010):** compose action + artifact-event emission + client re-validation →
Vitest (mocked SDK + compiler); panel artifact-slot rendering via real I3 renderer →
Vitest/RTL; cross-stack save journey → ONE curated Playwright e2e (mock edge fn via
`page.route`). RLS / tenancy is proven by existing pgTAP suite (A1 AC-AR-012) — A4 adds no new
server-side trust boundary beyond what ADR-0039 already gates.
**Status:** Draft — 2026-06-30
**Author:** Director (Claude Opus 4.8)

---

## 1. Context

A1 shipped the `AgentRuntime` port and the `agent-chat` edge function with a `query_entity` read
action. A2 shipped the `AssistantPanel` drawer. A3 ships write actions with `confirm:true` /
`needs-approval` approve/deny chips. **A4 closes the loop**: it gives the agent a `compose_view`
action so the user can say "show me a dashboard of my projects by status" in the panel conversation
and have the agent compose a live view inline — the same view the manual builder (I4) and the
one-shot modal (I5) produce, rendered by the same I3 renderer they already ship, saved into the
same `user_views` table. The build is **integration and wiring**, not new composition logic.

### The four pieces A4 wires together (reuse verbatim, do not rebuild)

| Piece | What A4 reuses | Where it lives |
|---|---|---|
| **I5 compose logic** | `composeViewHandler` (tool-forcing + bounded repair against `compileCompositionSpec`; ADR-0039 untrusted-output boundary) | `supabase/functions/compose-view/handler.ts` + `schema.ts` + `prompt.ts` |
| **I2 compiler** | `compileCompositionSpec` (throws on first invalid panel; the trust boundary) | `pmo-portal/src/lib/viewspec/compiler.ts` + `types.ts` + `registry.ts` |
| **I3 renderer** | `HydratedPrimitive` + `executeCompiledQuery` under the viewer's JWT (all 7 primitives; RLS is the ceiling) | `pmo-portal/pages/UserViewRenderer.tsx` |
| **I4 save path** | `useUserViewMutations().create` / `repositories.userView.create` + the `user_views` shape | `pmo-portal/src/hooks/useUserViews.ts` + `src/lib/db/userViews.ts` |

### What is net-new in A4

1. **`composeViewAction`** — a new `AgentAction` defined in `supabase/functions/agent-chat/actions.ts`
   that calls the I5 compose logic (refactored to be callable as a function, not just via HTTP — see
   §6 Reconciliation) and emits an `artifact` `AgentEvent` on success.
2. **Artifact slot in `AssistantPanel`** — the panel renders `artifact` events via a new
   `ArtifactSlot` component that (a) re-validates the spec client-side via `compileCompositionSpec`,
   (b) renders it inline through `HydratedPrimitive`, and (c) presents a **Save** affordance.
3. **`useComposeArtifact` hook** — manages client-side re-validation + panel save state (mirrors
   `useAIComposer`'s re-validation pattern but operates on an already-arrived spec rather than
   POSTing to compose-view).
4. **Flag wiring** — the existing `FEATURES.agentAssistant` AND `FEATURES.aiComposer` flags are
   AND-gated for the artifact rendering path (same guard as I5's `aiComposer` flag on the builder).

### Reconciliation flag: compose-view handler shape

The I5 `composeViewHandler` is currently shaped as a **standalone HTTP handler** (`async function
composeViewHandler(req, deps): Promise<HandlerResult>`). In A4, `composeViewAction.run` needs to
call the same compose-and-repair logic **inside the `agent-chat` deputy loop**, not via a second
HTTP hop. This is a reconciliation: the shared compose logic must be **extracted** from
`composeViewHandler` into a pure function `composeSpec(prompt, deps): Promise<CompositionSpec>`
that both `composeViewHandler` (the I5 HTTP path) and `composeViewAction.run` (the A4 agent path)
call. The HTTP handler becomes a thin wrapper; the agent action imports the same function. This
extraction is net-new code but the logic is zero-new. See §6 for the exact refactor shape.

---

## 2. The Compose-as-Action Flow (the spine)

```
AssistantPanel conversation
  │
  │  user: "show me active projects by status"
  │
  ▼
agent-chat edge fn (Deno deputy loop, A1 handler)
  │  tool catalog = [query_entity, compose_view (NEW A4)]
  │
  │  model picks compose_view tool
  │
  ▼
composeViewAction.run(input, deputyCtx)                ← NEW (actions.ts)
  │  input = { prompt: string }
  │
  │  calls composeSpec(prompt, deps)                   ← EXTRACTED from I5 handler
  │     ├─ buildSystemPrompt(ENTITY_WHITELIST, registry.keys(), orgId, MAX_PANELS_PER_VIEW)
  │     ├─ Anthropic tool-forcing (compose_view tool, COMPOSITION_SPEC_SCHEMA)
  │     └─ bounded repair loop → compileCompositionSpec THROWS on invalid (ADR-0039 boundary)
  │        (up to MAX_REPAIR_ATTEMPTS, then REPAIR_EXHAUSTED → error result)
  │
  │  on success: returns { spec: CompositionSpec, repairAttempts, tokensUsed }
  │
  ▼
agentChatHandler emits AgentEvent:
  {
    type: 'artifact',
    payload: {
      kind: 'compose_view',
      spec: CompositionSpec,          ← server-validated (compileCompositionSpec passed)
      repairAttempts: number,
      title: string,                  ← model-supplied or derived
    }
  }
  │
  ▼
AssistantPanel receives artifact event via subscribe() stream
  │
  │  ArtifactSlot (NEW A4 component):
  │    1. client re-validates: compileCompositionSpec(event.payload.spec, ctx)
  │       → throws → renders error notice (NEVER renders unvalidated spec)
  │    2. on pass: renders inline via HydratedPrimitive (I3 machinery)
  │    3. presents Save button (user-disposes — NEVER auto-saves)
  │
  │  on Save:
  │    useUserViewMutations().create({ name, spec, scope: 'private' })
  │    → repositories.userView.create (I4 path)
  │    → success toast + link to /views/:newViewId (or opens I4 builder pre-filled)
  │
  ▼
user can open the saved view from My Views at any time
```

---

## 3. Functional Requirements (EARS)

Tags: **[ACTION]** edge fn compose action · **[EVENT]** artifact AgentEvent · **[SLOT]** panel
artifact slot · **[SAVE]** save affordance → user_views · **[FLAG]** feature gating · **[REUSE]**
explicit reuse of existing machinery.

### 3.1 `compose_view` AgentAction Registration `[ACTION]`

**FR-CV-001** (ubiquitous)
The system SHALL define a `composeViewAction: AgentAction` in
`supabase/functions/agent-chat/actions.ts` with `name: 'compose_view'`, surfaces `['agent']`,
`confirm: false` (the compose step is non-destructive; the Save is user-initiated), and an
`inputSchema` accepting `{ prompt: string }` (the user's natural-language request for a view).

**FR-CV-002** (ubiquitous)
The `agentChatHandler` in `supabase/functions/agent-chat/handler.ts` SHALL register
`composeViewAction` alongside `queryEntityAction` in the tool catalog passed to each Anthropic
`messages.create` call. The catalog order SHALL be `[queryEntityAction, composeViewAction]`.
The handler SHALL route `compose_view` tool-use blocks to `composeViewAction.run`.

**FR-CV-003** (ubiquitous)
`composeViewAction.run(input, ctx)` SHALL receive a `DeputyContext` carrying the verified
caller JWT, `userId`, and `orgId` — the same deputy contract as `queryEntityAction`. It SHALL
NEVER receive or use a `service_role` key (NFR-CV-SEC-001 / ADR-0036 §2 deputy invariant).

### 3.2 Reuse of I5 Compose + Repair Logic `[ACTION]` `[REUSE]`

**FR-CV-004** (ubiquitous)
The composition-and-repair logic SHALL be extracted from `composeViewHandler` into a pure
async function `composeSpec(prompt: string, orgId: string, deps: ComposeSpecDeps): Promise<CompositionSpec>` exported from a new module `supabase/functions/compose-view/composeSpec.ts`
(or equivalent co-location). **`composeViewHandler` SHALL be refactored to call `composeSpec`**,
preserving all existing AC-AS-### behaviour identically. `composeViewAction.run` SHALL call the
same `composeSpec` — no duplication of the compose/repair logic (ADR-0039 boundary: reuse, not
a second weaker path). See §6 Reconciliation for the exact refactor shape.

**FR-CV-005** (ubiquitous)
`composeSpec` SHALL implement the same tool-forcing + bounded repair loop as the current I5
handler: Anthropic `claude-opus-4-8` · `COMPOSITION_SPEC_SCHEMA` · `tool_choice: { type: 'tool', name: 'compose_view' }` · up to `MAX_REPAIR_ATTEMPTS` (2) repair turns · `compileCompositionSpec` THROWS on invalid (ADR-0039 decision 3 — fail-fast, single error fed back). The model and repair
constants are shared; no agent-specific override (CV-OD-001).

**FR-CV-006** (event-driven)
When `composeSpec` exhausts repair attempts (`REPAIR_EXHAUSTED`) or encounters an upstream SDK
error, `composeViewAction.run` SHALL return a structured error object `{ error: string, code: 'REPAIR_EXHAUSTED' | 'UPSTREAM_ERROR' }` (never throw to the handler). The `agentChatHandler`
SHALL emit an `assistant` text event with a user-facing message ("I wasn't able to compose a valid
view — try rephrasing your request") and continue the conversation. It SHALL NOT emit an artifact
event for a failed compose.

### 3.3 The `artifact` AgentEvent Payload `[EVENT]`

**FR-CV-007** (event-driven)
When `composeViewAction.run` succeeds (a `CompositionSpec` passes `compileCompositionSpec`
server-side), the `agentChatHandler` SHALL emit an `AgentEvent` with:
```ts
{
  type: 'artifact',
  payload: {
    kind: 'compose_view',            // discriminant
    spec: CompositionSpec,           // the server-validated spec (NEVER unvalidated)
    repairAttempts: number,          // 0..MAX_REPAIR_ATTEMPTS
    title: string,                   // suggested view name (model-supplied or derived from prompt)
    tokensUsed: number,
  }
}
```
The `spec` field SHALL be the exact spec that passed `compileCompositionSpec` server-side. The
`title` SHALL be a short, human-readable label (≤60 chars; the action derives it from the user's
prompt or the model's summary — see CV-OD-002).

**FR-CV-008** (ubiquitous)
The `artifact` event SHALL be emitted **after** any `assistant` text blocks the model produced in
the same turn (e.g. "Here's a view of your active projects by status:") and **before** the
`status: 'completed'` event. The panel renders it in insertion order.

**FR-CV-009** (ubiquitous)
The `AgentEvent.payload` for `kind: 'compose_view'` artifacts SHALL be serializable as JSON
(no circular refs, no class instances). The `CompositionSpec` at this point contains only the
`QuerySpec` (pre-compilation inputs), NOT the compiled output — the client re-compiles with its
own `CompilerContext` to get the `CompiledPanel[]` for rendering (defense-in-depth, FR-CV-013).

### 3.4 Client-Side Re-Validation Before Render `[SLOT]` `[REUSE]`

**FR-CV-010** (event-driven)
When the `AssistantPanel` receives an `AgentEvent` with `type === 'artifact'` and
`payload.kind === 'compose_view'`, the `ArtifactSlot` component SHALL call
`compileCompositionSpec(payload.spec, { userId, orgId })` using the **viewer's own** `CompilerContext`
before attempting any render. This is the defense-in-depth client-side re-validation gate
(ADR-0039 decision 3; same pattern as `useAIComposer`'s re-validation in `pmo-portal/src/hooks/useAIComposer.ts`).

**FR-CV-011** (event-driven)
When `compileCompositionSpec` throws a `ValidationError` during client re-validation, the
`ArtifactSlot` SHALL render an **inline error notice** in the transcript ("The composed view
couldn't be validated — try rephrasing your request") and SHALL NOT render the spec or show a
Save button. The error SHALL NOT expose raw `ValidationError.code` or `detail` to the user in
production (VITE_APP_ENV !== 'prod' may show developer detail, mirroring the I3 spec-invalid
disclosure pattern in `UserViewRenderer`).

**FR-CV-012** (ubiquitous)
The `useComposeArtifact` hook (new, at `pmo-portal/src/hooks/useComposeArtifact.ts`) SHALL own
the client re-validation and panel-save state for a single artifact event. It exposes:
```ts
interface UseComposeArtifactResult {
  compiledPanels: CompiledPanel[] | null;  // null until re-validation passes
  validationError: ValidationError | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  save: (name: string, scope?: 'private' | 'shared_org') => Promise<void>;
}
```
The hook imports only `compileCompositionSpec` from `src/lib/viewspec/compiler` and
`useUserViewMutations` from `src/hooks/useUserViews`. It SHALL NOT import any adapter or
edge-fn client directly.

### 3.5 Inline Artifact Rendering via I3 `HydratedPrimitive` `[SLOT]` `[REUSE]`

**FR-CV-013** (event-driven)
When client re-validation passes (FR-CV-010), the `ArtifactSlot` SHALL render each
`CompiledPanel` using the existing `HydratedPrimitive` component from `UserViewRenderer.tsx`.
**A4 SHALL NOT fork or duplicate `HydratedPrimitive`** — it SHALL import and reuse it directly
(or extract it to a shared module if `UserViewRenderer.tsx` does not yet export it; see CV-OD-003).
The rendering contract is identical to I3: `HydratedPrimitive({ panel, data })` after `executeCompiledQuery` runs against the viewer's JWT-scoped Supabase client.

**FR-CV-014** (event-driven)
The `ArtifactSlot` SHALL fire `executeCompiledQuery(panel.compiledQuery)` for each
`CompiledPanel` in parallel (same `Promise.allSettled` pattern as `UserViewRenderer`) under the
viewer's own Supabase client (caller JWT; RLS is the ceiling — the executor is called with the
`useAuth()` session, never elevated). Per-panel loading/empty/error states SHALL be rendered
(loading skeleton → `HydratedPrimitive` or per-panel error notice).

**FR-CV-015** (ubiquitous)
The `ArtifactSlot` component SHALL be visually contained within the `AssistantPanel` transcript
area (not a modal, not a route change). It SHALL use DESIGN.md tokens for its container
(border, background, spacing) and be distinguishable from user/assistant text bubbles. The
design-plan owns the exact visual treatment; this spec owns the behavior.

**FR-CV-016** (ubiquitous)
The `ArtifactSlot` SHALL display the `title` from the artifact payload as a heading above the
rendered panels, so the user knows what view was composed.

### 3.6 Save Affordance → `user_views` `[SAVE]` `[REUSE]`

**FR-CV-017** (event-driven)
When the `ArtifactSlot` renders a successfully-validated artifact, it SHALL present a **Save**
button (or affordance). Clicking Save SHALL NOT auto-navigate away from the panel; it SHALL
trigger the save flow while keeping the panel open and the artifact visible (CV-OD-004 covers
whether to navigate after save).

**FR-CV-018** (event-driven)
When the user clicks Save, the `ArtifactSlot` (via `useComposeArtifact.save`) SHALL call
`useUserViewMutations().create({ name: title, spec: payload.spec, scope: 'private' })` via the
I4 save path (`repositories.userView.create`). The `scope` defaults to `'private'` (CV-OD-005).
On success the Save button SHALL change state to "Saved" and a toast SHALL appear with a link to
`/views/:newViewId` (CV-OD-004).

**FR-CV-019** (ubiquitous)
Save SHALL NEVER be triggered automatically. The user MUST click the Save affordance. The spec
payload is not persisted to `user_views` until the user explicitly saves (the agent-proposes /
user-disposes guarantee). No auto-persist, no background queue. (NFR-CV-SEC-002.)

**FR-CV-020** (state-driven)
While save is in flight (`saveStatus === 'saving'`), the Save button SHALL be disabled to
prevent double-submission. On save error, the button SHALL re-enable and a user-facing error
message SHALL appear (classified via `classifyMutationError`; FK-block → "in use" is not
applicable here, but UNKNOWN → "Could not save the view. Please try again.").

**FR-CV-021** (event-driven)
If CV-OD-004 is set to "open I4 builder pre-filled", clicking Save SHALL navigate to
`/views/new` passing the `CompositionSpec` in `location.state.composedSpec` (the same pathway
`AIComposerModal` uses in `ViewBuilderPage` — the existing populate path at lines 88–99 of
`ViewBuilderPage.tsx`). The user can then name and save from the builder. (Default per CV-OD-004
is direct save, not builder redirect.)

### 3.7 Agent-Proposes / User-Disposes Guarantee `[SAVE]`

**FR-CV-022** (ubiquitous)
The `compose_view` `AgentAction` SHALL have `confirm: false` (FR-CV-001) because composing a
spec is non-destructive (no data is written until the user saves). The Save affordance in the
panel IS the user-dispose gate. The agent SHALL NEVER automatically call
`useUserViewMutations().create` or any `user_views` write RPC on behalf of the user.

**FR-CV-023** (ubiquitous)
The agent SHALL NOT be capable of saving a view without user action: the compose-view action
exists only in the edge fn's tool catalog and emits only an artifact event; there is no
`save_view` AgentAction in A4. If a prompt-injected instruction tells the agent to save
automatically, the agent has no tool to do so — the RLS write path is only reachable via the
user's Save click in the FE. (Prompt injection → agent still cannot auto-persist; NFR-CV-SEC-003.)

### 3.8 Feature Flag Gating `[FLAG]`

**FR-CV-024** (ubiquitous)
The `compose_view` AgentAction SHALL be registered in the `agent-chat` handler's tool catalog
**only when** `FEATURES.agentAssistant === true` AND `FEATURES.aiComposer === true` (AND-gate).
When either flag is off, the tool is absent from the catalog; the agent loop behaves as A1/A2/A3
with no composition capability.

**FR-CV-025** (ubiquitous)
The `ArtifactSlot` component SHALL NOT be rendered (even if an `artifact` event arrives in the
stream) unless both `FEATURES.agentAssistant === true` and `FEATURES.aiComposer === true`. If
either flag is off and an artifact event arrives, the panel SHALL silently skip rendering it
(treat it as an unknown event type). This guards against a flag-mismatch edge case where an
artifact event arrives for a user who is not flag-enabled for AI compose.

---

## 4. Non-Functional Requirements

### Security — `NFR-CV-SEC-###`

**NFR-CV-SEC-001** — **Untrusted-output boundary holds (ADR-0039 — reuse, do not weaken).**
Every `CompositionSpec` produced by the compose_view action SHALL pass `compileCompositionSpec`
**server-side** (in `composeSpec`, before the artifact event is emitted) AND **client-side**
(in `ArtifactSlot` / `useComposeArtifact`, before any render or persist). The server-side
pass is the primary boundary (ADR-0039); the client-side pass is defense-in-depth. If either
fails, the spec is never rendered and never saved. A4 creates no second, weaker compose path:
the same `COMPOSITION_SPEC_SCHEMA` tool schema + the same `compileCompositionSpec` compiler
+ the same `MAX_REPAIR_ATTEMPTS` cap apply as in I5.

**NFR-CV-SEC-002** — **No auto-persist.**
The `user_views` table SHALL receive a write for a composed spec only via an explicit
`repositories.userView.create` call triggered by the user's Save action. The edge fn has no
direct write to `user_views`; the agent-chat handler emits only events. Even if the edge fn is
compromised or prompt-injected, it cannot write to `user_views` (the write path is FE-only,
JWT-scoped, RLS-enforced).

**NFR-CV-SEC-003** — **Prompt-injection containment.**
An injected instruction such as "compose a view of all orgs" or "include `service_role` key
in the spec" SHALL be contained by the layered boundary: the `ENTITY_WHITELIST` in the
`COMPOSITION_SPEC_SCHEMA` constrains model output to whitelisted entities/columns; the compiler
rejects any spec that references an unknown entity or column; `executeCompiledQuery` runs under
the viewer's own JWT (RLS is the ceiling). The artifact slot's client-side re-validation applies
the same whitelist. At no point does a prompt-injected spec reach the DOM or the database
without passing both gates.

**NFR-CV-SEC-004** — **Artifact executes under the viewer's own JWT (RLS ceiling).**
`executeCompiledQuery` in `ArtifactSlot` SHALL use the `useAuth()` Supabase client (caller JWT).
The composed view shows only the rows the viewer's own RLS policy permits — identical to I3's
`UserViewRenderer`. A shared/composed view never leaks another user's or another tenant's rows.
The `org_id` seam (ADR-0001) is enforced by the `$current_org` token + RLS; the artifact slot
does not pass a hardcoded `org_id` — it resolves from the viewer's JWT at query time.

**NFR-CV-SEC-005** — **ANTHROPIC_API_KEY stays server-side.**
The edge fn's Anthropic client is constructed in `index.ts` from `Deno.env.get('ANTHROPIC_API_KEY')`.
The SPA has no access to this key. `composeSpec` is called only inside the Deno edge fn; the FE
never calls Anthropic directly (mirroring NFR-AR-SEC-001 / NFR-AP-SEC-001 from A1/A2).

**NFR-CV-SEC-006** — **Logging discipline.**
`composeSpec` and `composeViewAction.run` SHALL log only `{ errorCode, repairAttempts, tokensUsed }` on failure — NEVER the prompt text, spec contents, or data rows (inheriting NFR-AS-SEC-004 from I5).

**NFR-CV-SEC-007** — **Port isolation.**
`ArtifactSlot` and `useComposeArtifact` SHALL import only from `src/lib/viewspec/` and
`src/hooks/useUserViews` (plus DESIGN.md token imports). They SHALL NOT import `PmoNativeRuntime`,
any adapter, or any Supabase edge-fn client directly (extending NFR-AP-SEC-003).

### Performance — `NFR-CV-PERF-###`

**NFR-CV-PERF-001** — **Compose latency expectation.**
`composeSpec` involves one Anthropic API call (+ up to `MAX_REPAIR_ATTEMPTS` repair calls). In
the happy path (0 repairs) this is a single model call. P50 latency of the one-shot compose-view
function is already baselined by I5; A4 operates under the same budget. The panel shows a
streaming indicator during the compose turn (the agent-chat SSE is already streaming; the model
text before the tool result streams as `assistant` events). No additional spinner is needed beyond
the existing A2 streaming indicator.

**NFR-CV-PERF-002** — **Artifact panel queries in parallel.**
`ArtifactSlot` SHALL fire all `executeCompiledQuery` calls for its `CompiledPanel[]` in parallel
via `Promise.allSettled` (same pattern as `UserViewRenderer`). The render SHALL show per-panel
loading skeletons during the fetch, not a full-slot spinner (no perceived wait for the whole view
before any panel renders).

**NFR-CV-PERF-003** — **ArtifactSlot does not re-render the transcript.**
Rendering the `ArtifactSlot` (and its inner `HydratedPrimitive` panels) SHALL NOT cause the rest
of the `AssistantPanel` transcript list to unmount or re-render (NFR-AP-PERF-002 from A2 applies
to the artifact slot as a transcript entry — it is a keyed component with a stable key derived
from the artifact event's `id`).

### Accessibility — `NFR-CV-A11Y-###`

**NFR-CV-A11Y-001** — **ArtifactSlot landmark.**
The artifact slot SHALL be contained within a `<section>` with `aria-label` derived from the
composed view's `title` (e.g. `aria-label="Composed view: Active projects by status"`). All
panels inside SHALL use WCAG-AA contrast via DESIGN.md tokens.

**NFR-CV-A11Y-002** — **Save button accessibility.**
The Save button SHALL have an accessible label (`aria-label="Save composed view"` or equivalent).
When disabled (saving in flight), it SHALL carry `aria-disabled="true"` and `aria-busy="true"`.
After save succeeds, the state change SHALL be announced via an `aria-live` region (the toast or
a visually-hidden notice).

**NFR-CV-A11Y-003** — **axe-core zero violations.**
The `ArtifactSlot` rendered with a mocked `CompiledPanel[]` and data rows SHALL produce zero
axe-core violations in its RTL unit test.

---

## 5. Acceptance Criteria

All AC are Given/When/Then, tagged to the **lowest sufficient owning layer** (ADR-0010). The
Anthropic SDK and `compileCompositionSpec` are **mocked** in all Vitest tests; no live LLM call
or Supabase edge fn is made in unit/component tests. The Playwright e2e mocks the edge fn via
`page.route`.

### 5.1 `compose_view` Action Registration + Artifact Event (Unit — Vitest, edge fn handler)

**AC-CV-001** (Unit) — *`compose_view` tool is in the catalog when both flags are on.*
Given `FEATURES.agentAssistant = true` and `FEATURES.aiComposer = true`
When the `agent-chat` handler builds its tool catalog for an Anthropic `messages.create` call
Then the catalog contains a tool with `name: 'compose_view'` and an `inputSchema` accepting `{ prompt: string }`.
Test file: `supabase/functions/agent-chat/handler.test.ts`

**AC-CV-002** (Unit) — *`compose_view` tool absent when `aiComposer` flag is off.*
Given `FEATURES.aiComposer = false` (or absent from the env)
When the `agent-chat` handler builds its tool catalog
Then no tool with `name: 'compose_view'` is present; the catalog contains only `query_entity`.
Test file: `supabase/functions/agent-chat/handler.test.ts`

**AC-CV-003** (Unit) — *Successful compose emits an `artifact` event with validated spec.*
Given a mocked Anthropic SDK that (turn 1) returns `stop_reason: 'tool_use'` with `tool_use.name: 'compose_view'` and `input: { prompt: "active projects by status" }`, then (turn 2, compose model call) returns a valid `CompositionSpec` JSON via `tool_use: { name: 'compose_view', input: { version: 1, panels: [...] } }` that passes `compileCompositionSpec`
When `agentChatHandler` processes a user turn "show me active projects by status"
Then the emitted event sequence includes an `AgentEvent` with `type: 'artifact'`, `payload.kind: 'compose_view'`, `payload.spec.version === 1`, and `payload.repairAttempts >= 0`; the artifact event appears after any `assistant` text events and before the `status: 'completed'` event.
Test file: `supabase/functions/agent-chat/handler.test.ts`

**AC-CV-004** (Unit) — *Invalid compose spec triggers repair and, on exhaustion, emits assistant error text (not an artifact event).*
Given a mocked Anthropic SDK where the compose model calls always return an invalid spec (failing `compileCompositionSpec`)
When `composeViewAction.run` runs with `MAX_REPAIR_ATTEMPTS = 2` and all three attempts produce invalid specs
Then `composeViewAction.run` returns `{ error: ..., code: 'REPAIR_EXHAUSTED' }`; `agentChatHandler` emits an `assistant` text event (the error message to the user) and does NOT emit an `artifact` event.
Test file: `supabase/functions/agent-chat/actions.test.ts`

**AC-CV-005** (Unit) — *composeSpec extraction: refactored handler still passes all existing I5 AC.*
Given the refactored `composeViewHandler` that delegates to `composeSpec`
When the existing I5 Vitest tests (`supabase/functions/compose-view/handler.test.ts`) run against the refactored handler
Then all existing AC-AS-### pass without modification. (This is the regression gate on the refactor — zero net-new test for the refactor itself, but the existing suite must stay green.)
Test file: `supabase/functions/compose-view/handler.test.ts` (existing, unmodified suite)

### 5.2 Client Re-Validation + Artifact Slot Rendering (Unit — Vitest/RTL)

**AC-CV-006** (Unit) — *Valid artifact event: `useComposeArtifact` returns `compiledPanels`, not `validationError`.*
Given a valid `CompositionSpec` in the artifact event payload and a `CompilerContext` with a valid `userId` and `orgId`
When `useComposeArtifact(event.payload.spec, ctx)` runs (with the real `compileCompositionSpec`, mocked `useUserViewMutations`)
Then `compiledPanels` is a non-null `CompiledPanel[]` and `validationError` is `null`.
Test file: `pmo-portal/src/hooks/useComposeArtifact.test.ts`

**AC-CV-007** (Unit) — *Invalid artifact spec: client re-validation rejects it; no render.*
Given a `CompositionSpec` with an unknown entity (e.g. `{ entity: 'secret_salaries' }`) in the artifact event payload
When `useComposeArtifact` calls `compileCompositionSpec`
Then `compiledPanels` is `null` and `validationError` is a `ValidationError` with `code: 'UNKNOWN_ENTITY'`.
Test file: `pmo-portal/src/hooks/useComposeArtifact.test.ts`

**AC-CV-008** (Unit — RTL) — *Panel renders `ArtifactSlot` via real `HydratedPrimitive` for a valid spec.*
Given `FEATURES.agentAssistant = true`, `FEATURES.aiComposer = true`, and the `AssistantPanel` receives a scripted `artifact` AgentEvent with `payload.kind: 'compose_view'` and a valid `CompositionSpec` (one `KPITile` panel); `executeCompiledQuery` is mocked to return `[{ count: 7 }]`
When the panel renders
Then the `ArtifactSlot` is present in the DOM; a `KPITile` element (or its test-id) is rendered with the mocked value; a "Save" button is present and enabled.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-CV-009** (Unit — RTL) — *Invalid artifact: error notice rendered; no primitive; no Save button.*
Given the `AssistantPanel` receives a scripted `artifact` event with `payload.kind: 'compose_view'` and a spec that fails client-side `compileCompositionSpec` (unknown entity)
When the panel renders
Then the transcript shows an inline error notice (text matching /couldn't be validated/i or equivalent); no `HydratedPrimitive` output is present; no "Save" button is present.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-CV-010** (Unit — RTL) — *Flag guard: artifact event silently skipped when `aiComposer` is off.*
Given `FEATURES.agentAssistant = true`, `FEATURES.aiComposer = false`, and the panel receives an `artifact` event
When the panel renders
Then no `ArtifactSlot` is rendered; the artifact event is ignored silently; the rest of the transcript (any surrounding assistant/tool events) renders normally.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

### 5.3 Save Affordance (Unit — Vitest/RTL)

**AC-CV-011** (Unit — RTL) — *Save calls `useUserViewMutations().create` with the spec and default private scope.*
Given a rendered `ArtifactSlot` with a validated spec (from AC-CV-008) and a mocked `useUserViewMutations` where `create.mutateAsync` resolves with `{ id: 'new-view-id' }`
When the user clicks the "Save" button
Then `create.mutateAsync` is called with an input that includes `spec: payload.spec` and `scope: 'private'`; the Save button shows a saved/disabled state; a success indication appears (toast or "Saved" label).
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-CV-012** (Unit — RTL) — *Save button is disabled while save is in flight.*
Given a `save` call that does not resolve immediately (mocked as a pending promise)
When the user clicks Save
Then the Save button is `disabled` (or `aria-disabled`) during the pending period.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-CV-013** (Unit — RTL) — *Save is never automatic.*
Given a valid `ArtifactSlot` rendered with a validated spec and mocked `useUserViewMutations`
When the component renders and the user performs no action
Then `create.mutateAsync` has NOT been called (no auto-save at any point before user interaction).
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

### 5.4 Accessibility (Unit — Vitest/RTL)

**AC-CV-014** (Unit — RTL + jest-axe) — *ArtifactSlot: zero axe violations.*
Given `ArtifactSlot` rendered with a valid mocked `CompiledPanel[]` and dummy data rows
When `axe` runs on the slot's DOM subtree
Then zero violations are reported.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx` (or a dedicated `ArtifactSlot.test.tsx`)

### 5.5 Cross-Stack Journey (E2E — Playwright, ONE curated test)

**AC-CV-015** (E2E) — *Ask in panel → artifact view renders → Save → reopen from My Views.*
This is the single curated Playwright e2e for A4. The edge fn is mocked via `page.route` (no live
Anthropic call; no Supabase edge fn deploy in CI).

**Setup:**
- `VITE_FEATURES_AGENT_ASSISTANT=true`, `VITE_FEATURES_AI_COMPOSER=true`
- `page.route('**/functions/v1/agent-chat', ...)` returns a mocked SSE stream:
  ```
  { type: 'user',      text: 'show me active projects by status', ... }
  { type: 'assistant', text: 'Here is a dashboard of your active projects by status:', ... }
  { type: 'artifact',  payload: {
      kind: 'compose_view',
      spec: { version: 1, panels: [{ id: 'p1', primitive: 'StatusBarChart',
                querySpec: { entity: 'projects', select: ['status', 'id'],
                             groupBy: 'status',
                             aggregate: { fn: 'count', column: 'id', alias: 'count' } } }] },
      title: 'Active projects by status',
      repairAttempts: 0, tokensUsed: 320
  }, ... }
  { type: 'status',    payload: { status: 'completed' }, ... }
  ```
- `page.route('**/rest/v1/projects*', ...)` returns a mocked Supabase response with
  `[{ status: 'active', count: 5 }, { status: 'on_hold', count: 2 }]`
- `page.route('**/rest/v1/user_views*', ...)` for the Save POST returns `[{ id: 'saved-view-1', name: 'Active projects by status', ... }]`

**Journey:**
1. User logs in (auth fixture) and lands on any route.
2. User opens the AssistantPanel (⌘J or Ctrl+J).
3. User types "show me active projects by status" and presses Enter.
4. Composer is disabled; streaming indicator appears.
5. Assistant text bubble "Here is a dashboard..." appears.
6. `ArtifactSlot` renders with heading "Active projects by status".
7. A `StatusBarChart` (or its test content) is visible inside the slot.
8. A "Save" button is visible and enabled.
9. User clicks "Save".
10. A success toast or "Saved" indicator appears (with a link/mention of the view).
11. User navigates to `/views` (My Views).
12. The saved view "Active projects by status" appears in the list.
13. User clicks the view → navigates to `/views/saved-view-1` → I3 renderer shows the view.

**Assertions:**
- After step 6: `getByRole('region', { name: /active projects by status/i })` (or `section`) is visible within the panel.
- After step 7: the `ArtifactSlot` contains content (a chart element or data-testid).
- After step 8: a button with accessible name matching /save/i is enabled.
- After step 9 (before step 10): the Save button is disabled (in-flight state).
- After step 10: a success indication is visible (toast or "Saved" text).
- After step 12: the My Views list contains a row/card with text "Active projects by status".
- After step 13: the `UserViewRenderer` page loads (I3 renderer, not the panel).

**No auto-save assertion:** between step 5 (artifact renders) and step 9 (user clicks Save), the
`/rest/v1/user_views` route SHALL NOT have been called with a POST (verify via `page.route` request log or `requestCount` counter).

Test file: `pmo-portal/e2e/AC-CV-015-compose-view-artifact-journey.spec.ts`
CI gate: PR→`dev` fast lane (Vite dev server; edge fn + Supabase mocked via `page.route`; no live LLM; no live DB).

### 5.6 Negatives (Unit — Vitest/RTL)

**AC-CV-016** (Unit — edge fn) — *Upstream error on compose model call emits assistant text, not an artifact.*
Given `composeSpec` throws an upstream SDK error (non-`ValidationError`)
When `agentChatHandler` processes the `compose_view` tool result
Then the handler emits one `assistant` text event (the user-facing error) and one `status: 'completed'` event; zero `artifact` events are emitted. (The handler does NOT propagate a `status: 'errored'` for a compose failure — compose is one turn; the conversation can continue.)
Test file: `supabase/functions/agent-chat/actions.test.ts`

---

## 6. Reconciliation: `composeViewHandler` Refactor Shape

The I5 `composeViewHandler` must be refactored to extract the compose+repair logic. The
implementation plan will own the exact file paths; this spec defines the contract.

**Current shape** (`supabase/functions/compose-view/handler.ts`):
```ts
export async function composeViewHandler(req, deps): Promise<HandlerResult>
// contains: gate checks (401/400/429) + model call loop + repair
```

**Target shape after A4 refactor:**
```ts
// supabase/functions/compose-view/composeSpec.ts  (NEW — extracted shared logic)
export async function composeSpec(
  prompt: string,
  orgId: string,
  deps: ComposeSpecDeps,  // { anthropic, userId }
): Promise<CompositionSpec>  // throws ComposeSpecError({ code, repairAttempts }) on failure

// supabase/functions/compose-view/handler.ts  (REFACTORED — thin HTTP wrapper)
export async function composeViewHandler(req, deps): Promise<HandlerResult>
// gates (401/400/429) remain here; calls composeSpec() for the model logic

// supabase/functions/agent-chat/actions.ts  (NEW action)
export const composeViewAction: AgentAction = {
  name: 'compose_view',
  run: async (input: { prompt: string }, ctx: DeputyContext) => {
    try {
      const spec = await composeSpec(input.prompt, ctx.orgId, { anthropic: deps.anthropic, userId: ctx.userId });
      return { spec, repairAttempts: ..., tokensUsed: ..., title: deriveTitle(input.prompt) };
    } catch (e: ComposeSpecError) {
      return { error: e.message, code: e.code };
    }
  }
}
```

**Invariants of the refactor:**
1. The `composeViewHandler` HTTP path (I5) behaves identically after refactor — all existing AC-AS-### pass.
2. `composeSpec` imports `compileCompositionSpec` from the same trusted core (`pmo-portal/src/lib/viewspec/compiler`).
3. The same `MAX_REPAIR_ATTEMPTS`, `COMPOSITION_SPEC_SCHEMA`, `buildSystemPrompt`, and `MAX_PANELS_PER_VIEW` constants apply to both callers.
4. `ComposeSpecDeps` mirrors `HandlerDeps` minus the gate-check concerns (no `supabase` — org lookup stays in the HTTP handler and the agent-chat handler independently; `composeSpec` only needs `anthropic` + `userId` for the `CompilerContext`).

---

## 7. Owner-Decision Flags (defaults applied — nothing blocks the plan)

| Flag | Question | **Default applied** | Rationale |
|---|---|---|---|
| **CV-OD-001** | Model for the compose action: same `claude-opus-4-8` as I5, or a cheaper model for the agent path? | **`claude-opus-4-8`** (same as I5) | Composition quality is the same job regardless of surface; the model is the critical path for spec quality and repair. Cheaper models produce more repairs (higher total cost + latency). Review after profiling. |
| **CV-OD-002** | How to derive the artifact `title`? Model-supplied in tool input, derived from the user's prompt, or a post-hoc summary call? | **Derived from the user's prompt** (first 60 chars of the user message that triggered the compose, capitalized) | Avoids a third model call; the user's words are the best view name. The user can rename on Save. |
| **CV-OD-003** | Should `HydratedPrimitive` be extracted to a shared module, or should `ArtifactSlot` import it directly from `UserViewRenderer.tsx`? | **Extract to `pmo-portal/src/components/dashboard/HydratedPrimitive.tsx`** | `UserViewRenderer.tsx` is a route-level component; importing from it creates a coupling. Extraction is ~10 lines (move the function, re-export it from `UserViewRenderer` to avoid breaking tests). |
| **CV-OD-004** | After Save: stay in panel with "Saved" + link, or navigate to the I4 builder pre-filled, or navigate directly to the saved view? | **Stay in panel; show "Saved" + a link chip to `/views/:newViewId`** | Agent-proposes / user-disposes means the panel stays open; the user decides whether to navigate. The link is an affordance, not a forced redirect. |
| **CV-OD-005** | Default `scope` for artifact saves: `'private'` or ask the user? | **`'private'` (no prompt)** | Consistent with I5's `AIComposerModal` default; sharing is a deliberate second action. A scope dropdown could be added to the Save affordance as a follow-up. |
| **CV-OD-006** | Can the agent compose multiple artifacts in one turn or conversation? | **Yes — no restriction on artifact count per turn or per conversation** | The model decides (it may produce one tool call per turn; multiple turns → multiple artifacts). Each artifact is independent and has its own Save button. The `ArtifactSlot` is a transcript entry like any other — multiple are fine. |
| **CV-OD-007** | Does the artifact (spec + rendered view) persist in the transcript after the panel is closed and reopened? | **No — transcript is in-memory React state (AP-OD-005 from A2); artifacts clear on panel close/reopen** | Consistent with A2's transcript persistence model. Durable run history (including artifacts) is a later concern (flagged in A1's AR-OD-005). |

---

## 8. Traceability Table (ADR-0010)

Each AC is owned by **one** test at the lowest sufficient layer. The owning test names its `AC-CV-###`
in its title for `grep`-able traceability.

| AC-### | Layer | Tool | Owning test file |
|---|---|---|---|
| AC-CV-001 | Unit | Vitest | `supabase/functions/agent-chat/handler.test.ts` |
| AC-CV-002 | Unit | Vitest | `supabase/functions/agent-chat/handler.test.ts` |
| AC-CV-003 | Unit | Vitest | `supabase/functions/agent-chat/handler.test.ts` |
| AC-CV-004 | Unit | Vitest | `supabase/functions/agent-chat/actions.test.ts` |
| AC-CV-005 | Unit | Vitest | `supabase/functions/compose-view/handler.test.ts` (existing) |
| AC-CV-006 | Unit | Vitest | `pmo-portal/src/hooks/useComposeArtifact.test.ts` |
| AC-CV-007 | Unit | Vitest | `pmo-portal/src/hooks/useComposeArtifact.test.ts` |
| AC-CV-008 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-CV-009 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-CV-010 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-CV-011 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-CV-012 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-CV-013 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-CV-014 | Unit | Vitest/RTL + jest-axe | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-CV-015 | E2E | Playwright | `pmo-portal/e2e/AC-CV-015-compose-view-artifact-journey.spec.ts` |
| AC-CV-016 | Unit | Vitest | `supabase/functions/agent-chat/actions.test.ts` |

**CI placement:**
- AC-CV-001 → AC-CV-014: `npm run verify` (typecheck + lint + Vitest) — PR→`dev` fast lane.
- AC-CV-015: Playwright, PR→`dev` fast lane (Vite dev server; `agent-chat` + Supabase mocked via `page.route`; no live Anthropic, no Supabase edge fn deploy).
- All AC rerun in PR→`main` integration job.

**Coverage:** ≥80% line coverage on all new files (`useComposeArtifact.ts`, `ArtifactSlot.tsx`, `composeSpec.ts`, `composeViewAction` in `actions.ts`) required to merge.

---

## 9. Open Questions for the Director (≤5, each with a recommendation)

**CV-OQ-001 — Title derivation: prompt truncation vs. model-supplied title field.**
The `compose_view` tool input schema currently has only `{ prompt: string }`. The artifact event
needs a `title`. Option A: derive from the prompt (CV-OD-002 default — no schema change). Option
B: add `title?: string` to the tool input schema, letting the model choose a title when it calls
the tool. Option B is slightly richer but risks the model ignoring the field.
**Recommendation: start with Option A (prompt truncation); add `title` to the tool schema in a
follow-up if user testing shows the derived titles are too opaque.**

**CV-OQ-002 — Should `composeSpec` validate org membership (the I5 Gate 3 profiles lookup)?**
The I5 handler's Gate 3 validates that `req.orgId` matches the caller's `profiles.org_id`. In
A4, the `DeputyContext` already carries `orgId` (derived by `agentChatHandler`'s own Gate 2
profiles lookup). Should `composeSpec` re-run the profiles lookup, or trust `ctx.orgId`?
**Recommendation: trust `ctx.orgId` — the `agentChatHandler` already validated it at Gate 2
(same pattern, same source). Doing it twice is a redundant DB call. `ComposeSpecDeps` does not
need a `supabase` client; `composeSpec` only uses `ctx.orgId` to build the system prompt.**

**CV-OQ-003 — `HydratedPrimitive` extraction: extract now or defer?**
CV-OD-003 defaults to extracting `HydratedPrimitive` to a shared module. This is a small refactor
of `UserViewRenderer.tsx` (the function is already co-located; moving it breaks no contracts). The
alternative is having `ArtifactSlot` import from `UserViewRenderer.tsx` directly (workable but
architecturally messy).
**Recommendation: extract as part of A4's build task — it is a ~10-line move, the kind of refactor
that pays immediately and only gets messier if deferred. The implementer should do it as Task 1
before building `ArtifactSlot`.**

**CV-OQ-004 — Rate limiting: should `composeSpec` calls from the agent path share the same `RateGuard` as the I5 HTTP path?**
The I5 handler uses `rateGuard` (optional, disabled by default per AS-OD-002). In A4, each
`compose_view` tool call within a conversation is a separate Anthropic call. Without a guard, a
conversation that asks for 10 views consumes 10× the token budget of a single compose.
**Recommendation: yes, share the same `RateGuard` check at the `agentChatHandler` level (not
inside `composeSpec`), counting compose tool calls against the same per-user bucket as I5 compose
calls. Implementation: the `agentChatHandler` checks the rate guard before dispatching
`composeViewAction.run` (a per-tool pre-check within the action dispatch). Defer to the
implementation plan; this spec flags the concern.**

**CV-OQ-005 — The `confirm: false` choice for `compose_view`: should the model propose the view before composing (a two-step `needs-approval`), or compose immediately?**
With `confirm: false`, the model calls `compose_view` and the spec is composed in one shot. An
alternative is `confirm: true` (needs-approval): the model proposes "I'll compose a dashboard of
active projects by status — shall I?" and waits for the user to approve/reject before the tool
runs. This matches A3's pattern for write actions.
**Recommendation: `confirm: false` (the current default). Composition is non-destructive (no DB
write until the user saves); the preview-before-save IS the user-dispose gate. Adding a
pre-approval step before even composing makes the UX two-step for no security gain. Re-evaluate
if user research shows "surprise" at the composed result.**

---

## 10. Out of Scope (explicit — not built in A4)

- A `save_view` `AgentAction` (auto-save by the agent) — explicitly forbidden by NFR-CV-SEC-002 and CV-OD-005.
- Multi-artifact layouts (multiple artifacts side-by-side in the panel) — the slot is inline in the transcript; multiple are allowed sequentially (CV-OD-006) but layout is the design-plan's concern.
- `AgentNativeRuntime` sidecar adapter → **B-adapter, deferred.**
- Durable artifact/transcript persistence → later (AR-OD-005 / AP-OD-005).
- A2A or MCP exposure of the `compose_view` action → later (surfaces `['agent']` only in A4).
- Edit/refine artifact in the panel (ask the agent "add a KPI tile for total budget") → later; A4 is compose-once-per-turn.
