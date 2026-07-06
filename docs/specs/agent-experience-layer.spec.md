# SDD: Agent Experience Layer — make the shipped batteries actually surface

**Feature:** The deployed `AssistantPanel` (live at pmo-bfb.pages.dev, deepseek-v4-flash via OpenRouter)
behaves like a **plain chatbot**: it answers in raw prose (markdown `**bold**` / `| pipe tables |` render
as literal characters), never emits the typed table/chart widgets that ARE built, and asks clarifying
questions in prose instead of the structured ask-user chips that ARE built. The batteries' **plumbing
shipped** (widgets, ask-user, automations, notifications, live context — all wired and tool-registered);
the **experience layer did not**. This spec closes that gap along five axes: (1) safe markdown rendering in
the transcript, (2) a layered prompt/skills architecture that STEERS the model to use its affordances,
(3) battery-surfacing behavior ACs proving the built batteries fire from natural phrasing, (4)
context-awareness completeness, and (5) an adjacent (separately-acceptable) drawer-UX section.

**Spec ID prefix:** AXP (`FR-AXP-###` functional · `NFR-AXP-###` non-functional · `AC-AXP-###` acceptance)
**ADR refs:** ADR-0045 (transcript contracts — typed widgets, ask-user, live context; the plumbing this
spec surfaces), ADR-0039 (untrusted-output validation boundary — the "validate-before-render" rule this
spec extends to markdown), ADR-0036 (§2 deputy invariant "nuisance not breach"; §5 declarative-artifact
rule — **note: §5 rejects sandboxed *executable* generative UI; it does NOT ban rendering safe prose
markdown**), ADR-0040 (the `AgentRuntime` port + panel), ADR-0044 (automations/notifications),
ADR-0010 (test pyramid), ADR-0016/0017 (real-JWT + repository seam), ADR-0001 (org_id seam).
**Layer ownership (ADR-0010):** markdown renderer + prompt-builder shape → Vitest/RTL (unit); prompt
*content*/steering + model tool-selection → behavior ACs verified by curated e2e + (recommended) an eval
harness; RLS/tenancy is unchanged and re-proven by nothing here (deputy invariant preserved by
construction).
**Status:** Draft — 2026-07-05
**Author:** Director (Claude Opus 4.8)

---

## 1. Context & problem

Everything the transcript-contracts program (`docs/specs/agent-transcript-contracts.spec.md`, ADR-0045)
and the batteries-included-A program built is **present and wired** — confirmed by code audit
(§2 audit table). Yet the deployed agent feels like a raw chatbot. Two root causes:

1. **The transcript renders plain text only.** `TranscriptItem.tsx` (`case 'assistant'`) renders
   `{event.text}` as a bare JSX text node inside a `<div className="text-sm">` — no markdown parse, no
   `whitespace-pre-wrap`, no renderer dependency in `package.json`. When the model answers in GFM
   (`**bold**`, `-` lists, `| tables |`, fenced code), the user sees literal asterisks and pipe walls.
   The security comment ("Plain-text assistant rendering only — NO dangerouslySetInnerHTML",
   `AssistantPanel.tsx:12`) is correct and must be preserved — but it currently *also* blocks legible
   prose, because nothing renders safe markdown.

2. **The system prompt never tells the model about its affordances.** `supabase/functions/agent-chat/prompt.ts`
   is a flat ~79-line prompt whose *only* tool guidance is `query_entity` (lines 67–76), and which ends
   with **"When you have enough information to answer the user's question, respond in plain text."**
   (`prompt.ts:76`). It never mentions `data_table`/`as:"table"`, `data_chart`, `data_insight`, `ask_user`,
   `compose_view`, `create_automation`, or `notify` — even though all of those tools ARE handed to the
   model (`handler.ts` `buildTools`, audit §1). deepseek-v4-flash, a weak tool-selector, therefore
   defaults to hand-rolled markdown prose for everything.

The fix is an **experience layer**, not new plumbing: render safe markdown, and rebuild the prompt to the
layered charter+skills architecture cataloged (but never built) in the battery-mining spike
(`docs/spikes/2026-07-03-agent-native-battery-mining.md` § "Prompt-architecture conventions worth adopting
framework-free"). No new runtime, no new event type, no schema change to the widget/ask-user/context
contracts — those are already correct.

### 1.1 Current-state audit (built vs missing — with file evidence)

Every "already built" claim below was verified by reading the code, not trusted from the brief.

| Capability | State | Evidence |
|---|---|---|
| Typed widget union (`data_table`/`data_chart`/`data_insight`) zod schema | **BUILT** | `pmo-portal/src/lib/agent/widgets/schema.ts` (`WIDGET_PAYLOAD_SCHEMA`, discriminated union) |
| Server-side widget reshape from `query_entity` + zod-validate before emit | **BUILT** | `handler.ts` `buildDataTableWidgetFromQueryResult` (fires on `input.as === 'table'`; `WIDGET_PAYLOAD_SCHEMA.safeParse` before emit; `null` → text fallback) |
| `query_entity` presentation hint | **BUILT** (named `as:"table"`, not `presentation`) | `schema.ts` `QUERY_ENTITY_SCHEMA.properties.as` (enum `['table']`) |
| Client widget registry (`kind → PMO component`) + re-validation | **BUILT** | `src/components/panel/widgets/registry.tsx` (data_table→DataTable, data_chart→StatusBarChart/ChartFrame, data_insight→KPITile), `widgets/WidgetSlot.tsx` |
| `ask_user` tool + `status{kind:'question'}` emit | **BUILT & tool-registered** | `schema.ts` `ASK_USER_SCHEMA`; `actions.ts` `askUserAction` (line 556); `handler.ts` dispatch → `emit('status',{payload:{kind:'question',…}})` |
| Question chips render | **BUILT** | `src/components/panel/QuestionChips.tsx`; `TranscriptItem.tsx` `payload.kind==='question'` case |
| `compose_view` tool | **BUILT** (flag-gated `composeEnabled`) | `actions.ts` `composeViewAction` (line 538) |
| `create_automation` + `notify` tools | **BUILT** (env-gated `AUTOMATIONS_ENABLED`) | `actions.ts` (lines 439, 314); mig `0048_agent_automations_notifications.sql`, `0059_agent_automation_bounds.sql` |
| Notifications inbox (bell + unread badge) | **BUILT** | `src/components/shell/NotificationBell.tsx`, wired in `ContextBar.tsx` |
| StuckRunBanner (long-run recovery) | **BUILT** | `src/components/panel/StuckRunBanner.tsx` |
| Live context provider — publishes `route` | **BUILT & active** | `src/lib/agent/context/AgentContextProvider.tsx` `getContext()` → `{ route: location.pathname, entity?, selection? }`; mounted app-wide in `App.tsx` |
| Live context — `entity` grounding hint injected into prompt | **BUILT (initial run only)** | `handler.ts` `buildGroundingHint(req.context?.entity)` appended at line 1001; **NOT re-appended** on answer/decision continuation paths (lines 1074, 1140) |
| Live context — `entity` **populated** by any page | **MISSING** | `getContext()` sets `entity` only when `setEntity()` is called; **zero production callers** — no page under `pmo-portal/pages/` calls `setEntity`. `route` is the only live field. |
| **Markdown rendering of assistant prose** | **MISSING** | `TranscriptItem.tsx` `case 'assistant'` renders `{event.text}` verbatim; no markdown dep in `package.json` (no react-markdown/marked/markdown-it/dompurify) |
| **Prompt steering to widgets/ask-user/compose/automation** | **MISSING** | `prompt.ts` (~79 lines) documents only `query_entity`; ends "respond in plain text" (line 76); no skills, no tool index, no "use a table for tabular data" rule |
| Resizable drawer / dock-vs-overlay | **MISSING** | `AssistantPanel.tsx:321` fixed `w-[400px]`; `fixed right-0 top-0 z-[40]` overlay; no resize handle |

**Verdict per scope group:** Group 1 (markdown) = **NEW**. Group 2 (prompt/skills) = **NEW authoring over
existing tools** (no tool changes — the tools exist; only the prompt that describes them is missing).
Group 3 (battery-surfacing behavior) = **WIRING/steering existing batteries** (behavior ACs, not new
code paths). Group 4 (context completeness) = **mostly WIRING an existing battery** (`setEntity` callers +
grounding-hint consistency) with one small gap. Group 5 (drawer UX) = **NEW**, adjacent, separately
acceptable.

---

## 2. Functional Requirements (EARS)

Conventions: **[MD]** markdown rendering · **[PROMPT]** prompt/skills architecture · **[STEER]** model
steering behavior · **[CTX]** context-awareness · **[DRAWER]** drawer UX (separate section §2.5).

### 2.1 Safe markdown rendering `[MD]` — **NEW**

**FR-AXP-001** (ubiquitous)
The system SHALL render an `assistant` transcript event's text as **GitHub-Flavored Markdown** (headings,
bold/italic, ordered/unordered lists, inline code, fenced code blocks, links, blockquotes, and **pipe
tables**) instead of as a literal string, so a model that answers in markdown reads as formatted prose.

**FR-AXP-002** (ubiquitous)
The markdown renderer SHALL produce **only a fixed, safe set of React elements** and SHALL NOT use
`dangerouslySetInnerHTML`, `eval`, `<iframe>`, `<script>`, `<style>`, event-handler attributes
(`onClick=` etc. in the source string), or any raw-HTML passthrough. Raw HTML embedded in the model's
markdown SHALL be **escaped or dropped**, never executed — preserving the `AssistantPanel.tsx:12`
plain-text-security stance (`NFR-AP-SEC-002`, ADR-0039 untrusted-output boundary).

**FR-AXP-003** (event-driven)
When a rendered link is present in assistant markdown, the system SHALL render it with
`rel="noopener noreferrer nofollow"` and SHALL restrict the href scheme to a safe allowlist
(`http`, `https`, `mailto`, and same-origin relative paths); a `javascript:`, `data:`, or otherwise
disallowed scheme SHALL render as inert text (not a live anchor).

**FR-AXP-004** (state-driven)
While an assistant message is **streaming** (partial/incomplete markdown, e.g. an unterminated code
fence or half-written table), the renderer SHALL degrade gracefully — rendering the partial content
without throwing and without corrupting the surrounding transcript — and SHALL settle to the correct
formatted output when the message completes.

**FR-AXP-005** (ubiquitous — coexistence with typed widgets)
Markdown rendering SHALL apply to **`assistant` prose text only**. It SHALL NOT replace or intercept the
typed-widget path (`artifact{kind:'widget'}` → registry), the question-chip path
(`status{kind:'question'}`), the compose-view artifact, or tool-call cards — those continue to render via
their existing components. Prose and typed widgets **coexist**: markdown handles narrative/explanatory
text; typed widgets handle interactive/sortable/charted data (see FR-AXP-011 for the precedence rule the
prompt enforces).

**FR-AXP-006** (ubiquitous — user echo unaffected)
The **user's own** message bubble (`ChatBubble.tsx`) SHALL remain plain text (no markdown parse) — a user
typing `*` should see `*`, and rendering user input as markdown is an unnecessary trust surface.

**FR-AXP-007** (ubiquitous — feature gating)
Markdown rendering SHALL live behind the existing `agentAssistant` flag (it is part of the panel);
no separate flag is introduced. With the flag off, the panel and its renderer do not mount (unchanged).

### 2.2 Prompt / skills architecture `[PROMPT]` — **NEW authoring over existing tools**

**FR-AXP-008** (ubiquitous — layered structure)
The system SHALL replace the flat `buildAgentSystemPrompt` body with a **layered prompt** composed of, in
order: (a) a small always-on **charter**, (b) a concise **tool index** (one line per tool the model is
actually handed), (c) progressively-disclosed **skills** with explicit "Use when…" triggers, and (d) the
per-turn **live-context** block. The builder SHALL remain a **pure function** (no I/O, no data rows,
NFR-AR-SEC-005) exactly as today, and SHALL continue to receive `(entities, rowCap, role)`.

**FR-AXP-009** (ubiquitous — charter content)
The charter SHALL state, concisely: the assistant's purpose (a read-and-act deputy for the PMO app); the
**hard rules** — the **deputy invariant** (acts only within the caller's RLS-scoped access; cannot exceed
the user's permissions; read scope = the user's own rows), **anti-fabrication** (never invent entity/column
names, ids, or data values; only report what a tool returned), and **verify-before-done** (confirm a tool
result actually answers the question before concluding); and the existing role-grounding sentence
(FR-DH-007) when a role resolved. The charter SHALL NOT end with "respond in plain text" — that instruction
is removed (it is the direct cause of the plain-chatbot behavior).

**FR-AXP-010** (ubiquitous — tool index)
The prompt SHALL include a one-line description per tool **actually registered for that request**
(`query_entity`, `ask_user`, and — when their env/flag gate is on — `compose_view`, `create_automation`,
`notify`, `create_activity`, `update_task_status`), naming what each is for. A tool that is NOT registered
for the request (e.g. `compose_view` when `composeEnabled` is false) SHALL NOT be advertised in the index
(no dangling affordance the model cannot call).

**FR-AXP-011** (event-driven — the table-not-markdown skill)
The prompt SHALL include a skill instructing: **when the answer is multi-row / tabular data**, the model
MUST call `query_entity` with `as:"table"` (or otherwise produce a `data_table` result) so the panel
renders a real sortable table — and MUST **NOT** hand-roll a markdown pipe table for that data. Single
scalar KPI-shaped answers SHOULD use `data_insight`; comparative magnitude-over-categories answers SHOULD
use `data_chart`. Narrative/explanatory prose remains markdown (FR-AXP-005). This is the precedence rule:
**typed widget for data, markdown for narrative.**

**FR-AXP-012** (event-driven — the ask-user skill)
The prompt SHALL include a skill instructing: **when the request is ambiguous** (an underspecified entity,
an unresolved "which one", a missing required filter the user did not supply), the model MUST call
`ask_user` with structured `options` rather than guessing, and rather than asking the clarifying question
in prose. It SHALL give a concrete trigger example (e.g. an ambiguous "show my projects" that could mean
several scopes → offer option chips).

**FR-AXP-013** (event-driven — the compose-view skill; only when enabled)
Where `compose_view` is registered for the request, the prompt SHALL include a skill instructing the model
to use `compose_view` when the user wants a **saved/dashboard/reusable view** ("build me a dashboard of…",
"save this as a view"), distinct from a one-shot inline widget answer (which stays on the `data_table`
path — the ephemeral-vs-persisted distinction of ADR-0045 §1 / ADR-0036 §5).

**FR-AXP-014** (event-driven — the automation skill; only when enabled)
Where `create_automation` is registered for the request, the prompt SHALL include a skill instructing the
model to offer `create_automation` for **recurring or event-triggered** requests ("every Monday…",
"remind me when…", "each morning…", "when a case sits >30 days…") — a `schedule` kind for cron phrasing,
a `trigger` kind for event phrasing — rather than answering as if it were a one-shot.

**FR-AXP-015** (ubiquitous — anti-over-triggering)
Each skill's "Use when…" trigger SHALL be scoped so the model does not fire the affordance
inappropriately: `ask_user` only on genuine ambiguity (not as a reflex before every answer);
`create_automation` only on genuinely recurring/triggered phrasing (not for a one-shot "show me…");
`compose_view` only on save/dashboard intent. The prompt SHALL prefer answering directly when no skill
trigger matches.

**FR-AXP-016** (ubiquitous — no security regression via prompt)
The layered prompt SHALL NOT weaken any existing hard rule: it MUST retain the read-only framing for
`query_entity`, the RLS/deputy scoping language, the role-appropriate help-answer rule (FR-DH-007), and
the "no data rows in reasoning" rule (NFR-AR-SEC-005). The prompt is **defense-in-depth only** — the
schema/handler/RLS remain the enforcement authorities (ADR-0039); prose steering never becomes a
security control.

### 2.3 Battery-surfacing behavior `[STEER]` — **WIRING/steering existing batteries**

> These are **behavior/quality** requirements: they assert that the BUILT batteries fire end-to-end from
> natural user phrasing once the prompt steers the model. They are model-dependent (deepseek-v4-flash is a
> weak tool-selector) — see NFR-AXP-QUAL-001 and the Open Questions on a possible model bump / eval
> harness. They are stated as target behaviors; their ACs (below) run against the real agent loop.

**FR-AXP-017** (event-driven)
When a user asks for multi-row data in natural language (e.g. "show me over-budget projects", "list my
open tasks"), the system SHALL surface the answer as an **inline typed widget** (a real sortable
`data_table`, or `data_chart`/`data_insight` where apt) — not as a markdown/prose table.

**FR-AXP-018** (event-driven)
When a user makes a **recurring/triggered** request in natural language (e.g. "remind me every Monday to
review overdue tasks"), the system SHALL surface the **automation-creation** flow (a `create_automation`
tool call → its approval/confirmation UX), not a one-shot prose answer.

**FR-AXP-019** (event-driven)
When a user makes an **ambiguous** request (e.g. a bare "show my projects" with multiple plausible
scopes), the system SHALL surface a **structured clarifying question** (`ask_user` chips), not a prose
question and not a guessed answer.

**FR-AXP-020** (event-driven)
When a user asks for a **legible formatted narrative** answer (e.g. "explain how procurement approvals
work for my role"), the system SHALL render the prose with markdown formatting (headings/lists/emphasis
legible), grounded to the user's role (FR-DH-007), not as a literal-asterisk wall.

### 2.4 Context-awareness completeness `[CTX]` — **WIRING an existing battery (+ one gap)**

**FR-AXP-021** (ubiquitous)
The system SHALL populate `getContext().entity` on the app's **entity-detail routes** so that
"summarize this" / "this project" resolves without the user restating which record. Specifically, each
detail page that renders a single primary entity (the audit found **none** currently call `setEntity`)
SHALL call the provider's `setEntity({ type, id, label })` on mount/selection and clear it on unmount, so
the currently-viewed record is published in the per-request context block (ADR-0045 §3, FR-ATC-015). The
eng-plan SHALL enumerate the exact detail routes in scope (at minimum the primary record pages —
projects, companies, procurement cases — the plan surveys `pmo-portal/pages/` for the detail-route set).

**FR-AXP-022** (state-driven)
While a `context.entity` is published, the handler SHALL inject the grounding hint on **every turn of the
run**, including the answer-resolution and decision-continuation paths — closing the current gap where
`buildGroundingHint` is appended only on the initial run (`handler.ts:1001`) and omitted on the
continuation paths (`handler.ts:1074`, `handler.ts:1140`). The hint remains **grounding-only, never an
authorization input** (FR-ATC-016, NFR-ATC-SEC-003 unchanged).

**FR-AXP-023** (ubiquitous — no new authorization surface)
Populating `entity` (FR-AXP-021) and injecting it consistently (FR-AXP-022) SHALL NOT change any
authorization behavior: a forged/stale `entity.id` the caller cannot see still yields zero rows under the
caller's JWT (AC-ATC-013 unchanged). Context completeness is a *grounding* improvement only.

### 2.5 Drawer UX `[DRAWER]` — **NEW, adjacent, SEPARATELY ACCEPTABLE**

> This section is UX polish the owner raised alongside the experience layer. It is **not** a spike Tier-1
> battery and is **independent** of Groups 1–4. The owner may accept, defer, or split it without affecting
> the rest of this spec. Recommendation: it could ship as its own small issue after Groups 1–3.

**FR-AXP-024** (event-driven — resizable width)
Where the panel is docked on desktop, the system SHALL let the user **resize** the drawer width by
dragging a handle on its left edge, replacing the fixed `w-[400px]` (`AssistantPanel.tsx:321`). The width
SHALL be clamped to a sensible min/max (the design-plan owns exact values, e.g. 320–720px) and SHALL
**persist** across sessions (localStorage), restoring on reopen.

**FR-AXP-025** (event-driven — dock vs overlay)
The system SHALL offer a **dock-vs-overlay** toggle for the desktop panel: **overlay** (the current
`fixed right-0 z-40` floating drawer over content) or **docked** (the panel reserves layout space as a
sibling of `<main>` so content reflows beside it rather than being covered). The chosen mode SHALL persist
across sessions. Mobile remains the full-screen sheet (unchanged).

**FR-AXP-026** (ubiquitous — a11y of the new controls)
The resize handle and dock/overlay toggle SHALL be keyboard-operable (the resize handle exposes an
ARIA slider or equivalent with arrow-key width adjustment; the toggle is a labelled button) and SHALL not
regress the panel's existing focus-management/Escape behavior (FR-AP-006/007).

---

## 3. Observed / legacy behavior to preserve (OBS)

**OBS-AXP-001 — The widget/ask-user/context CONTRACTS are unchanged.** This spec authors a renderer and a
prompt; it does not alter `WIDGET_PAYLOAD_SCHEMA`, `ASK_USER_SCHEMA`, `RunContext`, the `artifact`/`status`
event shapes, or the `control('answer')` verb (all shipped per ADR-0045). Widgets still validate twice
(server + client); questions still resolve into the same run.

**OBS-AXP-002 — `query_entity`'s presentation hint is `as:"table"` (not `presentation:"table"`).** The
prompt (FR-AXP-011) MUST steer the model to the **actual** field name in `QUERY_ENTITY_SCHEMA` (`as`,
enum `['table']`) — the brief's "presentation" phrasing is descriptive, not the wire name.

**OBS-AXP-003 — The deputy invariant is untouched.** Nothing here constructs a `service_role` client,
skips `can()`, or bypasses `dispatchAction`/`dispatchActionForced`. The agent runs as the caller JWT with
RLS as the ceiling (ADR-0036 §2), before and after this spec.

**OBS-AXP-004 — `AssistantPanel.tsx:12`'s no-`dangerouslySetInnerHTML` stance is preserved.** The markdown
renderer (FR-AXP-002) satisfies the same security posture by construction — it emits typed React elements,
never raw HTML — so the comment remains true.

**OBS-AXP-005 — Tool registration/gating is unchanged.** `compose_view` stays gated by `composeEnabled`;
`notify`/`create_automation` stay gated by `AUTOMATIONS_ENABLED`. The prompt only *advertises* a tool that
is *actually registered* for the request (FR-AXP-010).

---

## 4. Non-Functional Requirements

### 4.1 Security (OWASP / STRIDE)

- **NFR-AXP-SEC-001 — Markdown rendering introduces no XSS/HTML-execution surface.** The renderer
  (FR-AXP-002/003) MUST NOT execute raw HTML, scripts, styles, event handlers, or unsafe-scheme links from
  model-controlled text. This is the ADR-0039 untrusted-output boundary applied to prose: the model's text
  is untrusted; the renderer's fixed element set is the boundary. **Verified by a gate test** feeding
  hostile markdown (`<script>`, `<img onerror=…>`, `[x](javascript:alert(1))`,
  `<iframe src=…>`, raw HTML) and asserting **no** script/iframe/handler survives to the DOM.
- **NFR-AXP-SEC-002 — The prompt is defense-in-depth only, never an enforcement control.** The layered
  prompt (FR-AXP-016) restates the deputy/RLS/read-only/anti-fabrication rules but the **schema, handler,
  and RLS remain the authorities** (ADR-0039). Deleting or overriding a prompt line can degrade behavior
  but MUST NOT be able to widen access, bypass a `can()` gate, or exfiltrate cross-tenant data.
- **NFR-AXP-SEC-003 — The deputy invariant survives the context-completeness change.** `setEntity`
  (FR-AXP-021) publishes only a `{type,id,label}` grounding hint; consistent injection (FR-AXP-022) never
  makes `context` an authorization input (FR-ATC-016 unchanged). A forged/stale `entity.id` still yields
  zero rows under RLS (AC-ATC-013).
- **NFR-AXP-SEC-004 — No prompt/row content in logs.** The new prompt and markdown paths carry no data
  rows; logging discipline is unchanged (NFR-AR-SEC-005 / NFR-ATC-SEC-005) — never log the assistant text,
  the question prompt, or a widget's rows.

### 4.2 Performance

- **NFR-AXP-PERF-001 — Markdown parsing is client-side, synchronous-per-message, and bounded.** Parsing
  one assistant message (bounded by the model's output length) adds no network round-trip; it MUST NOT be
  re-parsed on every unrelated transcript re-render (memoize per message id). Any markdown dependency added
  MUST be lightweight (bundle-size-conscious) and inlined-safe (no runtime fetch).
- **NFR-AXP-PERF-002 — The layered prompt stays within a sane token budget.** Progressive disclosure
  (FR-AXP-008) means skills are concise; the whole system prompt MUST remain small enough not to materially
  raise per-turn cost or crowd context — the mining spike's "small always-on charter + short skills"
  guidance is the ceiling, not a license to write an essay per skill.

### 4.3 Accessibility (WCAG 2.1 AA)

- **NFR-AXP-A11Y-001 — Rendered markdown is semantic and accessible.** Headings render as real heading
  elements, lists as real `<ul>/<ol>`, tables with proper table semantics (header cells), code in `<code>/<pre>`,
  links as real `<a>` with discernible text — so a screen reader conveys structure. A rendered markdown
  table MUST carry table semantics (this is *prose* markdown; genuinely interactive/sortable data still
  routes to the typed `data_table` widget per FR-AXP-011).
- **NFR-AXP-A11Y-002 — Streaming markdown does not spam assertive announcements.** The live-region
  announcement behavior of the transcript (existing `aria-live`) MUST NOT re-announce the entire message on
  every streamed token because of markdown re-rendering — the announcement contract is unchanged from the
  plain-text panel.
- **NFR-AXP-A11Y-003 — Drawer-UX controls are operable and labelled** (FR-AXP-026) — resize via keyboard,
  toggle is a named button, focus order and Escape unchanged.

### 4.4 Quality / model behavior (the honest risk)

- **NFR-AXP-QUAL-001 — Battery-surfacing behavior (§2.3) is model-dependent and is the primary risk.**
  deepseek-v4-flash is a **weak tool-selector**; prompt steering (§2.2) is necessary but may not be
  sufficient for the §2.3 behavior ACs to pass reliably. This NFR **flags, does not solve**: the behavior
  ACs may need (a) prompt-steering iteration, (b) an **agent eval harness** (mining spike Tier-2 #10 —
  `*.eval.ts` with `usesTool`/`contains` scorers against the real loop) as the regression net, and/or (c)
  a **model bump** to a stronger tool-selector. The choice among these is an **Open Question** for the
  owner (below) — this spec does not decide it, and the §2.3 ACs are written to be re-runnable against
  whatever model/eval decision lands.

---

## 5. Acceptance Criteria (Given/When/Then)

> Layer per ADR-0010: **Unit** (Vitest/RTL) for the markdown renderer's safety + element output and the
> prompt builder's *structure*; **E2E** (Playwright) for the cross-stack surfacing journeys; **behavior**
> ACs in §2.3 are verified by the curated e2e AND (recommended, per NFR-AXP-QUAL-001) an eval harness — a
> behavior AC whose owning layer is "eval" is noted as such. No pgTAP layer (no schema/RLS change).

### Safe markdown rendering

**AC-AXP-001 — Assistant markdown renders as formatted elements, not literal characters. [Unit]**
Given an `assistant` event with text `"**Done.** Here are the steps:\n\n1. First\n2. Second"`,
When `TranscriptItem` renders it,
Then a bold `<strong>Done.</strong>` and a real ordered list with two `<li>`s render — no literal `**` or
`1.` characters appear as text.

**AC-AXP-002 — A markdown pipe table in prose renders as a real table. [Unit]**
Given an `assistant` event whose text contains a GFM pipe table,
When rendered,
Then a `<table>` with header and body rows renders (table semantics) — not a wall of `|` characters.

**AC-AXP-003 — Hostile markdown never executes. [Unit — security gate]**
Given an `assistant` event whose text contains `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`,
`<iframe src="…">`, and `[click](javascript:alert(1))`,
When rendered,
Then the DOM contains **no** `<script>`, `<iframe>`, no `onerror`/`on*` handler attribute, and the
`javascript:` link is inert (rendered as text or a non-navigating node) — asserting FR-AXP-002/003 and
NFR-AXP-SEC-001.

**AC-AXP-004 — Partial/streaming markdown does not throw or corrupt the transcript. [Unit]**
Given an `assistant` event with an **unterminated** code fence or half-written table (mid-stream),
When rendered,
Then the render does not throw, the rest of the transcript is intact, and completing the message settles to
the correct formatted output.

**AC-AXP-005 — User messages remain literal (not markdown-parsed). [Unit]**
Given a user message `"use * and ** literally"`,
When the user bubble renders,
Then the asterisks appear verbatim (no bold/list transformation) — FR-AXP-006.

**AC-AXP-006 — A typed `data_table` widget still renders via the registry, not markdown. [Unit]**
Given an `artifact{kind:'widget', widget:{kind:'data_table',…}}` event,
When rendered,
Then the real `DataTable` component renders (registry path) — the markdown renderer does not intercept it —
confirming coexistence (FR-AXP-005).

### Prompt / skills architecture

**AC-AXP-007 — The built system prompt is layered and no longer ends with "respond in plain text." [Unit]**
Given `buildAgentSystemPrompt(entities, rowCap, role)`,
When the returned string is inspected,
Then it contains a charter section, a tool-index section listing each registered tool, at least the
table/ask-user skills with "Use when…" triggers, and it does **not** contain the string
"respond in plain text" — while still being a pure function returning schema-metadata only (no data rows).

**AC-AXP-008 — The prompt steers tabular answers to `as:"table"`, not markdown tables. [Unit]**
Given the built prompt,
When inspected,
Then it explicitly instructs the model to use `query_entity` with `as:"table"` (the real field name,
OBS-AXP-002) for multi-row data and to NOT hand-roll a markdown table for that data (FR-AXP-011).

**AC-AXP-009 — The prompt only advertises tools registered for the request. [Unit]**
Given the prompt built for a request where `compose_view` is NOT registered (`composeEnabled` false),
When inspected,
Then the tool index and skills do **not** mention `compose_view`; and given a request where it IS
registered, the compose skill IS present (FR-AXP-010/013).

**AC-AXP-010 — The prompt retains all existing hard security rules. [Unit]**
Given the built prompt,
When inspected,
Then the deputy/RLS read-only framing, the FR-DH-007 role-appropriate-help rule, and the "no data rows in
reasoning" rule are all still present (FR-AXP-016, no security regression).

### Battery-surfacing behavior (model-dependent — §2.3)

**AC-AXP-011 — "Show me over-budget projects" surfaces an inline table widget, not prose. [E2E + Eval]**
Given a signed-in user opens the panel and asks "show me over-budget projects",
When the agent responds,
Then a real inline `data_table` widget renders in the transcript (an `artifact{kind:'widget'}` with
`kind:'data_table'`) — not a markdown/prose table. (E2E asserts the rendered widget on a scripted/mocked
model turn; the Eval layer asserts the real model *chooses* `query_entity` with `as:"table"` — `usesTool`
scorer — per NFR-AXP-QUAL-001.)

**AC-AXP-012 — A recurring request surfaces the automation-creation flow. [E2E + Eval]**
Given the user asks "remind me every Monday to review overdue tasks" (with automations enabled),
When the agent responds,
Then a `create_automation` tool call is dispatched (its approval/confirmation UX appears) — not a one-shot
prose answer (FR-AXP-018). (Eval `usesTool('create_automation')` on the real model.)

**AC-AXP-013 — An ambiguous request surfaces a structured clarifying question, not a guess or prose
question. [E2E + Eval]**
Given the user asks an ambiguous "show my projects" (multiple plausible scopes),
When the agent responds,
Then a `status{kind:'question'}` with option chips renders (the user can tap a chip to continue the same
run) — not a prose "which projects did you mean?" and not a silently-guessed answer (FR-AXP-019).
(Eval `usesTool('ask_user')` on the real model.)

**AC-AXP-014 — A narrative "how do I…" answer renders as legible formatted markdown, role-grounded.
[E2E]**
Given the user (with a known role) asks "explain how procurement approvals work for my role",
When the agent responds in markdown prose,
Then the panel renders formatted headings/lists/emphasis (not literal asterisks), and the answer is
scoped to the user's role affordances (FR-DH-007 / FR-AXP-020).

### Context-awareness completeness

**AC-AXP-015 — Viewing an entity-detail route publishes `entity` in the request context. [Unit]**
Given the user is on an in-scope detail route (e.g. a project detail page) that now calls `setEntity`,
When `getContext()` is evaluated for a panel request,
Then it returns `{ route, entity: { type, id, label } }` with the viewed record's identity (FR-AXP-021).

**AC-AXP-016 — "Summarize this" while viewing a project grounds to that project. [E2E]**
Given the user is viewing a specific project detail page and asks the panel "summarize this",
When the agent responds,
Then the answer is grounded to the viewed project (the grounding hint made `entity.id` available; the
model's `query_entity` filter targets that project) — without the user naming the project (FR-AXP-021/022).

**AC-AXP-017 — The grounding hint is injected on continuation turns, not just the initial run. [Unit]**
Given a run with a published `context.entity` that reaches an answer-resolution or decision-continuation
path,
When the system prompt for that continuation turn is built,
Then it includes the grounding hint (closing the `handler.ts:1074`/`:1140` omission — FR-AXP-022) — while
the hint remains grounding-only (a forged id still yields zero rows, AC-ATC-013 unchanged).

### Drawer UX (separate section — may be deferred)

**AC-AXP-018 — The desktop drawer is resizable and the width persists. [Unit/E2E]**
Given the desktop panel is open,
When the user drags the left-edge handle to a new width (within min/max) and reopens the panel in a later
session,
Then the panel restores the chosen width (FR-AXP-024), and the handle is keyboard-operable (FR-AXP-026).

**AC-AXP-019 — The dock/overlay toggle reflows content when docked and persists. [Unit/E2E]**
Given the desktop panel,
When the user switches from overlay to docked,
Then `<main>` content reflows beside the panel (not covered) and the mode persists across sessions
(FR-AXP-025); mobile remains the full-screen sheet.

---

## 6. Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-AXP-001 | Unit | `AC-AXP-001 assistant markdown renders formatted` (`pmo-portal/src/components/panel/TranscriptItem.markdown.test.tsx`) |
| AC-AXP-002 | Unit | `AC-AXP-002 markdown pipe table renders as table` (same file) |
| AC-AXP-003 | Unit | `AC-AXP-003 hostile markdown never executes` (`…/Markdown.security.test.tsx`) |
| AC-AXP-004 | Unit | `AC-AXP-004 partial streaming markdown does not throw` (same) |
| AC-AXP-005 | Unit | `AC-AXP-005 user message stays literal` (`…/ChatBubble.test.tsx`) |
| AC-AXP-006 | Unit | `AC-AXP-006 typed data_table still renders via registry` (`…/TranscriptItem.widgets.test.tsx`) |
| AC-AXP-007 | Unit | `AC-AXP-007 prompt is layered, no "respond in plain text"` (`pmo-portal/src/lib/agent/prompt.test.ts` — imports edge-fn `prompt.ts` by relative path per ADR-0039 §7) |
| AC-AXP-008 | Unit | `AC-AXP-008 prompt steers to as:table` (same) |
| AC-AXP-009 | Unit | `AC-AXP-009 prompt advertises only registered tools` (same) |
| AC-AXP-010 | Unit | `AC-AXP-010 prompt retains hard security rules` (same) |
| AC-AXP-011 | E2E + Eval | `AC-AXP-011 over-budget → inline table` (`pmo-portal/e2e/AC-AXP-011-table-surfacing.spec.ts`; `…/evals/table-surfacing.eval.ts`) |
| AC-AXP-012 | E2E + Eval | `AC-AXP-012 recurring → automation flow` (`e2e/AC-AXP-012-automation-surfacing.spec.ts`; eval) |
| AC-AXP-013 | E2E + Eval | `AC-AXP-013 ambiguous → ask_user chips` (`e2e/AC-AXP-013-ask-user-surfacing.spec.ts`; eval) |
| AC-AXP-014 | E2E | `AC-AXP-014 narrative → formatted markdown, role-grounded` (`e2e/AC-AXP-014-markdown-narrative.spec.ts`) |
| AC-AXP-015 | Unit | `AC-AXP-015 detail route publishes entity` (`pmo-portal/src/lib/agent/context/AgentContextProvider.test.tsx` + the page test) |
| AC-AXP-016 | E2E | `AC-AXP-016 summarize this grounds to viewed project` (`e2e/AC-AXP-016-context-summarize.spec.ts`) |
| AC-AXP-017 | Unit | `AC-AXP-017 grounding hint on continuation turns` (`supabase/functions/agent-chat/handler.context.test.ts`) |
| AC-AXP-018 | Unit/E2E | `AC-AXP-018 drawer resizable + persists` (`…/AssistantPanel.resize.test.tsx` / `e2e/AC-AXP-018-drawer-resize.spec.ts`) |
| AC-AXP-019 | Unit/E2E | `AC-AXP-019 dock/overlay reflow + persists` (`…/AssistantPanel.dock.test.tsx` / e2e) |

---

## 7. SoD & Security (OWASP / STRIDE)

**Tampering / XSS (STRIDE-T, OWASP A03 injection / A08 integrity).** The markdown renderer is the new
trust surface. Model text is **untrusted**; the renderer's fixed React-element output is the boundary
(ADR-0039 applied to prose). No `dangerouslySetInnerHTML`, no raw-HTML passthrough, unsafe-scheme links
inert — proven by AC-AXP-003. This is the same posture `AssistantPanel.tsx:12` already asserts; markdown
does not relax it.

**Elevation / deputy invariant (STRIDE-E, ADR-0036 §2, OWASP A01).** No code path added here constructs a
`service_role` client or reads `context`/prompt to widen access. The prompt is defense-in-depth
(NFR-AXP-SEC-002); the schema/handler/RLS remain authorities. Context completeness (§2.4) publishes only a
grounding hint; a forged `entity.id` degrades to zero rows (NFR-AXP-SEC-003 / AC-ATC-013 unchanged).

**Spoofing / tenancy (STRIDE-S, OWASP A01).** Unchanged — the agent still runs as the caller JWT with RLS
as the ceiling; this spec touches no RLS policy and adds no table.

**Repudiation (STRIDE-R).** Unchanged — assistant/artifact/status events still persist through the
existing `agent_events` append-only journal (ADR-0043).

**Depth note (model-tiering for the security review).** This change is **rendering + prompt-authoring
heavy** and **RLS/table-untouched**. The security-auditor should focus depth on the markdown XSS boundary
(NFR-AXP-SEC-001 / AC-AXP-003) and confirm the prompt-as-defense-in-depth framing (NFR-AXP-SEC-002) — a
lighter pass than a schema/RLS-bearing issue, but the XSS surface is genuine and must not be waved through.

---

## 8. Error Handling

| Error condition | Surface / behavior | User outcome |
|---|---|---|
| Assistant text is not valid markdown / partial mid-stream | Renderer degrades gracefully (FR-AXP-004) | The partial text renders as-is; settles when complete; no crash |
| Model emits raw HTML / script / unsafe-scheme link in markdown | Escaped/dropped/inert (FR-AXP-002/003) | Content shown as inert text; nothing executes |
| Model hand-rolls a markdown table despite steering (weak tool-selection) | Renders as a (legible) markdown table via FR-AXP-001; the behavior AC/eval flags the miss | User still sees a readable table; NFR-AXP-QUAL-001 tracks the steering gap |
| Model over-triggers `ask_user`/`create_automation` inappropriately | Prompt scoping (FR-AXP-015) reduces it; eval scorer catches regressions | Occasional extra chip/confirm; tuned via prompt iteration |
| `context.entity` present but the record is stale/forged | RLS zero-row read (NFR-AXP-SEC-003) | Agent answers "no data found"; no error, no elevated access |
| No page publishes `entity` for a given route (out of §2.4 scope) | `getContext()` returns `{ route }` only | "Summarize this" falls back to asking which record (unchanged from today) |

---

## 9. Non-goals (explicitly out of scope)

- **Sandboxed / iframe / executable generative UI** (agent-authored Alpine.js mini-apps, runnable
  JSX/SQL). Out per **ADR-0036 §5** and the mining skip-list; this spec renders **safe declarative
  markdown prose + typed declarative widgets only** — never executable code. (Rendering safe prose
  markdown is explicitly NOT what §5 bans.)
- **Cross-session user memory** (the agent remembering facts about the user across threads). Out — mining
  Tier-2 #9 is *thread compaction*, not user memory; both are separate backlog items.
- **Chat attachments, voice input, MCP server exposure, messaging channels** — mining Tier-2/3 items, each
  a separate backlog issue with its own ADR where needed.
- **New widget kinds** beyond the shipped v1 union (maps/timelines/forms) — ADR-0045 §1 closed set;
  extending it is a future issue.
- **Agent-driven navigation** (the agent moves the router). Deferred per ADR-0045 §3 / FR-ATC-019 —
  this spec reads context, it does not let the agent drive the UI.
- **A model bump or an eval-harness build as a *decided* deliverable.** NFR-AXP-QUAL-001 flags both as
  risks/options; the actual decision is an Open Question for the owner (below), not committed scope here.
- **Changing the widget/ask-user/context wire contracts.** They are shipped and correct (ADR-0045);
  this spec surfaces them, it does not re-open them.

---

## 10. Open Questions for the owner

1. **Markdown-vs-widget precedence — confirm the rule.** This spec proposes: **typed widget for data**
   (tables/charts/KPIs → the registry), **markdown for narrative prose**. A markdown *table the model
   writes inline* still renders legibly (FR-AXP-001), but the prompt steers genuinely tabular/sortable
   answers to the `data_table` widget (FR-AXP-011). Is that the intended split, or should the agent
   *always* prefer a typed widget for any table (and never emit a prose table at all)?

2. **Model bump vs. prompt-steering vs. eval harness (the NFR-AXP-QUAL-001 risk).** deepseek-v4-flash is a
   weak tool-selector. Three levers, not mutually exclusive: (a) ship prompt steering alone and measure;
   (b) also build the Tier-2 #10 **eval harness** now as the regression net (recommended if we care about
   §2.3 staying green); (c) **bump the model** to a stronger tool-selector for the agent-chat call. Which
   does the owner want in *this* issue vs. deferred? (This spec is written to survive any choice — the
   §2.3 ACs re-run against whatever lands.)

3. **Drawer-UX defaults (§2.5) — accept, defer, or split?** If accepted: (a) default mode — **overlay**
   (today's behavior, least disruptive) or **docked**? (b) resize min/max bounds (proposed 320–720px)?
   (c) is §2.5 the same issue as Groups 1–3, or its own follow-up issue? (Recommendation: split it — it is
   independent UX and the experience-layer fix, groups 1–3, is the higher-value core.)

4. **Context-completeness scope (§2.4).** FR-AXP-021 needs the exact set of detail routes that publish
   `entity`. Proposed minimum: project, company, procurement-case detail pages. Any others the owner wants
   in v1 (e.g. task detail, contact detail)?

5. **Recommended file split.** This is authored as **one cohesive spec** because the five groups share one
   goal (surface the batteries) and one code area (the panel + the prompt). If the owner prefers, **§2.5
   (drawer UX) could split into its own `agent-drawer-ux.spec.md`** since it is independently acceptable —
   flagged rather than split unilaterally. The other four groups belong together.

---

## 11. Contradictions / conflicts flagged against existing code & locked decisions

None against ADR-0045/0039/0036 (this spec operates strictly inside their boundaries — safe declarative
rendering, twice-validated widgets, deputy invariant, no executable UI). Facts worth flagging for the
eng-plan (none is a contradiction):

1. **The `query_entity` presentation hint is named `as`, not `presentation`.** `QUERY_ENTITY_SCHEMA.as`
   (enum `['table']`). The prompt (FR-AXP-011) and any eval must use the real field name (OBS-AXP-002).
2. **The grounding hint is currently initial-run-only.** `buildGroundingHint` is appended at
   `handler.ts:1001` but the answer/decision continuation paths (`:1074`, `:1140`) rebuild `system`
   without it. FR-AXP-022 closes this; the eng-plan should confirm no other continuation path is missed.
3. **`RunContext.entity` is fully wired but has zero production populators.** The provider, the wire field,
   the persistence (`scope`), and the grounding hint all exist and are tested; only the page-level
   `setEntity` calls are missing (FR-AXP-021). This is a small wiring gap, not new infrastructure.
4. **No markdown dependency exists yet.** `pmo-portal/package.json` has no react-markdown/marked/
   markdown-it/dompurify. FR-AXP-001 requires adding one (eng-plan picks a lightweight, XSS-safe,
   raw-HTML-disabled renderer, or a small hand-rolled safe subset) — analogous to ADR-0045's zod-promotion
   note, scoped to this contract only.
