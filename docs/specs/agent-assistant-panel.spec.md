# SDD: AssistantPanel Drawer — A2 (in-app agent surface)

**Feature:** The `AssistantPanel` — a persistent right-side drawer in the PMO shell that renders a
multi-turn conversation against the A1 `AgentRuntime` port. Covers the full read-only Q&A surface
(open/close, composer, transcript, streaming, cancellation, error/empty states, feature gating).
Write-actions (A3) and artifact/compose slots (A4) are explicitly out of scope.
**Spec ID prefix:** AP
**ADR refs:** ADR-0040 (Option A behind a B-shaped seam; A2 = "AssistantPanel drawer — ⌘J, transcript
list, streaming, model/budget guard — against the port"), ADR-0010 (test pyramid), ADR-0016 (FE
authz), ADR-0030 (build-vs-buy).
**Layer ownership (ADR-0010):** component behavior/states/a11y → Vitest/RTL (mock the AgentRuntime
port); RLS/tenancy is proven by A1's AC-AR-012 (pgTAP) — A2 adds no new server-side layer; one
curated cross-stack journey → Playwright (AC-AR-013, deferred from A1).
**Status:** Draft — 2026-06-30
**Author:** Director (Claude Opus 4.8)

---

## 1. Context

A1 shipped the `AgentRuntime` port (`src/lib/agent/runtime/port.ts`), the `PmoNativeRuntime` adapter,
and the `agent-chat` edge function (multi-turn deputy loop, `query_entity` over `projects` + `tasks`).
A2 is **purely a FE surface**: it mounts the panel in `AppShell`, wires it to the port via
`PmoNativeRuntime`, and renders the stream of `AgentEvent`s as a conversation. No new backend, no
new edge function, no schema changes. A2 also owns AC-AR-013 (the deferred cross-stack e2e journey
from A1's spec).

### Scope: A2 ONLY

In scope:
- `AssistantPanel` drawer (mount, open/close, persistent across routes).
- Open affordance: ⌘J / Ctrl+J keyboard shortcut + a Rail "Assistant" entry.
- Message composer (textarea, send, Enter-to-send, Shift+Enter newline, disabled-while-running).
- Transcript view: `AgentEvent` stream rendering — assistant text, tool-call cards, status events, terminal run status.
- Loading/streaming indicator (aria-live).
- Empty state (first-run prompt with example questions).
- Error state (transport/edge-fn failure → friendly retry).
- Stop/cancel control wired to `runtime.control(runId, 'cancel')`.
- `followUp` continuing the same conversation within the same run (client-held transcript per A1's stateless model).
- Feature flag `FEATURES.agentAssistant` gating: panel and ⌘J hidden when off.
- `useAssistantPanel` hook owning panel state and `AgentRuntime` orchestration.

Out of scope:
- Write `AgentAction`s + `confirm:true` → `needs-approval` approve/deny UX → **A3**.
- `artifact` events → I3 renderer slot → **A4**.
- `AgentNativeRuntime` sidecar adapter → **B-adapter, deferred**.
- Durable run/transcript persistence across page reloads → later.
- Model/token-budget UI in the panel (the `RateGuard` from A1 is the backend-side gate; a per-turn
  counter display is a stretch concern for the design-plan).

### Ground truth for this spec

Port types are exactly as shipped at `pmo-portal/src/lib/agent/runtime/port.ts`:
`AgentRuntime { createRun / followUp / control / subscribe }`, `AgentRun`, `AgentEvent`, `AgentRunStatus`,
`AgentEventType` (`'user'|'assistant'|'tool'|'artifact'|'status'|'system'`).

---

## 2. Functional Requirements (EARS)

Conventions: **[PANEL]** drawer/shell · **[COMPOSER]** input area · **[TRANSCRIPT]**
event-stream display · **[FLAG]** feature gating · **[SHORTCUT]** keyboard affordance ·
**[RUNTIME]** port wiring.

### 2.1 Feature Flag and Mount Point `[FLAG]` `[PANEL]`

**FR-AP-001** (ubiquitous)
The system SHALL add `agentAssistant: import.meta.env.VITE_FEATURES_AGENT_ASSISTANT === 'true' || false`
to `FEATURES` in `pmo-portal/src/lib/features.ts`, following the same pattern as `aiComposer`. When
`FEATURES.agentAssistant` is `false`, the `AssistantPanel` component SHALL NOT be mounted, the ⌘J
shortcut SHALL NOT be registered, and the Rail "Assistant" entry SHALL NOT appear — as if A2 had
never shipped.

**FR-AP-002** (ubiquitous)
When `FEATURES.agentAssistant` is `true`, the system SHALL mount `AssistantPanel` as a **sibling of
`<main>`** inside `AppShell`'s grid, pinned to the right edge, persisting its DOM across all route
changes. The panel SHALL NOT be rendered inside `<main>` or inside the Rail `<aside>`. The
`AppShell` component SHALL be extended to accept an optional `assistant?: React.ReactNode` prop;
when absent (flag off), the layout is unchanged.

**FR-AP-003** (ubiquitous)
The `AssistantPanel` SHALL maintain open/closed state in the `useAssistantPanel` hook (React state,
not router state — the panel open/closed state is **not** reflected in the URL). The panel persists
the **conversation transcript in hook state** across route changes (navigating away does not reset
the transcript while the panel is open or has an active run).

### 2.2 Open / Close Affordance `[PANEL]` `[SHORTCUT]`

**FR-AP-004** (event-driven, conditional)
Where `FEATURES.agentAssistant` is `true`, when the user presses ⌘J (macOS) or Ctrl+J (Windows /
Linux) from any route, the `AssistantPanel` SHALL toggle open/closed. The shortcut handler SHALL be
registered on `document` (same pattern as the CommandPalette ⌘K handler) and SHALL respect `Escape`
for close (FR-AP-022).

**FR-AP-005** (ubiquitous, conditional)
Where `FEATURES.agentAssistant` is `true`, the Rail SHALL render an "Assistant" entry in a dedicated
"Assistant" section (below the existing group structure, above the Administration footer, or at the
bottom of the last group — per the design-plan). The entry SHALL be visible to **all roles** (not
role-gated). Clicking the entry SHALL open the panel and call `onNavigate` (same as all other Rail
entries). The entry uses the `feature: 'agentAssistant'` gate on the `NavItem` pattern already in
`Rail.tsx`.

**FR-AP-006** (event-driven)
When the panel is opened (via ⌘J or the Rail entry), focus SHALL move into the `AssistantPanel`
— specifically to the composer textarea when the transcript is non-empty, or to a "get started"
action element when the transcript is empty (NFR-AP-A11Y-002). When the panel is closed, focus SHALL
restore to the element that had focus before the panel opened (the trigger or the last focused
element in the page), exactly as `AIComposerModal` and the mobile rail drawer implement this.

**FR-AP-007** (event-driven)
When the user presses Escape while the panel is focused, the panel SHALL close and focus SHALL restore to
the trigger — **regardless of run state** (D-A2-4; cancelling a run is the separate Stop control, never Escape).

### 2.3 Message Composer `[COMPOSER]`

**FR-AP-008** (ubiquitous)
The panel SHALL include a composer area containing: a `<textarea>` labelled "Ask a question" (or
equivalent — exact copy owned by the design-plan), a "Send" button, and a "Stop" button (visible
while a run is in flight).

**FR-AP-009** (event-driven)
When the user presses Enter (without Shift) in the composer textarea and the textarea is non-empty
and no run is in flight, the system SHALL call `createRun` (first message) or `followUp` (subsequent
messages in the same run), then begin streaming. Shift+Enter SHALL insert a newline, not submit.

**FR-AP-010** (state-driven)
While a run is in flight (`status === 'running'`), the composer textarea and the Send button SHALL
be `disabled` so the user cannot submit a concurrent message. The Stop button SHALL be enabled.

**FR-AP-011** (event-driven)
When the run terminates (terminal `status` event: `completed` or `errored`) the composer textarea
and Send button SHALL re-enable. The Stop button SHALL be hidden or disabled.

**FR-AP-012** (state-driven)
While the composer textarea is empty (trimmed length === 0) and no run is in flight, the Send button
SHALL be `disabled` (identical to `AIComposerModal`'s `disabled={prompt.trim().length === 0}`).

### 2.4 Transcript View and Event Rendering `[TRANSCRIPT]` `[RUNTIME]`

**FR-AP-013** (ubiquitous)
The panel SHALL render the transcript as an ordered list of entries, one per visible `AgentEvent`
(user turns + assistant turns + tool cards + status notices). The list SHALL be scrollable and the
panel SHALL auto-scroll to the latest entry when new events arrive, unless the user has manually
scrolled up (scroll-anchoring to the user's intent).

**FR-AP-014** (event-driven — assistant text)
When an `AgentEvent` with `type === 'assistant'` is received from `subscribe`, the system SHALL
append the event's `text` to the current assistant turn bubble **incrementally** (token-append, not
full re-render). Successive `assistant` events in the same turn are concatenated into one bubble.
The implementation SHALL NOT cause the entire transcript to unmount/remount on each token (no
full-list re-render jank, per NFR-AP-PERF-002).

**FR-AP-015** (event-driven — tool events)
When an `AgentEvent` with `type === 'tool'` is received, the system SHALL render a compact
**tool-call card**: "Looked up {entity}" (derived from `payload`) with a subtle visual treatment
(e.g. a muted icon + condensed text, distinct from a user/assistant bubble). The card is informational
only (no interactive control in A2 — approve/deny chips are A3). If `payload` is unrecognizable,
fall back to "Checking your data…".

**FR-AP-016** (event-driven — status events)
When an `AgentEvent` with `type === 'status'` is received, the system SHALL:
- If `payload.status === 'completed'`: mark the run as complete, re-enable the composer; render no
  extra status line (the assistant's final text bubble is the terminal signal).
- If `payload.status === 'errored'` with `error === 'TURN_CAP'`: render a non-error notice
  "I've reached my step limit for this question — you can follow up to continue." (per AC-AR-004
  reconciliation: step-cap is a bounded stop, not a failure).
- If `payload.status === 'errored'` with any other error code: enter the **error state** (FR-AP-018).

**FR-AP-017** (event-driven — system events)
When an `AgentEvent` with `type === 'system'` is received, the system SHALL render it as a quiet
inline notice in the transcript (e.g. muted text "Session started"). `type === 'user'` events are
reflected as the user's own message bubble (already appended locally on send; the echo confirms
delivery).

**FR-AP-018** (state-driven — error state)
While the panel is in error state (transport failure, upstream error, `errored` status with a
non-`TURN_CAP` code), the panel SHALL render a friendly message ("Something went wrong") with a
"Retry" button that re-invokes `createRun` with the last goal. The error state SHALL NOT expose
raw error bodies or SDK stack traces (mirrors AC-AR-005 / NFR-AR-SEC-005).

### 2.5 Loading / Streaming Indicator `[TRANSCRIPT]`

**FR-AP-019** (state-driven)
While a run is in flight, the panel SHALL render a streaming indicator (e.g. an animated "…" or
a spinner after the last assistant bubble) so the user knows the agent is working. This indicator
SHALL be the aria-live region anchor (NFR-AP-A11Y-003).

### 2.6 Empty State `[TRANSCRIPT]`

**FR-AP-020** (ubiquitous)
When the transcript is empty (no messages have been sent yet in this session), the panel SHALL
render a first-run **empty state**: a heading ("Ask your agent"), a brief descriptor, and 2–3
**example question chips** (e.g. "Which of my projects are behind?", "How many open tasks do I
have?", "Show me active procurement cases"). Clicking a chip SHALL pre-fill the composer textarea
and focus it (not auto-submit — the user may edit before sending).

### 2.7 Stop / Cancel `[RUNTIME]`

**FR-AP-021** (event-driven)
When the user clicks the Stop button (visible while `status === 'running'`), the system SHALL call
`runtime.control(runId, 'cancel')`. The `PmoNativeRuntime` implementation aborts the fetch (via
`AbortController`); the transcript SHALL reflect cancellation (e.g. a "Stopped" notice appended).
The composer SHALL re-enable after cancellation.

### 2.8 FollowUp within the same run `[RUNTIME]`

**FR-AP-022** (event-driven)
When the user sends a subsequent message after a run has completed (composer re-enabled, transcript
non-empty), the system SHALL call `runtime.followUp(runId, message)` then `subscribe(runId)` again
(per A1's stateless replay model — the client holds the full transcript and re-posts it; the server
is stateless per AR-OD-005). The transcript SHALL append the new user turn and the agent's response
below the prior exchange.

**FR-AP-023** (ubiquitous)
The `useAssistantPanel` hook SHALL hold the active `runId` in state, resetting it only when the
user explicitly starts a new conversation (e.g. a "New conversation" control — AP-OD-005) or closes
and reopens the panel (AP-OD-003). While a `runId` is held, "send" calls `followUp`; when no
`runId` is held, "send" calls `createRun`.

### 2.9 `AgentRuntime` Wiring `[RUNTIME]`

**FR-AP-024** (ubiquitous)
`AssistantPanel` and `useAssistantPanel` SHALL depend **only** on the `AgentRuntime` interface from
`port.ts` — they SHALL NOT import `PmoNativeRuntime` or any concrete adapter directly
(NFR-AR-SEC-007 / FR-AR-001). The `AgentRuntime` instance SHALL be injected via a React context
(`AgentRuntimeContext`) or a prop. `PmoNativeRuntime` is constructed once at the app root (inside
the flag-on branch) and provided via context — this is the ONLY place that imports the concrete
adapter.

**FR-AP-025** (ubiquitous)
`PmoNativeRuntime` SHALL be constructed with `getJwt` returning the current Supabase auth session
JWT and `fnUrl` from `VITE_SUPABASE_URL + '/functions/v1/agent-chat'`. The SPA SHALL NEVER pass a
service-role key or the `ANTHROPIC_API_KEY` to `PmoNativeRuntime`
(NFR-AP-SEC-001 / NFR-AR-SEC-001).

---

## 3. Non-Functional Requirements

### Accessibility — `NFR-AP-A11Y-###`

**NFR-AP-A11Y-001** — **Landmark role for the drawer (dual focus contract — D-A2-1).**
The panel's role is **viewport-dependent**:
- **Desktop (≥1024px):** `<aside role="complementary" aria-label="Agent assistant">` — **non-modal**: NO
  focus-trap, the main content is NOT `inert`, and Tab freely exits to `<main>`. The panel complements the
  app so the user can reference/click app content while conversing with the agent.
- **Mobile (<1024px):** `role="dialog" aria-modal="true"` with a **full focus-trap + scrim + the background
  marked `inert`** (reuse the existing focus-trap util, as the mobile Rail drawer does).
**Escape always CLOSES the panel** (focus restores to the trigger) — regardless of whether a run is in
flight (D-A2-4). Cancelling a run is the **separate, explicit Stop control** (`control('cancel')`), never
Escape — single-purpose and discoverable.

**NFR-AP-A11Y-002** — **Focus management (open/close).**
When the panel opens: focus SHALL move to the composer textarea (if transcript is non-empty) or to
the first focusable element in the empty state (if transcript is empty). When the panel closes:
focus SHALL restore to the element that had focus immediately before the panel opened — captured in
a `triggerRef` at the moment of open (exactly as `AIComposerModal` and the mobile Rail drawer
implement). The focus-in and focus-restore use the same `setTimeout(0)` / synchronous patterns
already in the codebase.

**NFR-AP-A11Y-003** — **aria-live for streaming.**
The streaming indicator and each incoming assistant-text chunk SHALL be announced by AT without
requiring explicit focus. The transcript container (or a visually-hidden live region sibling) SHALL
carry `aria-live="polite" aria-atomic="false"` so incremental text appends are announced. Status
notices (step-limit, error) MAY be `aria-atomic="true"` (they are single, complete messages).
The composer textarea SHALL have an explicit `<label>` (not just a `placeholder`).

**NFR-AP-A11Y-004** — **Full keyboard operability.**
All panel interactions (open via ⌘J, send via Enter, stop via Stop button, retry via Retry button,
example chip selection) SHALL be fully operable by keyboard alone. Tab order within the open panel
SHALL be: transcript (scroll region, not interactive) → composer textarea → Send / Stop button →
any other controls. No interactive element within the panel SHALL be keyboard-unreachable while
the panel is open.

**NFR-AP-A11Y-005** — **`inert` rules (closed + the dual mode).**
When the panel is **closed**, its DOM (kept mounted for persistence — D-A2-6) SHALL be marked `inert`
so it is invisible to the Tab sequence and screen-reader tree. When **open on desktop (≥1024px)** the main
content is **NOT** `inert` (complementary, non-modal — the user may freely Tab back to `<main>`). When
**open on mobile (<1024px)** the panel is modal: the background **IS** `inert` + scrim (D-A2-1).

**NFR-AP-A11Y-006** — **Colour/motion.**
All panel states (empty, streaming, error, tool card) SHALL meet WCAG AA contrast ratios using
DESIGN.md tokens. Animations (slide-in, streaming indicator) SHALL respect `prefers-reduced-motion`
(duration zeroed, transform skipped) following the pattern in `ConfirmDialog`.

### Security — `NFR-AP-SEC-###`

**NFR-AP-SEC-001** — **JWT forwarding only.**
The panel (and `PmoNativeRuntime`) SHALL forward only the user's own Supabase session JWT to
`agent-chat`. The SPA SHALL NEVER construct, forge, elevate, or cache custom JWT claims. The
`ANTHROPIC_API_KEY` and service-role key MUST NOT appear in the SPA bundle or any client-readable
env var (inherited from NFR-AR-SEC-001/008; the panel adds no new secret surface).

**NFR-AP-SEC-002** — **Safe rendering of assistant text.**
All assistant `text` values rendered in the transcript SHALL be treated as **untrusted string
content** and rendered via React's default text rendering (never `dangerouslySetInnerHTML`). Markdown
rendering (if added by the design-plan) SHALL use a sanitized renderer (e.g. `react-markdown` with
a safe allowlist). No raw HTML from the model MAY reach the DOM.

**NFR-AP-SEC-003** — **Port isolation.**
`AssistantPanel` and `useAssistantPanel` SHALL import only `AgentRuntime`, `AgentRun`, `AgentEvent`,
`AgentRunStatus`, `AgentEventType`, `RunContext` from `port.ts`. No import of `PmoNativeRuntime`
or any adapter is permitted in panel or hook files (NFR-AR-SEC-007 / FR-AP-024).

**NFR-AP-SEC-004** — **No secret logging.**
The panel SHALL NOT log `AgentEvent.text`, `AgentEvent.payload` data rows, or the JWT to the browser
console at any verbosity level reachable in production builds (mirrors NFR-AR-SEC-005).

### Performance — `NFR-AP-PERF-###`

**NFR-AP-PERF-001** — **Panel open latency < 200ms.**
From the ⌘J keypress or the Rail entry click to the panel being visible and focused, the elapsed
time SHALL be < 200ms (CSS transition + React render, no async gate). The panel is pre-mounted when
the flag is on; open/close is a CSS/state toggle.

**NFR-AP-PERF-002** — **Streaming without full-list re-render.**
Incoming `assistant` text tokens SHALL be appended to the current bubble without unmounting/remounting
the transcript list. The implementation MAY use a ref-based DOM append for the active bubble or a
keyed component whose stable key prevents sibling re-renders. At no point during streaming SHALL the
whole transcript list re-render. Verified by RTL's render-count assertion in the streaming unit test.

**NFR-AP-PERF-003** — **Transcript virtualization or cap.**
The panel's transcript list SHALL either virtualize (e.g. `react-virtual`) or hard-cap the displayed
events at **200 visible entries**, collapsing older entries with a "Show earlier" affordance, so
long conversations do not cause a DOM explosion. The cap threshold and behavior are an
owner-decision (AP-OD-007) with default 200.

---

## 4. Acceptance Criteria

All AC are Given/When/Then, tagged to the **lowest sufficient owning layer** (ADR-0010). The `AgentRuntime`
port is **mocked** in all RTL tests (a factory that yields scripted `AgentEvent` streams); no live
`agent-chat` call is made in unit/component tests.

### Feature flag (Unit — Vitest/RTL)

**AC-AP-001** (Unit) — *Flag off → panel and shortcut absent.*
Given `FEATURES.agentAssistant = false`
When `AppShell` (with the flag-aware assistant slot) is rendered
Then the `AssistantPanel` DOM is **not** present; pressing ⌘J has no effect; the Rail does not
render an "Assistant" entry.
Test file: `pmo-portal/src/components/shell/AppShell.test.tsx`

**AC-AP-002** (Unit) — *Flag on → panel mounted.*
Given `FEATURES.agentAssistant = true`
When `AppShell` is rendered
Then the `AssistantPanel` is present in the DOM (closed, `inert`); the Rail renders an "Assistant"
entry; ⌘J is registered.
Test file: `pmo-portal/src/components/shell/AppShell.test.tsx`

### Open / Close (Unit — Vitest/RTL)

**AC-AP-003** (Unit) — *⌘J toggles open/closed.*
Given `FEATURES.agentAssistant = true` and the panel is closed
When the user presses ⌘J (Meta+J)
Then the panel opens (not `inert`, visible); when pressed again the panel closes.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-004** (Unit) — *Rail "Assistant" entry opens the panel.*
Given `FEATURES.agentAssistant = true` and the panel is closed
When the user clicks the Rail "Assistant" entry
Then the panel opens.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-005** (Unit) — *Escape closes the panel (no run in flight).*
Given the panel is open and no run is in flight
When the user presses Escape while focus is within the panel
Then the panel closes and focus restores to the triggering element.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-006** (Unit) — *Focus moves in on open; restores on close.*
Given the panel is closed and a button in the main content has focus
When the user opens the panel (⌘J) and then closes it
Then on open: focus is in the panel (composer textarea or empty-state element); on close: focus
returns to the original button.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-007** (Unit) — *Panel is `inert` when closed.*
Given the panel is closed
When the a11y tree is inspected
Then the panel's root element has the `inert` attribute and no focusable within it is in the
Tab sequence.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

### Composer (Unit — Vitest/RTL)

**AC-AP-008** (Unit) — *Enter submits; Shift+Enter inserts newline.*
Given the panel is open with an empty transcript and a mocked `AgentRuntime`
When the user types "how many projects?" and presses Enter
Then `runtime.createRun` is called with `{ goal: "how many projects?" }`.
When the user types "line1" then Shift+Enter then "line2" and presses Enter
Then `runtime.createRun` is called with a goal containing a newline between "line1" and "line2".
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-009** (Unit) — *Composer disabled while running; Stop enabled.*
Given a run is in flight (mocked `AgentRuntime` emitting events without a terminal status)
When the composer is inspected
Then the textarea and Send button are `disabled`; the Stop button is enabled and labelled
"Stop" (or equivalent).
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-010** (Unit) — *Composer re-enables after terminal status.*
Given a mocked `AgentRuntime` that emits `assistant` text then a `status` event with `status: 'completed'`
When the subscribe stream terminates
Then the textarea and Send button are enabled; the Stop button is hidden/disabled.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-011** (Unit) — *Send disabled when textarea is empty.*
Given the panel is open and the textarea is empty
When the Send button is inspected
Then it is `disabled`.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

### Transcript rendering (Unit — Vitest/RTL)

**AC-AP-012** (Unit) — *Streamed assistant text appears incrementally.*
Given a mocked `AgentRuntime` that yields three successive `assistant` events with `text`
`"Hello "`, `"world"`, `"."` for the same run
When the panel renders the stream
Then the transcript shows a single assistant bubble containing `"Hello world."` (concatenated);
the transcript list does not unmount between events (render count stable after first bubble
appears).
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-013** (Unit) — *Tool-call card renders.*
Given a mocked `AgentRuntime` that emits a `tool` event with `payload: { entity: 'projects', rowCount: 3 }`
When the transcript is rendered
Then a tool-call card is visible containing text matching "projects" (e.g. "Looked up projects");
the card is distinct from user/assistant bubbles.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-014** (Unit) — *Step-limit status notice renders (non-error).*
Given a mocked `AgentRuntime` that emits `status { status: 'errored', error: 'TURN_CAP' }`
When the transcript is rendered
Then a non-error inline notice appears ("I've reached my step limit" or equivalent); no error
state is shown; the composer re-enables (the user can follow up).
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-015** (Unit) — *Error state on upstream failure with Retry.*
Given a mocked `AgentRuntime` that emits `status { status: 'errored', error: 'UPSTREAM_ERROR' }`
When the transcript is rendered
Then the panel shows an error state message ("Something went wrong" or equivalent) with a "Retry"
button; the error message contains no raw error body or SDK stack trace.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-016** (Unit) — *Retry re-invokes createRun with the original goal.*
Given the panel is in error state (from AC-AP-015) with the last goal "show active projects"
When the user clicks "Retry"
Then `runtime.createRun` is called again with `{ goal: 'show active projects' }`.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

### Empty state (Unit — Vitest/RTL)

**AC-AP-017** (Unit) — *Empty state renders with example chips.*
Given the panel is open and no messages have been sent
When the transcript area is inspected
Then an empty state is visible with a heading and at least two example question chips; no
transcript entries are shown.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-018** (Unit) — *Example chip pre-fills composer; does not auto-submit.*
Given the empty state is visible with a chip "Which of my projects are behind?"
When the user clicks the chip
Then the composer textarea contains "Which of my projects are behind?"; `runtime.createRun`
has NOT been called (the user must press Enter or click Send to submit).
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

### Cancel (Unit — Vitest/RTL)

**AC-AP-019** (Unit) — *Stop calls control('cancel') and re-enables composer.*
Given a mocked `AgentRuntime` that is streaming (no terminal status yet)
When the user clicks the Stop button
Then `runtime.control(runId, 'cancel')` is called; the transcript appends a cancellation
notice; the composer textarea and Send button re-enable.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

### a11y (Unit — Vitest/RTL with jest-axe / testing-library queries)

**AC-AP-020** (Unit) — *Panel landmark and label.*
Given the panel is open
When the a11y tree is inspected
Then there is an element with `role="complementary"` (or `<aside>`) and `aria-label="Agent assistant"`;
the composer textarea has an accessible label (not just a placeholder).
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-021** (Unit) — *aria-live region present.*
Given the panel is open
When the transcript container is inspected
Then there is an element with `aria-live="polite"` that wraps or is adjacent to the streaming
content.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

**AC-AP-022** (Unit) — *axe-core zero violations.*
Given the panel rendered in open state with: empty state, and separately with a transcript containing
one assistant bubble + one tool card + one status notice
When `axe` runs on the panel's DOM subtree
Then zero violations are reported.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

### FollowUp (Unit — Vitest/RTL)

**AC-AP-023** (Unit) — *followUp targets the same runId.*
Given a completed run (runId = "abc") with one exchange in the transcript
When the user types a follow-up message and presses Enter
Then `runtime.followUp("abc", <message>)` is called (not `createRun`); `subscribe("abc")` is
called again; the new exchange appends below the prior one.
Test file: `pmo-portal/src/components/panel/AssistantPanel.test.tsx`

### Port isolation (Unit — static / lint gate)

**AC-AP-024** (Unit/lint) — *No adapter import in panel or hook.*
Given the SPA source
When import paths in `AssistantPanel.tsx` and `useAssistantPanel.ts` are inspected
Then neither file imports `pmoNativeRuntime` (or any concrete adapter); they import only from
`port.ts` or the `AgentRuntimeContext`.
Enforced by the same ESLint `no-restricted-imports` rule as AC-AR-011 (extended to cover the panel
file paths).
Test file: enforced by lint gate (CI ESLint); optionally mirrored in `portIsolation.test.ts`.

### Cross-stack journey — deferred AC-AR-013 (E2E — Playwright)

**AC-AR-013** (E2E) — *Open the assistant, ask a question, see the streamed answer.*
This is the AC deferred from A1's spec; A2 owns it.

Given a CI environment with `VITE_FEATURES_AGENT_ASSISTANT=true` and `VITE_FEATURES_AGENT_ASSISTANT`
set on the test page, **and** `page.route` intercepting `**/functions/v1/agent-chat` to return a
mocked SSE stream of `AgentEvent`s:
```
{ type:'user',      text:'How many active projects do I have?', ... }
{ type:'tool',      payload:{ entity:'projects', rowCount:5 },   ... }
{ type:'assistant', text:'You have 5 active projects.',          ... }
{ type:'status',    payload:{ status:'completed' },              ... }
```

**Journey:**
1. User logs in (or uses a seeded auth fixture) and lands on any route.
2. User presses ⌘J (or Ctrl+J on Linux CI).
3. Panel opens; empty state is visible.
4. User types "How many active projects do I have?" and presses Enter.
5. Composer is disabled; streaming indicator appears.
6. Tool-call card "Looked up projects" appears in the transcript.
7. Assistant bubble "You have 5 active projects." appears (streamed via the mock).
8. Streaming indicator disappears; composer re-enables.
9. User presses ⌘J again → panel closes.

**Assertions:**
- After step 3: `getByRole('complementary', { name: /agent assistant/i })` is visible.
- After step 5: Send button is `disabled`.
- After step 6: tool-call card text matches `/projects/i`.
- After step 7: assistant bubble contains "5 active projects".
- After step 8: Send button is enabled.
- After step 9: panel is not visible (or has `inert`).

Test file: `pmo-portal/e2e/AC-AR-013-assistant-panel-journey.spec.ts`
CI gate: PR→`dev` (`verify` lane — Playwright with `--project=chromium` against the Vite dev server,
`agent-chat` mocked via `page.route`; no live Anthropic call, no Supabase edge fn deploy in CI).

---

## 5. Owner-Decision Flags (defaults applied — nothing blocks the plan)

| Flag | Decision | **Default applied** | Rationale / Impact |
|---|---|---|---|
| **AP-OD-001** | Drawer side: right vs left | **Right** | Consistent with industry convention for assistant/sidebar drawers; does not compete with the left Rail. |
| **AP-OD-002** | Open shortcut | **⌘J / Ctrl+J** | Mirrors ADR-0040 recommendation; ⌘K is the CommandPalette (existing); ⌘J is adjacent and unoccupied. |
| **AP-OD-003** | Panel width on desktop | **400px** (D-A2-3; design-plan owns the token) | Wide enough for readable assistant prose; leaves ≥880px for main content on a 1280px viewport. Mobile (<1024px) is a full-screen sheet. Collapsible to zero when closed (CSS transition). |
| **AP-OD-004** | Rail "Assistant" entry visible to all roles | **Yes — all roles** | The agent's job story in `jtbd.md` is "Any role." No role gate on the Rail entry (the flag gate is sufficient). |
| **AP-OD-005** | Persist open-state across page reloads | **No** (React state only, not `localStorage`) | Avoids the panel being unexpectedly open on first load. If the owner wants persistence, add a `localStorage` key later without changing behavior. |
| **AP-OD-006** | "New conversation" control | **Yes — a "New" button** in the panel header, visible when a transcript exists | Resets `runId` + transcript to empty state. Keeps the panel open. |
| **AP-OD-007** | Transcript cap / virtualization threshold | **200 entries, "Show earlier" affordance** | Bounds DOM size for long sessions; virtualization can be added if perf regression is observed in practice. |

---

## 6. Test Layering and Traceability (ADR-0010)

Each AC is owned by **one** test at the lowest sufficient layer. The owning test names its AC id
in its title (Vitest `it('AC-AP-### ...')` / Playwright `test('AC-AR-013 ...')`) for `grep`-able
traceability.

| AC-### | Layer | Tool | Intended owning test file |
|---|---|---|---|
| AC-AP-001 | Unit | Vitest/RTL | `pmo-portal/src/components/shell/AppShell.test.tsx` |
| AC-AP-002 | Unit | Vitest/RTL | `pmo-portal/src/components/shell/AppShell.test.tsx` |
| AC-AP-003 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-004 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-005 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-006 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-007 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-008 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-009 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-010 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-011 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-012 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-013 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-014 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-015 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-016 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-017 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-018 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-019 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-020 | Unit | Vitest/RTL (a11y queries) | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-021 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-022 | Unit | Vitest/RTL + jest-axe | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-023 | Unit | Vitest/RTL | `pmo-portal/src/components/panel/AssistantPanel.test.tsx` |
| AC-AP-024 | Unit/lint | ESLint `no-restricted-imports` | CI lint gate (extended from AC-AR-011 rule) |
| AC-AR-013 | E2E | Playwright | `pmo-portal/e2e/AC-AR-013-assistant-panel-journey.spec.ts` |

**CI placement:**
- AC-AP-001 → AC-AP-024: `npm run verify` (typecheck + lint + Vitest) — the PR→`dev` fast lane.
- AC-AR-013: Playwright, PR→`dev` fast lane (Vite dev server, `agent-chat` mocked via `page.route`;
  no live Anthropic, no Supabase edge fn deploy). Also runs in the PR→`main` integration job.

**Coverage note:** ≥80% line coverage on all new files under `src/components/panel/` and
`src/hooks/useAssistantPanel.ts` is required to merge (binding project gate).

---

## 7. Design Dependencies

A companion **design-plan** (`docs/plans/2026-06-30-agent-assistant-panel.design.md`) is being
authored separately by `design-architect` and owns:
- Layout: panel grid column, width token (AP-OD-003 default = 360px), breakpoint behavior
  (collapsed ≤768px? hidden? — design-plan decides).
- Visual: bubble styles for user / assistant / tool-card / status-notice / empty-state,
  streaming indicator animation.
- IxD: Enter-to-send vs button-click affordance, Stop button placement, chip style.
- All DESIGN.md token references (colors, radii, shadows, spacing, typography).
- Responsive / mobile: whether the panel is accessible on narrow viewports (drawer overlay?).
- WCAG specifics: contrast ratios for each bubble type.

This spec owns **behavior and ACs**; the design-plan owns **appearance and token choices**.
Where a visual detail is mentioned here (e.g. "muted icon" for tool cards, "subtle treatment"),
the design-plan is the source of truth. Any conflict between this spec and the design-plan on
purely visual matters resolves in favor of the design-plan. Any conflict on behavior or a11y
resolves in favor of this spec.

The `ui-implementer` MUST read both documents before building and flag any inconsistency to the
Director.

---

## 8. Open Questions for the Director (≤5, each with a recommendation)

**AP-OQ-001 — Drawer vs. `inert`-on-close approach vs. unmount-on-close.**
Should `AssistantPanel` be kept permanently mounted (with `inert` when closed) to preserve
transcript state across route changes, or unmounted on close (simpler, but transcript is lost)?
**Recommendation: keep mounted with `inert` when closed** — FR-AP-003 requires the transcript to
persist while the panel has an active run; unmounting would abort the `subscribe` iterable and
lose the run. If transcript persistence across page reloads (AP-OD-005) is added later, move
transcript state to `localStorage`; this approach is forward-compatible.

**AP-OQ-002 — Escape behavior while a run is in flight.**
NFR-AP-A11Y-001 says Escape while a run is in flight cancels the run rather than closing the panel.
This is a deliberate UX choice (avoids accidentally losing an in-progress response). Is this the
right trade-off, or should Escape always close and also cancel?
**Recommendation: two-stage Escape** — first Escape cancels the run (if one is in flight); a second
Escape (or Escape when idle) closes the panel. Mirrors browser behavior for "stop" on a loading page.
Confirm before the design-plan locks IxD.

**AP-OQ-003 — Mobile viewport handling.**
The AppShell grid uses `--rail-w` and media queries at 921px; a 360px assistant panel would conflict
with the Rail on narrow viewports. Should the assistant panel behave as a full-screen overlay on
mobile (≤768px), or be suppressed (keyboard-only ⌘J anyway)?
**Recommendation: full-screen overlay on mobile** (z-index above main, slide-in from right, same
Escape/backdrop dismiss pattern as the mobile Rail drawer). The design-plan owns the exact
breakpoint. Confirm.

**AP-OQ-004 — `AgentRuntimeContext` vs. prop injection.**
FR-AP-024 says the `AgentRuntime` is injected via a React context or prop. Context is simpler for
deeply nested panel internals; a prop makes the dependency explicit and easier to mock in tests.
**Recommendation: React context (`AgentRuntimeContext`)**, constructed once at `App.tsx` root inside
the flag-on branch, with the mocked runtime provided via context in tests. Follows the established
pattern of Supabase client context. Confirm before the implementer picks a pattern.

**AP-OQ-005 — Transcript persistence across reloads (AP-OD-005 default: off).**
AP-OD-005 defaults to React state only (no `localStorage`). Should the design-plan include a
"conversation history" list (multiple past runs) as a future design surface, even if not built in A2?
**Recommendation: yes, note the history affordance as a deferred design surface** in the design-plan
(a "Recent conversations" section above the active transcript, populated from a future
`agent_runs` table). A2 does not implement it, but the panel's layout should leave room for it so
A2's design is not a dead end. Flag to the design-architect.

---

## 9. Out of Scope (explicit — owned by later A-issues)

- Write `AgentAction`s + `confirm:true` → `needs-approval` approve/deny chips → **A3**.
- `artifact` `AgentEvent`s + I3 renderer slot in the panel → **A4**.
- `AgentNativeRuntime` sidecar adapter → **B-adapter, deferred**.
- Durable `agent_runs` / transcript table + run history UI → later.
- Per-user token-budget display in the panel UI → later (backend `RateGuard` is the A1 gate).
- Markdown rendering of assistant text → later (plain text is the safe, sufficient first cut).
- Any Anthropic API call outside `supabase/functions/agent-chat/`.
