# Feature: Agent transcript interaction contracts — typed widgets, ask-user, live context

> **Authority:** ADR-0045 (Accepted, 2026-07-03). This spec **operationalizes** ADR-0045 — the v1
> widget union, the `control('answer')` port extension, and the live-context shape are decided
> there; this document turns those decisions into FR/OBS/NFR/AC with test-layer ownership. Where
> this spec and ADR-0045 could be read to disagree, **ADR-0045 wins** — file an issue, don't ship
> the divergence. Related: ADR-0036 (§2 deputy invariant "nuisance not breach", §5 declarative-
> artifact rule — no executable/generative UI), ADR-0039 (untrusted-output validation boundary —
> the compiler-analog this ADR extends), ADR-0040 (`AgentRuntime` port, A3 approve/deny chips, the
> panel), ADR-0041 (model-calling-action seam), ADR-0043 (thread `scope` — the persistence half of
> live context; this spec's §3 closes its dead-code gap), ADR-0016/0017 (real-JWT + repository
> seam), ADR-0010 (test pyramid), ADR-0001 (org_id seam).
> Glossary: Assistant (deputy invariant), thread scope (ADR-0043 §1).

## Overview

Today the transcript (`AssistantPanel` / `TranscriptItem.tsx`) renders four things: plain assistant
text, tool-call cards, A3 approve/deny chips (`status{needs-approval}`), and one `artifact` kind —
`compose_view` (`ArtifactSlot.tsx`). Everything else the agent might want to hand back — a real
table of over-budget projects, a clarifying question, an answer grounded in what the user is
currently looking at — has no first-class contract: today it would arrive as markdown text (a
table rendered as a wall of pipes) or not at all (the agent cannot ask a structured question; the
handler has no idea what route or entity the user is viewing).

This feature adds three transcript-level contracts, all **extensions** of the shipped port +
event stream — no new runtime, no new event type, no executable/generative UI:

1. **Typed widget results** — a validated discriminated union (`DataTableWidget` /
   `DataChartWidget` / `DataInsightWidget`) carried on the existing `artifact` event, rendered by a
   `kind → PMO component` registry (the same shape `HydratedPrimitive`'s
   `switch (panel.primitive)` already proves for `compose_view`), validated server-side **and**
   client-side (ADR-0039 boundary extension).
2. **Ask-user structured questions** — a new `payload.kind:'question'` on the existing
   `status` event (not a new event type), resolved via a new `control('answer', …)` port verb that
   continues the **same run** (the same family as A3's approve/deny, not a new user turn).
3. **Live context injection** — the client sends `{ route, entity?, selection? }` per request,
   extending `RunContext`; the server treats it as an **untrusted grounding hint only** (never an
   authorization input) and — closing a dead-code gap left by ADR-0043 — the handler now populates
   `agent_threads.scope` from `context.entity` on `createRun`, instead of always writing `null`.

**User value:** *When I ask my agent "show me over-budget projects," I want a real, sortable table
— not a markdown blob. When the agent needs to disambiguate, I want to tap a chip, not retype a
whole sentence. When I ask "summarize this" while looking at a project, I want it to know which
project I mean — without it being able to see anything my role can't.*

This is ADR-0045's full scope. Widget kinds are limited to the v1 union (§1); agent-driven
navigation is explicitly deferred (ADR-0045 §3); no iframe/executable UI (ADR-0036 §5, reaffirmed).

---

## Functional Requirements

### §1 — Typed widget results

**FR-ATC-001 — `WidgetPayload` discriminated union (v1 `kind` set).**
The system shall define a `WidgetPayload` discriminated union on the `kind` field with exactly
three members for v1: `DataTableWidget { kind:'data_table', columns: {key,label}[], rows:
Record<string,unknown>[], caption?: string }`, `DataChartWidget { kind:'data_chart', chartType:
'bar'|'line'|'donut', series: {label,value}[], caption?: string }`, `DataInsightWidget {
kind:'data_insight', label: string, value: string|number, delta?: {dir:'up'|'down'|'neutral',
text:string}, tone?: 'blue'|'violet'|'amber'|'red'|'green' }`. (`chartType`/`tone` enums mirror the
existing `StatusBarChart`/`KPITile` prop unions so the registry needs no new visual vocabulary.)

**FR-ATC-002 — A widget-returning `AgentAction` emits it as an `artifact` event.**
When an `AgentAction`'s `run()` produces a `WidgetPayload` result, the handler shall emit
`AgentEvent{ type:'artifact', payload: { kind: 'widget', widget: WidgetPayload } }` — nested one
level under `kind:'widget'` so the existing `artifact.kind` switch (`TranscriptItem.tsx`, currently
`'compose_view'` only) gains a second case without changing `compose_view`'s payload shape.

**FR-ATC-003 — Server-side zod validation before emit.**
Before emitting an `artifact{kind:'widget'}` event, the handler shall validate the `WidgetPayload`
against a zod discriminated-union schema (`z.discriminatedUnion('kind', [...])`, ADR-0045 §1); a
payload that fails validation shall **not** be emitted as an artifact — the handler falls back to
emitting the result as plain `assistant` text (never coerced, never partially rendered).

**FR-ATC-004 — Client-side zod re-validation before render.**
Before `TranscriptItem` renders an `artifact{kind:'widget'}` payload, the panel shall re-validate it
against the **same** zod schema (imported from the shared module, not re-implemented) — the
untrusted-output boundary is enforced twice, exactly as `compileCompositionSpec` is for
`compose_view` (ADR-0039 §3 extended, ADR-0045 §1). A payload that fails client-side validation
shall render the text fallback (FR-ATC-006), never throw and never partially render.

**FR-ATC-005 — Renderer registry: `kind → PMO component`.**
The system shall provide a renderer registry mapping each `WidgetPayload.kind` to an existing PMO
primitive: `data_table → DataTable` (`src/components/ui/DataTable.tsx`), `data_chart →
StatusBarChart` (`src/components/dashboard/StatusBarChart.tsx`) or an equivalent `ChartFrame`-
wrapped chart, `data_insight → KPITile` (`src/components/ui/KPITile.tsx`) — the same
`switch`-over-registry shape `HydratedPrimitive.tsx` already uses for `panel.primitive`, so no new
architectural pattern is introduced.

**FR-ATC-006 — Unknown/unregistered `kind` renders a safe text fallback.**
Where an `artifact{kind:'widget'}` payload's `widget.kind` is not a member of the v1 union (either
because it failed FR-ATC-003/004 validation, or because it is a value the registry has no entry
for), the system shall render a plain-text fallback (mirroring the panel's existing `assistant`
text treatment) and shall **never** render arbitrary payload content as HTML, never `eval`, and
never construct an iframe or any executable surface (ADR-0036 §5, reaffirmed).

**FR-ATC-007 — Widgets carry rendered result data, by documented exception.**
Unlike a persisted `user_views` spec (which stores a *query*, not results), a `WidgetPayload`
carries the **rendered rows/series/value** for this one answer. This is sound only because a
widget is ephemeral (not persisted as its own re-executable entity — though the *event* row that
carries it persists, per ADR-0043's existing `agent_events.payload jsonb`), addressed only to the
caller, and produced under the caller's RLS-scoped read (ADR-0045 §1 "Data-vs-results note"). No
code path may promote a widget's rows directly into a `user_views` row — "keep this" flows through
`compose_view` (queries-not-results), unchanged.

### §2 — Ask-user structured questions

**FR-ATC-008 — `QuestionPayload` shape on the existing `status` event.**
The system shall define `QuestionPayload { kind:'question', prompt: string, options: {id:
string, label: string}[], allowFreeText?: boolean }`, carried as `AgentEvent{ type:'status',
payload: QuestionPayload }` — a new payload `kind` on the **existing** `status` event type
(ADR-0045 §2), not a new `AgentEventType`. `AgentEventType` (`port.ts`) is unchanged.

**FR-ATC-009 — Question renders as inline chips (+ optional free-text).**
When `TranscriptItem` renders a `status{payload.kind:'question'}` event, the panel shall render
`options` as tappable chips (one per `{id,label}`) and, when `allowFreeText` is true, an additional
text input — extending the same rendering family as the A3 `ApprovalChip` (`status{needs-approval}`
already renders as chips today).

**FR-ATC-010 — `control` gains an `'answer'` verb; port stays a superset.**
The system shall extend `AgentRuntime.control`'s command union from `'pause'|'resume'|'cancel'|
'approve'|'reject'` to additionally accept `'answer'`, carrying an answer payload (`{ optionId?:
string, freeText?: string }`). This is a pure **addition** to the existing member set — no existing
`control` command's signature or behavior changes (ADR-0040's "port ⊇ their set" invariant
preserved).

**FR-ATC-011 — An answer resolves INTO the same run, never a new turn.**
When the user answers a pending question (taps a chip or submits free text), the client shall call
`runtime.control(runId, 'answer', { optionId?, freeText? })` — **not** `followUp` — so the answer
resolves the pending in-run request without starting a new user turn (ADR-0045 §2 rationale: an
answer is the resolution of a pending await, exactly like an approve/deny decision, not new user
speech). The handler resumes the **same** run via a re-POST carrying the answer, mirroring the A3
`decision` re-POST shape (`AgentChatRequest.decision` gains a sibling `answer` field, or the
existing `decision` field's verdict union is extended — the eng-plan picks the exact wire shape;
either way it is NOT `followUp`'s full-`messages`-replay semantics).

**FR-ATC-012 — Question and approve/deny share one resolution family.**
The handler shall route a `question` resolution through the same positional-idempotency /
trailing-unresolved-request finder pattern the A3 decision branch already uses
(`findTrailingConfirmToolUse`, generalized to also find a trailing unresolved `question` status
event) — one family, one resolution path, one idempotency story (ADR-0043 §3 journal / the A3
trailing-unresolved finder), per ADR-0045 §2.

**FR-ATC-013 — A stale/duplicate answer is idempotent.**
Where the replayed transcript already contains a resolution for the trailing question (the same
positional check FR-AGP find-trailing uses for A3), a repeated/duplicate `control('answer', …)`
call shall be treated as a no-op — the handler resumes the run without re-asking or double-
processing, mirroring AC-AW-003's stale-decision handling.

### §3 — Live context injection

**FR-ATC-014 — `RunContext` extends with `entity` and `selection`.**
The system shall extend `RunContext` (`port.ts`) from `{ route?, entityId? }` to `{ route?,
entity?: { type: string, id: string, label: string }, selection?: unknown }` — a superset; the
existing `entityId?: string` field is retained unchanged for backward compatibility with any
in-flight caller (deprecated in favor of `entity.id`, not removed in this issue).

**FR-ATC-015 — The client sends `context` on every request.**
Where the panel has a resolvable route/entity/selection (from router state + any selected-entity
context the host page exposes), the client shall include it as `AgentChatRequest.context` on both
`createRun` and `followUp` calls — the existing `context?: RunContext` field on
`AgentChatRequest` (`transport.ts`) already carries this; no new wire field is added.

**FR-ATC-016 — Context is grounding-only; never an authorization input.**
The handler shall treat `req.context` strictly as a hint the model **may** use to ground its tool
calls (e.g. pre-filling a `query_entity` filter) — it shall **never** use `context` to grant or
widen access, skip a `can()` check, bypass the deputy client, or select a different Supabase client
than the caller-JWT-scoped one. A forged/injected `context.entity.id` the caller cannot actually
see, if used to ground a `query_entity` read, returns **zero rows** under the caller's JWT — the
same outcome as any other out-of-scope query (ADR-0036 §2 "nuisance not breach" applied to context,
ADR-0045 §3).

**FR-ATC-017 — `createRun` populates `agent_threads.scope` from `context.entity`.**
When a new thread is created (`createThreadAndRun`, `persistence.ts`), the system shall populate
`agent_threads.scope` from `req.context.entity` (`{type, id, label}`) when present, instead of
`null` — closing the dead-code gap left by ADR-0043 (`createThreadAndRun` already accepts a
`scope` parameter and `handler.ts` already passes `req.context ?? null`, but `RunContext` had no
`entity` field for a caller to populate; FR-ATC-014 supplies it). This satisfies FR-AGP-002 (scope
is a UI grouping/continuity hint, never an authorization input — unchanged by this issue).

**FR-ATC-018 — Live context and persisted thread scope are independent and may diverge.**
The system shall not reconcile a request's live `context` against the thread's persisted `scope`
on every turn — they are complementary (persisted vs. live, ADR-0045 §3) and may legitimately
differ (e.g. a scoped thread reopened from a different route). Only thread **creation**
(FR-ATC-017) writes `scope`; a follow-up's `context` on an existing thread does not overwrite it.

**FR-ATC-019 — Agent-driven navigation is out of scope (deferred).**
The system shall not let the agent drive the router or otherwise change what the user is viewing
based on `context` or any other signal — reading context is the only capability this issue ships;
writing/driving navigation is explicitly deferred to a future ADR (ADR-0045 §3).

### Feature-flag gating

**FR-ATC-020 — All three contracts gate behind `agentAssistant`.**
The system shall gate widget rendering, the question-chip handler/control-verb, and the context
provider behind the existing `agentAssistant` flag (`VITE_FEATURES_AGENT_ASSISTANT`,
`src/lib/features.ts`) — the same flag gating the panel itself (ADR-0045 "Feature-flag gating").
With the flag off, none of the three code paths execute; the panel ships unchanged.

---

## Observed / legacy behavior to preserve (OBS)

**OBS-ATC-001 — `compose_view`'s `artifact{kind:'compose_view'}` payload shape is unchanged.**
FR-ATC-002's `artifact{kind:'widget'}` is a **new sibling** case in the same switch
(`TranscriptItem.tsx`); `ArtifactSlot`'s existing props/behavior are untouched.

**OBS-ATC-002 — A3 approve/deny (`status{needs-approval}` + `control('approve'|'reject')`) is
unchanged.** FR-ATC-008..013's question flow is a **parallel** interaction on the same event type
and the same `control` verb family — it does not alter `NeedsApprovalPayload`, `ApprovalChip`, or
the existing decision re-POST protocol.

**OBS-ATC-003 — `AgentEventType` is unchanged.** No new member is added to `'user'|'assistant'|
'tool'|'artifact'|'status'|'system'` (`port.ts`) — both widgets and questions ride existing event
types via new payload `kind` discriminants, per ADR-0045 §1/§2.

**OBS-ATC-004 — `AgentChatRequest.messages` full-replay (D8) is unchanged.** `followUp` still
replays the full `messages` array; the answer resolution (FR-ATC-011) is explicitly **not**
`followUp` — it rides the `control`/decision re-POST family instead, which is the existing stateless
pattern A3 already uses.

**OBS-ATC-005 — `dispatchAction`/`dispatchActionForced` remain the single write-dispatch sites
(NFR-AW-SEC-001).** No widget-emitting action is a write in this issue — `query_entity`-shaped
reads may return `WidgetPayload` results, but nothing here adds a new write path or bypasses the
existing dispatch gate.

---

## Non-Functional Requirements

### Security (OWASP / STRIDE)

- **NFR-ATC-SEC-001 — The zod schema is the sole validation authority (no ad-hoc substitute).**
  Neither the server emit path (FR-ATC-003) nor the client render path (FR-ATC-004) may substitute
  a hand-rolled `typeof`/shape check for the zod discriminated-union parse — mirrors ADR-0039 §3's
  "the compiler — not the prompt — is the enforcement authority."
- **NFR-ATC-SEC-002 — Unregistered/invalid `kind` never renders raw payload.** The text fallback
  (FR-ATC-006) renders only a fixed, safe string (or the model's own already-rendered `assistant`
  text, never the *unvalidated* payload's arbitrary fields) — no `dangerouslySetInnerHTML`, no
  `eval`, no iframe (ADR-0036 §5, D-A2-8 precedent already binding on the panel).
- **NFR-ATC-SEC-003 — `context` cannot widen access (deputy invariant extension).** No code path
  reads `req.context` to select a different Supabase client, skip `can()`, or bypass
  `dispatchAction`/`dispatchActionForced`. Verified by a gate test: a forged `context.entity.id`
  fed into a grounded `query_entity` call returns the same zero-row result under RLS as an
  unforged out-of-scope id.
- **NFR-ATC-SEC-004 — `control('answer')` is deputy-scoped like `control('approve'|'reject')`.**
  The answer-resolution re-POST re-derives org/role from `profiles` under the caller's JWT before
  resuming the run — no new bypass of the existing re-auth the A3 decision branch performs.
- **NFR-ATC-SEC-005 — No prompt/row/widget content in logs.** Persistence and handler logging on
  the widget/question/context paths follow the existing discipline (NFR-AR-SEC-005/NFR-AGP-SEC-005)
  — server logs on validation failure carry the `kind`/error code only, never row data or the
  question `prompt` text.

### Performance

- **NFR-ATC-PERF-001 — Widget validation is synchronous and cheap.** The zod parse of a
  `WidgetPayload` (bounded by `AGENT_READ_ROW_CAP` = 50 rows, D6) adds no network round-trip and is
  bounded, not O(n²), in row count.

### Accessibility (WCAG 2.1 AA)

- **NFR-ATC-A11Y-001 — Widget primitives inherit their existing a11y contracts.** `DataTable`,
  `StatusBarChart`/`ChartFrame`, and `KPITile` already carry table semantics / accessible names /
  focus styles (shipped components) — the registry (FR-ATC-005) does not bypass or re-implement
  these; it hydrates the existing components with widget data exactly as `HydratedPrimitive` does
  for `compose_view` panels.
- **NFR-ATC-A11Y-002 — Question chips are keyboard-operable with a live-region announcement.**
  Mirrors `ApprovalChip`'s existing `role="group"` `aria-live="assertive"` pattern
  (NFR-AW-A11Y-001/002/003) — each option is a real `<button>`, the free-text input (when present)
  has a visible label, and the question prompt is announced when it appears.
- **NFR-ATC-A11Y-003 — Text fallback is a real accessible text node**, not an empty/silent render —
  a screen-reader user is never left with a gap where a widget failed validation.

---

## Acceptance Criteria

> Layer per ADR-0010: **Unit** (Vitest, SDK+Supabase mocked) for the zod boundary (server + client),
> the renderer registry, the `control('answer')` resolution logic, and the deputy-invariant context
> gate. **E2E** (Playwright, ONE curated cross-stack journey per ADR-0045 Verification) for the
> real inline-table + question-continues-the-run flow. No pgTAP layer is needed for this issue —
> §3's `agent_threads.scope` write reuses the already-tested RLS/tenancy contracts from
> `agent-persistence.spec.md` (AC-AGP-001..008); this spec does not re-prove RLS.

### Typed widget results

**AC-ATC-001 — A valid `DataTableWidget` payload passes server-side zod validation and is emitted
as `artifact{kind:'widget'}`. [Unit]**
Given an `AgentAction`'s `run()` returns a well-formed `DataTableWidget` (`columns`, `rows` present,
`kind:'data_table'`),
When the handler processes the tool result,
Then it emits `AgentEvent{type:'artifact', payload:{kind:'widget', widget: <the DataTableWidget>}}`
and does **not** emit a plain-text fallback.

**AC-ATC-002 — A payload that fails the zod schema is never emitted as an artifact. [Unit]**
Given an `AgentAction`'s `run()` returns a malformed widget payload (e.g. `kind:'data_table'` but
`rows` is a string, or `kind` is absent),
When the handler processes the tool result,
Then no `artifact{kind:'widget'}` event is emitted; the handler falls back to an `assistant` text
event instead.

**AC-ATC-003 — Client re-validates before render; a payload that fails client-side validation
renders the text fallback. [Unit]**
Given a (constructed, out-of-band) `artifact{kind:'widget'}` event whose `widget` payload fails the
client's zod re-parse,
When `TranscriptItem` renders that transcript entry,
Then it renders the text fallback (FR-ATC-006) — never the `DataTable`/chart/KPI component, never
a crash.

**AC-ATC-004 — An unregistered `kind` renders the text fallback, never executable content. [Unit]**
Given an `artifact{kind:'widget'}` payload whose `widget.kind` is a value outside the v1 union
(e.g. `'iframe_app'` or `'raw_html'`),
When `TranscriptItem` renders it,
Then the text fallback renders and no `dangerouslySetInnerHTML`/`eval`/iframe is invoked (assert
via a DOM query: no `<iframe>`, no element with unescaped raw payload content).

**AC-ATC-005 — `data_table` renders via the registry as a real `DataTable`. [Unit]**
Given a valid `DataTableWidget{columns:[{key:'name',label:'Project'}], rows:[{name:'Alpha'}]}`,
When rendered,
Then a `DataTable` component instance renders with one row showing "Alpha" — not a markdown/pre
block.

**AC-ATC-006 — `data_insight` renders via the registry as a real `KPITile`. [Unit]**
Given a valid `DataInsightWidget{label:'Over-budget projects', value: 3}`,
When rendered,
Then a `KPITile` instance renders with that label and value.

### Ask-user structured questions

**AC-ATC-007 — A `question` payload renders as chips, not free text. [Unit]**
Given an `AgentEvent{type:'status', payload:{kind:'question', prompt:'Which project?',
options:[{id:'a',label:'Alpha'},{id:'b',label:'Beta'}]}}`,
When `TranscriptItem` renders it,
Then two chip buttons ("Alpha", "Beta") render, each independently clickable.

**AC-ATC-008 — Tapping a chip calls `control(runId, 'answer', …)`, not `followUp`. [Unit]**
Given a rendered question with a pending chip,
When the user clicks the "Alpha" chip,
Then `runtime.control` is called with `(runId, 'answer', {optionId:'a'})` and `runtime.followUp` is
**not** called.

**AC-ATC-009 — The answer resolves the SAME run (no new run is created). [Unit]**
Given an active run awaiting a question answer,
When the answer is submitted,
Then the handler's response stream continues under the **same** `runId` — no `createRun` call
occurs, mirroring the A3 approve/deny continuation.

**AC-ATC-010 — A duplicate/stale answer is idempotent (no-op, run continues normally). [Unit]**
Given the replayed transcript already contains a resolution for the trailing question (positional
check, mirrors `findTrailingConfirmToolUse`),
When a second `control('answer', …)` arrives for the same pending question,
Then the handler treats it as a no-op (does not re-process or double-resolve) and the run continues
normally — mirrors AC-AW-003.

**AC-ATC-011 — `control`'s existing verbs are unchanged (port superset proof). [Unit]**
Given the `AgentRuntime.control` type signature,
When inspected,
Then `'pause'|'resume'|'cancel'|'approve'|'reject'` are all still present and unchanged, with
`'answer'` added as a new member — a type-level/contract test proves no existing member's shape
changed.

### Live context injection

**AC-ATC-012 — A well-formed `context.entity` grounds a `query_entity` read to that entity when the
user asks about "this." [Unit]**
Given `req.context = {route:'/projects/123', entity:{type:'project', id:'123',
label:'Alpha'}}` and a user message "summarize this,"
When the handler builds the model's context/grounding,
Then the injected context makes `entity.id:'123'` available to the model as a grounding hint (e.g.
present in the system/context message) — asserted by inspecting the constructed model messages, not
by asserting any authorization change.

**AC-ATC-013 — A forged `context.entity.id` the caller cannot see yields zero rows, not an error,
not elevated access. [Unit]**
Given `req.context.entity.id` is set to an id belonging to a different org (the caller's RLS-scoped
mock Supabase client returns `[]` for that id, exactly as it would for real RLS),
When a `query_entity` call is grounded by that forged id,
Then the read returns `{rowCount: 0, rows: []}` — the same shape as any legitimate empty result —
and no code path selects a `service_role` client or bypasses `can()`/`dispatchAction`.

**AC-ATC-014 — `createRun` with `context.entity` populates `agent_threads.scope`. [Unit]**
Given a fresh `createRun` request (`req.runId` absent) with `context: {entity:{type:'project',
id:'123', label:'Alpha'}}`,
When `createThreadAndRun` is invoked,
Then the inserted `agent_threads` row's `scope` equals `{type:'project', id:'123', label:'Alpha'}`
— not `null`.

**AC-ATC-015 — `createRun` with no `context.entity` still writes `scope: null` (unchanged
default). [Unit]**
Given a fresh `createRun` request with no `context` (or `context` present but no `entity`),
When `createThreadAndRun` is invoked,
Then the inserted `agent_threads` row's `scope` is `null` — OBS-preserving the existing default
for context-free conversations.

**AC-ATC-016 — A follow-up's `context` does not overwrite an existing thread's `scope`. [Unit]**
Given an existing thread whose `scope` was set on creation,
When a follow-up request on the same `runId` carries a **different** `context.entity`,
Then no code path in the follow-up path updates `agent_threads.scope` (FR-ATC-018) — asserted by
confirming no `update agent_threads set scope = …` call occurs on the follow-up branch.

### Cross-stack — the curated e2e (ADR-0045 Verification, ONE journey)

**AC-ATC-017 — "Show me over-budget projects" renders a real table inline; a clarifying question
chip continues the same run. [E2E]**
Given a signed-in user opens the assistant panel and asks "show me over-budget projects,"
When the agent's tool call returns a `DataTableWidget` result,
Then a real, sortable `DataTable` renders inline in the transcript (not a markdown block) — and
separately in the same journey, when the agent asks a clarifying question, the user taps an
option chip and the **same run** continues to produce a final answer (no new conversation/run is
started, no reload required).

---

## Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-ATC-001 | Unit | `AC-ATC-001 valid widget passes zod, emits artifact` (`supabase/functions/agent-chat/handler.widgets.test.ts`) |
| AC-ATC-002 | Unit | `AC-ATC-002 malformed widget never emitted, falls back to text` |
| AC-ATC-003 | Unit | `AC-ATC-003 client re-validates, renders fallback on failure` (`pmo-portal/src/components/panel/TranscriptItem.widgets.test.tsx`) |
| AC-ATC-004 | Unit | `AC-ATC-004 unregistered kind renders text fallback, no iframe/eval` |
| AC-ATC-005 | Unit | `AC-ATC-005 data_table renders via registry as DataTable` |
| AC-ATC-006 | Unit | `AC-ATC-006 data_insight renders via registry as KPITile` |
| AC-ATC-007 | Unit | `AC-ATC-007 question payload renders as chips` (`pmo-portal/src/components/panel/TranscriptItem.question.test.tsx`) |
| AC-ATC-008 | Unit | `AC-ATC-008 tapping chip calls control answer not followUp` |
| AC-ATC-009 | Unit | `AC-ATC-009 answer resolves same run, no new createRun` (`pmo-portal/src/hooks/useAssistantPanel.question.test.ts`) |
| AC-ATC-010 | Unit | `AC-ATC-010 duplicate answer is idempotent no-op` (`supabase/functions/agent-chat/handler.question.test.ts`) |
| AC-ATC-011 | Unit | `AC-ATC-011 control verb set is a superset, no existing member changed` (`pmo-portal/src/lib/agent/runtime/port.test.ts`) |
| AC-ATC-012 | Unit | `AC-ATC-012 context.entity grounds query_entity read` (`supabase/functions/agent-chat/handler.context.test.ts`) |
| AC-ATC-013 | Unit | `AC-ATC-013 forged context entity id yields zero rows not elevated access` |
| AC-ATC-014 | Unit | `AC-ATC-014 createRun with context.entity populates thread scope` (`supabase/functions/agent-chat/persistence.scope.test.ts`) |
| AC-ATC-015 | Unit | `AC-ATC-015 createRun with no entity writes scope null` |
| AC-ATC-016 | Unit | `AC-ATC-016 follow-up context does not overwrite existing scope` |
| AC-ATC-017 | E2E | `AC-ATC-017 over-budget table renders inline, question chip continues run` (`pmo-portal/e2e/AC-ATC-017-widget-question-context.spec.ts`) |

---

## SoD & Security (OWASP / STRIDE)

**Spoofing / tenancy (STRIDE-S, OWASP A01 broken access control).** `context` is explicitly
**never** an authorization input (FR-ATC-016) — the caller-JWT-scoped Supabase client and the
existing `can()`/`dispatchAction` gates are unchanged by this issue. A forged `context.entity.id`
degrades to a normal zero-row RLS outcome, never elevated access (AC-ATC-013), proving ADR-0036
§2's "nuisance not breach" applied to context.

**Tampering (STRIDE-T, OWASP A08 software/data integrity).** Both new render paths (widgets,
questions) are **read-only rendering** of model-controlled data — neither adds a write path.
Widget payloads are validated twice (server+client) against the sole-authority zod schema
(NFR-ATC-SEC-001); an invalid or unregistered payload can only ever produce a safe text fallback,
never arbitrary DOM/script content (NFR-ATC-SEC-002) — the declarative-artifact rule (ADR-0036 §5)
holds by construction, not by convention.

**Elevation / deputy invariant (STRIDE-E, ADR-0036 §2).** No code path added by this issue
constructs or uses a `service_role` client; the answer-resolution re-POST re-derives org/role under
the caller's JWT before resuming (NFR-ATC-SEC-004), identical in shape to the existing A3 decision
re-auth.

**Repudiation (STRIDE-R).** Widget and question events are persisted through the existing
`agent_events` append-only journal (ADR-0043, unchanged) — they are ordinary `artifact`/`status`
rows with a `payload`, so the existing audit trail covers them with zero schema changes.

**Injection (OWASP A03).** No new user-controlled string is interpolated into SQL or HTML. The
widget renderer registry hydrates fixed PMO components with typed props (columns/rows/series/value)
— never a raw HTML string, never a template-interpolated component name.

**Depth note (model-tiering).** This change is validation-boundary-heavy (a new zod trust surface,
a new `control` verb, a context-grounding path adjacent to `query_entity`) but touches **no** RLS
policy and **no** new table — the security-auditor should focus depth on the zod
schema-is-sole-authority proof (NFR-ATC-SEC-001/002) and the context-cannot-widen-access gate
(NFR-ATC-SEC-003/AC-ATC-013), a lighter pass than a schema/RLS-bearing issue.

---

## Error Handling

| Error condition | Surface / code | User message |
|---|---|---|
| Widget payload fails server-side zod validation | Handler falls back to `assistant` text (no `artifact` event) | The agent's own text answer (no separate error surfaced — the fallback text is the answer, per FR-ATC-003). |
| Widget payload fails client-side zod re-validation | `TranscriptItem` text fallback | A plain-text render of nothing alarming; no error banner (defense-in-depth catch, not expected to fire if server validation is correct). |
| Unregistered `widget.kind` | Text fallback (FR-ATC-006) | Same as above — no crash, no raw payload dump. |
| Duplicate/stale `control('answer', …)` | No-op continuation | No error; the run simply continues (mirrors AC-AW-003 stale-decision UX). |
| Forged/dangling `context.entity.id` | RLS zero-row read | No error — the agent's answer reflects "no data found," identical to any legitimate empty result. |
| `context` present but `entity` absent | `agent_threads.scope` stays `null` | No user-facing message; behaves exactly like today's context-free conversation. |

---

## Implementation TODO

### Shared (widget schema + registry)

- [ ] Add `zod` as a **direct** dependency of `pmo-portal` (see Open Questions — currently only a
      transitive dependency via `package-lock.json`; ADR-0045 mandates zod for this contract, so
      this issue is what promotes it to `dependencies`).
- [ ] `pmo-portal/src/lib/agent/widgets/schema.ts`: `WidgetPayload` zod discriminated union
      (FR-ATC-001), exported for both server (Deno-importable, relative path, no `.ts` extension
      per the existing `agent-chat` import convention) and client use — one schema module, two
      importers, mirroring `COMPOSITION_SPEC_SCHEMA`'s reuse pattern.
- [ ] `pmo-portal/src/components/panel/widgets/registry.ts`: `kind → component` map (FR-ATC-005),
      shaped like `src/lib/viewspec/registry.ts` / consumed like `HydratedPrimitive.tsx`'s switch.
- [ ] `WidgetSlot.tsx` (or extend `ArtifactSlot.tsx` with a second branch): client re-validation
      (FR-ATC-004) + registry dispatch (FR-ATC-005) + text fallback (FR-ATC-006).

### Backend (edge-fn: widgets, question, context)

- [ ] `handler.ts`: on a tool result shaped as a `WidgetPayload`, validate (FR-ATC-003) and emit
      `artifact{kind:'widget', widget}` or fall back to `assistant` text.
- [ ] `handler.ts`/`actions.ts`: add (or extend an existing read action) to optionally return a
      `WidgetPayload`-shaped result for table/chart/insight-shaped queries — eng-plan picks
      whether this is a `query_entity` result-shaping step or a new action.
- [ ] `port.ts`: extend `control`'s command union with `'answer'` (FR-ATC-010); extend
      `RunContext` with `entity`/`selection` (FR-ATC-014).
- [ ] `transport.ts`: extend the decision/answer wire shape per FR-ATC-011 (eng-plan picks exact
      field name — new `answer` field alongside `decision`, or a widened `decision.verdict` union;
      either satisfies "not `followUp`").
- [ ] `handler.ts`: generalize `findTrailingConfirmToolUse`-style lookup to also find a trailing
      unresolved `question` status event (FR-ATC-012); route `control('answer')` re-POSTs through
      it with the same idempotency check (FR-ATC-013/AC-ATC-010).
- [ ] `persistence.ts`: `createThreadAndRun`'s existing `scope` parameter now receives
      `req.context?.entity` (not `req.context`) — a one-line narrowing at the `handler.ts` call
      site (FR-ATC-017/AC-ATC-014/015); no change to `createThreadAndRun` itself.
- [ ] Grounding: thread `context` into the system/context message the model sees (AC-ATC-012) —
      read-only, no `can()`/client-selection change (NFR-ATC-SEC-003).

### Frontend (panel UX)

- [ ] `QuestionChips.tsx` (mirrors `ApprovalChip.tsx` conventions): renders `options` as buttons +
      optional free-text input (FR-ATC-009, NFR-ATC-A11Y-002).
- [ ] `TranscriptItem.tsx`: add the `status{payload.kind:'question'}` case (alongside the existing
      `needs-approval` case) and the `artifact{kind:'widget'}` case (alongside `compose_view`).
- [ ] `useAssistantPanel.ts`: add an `answerQuestion(optionId?, freeText?)` action mirroring
      `approve`/`deny`'s call-`control`-then-resubscribe shape (FR-ATC-011).
- [ ] Context provider: source `route` from `react-router-dom`'s location, `entity`/`selection`
      from whatever selected-entity state the host page already exposes (eng-plan surveys current
      pages for an existing "selected entity" seam before inventing one); wire into
      `AgentChatRequest.context` on both `createRun` and `followUp` call sites (FR-ATC-015).
- [ ] All of the above gated behind `isFeatureEnabled('agentAssistant')` (FR-ATC-020).

### E2E / gates

- [ ] `e2e/AC-ATC-017-widget-question-context.spec.ts`: ask → real table renders inline; agent asks
      a clarifying question → tap chip → same run continues to a final answer.
- [ ] Full `npm run verify` before PR; render the panel (a widget table, a chart, a KPI tile, a
      question with chips) before promote — MEMORY durable rule
      (rendered-review-catches-what-tests-pass).

---

## Out of Scope (deferred)

- **Agent-driven navigation** (the agent moves the router). ADR-0045 §3: explicitly deferred to a
  later ADR — this issue is read-the-context-only (FR-ATC-019).
- **Widget kinds beyond the v1 union** (e.g. maps, timelines, forms). ADR-0045 §1: "v1 union" is a
  closed set for this issue; extending it is a future issue that adds a registry entry + schema
  member, not an architecture change.
- **Persisting/promoting a widget's rendered rows into a `user_views` row.** FR-ATC-007: "keep
  this" stays on the `compose_view` (queries-not-results) path, unchanged.
- **`selection` payload's concrete shape.** `RunContext.selection?: unknown` (FR-ATC-014) is typed
  as an escape hatch for a future selection model (e.g. a table's selected rows); this issue does
  not define or populate it — `route`/`entity` are the only populated fields in v1.
- **Batched/multi-question flows** (the agent asks several questions before continuing). This
  issue's `question` payload is one prompt + option set per event, matching A3's one-pending-write-
  at-a-time precedent (AW-OD-003 is still open/deferred there too).
- **Reconciling live `context` against persisted thread `scope` on every turn.** FR-ATC-018: only
  thread creation writes `scope`; no reconciliation/overwrite logic is built here.

---

## Contradictions / conflicts flagged against existing code & locked decisions

None found against ADR-0045 itself (Accepted, owner-directed 2026-07-03, the controlling
authority for this spec). Two **pre-existing** facts worth flagging explicitly for the eng-plan
(neither is a contradiction of the ADR — both are exactly what the ADR calls out as needing to be
built):

1. **`zod` is not yet a direct `pmo-portal` dependency.** It is present only transitively (pulled
   in by another package, per `package-lock.json`). ADR-0045 §1 mandates zod as "the sole
   authority" for the widget schema — this spec's Implementation TODO calls out promoting it to
   `dependencies` explicitly so the eng-plan doesn't discover it as a surprise mid-build. This is
   consistent with ADR-0039's precedent of hand-rolled validators (`compileCompositionSpec`,
   `ValidationError`) elsewhere in the agent stack — zod is scoped to *this* new contract only, not
   a repo-wide validation-library migration.
2. **`RunContext.entityId?: string` already exists** (pre-ADR-0045) and is retained, not replaced,
   by `entity?: {type,id,label}` (FR-ATC-014) — the eng-plan should confirm no current caller
   populates `entityId` today (a quick grep) before deciding whether to also deprecate/migrate it
   in this issue or leave it dormant.

## Open Questions

Two mechanical choices are left to the eng-plan (not requiring owner adjudication, per the
Companies/`user_views`/`agent-persistence` precedent of letting the plan pick file names/exact
wire shapes):

1. **Exact wire shape for the answer re-POST** (FR-ATC-011/§3 Implementation TODO) — a new
   `AgentChatRequest.answer` field alongside `decision`, or a widened `decision.verdict` union
   (`'approve'|'reject'|'answer'` with an `answerPayload`). Either satisfies "resolves into the
   same run via `control`, not `followUp`"; the eng-plan picks based on which reads cleaner against
   the existing `findTrailingConfirmToolUse` generalization (FR-ATC-012).
2. **Which existing action(s) gain widget-shaped results** (FR-ATC-002's Implementation TODO item)
   — whether `query_entity`'s existing result is reshaped into a `DataTableWidget` when the caller
   requests a "table" framing, or a new thin wrapper action is added. Not gated by any ADR
   decision; the eng-plan picks the smaller diff.

One question **is** flagged for the Director/owner, since it is a real (if small) architectural
choice ADR-0045 does not pin down:

3. **Should `zod` be promoted to a direct dependency in *this* issue, or in a small prerequisite
   issue?** (Contradictions §1 above.) Recommendation: do it in this issue — it is a one-line
   `package.json` change gated entirely behind the widget-schema module this issue already builds,
   and splitting it into a separate issue would just add PR-sequencing overhead for no isolation
   benefit (nothing else in the repo depends on zod's absence).
