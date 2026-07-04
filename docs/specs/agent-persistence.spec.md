# Feature: Agent thread/event persistence & run lifecycle (batteries-included A, item 2)

> **Authority:** ADR-0043 (Accepted, 2026-07-03). This spec **operationalizes** ADR-0043 — table
> shapes, RLS posture, the tool-call journal, the heartbeat, and the feedback columns are decided
> there; this document turns those decisions into FR/OBS/NFR/AC with test-layer ownership. Where
> this spec and ADR-0043 could be read to disagree, **ADR-0043 wins** — file an issue, don't ship
> the divergence. Related: ADR-0040 (`AgentRuntime` port — `AgentRun`/`AgentEvent` shapes, unchanged
> here), ADR-0039 (single LLM call site, caller-JWT deputy), ADR-0036 (deputy invariant + `user_views`
> tenant-entity pattern), ADR-0018 (soft-archive), ADR-0016/0017 (real-JWT + repository seam),
> ADR-0010 (test pyramid), ADR-0022 (PostHog — consumed, not built, here).
> Glossary: Assistant (deputy invariant).

## Overview

Today the agent panel (`AssistantPanel` + `useAssistantPanel`, ADR-0040 Option A) is **stateless**:
`agentChatHandler` (`supabase/functions/agent-chat/handler.ts`) streams `AgentEvent`s over SSE
(`transport.ts`), each `AgentChatRequest` replays the full `messages` array (D8), and the transcript
lives only in the browser's React state. Reload, navigate away, or switch devices, and the
conversation is gone — no audit trail of what the agent read or wrote, and a dropped SSE mid-turn
can leave the model re-attempting (or believing it never attempted) a write it already made.

This feature adds the storage + lifecycle layer under the existing `AgentRuntime` port
(`pmo-portal/src/lib/agent/runtime/port.ts`) — three ordinary PMO tenant entities
(`agent_threads`, `agent_runs`, `agent_events`), owner-only RLS, a tool-call journal for durable
resume, a progress heartbeat for stuck-run detection, and per-event feedback columns — plus the
edge-fn and panel-UI changes to write and read them. The port's TypeScript contract
(`AgentRun`/`AgentEvent`) is **unchanged**; these tables are its durable backing, mapped 1:1.

**User value:** *When I use the assistant, I want my conversation to survive a reload or a dropped
connection, and I want to see when it's stuck instead of staring at a frozen spinner — so I trust
it enough to use it for real work.*

This is the whole of backlog "batteries-included A" item 2. Credits/metering (item 3), PostHog
events (item 4), widgets/ask-user (ADR-0045), automations (ADR-0044), and thread sharing/fork are
explicitly out of scope (see Out of Scope).

---

## Functional Requirements

### Schema — `agent_threads` (ADR-0043 §1)

**FR-AGP-001 — `agent_threads` table.**
The system shall provide an `agent_threads` table with `id`, `org_id` (not null, default seed-org),
`owner_id` (not null, default `auth.uid()`), `title` (not null, default `'New conversation'`),
`scope` (nullable `jsonb`), `pinned_at` (nullable `timestamptz`), `created_at`, `updated_at`, and
`archived_at` (nullable, soft-archive per ADR-0018) — exactly the columns of ADR-0043 §1.

**FR-AGP-002 — `scope` is a hint, not an authorization input.**
Where a thread's `scope` names a bound entity (`{type, id, label}`), the system shall use it **only**
for grouping/continuity in the UI (e.g. "the assistant thread for Project X") and shall **never**
use it to grant or deny access; a dangling `scope.id` (its referenced row archived/deleted) shall
degrade gracefully to displaying `scope.label` alone, without erroring.

### Schema — `agent_runs` + `agent_events` (ADR-0043 §2)

**FR-AGP-003 — `agent_runs` table.**
The system shall provide an `agent_runs` table with `id`, `thread_id` (FK → `agent_threads`, `on
delete cascade`), `org_id`, `owner_id`, `title` (default `''`), `status` (constrained to
`'queued'|'running'|'paused'|'needs-approval'|'completed'|'errored'`, mapping `AgentRunStatus`),
`progress` (nullable numeric 0..1), `last_progress_at` (nullable timestamptz, the heartbeat),
`progress_step` (nullable text), `created_at`, `updated_at` — exactly ADR-0043 §2.

**FR-AGP-004 — `agent_events` table.**
The system shall provide an `agent_events` table with `id`, `run_id` (FK → `agent_runs`, `on delete
cascade`), `org_id`, `owner_id`, `seq` (not null bigint), `type` (constrained to
`'user'|'assistant'|'tool'|'artifact'|'status'|'system'`, mapping `AgentEventType`), `text`
(nullable), `payload` (nullable jsonb), `tool_name`/`tool_args_hash`/`tool_status` (nullable, §3
journal columns), `rating`/`downvote_reason` (nullable, §5 feedback columns), `created_at` —
exactly ADR-0043 §2.

**FR-AGP-005 — `seq` is the transcript order, not `created_at`.**
The system shall assign `agent_events.seq` as a per-`run_id` monotonic counter as the edge fn emits
each event, and shall order every transcript read by `(run_id, seq)` — never by `created_at`, which
may tie within a turn.

**FR-AGP-006 — Indexes.**
The system shall index `agent_events (run_id, seq)`, `agent_runs (thread_id, created_at)`, and
`agent_threads (owner_id) where archived_at is null` — the ADR-0043 §2 hot-path set.

### RLS — owner-only, no Admin read (ADR-0043 §1/§2)

**FR-AGP-007 — Owner-only RLS on all three tables.**
The system shall enable and force RLS on `agent_threads`, `agent_runs`, and `agent_events`, gating
`SELECT`/`INSERT`/`UPDATE`/`DELETE` to `owner_id = auth.uid() and org_id = auth_org_id()`; `INSERT`
shall pin both `org_id` and `owner_id` via column default + `with check` (mirrors `user_views_insert`).

**FR-AGP-008 — No Admin read of another user's thread/run/event.**
Unlike `user_views` (OD-2), the system shall grant **no** cross-owner read to Admin on any of the
three tables — an agent conversation is more sensitive than a saved view. A cross-org OR
cross-owner query returns zero rows regardless of the requester's role.

**FR-AGP-009 — Append-only `agent_events`, except the feedback UPDATE.**
The system shall permit **no** `UPDATE`/`DELETE` on `agent_events` rows except the single narrow §5
feedback update (`rating`, `downvote_reason`), which shall additionally be constrained by `with
check` so a user may rate only their **own** events and may not alter `type`/`text`/`payload`/
`tool_name`/`tool_args_hash`/`tool_status` via that path.

### Edge-fn persistence — write path (ADR-0043 §2/§3/§4/§6)

**FR-AGP-010 — Thread creation on first message.**
When a user sends the first message of a new conversation (no `runId` present), the system shall
create an `agent_threads` row (if none is bound yet — e.g. a follow-up from a scoped entry point) and
an `agent_runs` row under it, both under the caller's JWT.

**FR-AGP-011 — Every streamed `AgentEvent` is persisted as an `agent_events` row.**
When the handler yields an `AgentEvent` over SSE, the system shall also insert a corresponding
`agent_events` row (same `id`, `type`, `text`, `payload`, assigned `seq`) under the caller's JWT,
so the persisted log is 1:1 with what the client saw modulo the client's own in-memory merge of
consecutive assistant chunks (FR-AGP-005's `seq` is what makes the merge reconstructable on reload).

**FR-AGP-012 — Tool-call journal populated on `type='tool'`.**
When the handler dispatches a tool call, the system shall populate `tool_name`, `tool_args_hash`
(sha-256 hex of the canonicalized, schema-validated args — stable key order), and `tool_status`
(`'completed'|'errored'`) on that event's row, in addition to `payload` carrying the result.

**FR-AGP-013 — Write de-dupe at the dispatch gate on resume.**
When a run resumes (reconnect after disconnect, or the client re-subscribes), the system shall load
that run's `type='tool'` events with `tool_status='completed'`, and for any subsequent **write**
tool call whose `(tool_name, tool_args_hash)` matches an already-journaled completed call, the
dispatch gate (`dispatchAction`/`dispatchActionForced`, the same single site ADR-0040's
`NFR-AW-SEC-001` funnels writes through) shall **not** call `action.run` again — it shall return the
journaled `payload` result as the tool_result. A **read** tool call (`confirm:false`, no side
effect — e.g. `query_entity`) shall **never** be blocked this way; it always re-runs.

**FR-AGP-014 — Heartbeat updates.**
While a run is active, the system shall update `agent_runs.last_progress_at` (and optionally
`progress`, `progress_step`) on each tool round and each model turn, via an `UPDATE` under the
caller's JWT (owner RLS).

**FR-AGP-015 — Terminal status persisted.**
When a run reaches a terminal state (`completed` or `errored`) or `control(runId, 'cancel')` is
invoked, the system shall persist that status onto `agent_runs.status` in addition to emitting the
`type='status'` SSE event carrying the same value in `payload.status`.

**FR-AGP-016 — Client-disconnect continuation stays caller-JWT.**
Where the client disconnects mid-run (SSE socket drops, tab closes, navigation away), the system
shall continue the run server-side to a terminal status using the caller's JWT captured at request
start — **never** escalating to `service_role` — so the tool-call journal reaches a durable,
resumable state even though no browser is listening. This continuation is bounded by
`MAX_TOOL_ROUNDS` and the heartbeat/stuck path, not by an unbounded background job.

**FR-AGP-017 — Every write is under the caller's JWT; no `service_role`.**
The system shall write `agent_threads`/`agent_runs`/`agent_events` rows exclusively under the
caller's verified JWT (owner-only RLS enforces `owner_id`/`org_id`); no code path on the persistence
write side shall use a `service_role` client (the deputy invariant, ADR-0036 §2, is unchanged).

### Durable resume — reads vs. writes (ADR-0043 §3)

**FR-AGP-018 — Resume replays journaled context.**
When a run resumes, the system shall inject, into the model's replayed context, what already
executed (journaled tool name + result) for `tool_status='completed'` events, so the model does not
re-plan a step it already completed.

**FR-AGP-019 — Reads always re-run.**
A repeated read-only tool call on resume shall always execute again (never blocked by the journal),
because reads are idempotent under RLS and their underlying data may have legitimately changed.

### Panel UX — thread list, resume, stuck-run, feedback

**FR-AGP-020 — Thread list.**
While the panel is open, the system shall present a list of the current user's own recent threads
(most-recently-active first), with pinned threads (`pinned_at` not null) surfaced above unpinned
ones, scoped to the caller's `org_id`/`owner_id` (no other user's threads ever appear).

**FR-AGP-021 — Open/resume a thread restores transcript order.**
When a user opens a thread from the list (or reloads/returns to a thread already open), the system
shall fetch that thread's most recent run's events ordered by `(run_id, seq)` and render them in
that exact order, reproducing the original conversation sequence including tool/assistant/user
interleaving.

**FR-AGP-022 — Stuck-run banner keyed on heartbeat staleness.**
While a run's `agent_runs.status` is an active state (`running`/`paused`/`needs-approval`) and
`now() - last_progress_at` exceeds the staleness threshold, the panel shall display a stuck-run
banner offering **Retry** and **Cancel**, independent of the SSE connection's own liveness (a live
SSE can be silently wedged; a dropped SSE can be genuinely still working server-side).

**FR-AGP-023 — Retry and Cancel actions on the stuck-run banner.**
When the user selects **Cancel** on the stuck-run banner, the system shall invoke
`runtime.control(runId, 'cancel')`, driving the run to a terminal status. When the user selects
**Retry**, the system shall start a fresh run against the same thread (mirrors the existing `retry()`
behavior in `useAssistantPanel`).

**FR-AGP-024 — Per-assistant-event feedback (thumbs).**
While viewing a restored or live transcript, the system shall let the user mark any `assistant`
event `rating: 'up'` or `rating: 'down'`, persisted via the single narrow feedback `UPDATE`
(FR-AGP-009), scoped to events the user owns.

**FR-AGP-025 — Downvote category.**
When a user marks an `assistant` event `rating: 'down'`, the system shall additionally let them pick
one `downvote_reason` from `{inaccurate, not_helpful, wrong_tool, too_slow}`, persisted on the same
row.

### Feature-flag gating

**FR-AGP-026 — `agentAssistant` gates the whole persistence layer.**
The system shall gate every persistence write/read code path (thread/run/event creation, journal,
heartbeat, thread list, resume, stuck-run banner, feedback) behind the existing `agentAssistant`
flag (`VITE_FEATURES_AGENT_ASSISTANT`, `pmo-portal/src/lib/features.ts`) — the same flag gating the
panel itself. With the flag off, the migration still applies (tables exist unconditionally) but no
code path writes or reads them, so an environment without an LLM provider is unaffected.

---

## Observed / legacy behavior to preserve (OBS)

**OBS-AGP-001 — Stateless `AgentChatRequest` replay is unchanged (D8).** The client still POSTs the
full `messages` array each turn; persistence is an **additional** write path alongside the existing
SSE stream, not a replacement for it. (`transport.ts` `AgentChatRequest`.)

**OBS-AGP-002 — `AgentRun`/`AgentEvent` TypeScript shapes are unchanged.** `port.ts`'s
`AgentRun`/`AgentEvent`/`AgentRunStatus`/`AgentEventType` are the canonical shapes; this feature adds
no field to them. (ADR-0043 Scope: "does not change the port's TypeScript contract.")

**OBS-AGP-003 — A3 approve/deny flow is unchanged.** The `needs-approval` → re-POST-with-`decision`
protocol (`handleDecision`, `findTrailingConfirmToolUse`) is untouched; persistence records its
events (`needs-approval` status, `write_resolved` system event) like any other event, and the
dispatch-gate de-dupe (FR-AGP-013) applies identically whether a write executed via the normal loop
or via the approval branch (`dispatchActionForced`).

**OBS-AGP-004 — `dispatchAction`/`dispatchActionForced` remain the single write-dispatch sites
(NFR-AW-SEC-001).** The de-dupe check is added **inside** these existing gate functions, not as a
new parallel gate.

**OBS-AGP-005 — Companies/`user_views` tenant-entity pattern reused, not reinvented.** Table shape
(`id`/`org_id`/`owner_id`/timestamps/`archived_at`), RLS phrasing (`owner_id = auth.uid() and org_id
= auth_org_id()`), and the INSERT-pins-both pattern mirror `0045_user_views.sql` exactly, with the
one deliberate divergence being no Admin-read grant (FR-AGP-008).

---

## Non-Functional Requirements

### Security (OWASP / STRIDE)

- **NFR-AGP-SEC-001 — No `service_role` on any agent-persistence table, ever.** All reads and writes
  to `agent_threads`/`agent_runs`/`agent_events` go through the caller-JWT-scoped Supabase client;
  a `service_role` client is never constructed or passed on this path (deputy invariant, ADR-0036
  §2). Verified by a deputy-invariant gate test.
- **NFR-AGP-SEC-002 — Append-only integrity.** No code path other than the single feedback `UPDATE`
  may modify an existing `agent_events` row; this is enforced by RLS policy (not just application
  discipline), so a direct PostgREST call is equally blocked.
- **NFR-AGP-SEC-003 — `org_id` seam enforced server-side.** `org_id` is stamped via column default
  (`auth_org_id()`-equivalent seed-org default, consistent with `user_views`) and re-verified by
  `WITH CHECK`; a client-supplied cross-org `org_id` is preserved (not silently rewritten) so it
  hits `WITH CHECK` and is denied, per the 0015/0028/`user_views` pattern.
- **NFR-AGP-SEC-004 — Tool-args hash is a hash of *validated* args.** `tool_args_hash` is computed
  from the post-schema-validation, canonicalized args (stable key order) — never raw/untrusted
  model output — so the de-dupe key cannot be spoofed by cosmetic reordering, and a genuinely
  different write is never incorrectly de-duped.
- **NFR-AGP-SEC-005 — No prompt/row content in logs.** Persistence writes/reads follow the existing
  handler discipline (NFR-AR-SEC-005): server logs on error carry counts/codes, never event
  `text`/`payload` content.

### Performance

- **NFR-AGP-PERF-001 — Transcript fetch is indexed.** A thread-resume read is a single indexed query
  on `agent_events (run_id, seq)` (FR-AGP-006) — no N+1 per event.
- **NFR-AGP-PERF-002 — Heartbeat writes are cheap.** Each heartbeat `UPDATE` touches only
  `agent_runs.last_progress_at`/`progress`/`progress_step` on one row by primary key — bounded cost
  per tool round.

### Accessibility (WCAG 2.1 AA)

- **NFR-AGP-A11Y-001 — Stuck-run banner is announced.** The banner uses `role="status"`/`aria-live`
  consistent with the panel's existing status announcements (`useAssistantPanel`'s `needs-approval`
  status region pattern) so screen-reader users learn the run is stuck, not just visually.
- **NFR-AGP-A11Y-002 — Feedback controls are keyboard-operable with visible focus and programmatic
  labels** (thumbs buttons, downvote-reason picker), consistent with the panel's existing button
  patterns (`aria-label`, focus ring).
- **NFR-AGP-A11Y-003 — Thread list is a semantic list** with an accessible name per thread (title +
  pinned/recency state conveyed by text, not color alone).

---

## Acceptance Criteria

> Layer per ADR-0010: **pgTAP** for RLS/tenancy/append-only/feedback-update contracts; **Unit**
> (Vitest, SDK+Supabase mocked) for handler journal/de-dupe/heartbeat logic and panel components;
> **E2E** (Playwright, ONE curated cross-stack journey per ADR-0043 Verification). Each AC names its
> owning layer; the traceability table records the canonical owner.

### Schema & indexes

**AC-AGP-001 — Three tables exist with required columns. [pgTAP]**
Given the migration is applied,
When the schema is inspected,
Then `agent_threads`, `agent_runs`, `agent_events` each exist with exactly the columns of ADR-0043
§1/§2 (including `scope jsonb` nullable on threads, `last_progress_at`/`progress_step` on runs, and
the journal + feedback columns on events).

**AC-AGP-002 — Required indexes exist. [pgTAP]**
Given the migration is applied,
When indexes are inspected,
Then `agent_events (run_id, seq)`, `agent_runs (thread_id, created_at)`, and `agent_threads
(owner_id) where archived_at is null` all exist.

**AC-AGP-003 — `seq` orders the transcript, not `created_at`. [pgTAP]**
Given three events inserted for one run with `created_at` values equal to the microsecond but `seq`
1, 2, 3,
When events are read `order by seq`,
Then they return in `seq` order, proving `seq` (not `created_at`) is the ordering key.

### RLS — tenancy & owner isolation

**AC-AGP-004 — Owner reads own threads/runs/events; non-owner in the same org reads zero. [pgTAP]**
Given user A creates a thread + run + event,
When user B (same org, not the owner) queries any of the three tables for that row,
Then user B's query returns zero rows — no same-org sharing exists on these tables (contrast
`user_views` `shared_org`).

**AC-AGP-005 — Cross-org read returns zero regardless of role, including Admin. [pgTAP]**
Given user A (org 1) owns a thread/run/event,
When a user in org 2 — including an org-2 Admin — queries for it,
Then zero rows are returned; org_id is the wall.

**AC-AGP-006 — Admin does NOT get cross-owner read within the same org. [pgTAP]**
Given user A owns a thread/run/event in org 1,
When an **Admin in org 1** (not the owner) queries for it,
Then zero rows are returned — proving the explicit no-Admin-read divergence from `user_views` OD-2
(FR-AGP-008).

**AC-AGP-007 — INSERT pins org_id and owner_id; a spoofed owner_id is rejected. [pgTAP]**
Given user A is authenticated,
When user A inserts a thread/run/event with an explicit `owner_id` of another user,
Then the insert is denied by `WITH CHECK` (org_id/owner_id are pinned to the caller, not
client-trusted).

**AC-AGP-008 — Soft-archive hides a thread from the live index. [pgTAP]**
Given a thread with `archived_at` set,
When the live-thread-list query (`where archived_at is null`) runs,
Then the archived thread is excluded.

### Append-only & feedback

**AC-AGP-009 — A non-owner cannot insert into another user's run/thread. [pgTAP]**
Given user A's thread/run,
When user B attempts to insert an event under user A's `run_id`,
Then the insert is denied (RLS `WITH CHECK` fails the owner/org predicate).

**AC-AGP-010 — A plain UPDATE touching `payload`/`text`/`type`/`tool_*` is rejected. [pgTAP]**
Given an existing `agent_events` row owned by the caller,
When the caller attempts `UPDATE ... SET payload = ...` (or `text`/`type`/`tool_name`/
`tool_args_hash`/`tool_status`) directly (bypassing the app),
Then the update is denied — append-only holds even for the owner.

**AC-AGP-011 — The feedback UPDATE succeeds for the owner on an `assistant` row, touching only
rating/downvote_reason. [pgTAP]**
Given the caller owns an `assistant`-type event,
When the caller `UPDATE`s only `rating` and `downvote_reason`,
Then the update succeeds and the row's `payload`/`text`/`type` are unchanged.

**AC-AGP-012 — The feedback UPDATE is denied for a non-owner. [pgTAP]**
Given an `assistant` event owned by user A,
When user B attempts the feedback `UPDATE` on it,
Then it is denied (zero rows affected / RLS rejection).

### Handler — journal, de-dupe, heartbeat

**AC-AGP-013 — A resumed write matching a journaled completed call is hard-blocked and returns the
journaled result. [Unit]**
Given a run with a journaled `type='tool'`, `tool_status='completed'` event for `(tool_name:
'create_activity', tool_args_hash: H)`,
When the handler resumes and the model proposes the same write with args hashing to `H`,
Then `action.run` is **not** called and the dispatch gate returns the journaled `payload` result as
the tool_result.

**AC-AGP-014 — A repeated read is never blocked. [Unit]**
Given a run with a journaled completed `query_entity` (read) call,
When the same read is proposed again on resume,
Then it executes again (not blocked), proving reads are exempt from the de-dupe gate.

**AC-AGP-015 — A genuinely different-args write is allowed. [Unit]**
Given a journaled completed write for `(tool_name, args_hash: H1)`,
When a **different** write with the same `tool_name` but args hashing to `H2 ≠ H1` is proposed,
Then it executes normally (not blocked) — proving the gate keys on the args hash, not just the tool
name.

**AC-AGP-016 — Heartbeat advances each round. [Unit]**
Given a run in progress across N tool rounds,
When the handler completes each round,
Then `agent_runs.last_progress_at` is updated (advances in time) after each round.

**AC-AGP-017 — `control('cancel')` drives the run to a terminal status. [Unit]**
Given an active run,
When `control(runId, 'cancel')` is invoked,
Then `agent_runs.status` is persisted as a terminal value and the in-flight turn stops.

**AC-AGP-018 — Deputy invariant: no `service_role` reaches the persistence path. [Unit]**
Given the handler's persistence write calls (thread/run/event creation, journal, heartbeat),
When inspected/exercised in the handler unit tests,
Then every call is made with the caller-JWT-scoped client; no `service_role` parameter is
constructed or passed (port of the retired sidecar's `deputy-invariant.gate.test` shape).

### Panel UX

**AC-AGP-019 — Thread list shows the user's own recent threads, pinned above unpinned. [Unit]**
Given the caller has three threads (one pinned, two unpinned, ordered by recent activity),
When the thread list renders,
Then the pinned thread appears first, followed by the unpinned threads ordered by recency.

**AC-AGP-020 — Stuck-run banner appears on heartbeat staleness, independent of SSE state. [Unit]**
Given a run whose `status` is `'running'` and `last_progress_at` is older than the staleness
threshold, with the SSE connection still nominally open,
When the panel evaluates run state,
Then the stuck-run banner renders with Retry and Cancel controls (keyed on the heartbeat, not on SSE
liveness).

**AC-AGP-021 — Cancel on the stuck-run banner drives the run to a terminal state. [Unit]**
Given the stuck-run banner is showing,
When the user clicks Cancel,
Then `runtime.control(runId, 'cancel')` is invoked and the panel reflects a terminal/idle phase.

**AC-AGP-022 — Thumbs up/down persists per assistant event. [Unit]**
Given an assistant event in the transcript,
When the user clicks thumbs-down and selects a downvote category,
Then the feedback UPDATE is issued for that event's id with the chosen `rating`/`downvote_reason`.

### Cross-stack — the curated e2e (ADR-0043 Verification, ONE journey)

**AC-AGP-023 — Converse, reload, transcript restored; a second user cannot see it. [E2E]**
Given a signed-in user opens the assistant panel and has a short conversation (send a message,
receive a reply),
When the user reloads the page and reopens the panel / navigates back to the same thread,
Then the full transcript is restored in its original order (user message, assistant reply, in
sequence) — and when a **second** user signs in, they see **no** trace of the first user's thread
(it does not appear in their thread list and is not fetchable by id).

---

## Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-AGP-001 | pgTAP | `AC-AGP-001 three tables exist with required columns` (`supabase/tests/agent_persistence_schema.test.sql`) |
| AC-AGP-002 | pgTAP | `AC-AGP-002 required indexes exist` |
| AC-AGP-003 | pgTAP | `AC-AGP-003 seq orders transcript not created_at` |
| AC-AGP-004 | pgTAP | `AC-AGP-004 non-owner same-org reads zero` (`supabase/tests/agent_persistence_tenancy.test.sql`) |
| AC-AGP-005 | pgTAP | `AC-AGP-005 cross-org read zero incl admin` |
| AC-AGP-006 | pgTAP | `AC-AGP-006 admin no cross-owner read` |
| AC-AGP-007 | pgTAP | `AC-AGP-007 insert pins org and owner, spoofed owner denied` |
| AC-AGP-008 | pgTAP | `AC-AGP-008 soft-archive hides from live index` |
| AC-AGP-009 | pgTAP | `AC-AGP-009 non-owner insert denied` (`supabase/tests/agent_persistence_append_only.test.sql`) |
| AC-AGP-010 | pgTAP | `AC-AGP-010 payload-touching update rejected` |
| AC-AGP-011 | pgTAP | `AC-AGP-011 feedback update succeeds owner assistant row` |
| AC-AGP-012 | pgTAP | `AC-AGP-012 feedback update denied non-owner` |
| AC-AGP-013 | Unit | `AC-AGP-013 resumed write matching journal is hard-blocked` (`supabase/functions/agent-chat/handler.persistence.test.ts`) |
| AC-AGP-014 | Unit | `AC-AGP-014 repeated read never blocked` |
| AC-AGP-015 | Unit | `AC-AGP-015 different-args write allowed` |
| AC-AGP-016 | Unit | `AC-AGP-016 heartbeat advances each round` |
| AC-AGP-017 | Unit | `AC-AGP-017 cancel drives terminal status` |
| AC-AGP-018 | Unit | `AC-AGP-018 no service_role on persistence path` (`supabase/functions/agent-chat/handler.deputy-invariant.test.ts`) |
| AC-AGP-019 | Unit | `AC-AGP-019 thread list pinned above unpinned` (`pmo-portal/src/components/panel/ThreadList.test.tsx`) |
| AC-AGP-020 | Unit | `AC-AGP-020 stuck-run banner on heartbeat staleness` (`pmo-portal/src/components/panel/StuckRunBanner.test.tsx`) |
| AC-AGP-021 | Unit | `AC-AGP-021 cancel from stuck-run banner terminal state` |
| AC-AGP-022 | Unit | `AC-AGP-022 thumbs feedback persists` (`pmo-portal/src/components/panel/Transcript.test.tsx`) |
| AC-AGP-023 | E2E | `AC-AGP-023 converse reload transcript restored second user cannot see` (`pmo-portal/e2e/AC-AGP-023-thread-persistence.spec.ts`) |

---

## SoD & Security (OWASP / STRIDE)

**Spoofing / tenancy (STRIDE-S, OWASP A01 broken access control).** All three tables are
`enable`+`force` RLS, owner-only (`owner_id = auth.uid() and org_id = auth_org_id()`), with **no**
Admin or same-org read grant (FR-AGP-008) — a stricter posture than `user_views`, reflecting that a
conversation is more sensitive than a saved view. `org_id`/`owner_id` are server-stamped via column
default + `WITH CHECK` re-pin, never client-trusted (NFR-AGP-SEC-003).

**Tampering (STRIDE-T, OWASP A01/A08).** `agent_events` is append-only by RLS policy (not just
convention) except the one narrow feedback `UPDATE`, which itself is `WITH CHECK`-constrained to the
owner and to the two feedback columns (NFR-AGP-SEC-002) — a hand-crafted PATCH cannot alter the
transcript, the tool journal, or reassign ownership.

**Elevation / deputy invariant (STRIDE-E, ADR-0036 §2).** No code path on the persistence write or
read side ever constructs or uses a `service_role` client, including the client-disconnect
continuation (§6) — the edge fn holds the caller's JWT for the request's duration, so continuing
after the browser drops does not require privilege escalation (NFR-AGP-SEC-001, gated by
AC-AGP-018).

**Repudiation (STRIDE-R).** `agent_events` (append-only, `seq`-ordered) **is** the audit trail —
what the agent read, wrote, and said, in order, per run — doubling as the durable-resume substrate
(one table, two jobs, per ADR-0043).

**Injection (OWASP A03).** No new user-controlled string is interpolated into SQL; all persistence
writes go through parameterized RPC/PostgREST inserts/updates. `tool_args_hash` is computed
server-side from validated (not raw) args (NFR-AGP-SEC-004).

**Depth note (model-tiering).** This change is RLS/tenancy-heavy (three new tables, an
append-only-except-one-path invariant, an explicit no-Admin-read divergence, plus the deputy
invariant on the client-disconnect continuation) — the security-auditor should run at full depth on
the migration + both edge-fn persistence call sites, not a light pass.

---

## Error Handling

| Error condition | Surface / code | User message |
|---|---|---|
| Cross-org or cross-owner thread/run/event read | RLS (zero rows) | Thread simply does not appear in the list; no error surfaced (indistinguishable from non-existence, by design). |
| Direct non-feedback UPDATE/DELETE on `agent_events` | RLS `42501` | N/A (no client code path attempts this; a direct API call is denied silently by RLS). |
| Feedback UPDATE on a non-owned or non-assistant event | RLS `42501` (zero rows affected) | Thumbs control does not visually update; no destructive effect. |
| Heartbeat write fails (transient DB error) | Logged, swallowed | Panel behavior unaffected this round; next round retries the heartbeat. |
| Resume hits a run with no journaled events (fresh run) | No-op — normal path | No special message; behaves exactly like a first turn. |
| Stuck-run staleness threshold crossed | Panel UI | "This is taking longer than expected." + Retry / Cancel. |

---

## Implementation TODO

### Backend (migration + RLS + pgTAP)

- [ ] Migration `0046_agent_persistence.sql`: create `agent_threads`, `agent_runs`, `agent_events`
      exactly per ADR-0043 §1/§2 (columns, checks, defaults, FKs `on delete cascade`); the three
      indexes (FR-AGP-006); `enable`+`force` RLS; owner-only `select`/`insert`/`update`/`delete`
      policies (no Admin grant); the feedback-only `update` policy scoped to `rating`/
      `downvote_reason` on `type='assistant'` rows, `with check` re-pinning owner.
- [ ] pgTAP: `agent_persistence_schema.test.sql` (AC-AGP-001..003), `agent_persistence_tenancy.test.sql`
      (AC-AGP-004..008, mirrors `0089_user_views_tenancy.test.sql` shape), `agent_persistence_append_only.test.sql`
      (AC-AGP-009..012).

### Backend (edge-fn persistence hooks)

- [ ] `handler.ts`: on request start, resolve/create `agent_threads`/`agent_runs` row (FR-AGP-010);
      wrap `emit()` to also insert the `agent_events` row with assigned `seq` (FR-AGP-011); populate
      journal columns on `type='tool'` emit (FR-AGP-012).
- [ ] `dispatchAction`/`dispatchActionForced`: add the journaled-completed-write lookup + short-circuit
      (FR-AGP-013), read-exemption (FR-AGP-014/019), resume context injection (FR-AGP-018).
- [ ] Heartbeat: `UPDATE agent_runs SET last_progress_at = now() [, progress, progress_step]` once per
      tool round / model turn (FR-AGP-014).
- [ ] Terminal status + cancel path persist `agent_runs.status` (FR-AGP-015/FR-AGP-017 cancel via
      `control`).
- [ ] Client-disconnect continuation: ensure the edge fn's async generator is drained to completion
      server-side even if the SSE writer errors on a dropped socket (FR-AGP-016).
- [ ] Unit tests: `handler.persistence.test.ts` (AC-AGP-013..017), `handler.deputy-invariant.test.ts`
      (AC-AGP-018, port the retired sidecar's gate-test shape).

### Frontend (repository seam + panel UX)

- [ ] `src/lib/repositories/agentThreads.ts` / `agentRuns.ts` / `agentEvents.ts` (typed from
      regenerated DB types, not hand-cast).
- [ ] `ThreadList` component (recent, pinned-first, scoped) + wiring into `AssistantPanel`
      (FR-AGP-020, AC-AGP-019).
- [ ] Resume-on-open: fetch + order by `(run_id, seq)`, feed into `useAssistantPanel`'s transcript
      state (FR-AGP-021).
- [ ] `StuckRunBanner` component (heartbeat-staleness poll or subscription, Retry/Cancel) wired into
      `AssistantPanel`'s transcript region (FR-AGP-022/023, AC-AGP-020/021).
- [ ] Thumbs + downvote-category control on `assistant` transcript entries, wired to the feedback
      repository call (FR-AGP-024/025, AC-AGP-022).
- [ ] All of the above gated behind `isFeatureEnabled('agentAssistant')` (FR-AGP-026).

### E2E / gates

- [ ] `e2e/AC-AGP-023-thread-persistence.spec.ts`: converse → reload → transcript restored in order;
      second user cannot see it.
- [ ] Full `npm run verify` before PR; render the panel (thread list, resume, stuck-run banner,
      feedback controls) before promote — MEMORY durable rule (rendered-review-catches-what-tests-pass).

---

## Out of Scope (deferred)

- **Credits / per-user metering (batteries-included A item 3).** Separate issue; this spec's tables
  do not carry usage/cost columns.
- **PostHog analytics events (batteries-included A item 4).** ADR-0043 §5 notes the DB row is the
  durable feedback record and PostHog is a separate analytics feed — the PostHog emit is **not**
  built here; only the DB-side `rating`/`downvote_reason` columns and the UI controls that write
  them.
- **Widgets / ask-user (ADR-0045).** Not touched; this spec persists the existing event types only.
- **Automations (ADR-0044).** Not touched.
- **Thread sharing / fork.** Explicitly deferred by ADR-0043 §1 ("no sharing scope yet... deferred
  to a later ADR") and §1 ("Fork-thread: deferred, forward-compatible... no column is reserved for
  it now"). No `shared_org` analog, no `forked_from_event_id` column, in this issue.
- **Deriving a "frustration index" from feedback (rephrase/retry/abandon).** ADR-0043 §5: "a later
  PostHog-side insight, not a schema field here."

---

## Contradictions / conflicts flagged against existing code & locked decisions

None found. ADR-0043 is Accepted and is the controlling authority; this spec is a direct
operationalization of its §1–§6 with no attempted revision. The one deliberate divergence from an
existing pattern (`user_views`'s Admin same-org read grant, OD-2) is **explicitly called out** in
ADR-0043 §1 itself as intentional (not an oversight), and is carried through here as FR-AGP-008 /
AC-AGP-006.

## Open Questions

None — ADR-0043 resolves every design question this spec needed (table shapes, RLS posture,
journal mechanics, heartbeat semantics, feedback columns, feature-flag gating). Two mechanical
choices are left to the eng-plan (not requiring owner adjudication, per the Companies/`user_views`
precedent of letting the plan pick file names/exact SQL):

- Exact migration number (assumed `0046_agent_persistence.sql` — next after `0045_user_views.sql`
  at spec time; the eng-plan confirms against `main` at build time).
- Exact staleness threshold for the stuck-run banner (FR-AGP-022) — a constant the eng-plan sets
  (e.g. 30–60s), not gated by any ADR decision.
