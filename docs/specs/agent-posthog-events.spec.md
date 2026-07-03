# Feature: PostHog agent analytics events (batteries-included A, item 4)

> **Authority:** ADR-0022 (PostHog product analytics, Accepted) decides the vendor/facade
> architecture; this spec is the **agent-surface event contract** built on top of it, per ADR-0043
> §5 ("On write, the client also emits a PostHog event... the DB row is the durable record, PostHog
> is the analytics feed"). Where this spec and ADR-0022 could be read to disagree, **ADR-0022 wins**
> on facade/privacy architecture — file an issue, don't ship the divergence. Related: ADR-0040
> (Option A `AssistantPanel`/`useAssistantPanel`), ADR-0043 (agent persistence — `agent_threads`/
> `agent_runs`/`agent_events`, the feedback columns this spec's `feedback_rated` event reports
> alongside), ADR-0036 (deputy invariant — analytics is observational only, never a write path),
> ADR-0010 (test pyramid). Glossary: Assistant (deputy invariant).

## Overview

The agent panel (`AssistantPanel` + `useAssistantPanel`, ADR-0040 Option A) has no analytics
instrumentation today — `docs/specs/posthog-instrumentation.spec.md` covers route tracking, auth,
and generic UI events, but never the agent surface. Product needs to answer basic usage questions
(how often is the panel opened, how long do runs take, how often are writes approved vs. denied, is
feedback trending negative) without capturing any conversation content — the DB (`agent_events.text`
/`payload`, ADR-0043) is the durable content record; PostHog is purely the aggregate usage feed.

This spec adds a small, fixed set of agent-surface events to the existing `src/lib/analytics/*`
facade (ADR-0022), following the exact pattern of `trackAuthLoginSucceeded`/
`trackFormValidationFailed` etc. — typed helper functions, `AnalyticsEventName` union extension,
`buildEventProperties` sanitizer reuse (no new privacy surface). No new vendor, no new
initialization path, no new privacy posture: this is additive event names + call sites only.

**User value (indirect — this is a product-analytics feature, not an end-user-facing one):** *As
the product owner, I want to see how the assistant is actually used — opens, run outcomes,
approval/denial rates, and feedback sentiment — so I can prioritize what to fix next, without ever
seeing what any user actually typed or the assistant actually said.*

This is the whole of backlog "batteries-included A" item 4. Credits/metering (item 3, separate),
PostHog dashboard construction (ADR-0022 "Watch": a required follow-up, not this issue), and any
new PostHog capability (feature flags, surveys, group analytics) are out of scope.

---

## Functional Requirements

### Event contract — extend the existing facade, not a new one

**FR-APH-001 — Nine agent event names added to `AnalyticsEventName`.**
The system shall extend `src/lib/analytics/events.ts`'s `AnalyticsEventName` union with exactly:
`agent_panel_opened`, `agent_run_started`, `agent_run_completed`, `agent_run_errored`,
`agent_approval_shown`, `agent_approval_decided`, `agent_thread_resumed`, `agent_feedback_rated`,
`agent_compose_view_saved` — no additional agent event names beyond this set without a spec
amendment.

**FR-APH-002 — Each event has a typed helper builder, following the existing pattern.**
The system shall provide one `trackAgent*` helper function per event name in
`src/lib/analytics/events.ts` (mirroring `trackFormValidationFailed`/`trackSaveFailed`'s
`TrackedEvent`-returning shape), so call sites never construct the `{event, properties}` shape
by hand.

**FR-APH-003 — Properties are ids/enums/counts only — reuses the existing sanitizer, no new
allowlist needed.**
The system shall pass every agent event's properties through the existing
`buildEventProperties`/`FORBIDDEN_PROPERTY_KEYS` sanitizer path (via `analyticsClient.capture`,
unchanged) — no agent event property is or ever contains message text, tool arguments, tool
results, thread titles, or any other user- or model-generated string content; only `run_id`/
`thread_id` (opaque uuids, already non-PII under the existing contract), enum-valued strings,
booleans, and numeric counts/durations are sent.

### Event → property contract

**FR-APH-004 — `agent_panel_opened`.**
When the assistant panel transitions from closed to open (`useAssistantPanel`'s `openPanel`), the
system shall fire `agent_panel_opened` with `{ has_scope: boolean }` (whether the panel was opened
with a bound entity scope, e.g. from a Project page's "Ask the assistant" entry point — the scope
`type`/`id`/`label` values themselves are never sent, only whether one is present).

**FR-APH-005 — `agent_run_started`.**
When a new run begins (`useAssistantPanel.send()` calling `runtime.createRun`, or `retry()`
creating a fresh run), the system shall fire `agent_run_started` with `{ run_id: string,
is_retry: boolean }`.

**FR-APH-006 — `agent_run_completed`.**
When a run's terminal status resolves to `'completed'` (the `type='status'`
`payload.status === 'completed'` branch in `useAssistantPanel`'s drain loop), the system shall fire
`agent_run_completed` with `{ run_id: string, duration_ms: number, tool_round_count: number }`,
where `duration_ms` is measured client-side from `agent_run_started`'s emission to this event's
emission for the same `run_id`, and `tool_round_count` counts `type='tool'` events observed in the
drained transcript for that run.

**FR-APH-007 — `agent_run_errored`.**
When a run's terminal status resolves to `'errored'` (the drain loop's errored branch, excluding
the informational `TURN_CAP` step-cap notice per the existing `payload.error === 'TURN_CAP'`
distinction already made in `useAssistantPanel`), the system shall fire `agent_run_errored` with
`{ run_id: string, duration_ms: number, tool_round_count: number, error_code: string }`, where
`error_code` is the existing enum-like `payload.error` value already present on the status event
(never a free-text error message).

**FR-APH-008 — `agent_approval_shown`.**
When a `needs-approval` status event is drained (the A3 pause branch — `ApprovalChip` becomes
visible), the system shall fire `agent_approval_shown` with `{ run_id: string }` — the proposed
write's summary/args are never sent.

**FR-APH-009 — `agent_approval_decided`.**
When the user resolves a pending approval — `approve()` or `deny()` in `useAssistantPanel`, or
equivalently the `write_resolved` system event's `decision` field observed in the drain loop — the
system shall fire `agent_approval_decided` with `{ run_id: string, decision: 'approved' |
'denied' }`.

**FR-APH-010 — `agent_thread_resumed`.**
When a thread is opened/resumed (`useAssistantPanel.openThread`), the system shall fire
`agent_thread_resumed` with `{ thread_id: string, run_id: string | null, event_count: number }`,
where `event_count` is the number of persisted events restored into the transcript.

**FR-APH-011 — `agent_feedback_rated`.**
When the user rates an assistant event via `FeedbackControl`'s `onRate` callback, the system shall
fire `agent_feedback_rated` with `{ rating: 'up' | 'down', downvote_reason: string | undefined }`
(the existing `DownvoteReason` enum value verbatim when present) — the event's `id`/`run_id` and
the assistant's actual text are never sent (rating trends are the analytics need; correlating a
specific rated message to its content is a DB-side/ADR-0043 concern, not a PostHog one).

**FR-APH-012 — `agent_compose_view_saved`.**
When a `compose_view` artifact is saved from the transcript (the existing
`useComposeArtifact`/`ArtifactSlot` save flow), the system shall fire `agent_compose_view_saved`
with `{ run_id: string }` — the composed view's title, prompt, or spec are never sent.

### Gating & failure posture

**FR-APH-013 — Gated behind `agentAssistant`, layered on top of the existing analytics gate.**
The system shall fire agent events only when both `isFeatureEnabled('agentAssistant')` is true
**and** the existing `AnalyticsProvider`/`analyticsClient` gate (`VITE_DEMO_MODE=true` or
`VITE_ANALYTICS_ENABLED=true`, ADR-0022) is active; with either gate off, no agent event call site
executes any PostHog SDK call (the existing `analyticsClient.capture` no-ops when
`!initialized || !activeConfig?.enabled`, so the feature-flag check is a defensive early-return at
the call site, not a new capability the facade needs to grow).

**FR-APH-014 — Fire-and-forget; never blocks or throws into the caller's control flow.**
The system shall treat every `trackAgent*` call as fire-and-forget: a call site invokes it
synchronously (no `await`), and `analyticsClient.capture`'s existing no-op-on-uninitialized /
try-safe posture means a PostHog delivery failure (network error, ad-blocker) never throws into or
delays the panel's own state transitions (drain loop, approval flow, feedback UI).

---

## Observed / legacy behavior to preserve (OBS)

**OBS-APH-001 — `analyticsClient`/`buildEventProperties`/`FORBIDDEN_PROPERTY_KEYS` are unchanged.**
This spec adds event names and call sites only; `src/lib/analytics/client.ts`'s init/capture/
identify/register/reset surface and the sanitizer in `events.ts` are not modified beyond the
`AnalyticsEventName` union extension (FR-APH-001).

**OBS-APH-002 — No Sentry, no new vendor.** Per ADR-0022's decision (PostHog, not Sentry, for
product analytics) and this issue's explicit scope, this spec introduces no error-tracking/APM
vendor; `agent_run_errored`'s `error_code` is a coarse product-analytics signal, not a replacement
for structured server-side error logging (which already exists per `NFR-AR-SEC-005`/
`NFR-AGP-SEC-005`, unaffected here).

**OBS-APH-003 — The DB feedback columns are the durable record; PostHog is the feed.** Per ADR-0043
§5, `agent_events.rating`/`downvote_reason` (written via `rateAgentEvent`, already shipped) remain
the system of record for feedback; `agent_feedback_rated` (FR-APH-011) is an **additional**
observational emit alongside that write, not a replacement path, and its failure/absence never
affects whether the DB write succeeds.

---

## Non-Functional Requirements

### Privacy (the binding constraint for this issue)

- **NFR-APH-PRIV-001 — No message/prompt/tool-argument/tool-result content in any agent event
  property, ever.** Every property listed in FR-APH-004..012 is exhaustive for its event; no call
  site may add an ad-hoc property beyond what its FR specifies without a spec amendment. Verified
  by a unit test asserting each `trackAgent*` helper's returned property **keys** exactly match its
  FR's declared set (a new key added later without updating both the FR and the test fails CI).
- **NFR-APH-PRIV-002 — `run_id`/`thread_id`/event `id` are the only identifiers sent, and only
  where explicitly named per-event above.** These are opaque server-generated uuids already
  non-sensitive under the existing PostHog contract (ADR-0022 registers `org_id` similarly); no
  event sends a user-entered title, scope label, or free-text field.
- **NFR-APH-PRIV-003 — Reuses the existing production-vs-dev sanitizer strictness.** Because agent
  events flow through the same `buildEventProperties` call as every other tracked event, a
  forbidden key or unsafe (object) value throws in dev/test (fail loud) and is silently dropped in
  prod (fail safe) — identical posture to the rest of the facade; no bespoke agent-event validation
  path is introduced.

### Reliability

- **NFR-APH-REL-001 — Fire-and-forget, never awaited, never in a try/catch that could suppress a
  real UX error.** Per FR-APH-014, `trackAgent*` calls are synchronous, unawaited statements placed
  alongside (not wrapping) the panel's real state transitions; a test asserts that a thrown/rejected
  analytics call (simulated via a mocked `analyticsClient.capture` that throws) does not prevent the
  triggering state transition (e.g. `phase` still reaches `'idle'` after a completed run) from
  completing.
- **NFR-APH-REL-002 — Duration measurement tolerates a missing start.** Where `agent_run_completed`/
  `agent_run_errored`'s `duration_ms` (FR-APH-006/007) cannot be computed because no matching
  `agent_run_started` was observed for that `run_id` in the current client session (e.g. panel
  opened mid-thread-resume, not mid-run), the system shall omit `duration_ms` (send `undefined`,
  which `buildEventProperties` already passes through as a `SafeValue`) rather than send a
  fabricated or negative value.

### Performance

- **NFR-APH-PERF-001 — No additional network round-trip beyond the existing PostHog capture
  pipeline.** Agent events use the same batched `posthog-js` capture call as every other tracked
  event (ADR-0022); this spec adds no new transport, no synchronous XHR, no blocking call.

---

## Acceptance Criteria

> Layer per ADR-0010: **Unit** (Vitest, `posthog-js`/`analyticsClient` mocked, mirrors
> `client.test.ts`/`AnalyticsProvider.test.tsx`'s existing mock pattern) owns every AC in this
> spec — the agent event contract is pure client-side instrumentation logic with no cross-stack
> round-trip of its own (the underlying panel/persistence behavior it observes is already covered
> by `agent-persistence.spec.md`'s ACs). No new e2e journey is added by this issue.

**AC-APH-001 — `agent_panel_opened` fires on open with `has_scope`. [Unit]**
Given the assistant panel is closed and `useAssistantPanel.openPanel()` is called with no bound
scope,
When the panel transitions to open,
Then `analyticsClient.capture` is called once with event `'agent_panel_opened'` and properties
`{ has_scope: false }`.

**AC-APH-002 — `agent_panel_opened` reports `has_scope: true` when opened onto a bound entity. [Unit]**
Given the panel is opened via a scoped entry point (e.g. a Project page's assistant affordance)
carrying a non-null `scope`,
When the panel opens,
Then `agent_panel_opened` fires with `{ has_scope: true }`.

**AC-APH-003 — `agent_run_started` fires on a new run, `is_retry: false`. [Unit]**
Given no active run,
When `send()` creates a new run via `runtime.createRun`,
Then `agent_run_started` fires with `{ run_id: <new run id>, is_retry: false }`.

**AC-APH-004 — `agent_run_started` reports `is_retry: true` from `retry()`. [Unit]**
Given a prior run ended in error and `retry()` is invoked,
When the fresh run is created,
Then `agent_run_started` fires with `{ run_id: <new run id>, is_retry: true }`.

**AC-APH-005 — `agent_run_completed` fires once on clean completion with duration and tool-round
count. [Unit]**
Given a run started at `t0` that streams two `type='tool'` events and then a `status`/`completed`
event at `t1`,
When the drain loop processes the completed status event,
Then `agent_run_completed` fires exactly once with `{ run_id, duration_ms: t1 - t0 (approximately,
via a fake/injected clock), tool_round_count: 2 }`.

**AC-APH-006 — `agent_run_errored` fires on a genuine error, not on the `TURN_CAP` step-cap
notice. [Unit]**
Given a run's status event resolves to `errored` with `payload.error = 'TURN_CAP'`,
When the drain loop processes it,
Then `agent_run_errored` is **not** fired (mirrors the existing informational-vs-error branch);
and given a **different** `payload.error` value (e.g. `'PROVIDER_ERROR'`),
When the drain loop processes that event,
Then `agent_run_errored` fires with `{ run_id, duration_ms, tool_round_count, error_code:
'PROVIDER_ERROR' }`.

**AC-APH-007 — `agent_approval_shown` fires when a needs-approval event is drained. [Unit]**
Given a run's status event resolves to `needs-approval`,
When the drain loop processes it,
Then `agent_approval_shown` fires with `{ run_id }` — no summary/args property present.

**AC-APH-008 — `agent_approval_decided` fires with `decision: 'approved'` on approve. [Unit]**
Given a pending approval chip,
When the user's `approve()` call resolves (or the `write_resolved` system event with
`decision:'approved'` is drained),
Then `agent_approval_decided` fires with `{ run_id, decision: 'approved' }`.

**AC-APH-009 — `agent_approval_decided` fires with `decision: 'denied'` on deny. [Unit]**
Given a pending approval chip,
When the user's `deny()` call resolves (or the `write_resolved` system event with
`decision:'denied'` is drained),
Then `agent_approval_decided` fires with `{ run_id, decision: 'denied' }`.

**AC-APH-010 — `agent_thread_resumed` fires on `openThread` with the restored event count. [Unit]**
Given a thread with a run containing 5 persisted events,
When `openThread(threadId, runId)` resolves,
Then `agent_thread_resumed` fires with `{ thread_id: threadId, run_id: runId, event_count: 5 }`.

**AC-APH-011 — `agent_feedback_rated` fires with rating only on thumbs-up. [Unit]**
Given `FeedbackControl`'s `onRate` is invoked with `('evt-1', 'up', undefined)`,
When the rate handler runs,
Then `agent_feedback_rated` fires with `{ rating: 'up', downvote_reason: undefined }` — no
`eventId`/`run_id` property present.

**AC-APH-012 — `agent_feedback_rated` fires with rating and reason on thumbs-down. [Unit]**
Given `onRate` is invoked with `('evt-1', 'down', 'wrong_tool')`,
When the rate handler runs,
Then `agent_feedback_rated` fires with `{ rating: 'down', downvote_reason: 'wrong_tool' }`.

**AC-APH-013 — `agent_compose_view_saved` fires on a successful compose-view save. [Unit]**
Given a `compose_view` artifact's save action succeeds,
When the save completes,
Then `agent_compose_view_saved` fires with `{ run_id }` — no title/prompt/spec property present.

**AC-APH-014 — No agent event fires when `agentAssistant` is off. [Unit]**
Given `isFeatureEnabled('agentAssistant')` returns `false`,
When any of the trigger conditions above occurs (panel open, run start, etc. — simulated via direct
helper/hook invocation bypassing the normally-hidden UI),
Then no `trackAgent*` call site invokes `analyticsClient.capture`.

**AC-APH-015 — No agent event fires when analytics itself is disabled (existing gate). [Unit]**
Given `agentAssistant` is on but `analyticsClient`'s own gate is inactive (mirrors
`client.test.ts`'s existing "capture no-ops when not initialized" case),
When a trigger condition occurs,
Then `posthog.capture` (the underlying mocked SDK call) is never invoked — proving the two gates
compose (FR-APH-013) without the agent layer needing its own separate suppression logic.

**AC-APH-016 — Every `trackAgent*` helper's property keys exactly match its FR's declared set. [Unit]**
Given each of the nine `trackAgent*` helpers,
When its returned `TrackedEvent.properties` object's keys are inspected for a representative call,
Then the key set is exactly the set named in that event's FR (FR-APH-004..012) — no extra key, no
missing key (this is the enforcement mechanism for NFR-APH-PRIV-001).

**AC-APH-017 — A thrown/rejected analytics call does not block the real state transition. [Unit]**
Given `analyticsClient.capture` is mocked to throw synchronously,
When a run completes (triggering `agent_run_completed`),
Then the panel's `phase` still transitions to `'idle'` and no unhandled rejection/thrown error
propagates out of the drain loop (NFR-APH-REL-001).

---

## Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-APH-001 | Unit | `AC-APH-001 agent_panel_opened fires on open` (`pmo-portal/src/hooks/useAssistantPanel.analytics.test.ts`) |
| AC-APH-002 | Unit | `AC-APH-002 agent_panel_opened has_scope true when scoped` |
| AC-APH-003 | Unit | `AC-APH-003 agent_run_started fires on new run` |
| AC-APH-004 | Unit | `AC-APH-004 agent_run_started is_retry true from retry` |
| AC-APH-005 | Unit | `AC-APH-005 agent_run_completed fires with duration and tool_round_count` |
| AC-APH-006 | Unit | `AC-APH-006 agent_run_errored excludes TURN_CAP, fires on real error` |
| AC-APH-007 | Unit | `AC-APH-007 agent_approval_shown fires on needs-approval` |
| AC-APH-008 | Unit | `AC-APH-008 agent_approval_decided approved on approve` |
| AC-APH-009 | Unit | `AC-APH-009 agent_approval_decided denied on deny` |
| AC-APH-010 | Unit | `AC-APH-010 agent_thread_resumed fires with event_count` |
| AC-APH-011 | Unit | `AC-APH-011 agent_feedback_rated up, no reason` (`pmo-portal/src/components/panel/FeedbackControl.analytics.test.tsx`) |
| AC-APH-012 | Unit | `AC-APH-012 agent_feedback_rated down with reason` |
| AC-APH-013 | Unit | `AC-APH-013 agent_compose_view_saved fires on save` (`pmo-portal/src/hooks/useComposeArtifact.analytics.test.ts`) |
| AC-APH-014 | Unit | `AC-APH-014 no agent event fires when agentAssistant off` (`pmo-portal/src/lib/analytics/events.agent.test.ts`) |
| AC-APH-015 | Unit | `AC-APH-015 no agent event fires when analytics gate inactive` |
| AC-APH-016 | Unit | `AC-APH-016 trackAgent* property keys match FR-declared set` |
| AC-APH-017 | Unit | `AC-APH-017 thrown analytics call does not block phase transition` |

---

## SoD & Security (OWASP / STRIDE)

**Information disclosure (STRIDE-I, OWASP A01/A09 — the only STRIDE category materially in play).**
The entire risk surface of this spec is "does an agent event leak conversation content to a
third-party vendor." NFR-APH-PRIV-001/002/003 close this: every event's property set is exhaustively
named in its owning FR, enforced by AC-APH-016 (a key-set equality test, not a spot-check), and
routed through the existing `buildEventProperties` denylist/dev-throw/prod-drop posture — no new
attack surface, no new vendor, no code path that could accidentally interpolate `event.text` or
`event.payload` into a property object (both are simply never read by any `trackAgent*` call site).

**No new write/authorization surface.** This is an observational feature: no `trackAgent*` call
ever mutates `agent_threads`/`agent_runs`/`agent_events` or any other table; the deputy invariant
(ADR-0036 §2) is unaffected because analytics has no server-side component beyond the existing
PostHog ingest endpoint the facade already talks to.

**Depth note (model-tiering).** This is a small, client-only, additive-event-names issue with one
well-understood privacy invariant (no content in properties) already enforced by a reusable
sanitizer; security-auditor should confirm the property-set claims (AC-APH-016) and move on — not a
deep-dive issue.

---

## Error Handling

| Error condition | Surface / code | User message |
|---|---|---|
| PostHog capture call throws/rejects (network, ad-blocker, malformed init) | Swallowed by the existing `analyticsClient.capture` no-op guard + fire-and-forget call sites (NFR-APH-REL-001) | None — no UI surface; the panel behaves identically with or without analytics delivery. |
| `agentAssistant` flag off | Call site early-returns before invoking `trackAgent*` (FR-APH-013) | None — not a user-facing condition. |
| Analytics gate (`VITE_DEMO_MODE`/`VITE_ANALYTICS_ENABLED`) inactive | `analyticsClient.capture` already no-ops (existing behavior, AC-APH-015) | None. |
| No matching `agent_run_started` found for a `run_id` at completion/error time | `duration_ms` omitted, event still fires with the remaining properties (NFR-APH-REL-002) | None — the completion/error UX itself is unaffected; this is a data-completeness nuance in PostHog only. |

---

## Implementation TODO

### Facade (event contract)

- [ ] `src/lib/analytics/events.ts`: extend `AnalyticsEventName` with the nine `agent_*` names
      (FR-APH-001); add `trackAgentPanelOpened`, `trackAgentRunStarted`, `trackAgentRunCompleted`,
      `trackAgentRunErrored`, `trackAgentApprovalShown`, `trackAgentApprovalDecided`,
      `trackAgentThreadResumed`, `trackAgentFeedbackRated`, `trackAgentComposeViewSaved` helper
      builders (FR-APH-002), each returning a `TrackedEvent` with exactly the property set named in
      its FR.
- [ ] `src/lib/analytics/index.ts`: export the nine new helpers alongside the existing
      `trackDemoPersonaSelected`/`trackAuthLoginSucceeded`/etc. pattern (thin wrappers calling
      `analyticsClient.capture`, guarded by `isFeatureEnabled('agentAssistant')` per FR-APH-013).
- [ ] Unit tests: `src/lib/analytics/events.agent.test.ts` (AC-APH-014..016).

### Call sites (hook + components)

- [ ] `src/hooks/useAssistantPanel.ts`: call the panel-open/run-started/run-completed/run-errored/
      approval-shown/approval-decided/thread-resumed helpers at the points named in FR-APH-004..010
      (drain loop branches already distinguish `completed`/`needs-approval`/`errored`/`TURN_CAP` —
      the emit calls are added alongside the existing `setPhase`/`setTranscript` calls, never
      replacing them). Track `run_id → start timestamp` in a ref (cleared on `newConversation`) to
      compute `duration_ms` (NFR-APH-REL-002 covers the missing-start case).
- [ ] `src/components/panel/FeedbackControl.tsx` (or its `onRate` caller in `AssistantPanel.tsx`):
      call `trackAgentFeedbackRated` alongside the existing `rateAgentEvent` DB write (FR-APH-011,
      OBS-APH-003 — additive, not a replacement).
- [ ] `useComposeArtifact.ts` (or `ArtifactSlot.tsx`'s save handler): call
      `trackAgentComposeViewSaved` on successful save (FR-APH-012).
- [ ] Unit tests: `useAssistantPanel.analytics.test.ts` (AC-APH-001..010, 017),
      `FeedbackControl.analytics.test.ts` (AC-APH-011/012), `useComposeArtifact.analytics.test.ts`
      (AC-APH-013).

### Gates

- [ ] Full `npm run verify` before PR (typecheck/lint/test/build) — this issue touches no schema,
      RLS, or e2e surface, so no pgTAP/Playwright work is added.

---

## Out of Scope (deferred)

- **PostHog dashboard construction.** ADR-0022's "Watch" already flags dashboard setup as a required
  follow-up after the event contract lands — this issue lands the contract, not the dashboards.
- **Sentry / any error-tracking or APM vendor.** Explicitly excluded per the issue brief and
  ADR-0022's decision (PostHog for product analytics; Sentry considered and rejected as the primary
  tool in ADR-0022's Context). `agent_run_errored.error_code` is a coarse product-analytics signal
  only.
- **A "frustration index" derived from feedback (rephrase/retry/abandon).** ADR-0043 §5 names this
  explicitly as "a later PostHog-side insight, not a schema field here" — and, by extension, not an
  event this issue defines either; it would be a PostHog-side computation over the events this spec
  ships, not a new emitted event.
- **Server-side / edge-function PostHog emission.** All nine events are client-side only (the panel
  already has the state needed); the edge fn (`agent-chat`) emits no PostHog events in this issue.
- **Credits/usage-cost properties on any agent event.** Batteries-included A item 3 (metering) is a
  separate issue; no agent event in this spec carries token counts, model name, or cost.
- **New PostHog capabilities** (feature flags, surveys, group analytics, session replay for the
  panel). ADR-0022 already defers these generally; this issue does not revisit that.

---

## Contradictions / conflicts flagged against existing code & locked decisions

None found. ADR-0022 (facade architecture) and ADR-0043 §5 (the feedback-event forward-reference
this issue fulfills) are both Accepted and in agreement; this spec adds event names and call sites
within their existing boundaries with no attempted revision of either.

## Open Questions

None blocking. Two mechanical choices are left to the eng-plan (consistent with the
Companies/`user_views`/agent-persistence precedent of letting the plan pick exact file names):

- Exact placement of the `run_id → start timestamp` tracking ref inside `useAssistantPanel`
  (module-scope `Map` vs. a `useRef<Map>`) — an implementation detail, not a behavior decision;
  either satisfies FR-APH-006/007's `duration_ms` requirement and NFR-APH-REL-002's missing-start
  fallback identically.
- Whether `trackAgentFeedbackRated`/`trackAgentComposeViewSaved` are called from the hook layer
  (`useAssistantPanel`) or directly from the component (`FeedbackControl`/`ArtifactSlot`) — both are
  fire-and-forget with no state dependency either way; the eng-plan picks whichever keeps the call
  site closest to the existing `rateAgentEvent`/save-handler call for auditability.
