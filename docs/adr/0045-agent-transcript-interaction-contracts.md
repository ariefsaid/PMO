# ADR-0045 — Transcript interaction contracts: typed widget results, ask-user questions, live context

- **Status:** Accepted (owner-directed 2026-07-03)
- **Date:** 2026-07-03
- **Deciders:** Owner, Director
- **Related:** ADR-0036 (deputy invariant §2 "nuisance not breach"; declarative-artifact rule §5 — no
  executable/generative UI), ADR-0039 (untrusted-output validation boundary — the compiler-analog this
  ADR extends), ADR-0040 (Option A `AgentRuntime` port — `AgentEvent`/`artifact` shapes; the panel that
  renders these; A3 approve/deny chips), ADR-0041 (model-calling-action seam), ADR-0043 (thread scope —
  the persistence half of live context), ADR-0016/0017 (real-JWT + repository seam), ADR-0010 (test
  pyramid), ADR-0001 (org_id seam).
- **Scope:** three transcript-level interaction contracts between the agent and the `AssistantPanel`:
  (§1) typed widget results, (§2) agent-initiated structured questions, (§3) live client context. Each
  **extends** the shipped port + untrusted-output boundary; none changes the deputy invariant.

## Context

The panel today renders plain assistant text, tool cards, A3 approve/deny chips, and A4 `artifact`
(composed-view) slots via the I3 renderer (ADR-0040). The battery-mining pass
(`docs/spikes/2026-07-03-agent-native-battery-mining.md` Tier-1 #4/#5, Tier-2 #6) surfaced three
interaction upgrades that make the transcript feel first-class **without** crossing into executable UI:
the agent should be able to answer *"show me over-budget projects"* as a **real table** (not a markdown
blob), **ask the user** a structured clarifying question inline, and **see what the user is looking at**
so *"summarize this"* just works. All three are contract/schema decisions; the shipped `agentAssistant`
panel gains renderers/handlers, not a new runtime.

The governing constraint is ADR-0036 §5 + ADR-0039: any agent output the UI renders is **untrusted** and
must cross a **schema-validation boundary** (the compiler-analog) — and it is **never executable code**.
Upstream's sandboxed Alpine.js generative-UI path is explicitly out (ADR-0036 §5; mining skip-list).

## Decision

Tags: **[PMO]** = a PMO addition/extension.

### 1. Typed widget results — a zod-validated discriminated union, rendered by a registry, validated twice. **[PMO]**

An `AgentAction` may return a **typed widget result**: a zod-validated discriminated union carried in an
`AgentEvent{ type:'artifact' }` payload and rendered by a **renderer registry** in `AssistantPanel`.

- **v1 union (`kind` discriminant):**
  - `DataTableWidget` — `{ kind:'data_table', columns[], rows[], caption? }` → the existing PMO table
    primitive (DESIGN.md tokens).
  - `DataChartWidget` — `{ kind:'data_chart', chartType, series[], … }` → `ChartFrame`.
  - `DataInsightWidget` — `{ kind:'data_insight', label, value, delta?, tone? }` → a KPI tile.
- **The renderer registry** maps `kind → PMO component` (tables / `ChartFrame` / KPI tiles). An unknown
  or unregistered `kind` renders a safe fallback (plain text), **never** anything executable.
- **Validated server-side AND client-side before render.** This **extends the ADR-0039 untrusted-output
  boundary**: the **zod schema is the sole authority** (the compiler-analog for inline answers — exactly
  as `compileCompositionSpec` is for composed views). The edge fn validates the widget payload before
  emitting the `artifact` event; the panel re-validates before rendering. A payload that fails validation
  is **not rendered** (fallback to text), never coerced.
- **Data-vs-results note.** A widget result carries **rendered result data** for an inline answer (unlike
  a persisted `user_views` spec, which stores *queries not results*, ADR-0036 §5 rule 1). This is safe
  and correct because a widget is **ephemeral, addressed only to the caller, produced under the caller's
  RLS-scoped read** — it is the answer to *this* question in *this* transcript, not a saved, re-executed,
  potentially-shared artifact. Anything the user wants to **keep** goes through the `compose_view` /
  `user_views` path (queries-not-results), unchanged.
- **Reaffirmed: NO executable/iframe generative UI.** ADR-0036 §5 stands — the agent emits a
  **validated declarative payload** the trusted registry hydrates into pre-built primitives; it never
  emits code, SQL, or an iframe app. Upstream's sandboxed Alpine.js path is explicitly rejected.

### 2. Ask-user structured questions — a new event payload kind, resolving into the SAME run. **[PMO]**

The agent can ask a structured clarifying question inline ("Which project — Alpha or Beta?"). This is a
new **`AgentEvent` payload kind** on the existing event stream — **not** a new event type:

- **Payload shape:** an `AgentEvent{ type:'status', payload:{ kind:'question', prompt, options:[{id,label}], allowFreeText? } }`
  (carried on `status` so it participates in the run-lifecycle the same way `needs-approval` does — it is
  the same interaction family as A3's approve/deny chips). Rendered as **inline chips** (+ an optional
  free-text box when `allowFreeText`).
- **The answer resolves INTO THE SAME RUN via `control('answer', …)` — an extension of the port's
  `control` command, chosen over `followUp`.** Rationale: `followUp` (`transport.ts`) starts a **new user
  turn** with the full replayed `messages` array — semantically "the user said something new." An answer
  to an agent's question is **not** a new turn; it is the resolution of a pending in-run request, exactly
  like an approve/deny decision (which already rides `control`/the `decision` field, **not** `followUp`).
  Modeling "answer" as a `control` verb keeps the two agent-initiated-await interactions (`needs-approval`
  and `question`) in **one** family, one resolution path, one idempotency story (ADR-0043 §3 journal /
  the A3 trailing-unresolved finder). **The port stays a superset of ADR-0040's shape:** `control`'s
  command set gains `'answer'` (with an answer payload), preserving the "port ⊇ their set" invariant — no
  existing member changes.

### 3. Live context injection — a small structured hint block, treated as UNTRUSTED, grounding only. **[PMO]**

The client sends a small **structured context block per request**, sourced from router + selected-entity
state, so "summarize this" while viewing a project just works:

```
context: { route, entity?: { type, id, label }, selection? }   // extends the existing RunContext (port.ts)
```

- **Untrusted hints — grounding, never authorization.** The server treats the block as **hints the model
  may use to ground its reads**, and **nothing more**: it is **never** an authorization input. RLS is
  unaffected — an injected/forged `entity.id` the caller cannot actually see returns 0 rows under the
  caller's JWT, exactly like any other query. This is ADR-0036 §2's "prompt injection is a nuisance, not
  a breach" applied to context: a lie in the context block can at most make the agent *try* to read
  something RLS then denies. The server **must not** trust `context` to widen access, skip a `can()`
  check, or bypass the deputy client.
- **Pairs with ADR-0043 thread `scope`.** Thread `scope` is the **persisted** entity binding (which
  record this conversation is *about*, survives reload); this live `context` is the **live** binding
  (what the user is looking at *right now*). They are complementary halves of the same idea — persistence
  vs. live — and may agree or differ (a scoped thread viewed from a different route).
- **Agent-driven navigation (agent moves the UI) is DEFERRED** — noted only. Reading the user's context
  is safe (grounding); letting the agent *drive* the router is a larger UX + safety surface for a later
  ADR. v1 is read-the-context-only.

## Feature-flag gating

All three contracts are gated behind the shipped **`agentAssistant`** flag
(`VITE_FEATURES_AGENT_ASSISTANT`, `pmo-portal/src/lib/features.ts`) — same flag as the panel. Widget
renderers, the question-chip handler, and the context provider are inert with the flag off; the panel
without them ships unchanged (ADR-0039 posture).

## Consequences

**Positive**
- Inline answers become **real PMO components** (tables/charts/KPI tiles on DESIGN.md tokens), not
  markdown — feeling first-class — while staying strictly inside the declarative, no-executable-code
  boundary (ADR-0036 §5) via the **same twice-validated** trust boundary as composed views (ADR-0039).
- Ask-user and approve/deny become **one** interaction family (both `control`-resolved, both in-run,
  both sharing the idempotency/journal story) — less surface, one mental model.
- Live context makes "summarize this" work with **zero** authorization risk: RLS is untouched; a forged
  hint is a nuisance, not a breach — provably, by construction.

**Negative / costs**
- A widget-schema registry is net-new trust surface: the zod schemas + the `kind→component` map must be
  maintained in lockstep, and an unregistered `kind` must fail safe (text fallback), never render
  arbitrary payload.
- `control` gains an `'answer'` verb and an answer payload — a small, explicit port extension the
  adapters and the handler's resolution path must both honor.
- Widget results carry rendered result data (not queries) — a deliberate, documented exception to the
  queries-not-results rule, sound only because widgets are ephemeral/caller-scoped/single-transcript;
  reviewers must keep "keep this" flows on the `user_views` (queries-not-results) path.

## Alternatives considered

- **Markdown-table / free-text parsing of model output for tables/charts.** Rejected: fragile,
  unvalidated, no typed contract, no DESIGN.md-native rendering — the exact anti-pattern typed widgets
  replace.
- **iframe mini-apps / sandboxed generative UI (Alpine.js, upstream).** Rejected: executable-artifact
  territory ADR-0036 §5 already declined without a dedicated ADR + real sandbox; the declarative widget
  union delivers the value safely.
- **Modeling "answer" as `followUp` (a new user turn).** Rejected: an answer is the resolution of a
  pending in-run request, not a new turn; `followUp` would fork the transcript semantics and split the
  idempotency story from A3's decision path. `control('answer')` keeps one family.
- **Stuffing live context into the free-text prompt.** Rejected: unparseable, unaudited, and it blurs the
  untrusted-hint boundary — a structured `context` block is explicitly untrusted-and-typed, greppable,
  and never an authorization input.

## Verification (what proves the decision when built)

- **Untrusted-output boundary (unit, Vitest — extends ADR-0039):** a widget payload that fails the zod
  schema is **not rendered** (server rejects before emit; client falls back to text before render); an
  unregistered `kind` renders the text fallback, never executable content. The zod schema is asserted as
  the sole authority (no ad-hoc validity check substitutes for it).
- **Deputy invariant (unit + gate):** a `context.entity.id` the caller cannot see yields 0 rows under the
  caller JWT (a forged/injected hint cannot widen access, skip `can()`, or bypass the deputy client) —
  RLS unaffected, "nuisance not breach" proven.
- **Ask-user resolution (unit):** a `question` event's answer arrives via `control('answer', …)` and
  resolves **the same run** (no new turn); a duplicate/stale answer is idempotent (shares the A3
  trailing-unresolved / ADR-0043 §3 journal story); the port remains a superset of ADR-0040 (no existing
  `control` member changed; `'answer'` added).
- **Curated e2e (one cross-stack AC, ADR-0010):** user asks "show over-budget projects" → a real
  `DataTableWidget` renders inline with correct rows; the agent asks a clarifying question → the user
  taps a chip → the same run continues to the answer.
- **Decision-level:** owner sign-off (recorded here); `docs/README.md` ADR range/Latest updated to
  include 0045.
