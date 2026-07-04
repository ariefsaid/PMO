# ADR-0043 — Agent thread/event persistence & run lifecycle (durable transcripts, tool-call journal, progress heartbeat)

- **Status:** Accepted (owner-directed 2026-07-03)
- **Date:** 2026-07-03
- **Deciders:** Owner, Director
- **Related:** ADR-0036 (deputy invariant + four ceilings + `user_views` tenant-entity pattern),
  ADR-0039 (single LLM call site + untrusted-output boundary), ADR-0040 (Option A `AgentRuntime` port —
  `AgentRun`/`AgentEvent` shapes; 2026-07-03 addendum "batteries-included A" forward plan item 2),
  ADR-0041 (model-calling-action capability seam), ADR-0018 (soft-archive), ADR-0016/0017 (real-JWT + repository seam),
  ADR-0010 (test pyramid), ADR-0022 (PostHog), ADR-0001 (org_id seam), ADR-0042 (versioning).
- **Scope:** the storage + lifecycle layer under the shipped `AgentRuntime` port. This ADR does **not**
  change the port's TypeScript contract (`pmo-portal/src/lib/agent/runtime/port.ts`); it decides how the
  port's `AgentRun`/`AgentEvent`/transcript are **persisted, resumed, and made safe under interruption**.

## Context

Today the agent panel (ADR-0040 Option A) is **stateless**: `agentChatHandler` streams `AgentEvent`s over
SSE (`transport.ts`), `AgentChatRequest` replays the full `messages` array each turn (handler D8), and the
transcript lives only in the browser. On reload, navigation away, or a device switch, the conversation is
gone; there is no audit trail of what the agent read or wrote; and a dropped SSE mid-turn can leave the
model believing a write never happened when it did (or, on a naive replay, cause it to be attempted twice).

The retired sidecar (ADR-0040 addendum 2026-07-03) provided run/thread persistence, an action audit, and a
durable-resume guarantee — but host-coupled inside its own Nitro/Drizzle schema, **not liftable**. The
battery-mining pass (`docs/spikes/2026-07-03-agent-native-battery-mining.md`, "design inputs" + Tier-1
item 3) identified four schema/contract requirements that are cheap to bake in now and expensive to
retrofit: entity **scope** on threads, a **tool-call journal** for durable resume, a **progress
heartbeat**, and **per-event feedback fields**. Backlog "batteries-included A" item (2) commits the build.

This ADR formalizes those requirements as ordinary PMO tenant entities on Supabase — the same
Companies/`user_views` pattern (`supabase/migrations/0045_user_views.sql`) — under the deputy invariant.

## Decision

Tags: **[PMO]** = a PMO addition/extension.

### 1. `agent_threads` is an ordinary owner-private tenant entity. **[PMO]**

A thread is the conversational container a user returns to. It follows the `user_views` slice exactly
(org_id seam, `owner_id default auth.uid()`, soft-archive) — **not** a new access model.

```
agent_threads
  id          uuid pk default gen_random_uuid()
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001'  -- tenancy seam
  owner_id    uuid not null references profiles(id) default auth.uid()                                    -- "user level"
  title       text not null default 'New conversation'
  scope       jsonb              -- NULLABLE thread↔entity binding: { type, id, label }; null = unscoped/global
  pinned_at   timestamptz        -- user pin ordering; null = unpinned
  created_at  timestamptz not null default now()
  updated_at  timestamptz not null default now()
  archived_at timestamptz        -- soft-archive (ADR-0018); never hard-delete by default
```

- **`scope jsonb {type,id,label}` (nullable)** binds a thread to a PMO record — "the assistant thread for
  Project X" — the single most-expected end-user behavior (battery-mining design input). `type` names an
  entity kind (e.g. `'project'`, `'procurement_case'`), `id` its uuid, `label` a denormalized display
  string. It is a **hint for grouping/continuity**, never an authorization input (the live half of the
  same idea is ADR-0045 §3; this is the persisted half). A dangling `scope.id` (referenced row archived)
  degrades gracefully to the label — no FK, because `type` is polymorphic.
- **RLS: owner-only, v1.** `SELECT/INSERT/UPDATE/DELETE` all gated to `owner_id = auth.uid() and
  org_id = auth_org_id()` (INSERT pins both via default + `with check`, mirroring `user_views_insert`).
  There is **no sharing scope yet** — no `scope='shared_org'` analog. Sharing agent threads/artifacts is
  deferred (mining Tier-3 item 15; a later ADR when artifacts outgrow the private model). Admin is **not**
  granted read of another user's thread (an agent conversation is more sensitive than a saved view;
  contrast `user_views` OD-2). org_id is the wall: a cross-org thread returns 0 rows.
- **Fork-thread: deferred, forward-compatible.** "Branch this conversation from turn N" is a known future
  affordance (mining design input). No column is reserved for it now, but the append-only `agent_events`
  design (§2) makes a future `forked_from_event_id` additive — recorded here so it is not re-litigated.
- **pgTAP (ADR-0010/0019):** owner isolation (owner reads own, non-owner reads 0), cross-org denial
  (identical to `0089_user_views_tenancy`), INSERT org/owner re-pin (a hand-crafted PATCH cannot reassign
  `owner_id`), soft-archive hides from the live index. Owns the tenancy ACs at the pgTAP layer.

### 2. `agent_runs` + `agent_events` persist the port's shapes — the port is the contract, the tables are its storage. **[PMO]**

`AgentRun` and `AgentEvent` (`port.ts`) are the **canonical shapes**; these tables are their durable
backing. The persistence layer maps 1:1 and adds no fields the port does not already imply (plus the
lifecycle columns of §3/§4). This keeps the B-ready seam true: a future `AgentNativeRuntime` adapter
persists into the same tables via the same mapping.

```
agent_runs
  id             uuid pk default gen_random_uuid()          -- == AgentRun.id
  thread_id      uuid not null references agent_threads(id) on delete cascade
  org_id         uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001'
  owner_id       uuid not null references profiles(id) default auth.uid()
  title          text not null default ''                   -- AgentRun.title
  status         text not null default 'queued'
                   check (status in ('queued','running','paused','needs-approval','completed','errored'))  -- AgentRunStatus
  progress       numeric                                    -- AgentRun.progress (0..1), nullable
  last_progress_at timestamptz                              -- §4 heartbeat
  progress_step  text                                       -- §4 optional current-step label
  created_at     timestamptz not null default now()
  updated_at     timestamptz not null default now()

agent_events
  id             uuid pk default gen_random_uuid()          -- == AgentEvent.id
  run_id         uuid not null references agent_runs(id) on delete cascade
  org_id         uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001'
  owner_id       uuid not null references profiles(id) default auth.uid()
  seq            bigint not null                            -- monotonic per-run ordering (see below)
  type           text not null
                   check (type in ('user','assistant','tool','artifact','status','system'))  -- AgentEventType superset
  text           text                                       -- AgentEvent.text
  payload        jsonb                                      -- AgentEvent.payload (tool input/result, status, artifact spec…)
  -- §3 tool-call journal columns (populated only on type='tool'):
  tool_name      text
  tool_args_hash text                                       -- sha-256 hex of canonicalized validated args
  tool_status    text check (tool_status in ('completed','errored'))
  -- §5 feedback columns (populated only on type='assistant', by a later UPDATE):
  rating         text check (rating in ('up','down'))
  downvote_reason text check (downvote_reason in ('inaccurate','not_helpful','wrong_tool','too_slow'))
  created_at     timestamptz not null default now()         -- AgentEvent.createdAt
```

- **Event ordering — `seq`, not `created_at`.** Two events in the same turn can share a millisecond;
  the transcript must be totally ordered. `seq` is a per-run monotonic counter (`max(seq)+1` under the
  run row, or an explicit sequence) assigned by the edge fn as it emits. The append-only log is the
  audit trail (ADR-0040 addendum: "the events table doubles as the audit trail").
- **`agent_events` is append-only** except the one narrow §5 feedback UPDATE (rating/downvote_reason);
  there is no other UPDATE/DELETE path (mirrors the `procurement_status_events` append-only discipline in
  `0038`). Terminal state lives on `agent_runs.status`; a `type='status'` event carries the same value in
  `payload.status` for the streaming client.
- **RLS: owner-only**, both tables, matching §1 (`owner_id = auth.uid() and org_id = auth_org_id()`),
  with the feedback UPDATE additionally constrained by `with check` so a user can only rate their **own**
  events and cannot mutate `type/text/payload/tool_*`. **Indexes:** `agent_events (run_id, seq)` (transcript
  fetch), `agent_runs (thread_id, created_at)`, `agent_threads (owner_id) where archived_at is null`
  (live-list fast path).
- **pgTAP:** owner isolation + cross-org denial for both tables; the append-only invariant (a non-owner
  cannot insert; a plain UPDATE that touches `payload` is rejected); the feedback UPDATE succeeds only for
  the owner on an `assistant` row. Owns these tenancy/immutability ACs at the pgTAP layer (ADR-0010).

### 3. Tool-call journal for durable resume — a binding safety property, not polish. **[PMO]**

Completed tool calls are **journaled on `agent_events`** (chosen over a dedicated table: a tool call is
already an event; a side table would duplicate ordering + RLS + org_id for no gain, and the journal must
be read in transcript order anyway). The columns `tool_name`, `tool_args_hash`, `tool_status`, and the
result in `payload` constitute the journal. On resume of an interrupted run:

1. The edge fn loads the run's `type='tool'` events with `tool_status='completed'` and injects, into the
   replayed context, **what already executed** (name + result) so the model does not re-plan a done step.
2. A **write** tool call whose `(tool_name, tool_args_hash)` matches a journaled **completed** call is
   **hard-blocked server-side**: the dispatcher does **not** re-run `action.run`; it returns the journaled
   result as the tool_result. This is enforced in the handler's dispatch gate (the same single site that
   ADR-0040's `dispatchAction`/`NFR-AW-SEC-001` already funnels writes through), **not** in the prompt.
3. **Reads are never blocked** — a repeated `query_entity` simply re-runs under RLS (idempotent, cheap,
   and its data may legitimately have changed).

The result: **no double-created task after a dropped SSE**. `tool_args_hash` is the sha-256 of the
*validated* args (post-schema, canonicalized key order), so cosmetically-different-but-semantically-equal
calls still de-dupe, and args that genuinely differ (a second, different write the user actually asked
for) are correctly allowed. This is the PMO-native equivalent of the sidecar's zero-config durable-resume.

### 4. Progress heartbeat — "working" vs "stuck", keyed off the heartbeat, not SSE liveness. **[PMO]**

`agent_runs.last_progress_at` (+ optional `progress`, `progress_step`) is updated by the edge fn as it
makes forward progress (each tool round, each model turn). The client's stuck-run detection — a banner
with **Retry / Cancel** — keys off **heartbeat staleness** (`now - last_progress_at > threshold`), **not**
SSE connection liveness, because SSE can silently reconnect while the server is genuinely wedged, and can
drop while the server is genuinely working. Distinguishing the two is the whole point (mining Tier-1 #3).

- **Abort** reuses the port's existing `control(runId, 'cancel')` (`AgentRuntime.control`) plus a
  **server abort path**: cancel sets `agent_runs.status='errored'` (or a terminal cancelled state carried
  in `payload`) and stops the in-flight turn. No new port method — `cancel` already exists.
- Heartbeat writes are small `UPDATE agent_runs SET last_progress_at=... WHERE id=...` under the caller
  JWT (owner RLS), so they cost one cheap write per round and are covered by the same RLS.

### 5. Per-event feedback — thumbs + downvote category, feeding PostHog. **[PMO]**

An `assistant` event carries optional `rating ∈ {up,down}` and, on a downvote, `downvote_reason ∈
{inaccurate, not_helpful, wrong_tool, too_slow}` (§2 columns), set by the owner via the single narrow
feedback UPDATE. On write, the client also emits a PostHog event (ADR-0022; backlog batteries-A item 4) —
the DB row is the durable record, PostHog is the analytics feed. The implicit "frustration index"
(rephrase/retry/abandon) is a later PostHog-side insight, not a schema field here.

### 6. Write path & the deputy invariant — caller-JWT throughout, including client-disconnect continuation. **[PMO]**

The `agent-chat` edge fn writes `agent_threads`/`agent_runs`/`agent_events` **under the caller's JWT**
(owner-only RLS stamps/verifies `owner_id`/`org_id`), identical to how it reads business data today
(ADR-0039 §2). **`service_role` is never used on these tables** — the deputy invariant (ADR-0036 §2) is
unchanged: the agent's persistence reach is exactly the user's reach, by construction.

**The one wrinkle, decided explicitly:** journal rows (and heartbeat/status updates) must be written even
when the **client disconnects mid-run** — the edge fn continues the turn server-side to a terminal state
so the tool journal is complete and durable-resume is sound. This is **still caller-JWT**: the function
holds the verified caller JWT for the **duration of the request** (the JWT is captured at request start,
not the browser connection), so continuing after the browser drops does **not** require `service_role`.
The deputy client outlives the SSE socket, not the JWT. (Practical cap: this only holds within the edge
function's own max wall-clock; a turn that would exceed it is bounded by `MAX_TOOL_ROUNDS` and the
heartbeat/stuck path, not by a privileged escalation.)

## Feature-flag gating

The whole persistence layer is gated behind the shipped **`agentAssistant`** flag
(`VITE_FEATURES_AGENT_ASSISTANT`, `pmo-portal/src/lib/features.ts`) — the same flag that gates the panel.
With the flag off, the tables exist (migration is unconditional) but no code path writes them, so an
environment without an LLM provider ships unchanged (mirrors ADR-0039's `aiComposer` sub-flag posture).

## Consequences

**Positive**
- Transcripts survive reload/navigation/device-switch; the events log is the audit trail **and** the
  durable-resume substrate — one table, three jobs.
- The durable-resume + write-de-dupe guarantee is **by construction** (the dispatch gate + args-hash),
  not by prompting — no double-created tasks after a dropped SSE.
- Zero new deployables and zero new trust surface: same edge fn, same caller-JWT deputy, same
  Companies/`user_views` tenant-entity pattern; the port's TypeScript contract is untouched.
- Heartbeat-based stuck detection fixes the frozen-spinner failure mode the panel would otherwise hit.

**Negative / costs**
- Three new tables + RLS + pgTAP to maintain, and one write per event/round (acceptable; all owner-RLS,
  all indexed).
- `seq` assignment and the append-only-except-feedback discipline are invariants reviewers must guard
  (a stray UPDATE path would corrupt the audit trail).
- `scope` is polymorphic (no FK) → a dangling reference is possible; mitigated by the `label` fallback and
  by treating scope as a hint, never an authorization input.

## Alternatives considered

- **localStorage-only transcripts.** Rejected: lost across devices and reloads, no audit trail, no
  server-side durable-resume substrate — the exact gap this ADR closes.
- **Framework-side storage (the retired sidecar's `agent_native` schema).** Rejected: host-coupled, not
  liftable (ADR-0040 addendum second finding); would re-introduce the second deployable.
- **`service_role` writes for persistence.** Rejected: violates the deputy invariant (ADR-0036 §2). The
  caller JWT is sufficient and correct, including for client-disconnect continuation (§6).
- **A dedicated `agent_tool_calls` journal table.** Rejected: a tool call is already an `agent_events`
  row; a side table duplicates ordering/RLS/org_id and must be joined back in transcript order anyway.
- **Blocking read tool calls on resume too.** Rejected: reads are idempotent and their data may have
  legitimately changed; only writes carry the double-execution hazard.

## Verification (what proves the decision when built)

- **pgTAP (owning layer for tenancy/immutability, ADR-0010):** owner isolation + cross-org denial for
  `agent_threads`/`agent_runs`/`agent_events` (identical shape to `0089_user_views_tenancy`); INSERT
  org/owner re-pin; append-only invariant (non-owner insert denied; a payload-touching UPDATE denied);
  the feedback UPDATE permitted only for the owner on an `assistant` row and only touching
  `rating`/`downvote_reason`.
- **Handler unit tests (Vitest, SDK+Supabase mocked, ADR-0039 dec 7):** a resume with a journaled
  completed **write** whose `(tool_name, args_hash)` matches is hard-blocked (returns the journaled
  result, `action.run` **not** called); a repeated **read** is allowed; a genuinely different-args write
  is allowed. Heartbeat `last_progress_at` advances each round; `control('cancel')` drives the run to a
  terminal state.
- **Deputy invariant gate:** no `service_role` parameter reaches the persistence path; a cross-tenant
  thread/event read is denied identically to the interactive path (port the retired branch's
  `deputy-invariant.gate.test` shape).
- **Curated e2e (one cross-stack AC, ADR-0010):** user has a conversation → reloads → the transcript is
  restored in order; a second user cannot see it.
- **Decision-level:** owner sign-off (recorded here); `docs/README.md` ADR range/Latest updated to
  include 0043.
