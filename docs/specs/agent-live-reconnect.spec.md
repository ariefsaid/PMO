# SDD: Agent Live Reconnect — resume an in-flight run after a dropped socket / tab close

**Feature:** Today the SPA holds **one long-lived SSE per POST** (`pmoNativeRuntime.ts:282`
`fetch`+`getReader` over `transport.ts decodeSseStream`). If that socket drops — or the user
closes/switches the tab mid-run — the browser **cannot rejoin the live stream**: the edge fn
keeps draining **for persistence** (`index.ts:242` `if (!socketLive) continue; // keep
draining for persistence` — ADR-0043 §6), so every event is still written to `agent_events`,
but the only FE path that surfaces those rows is the **cold-history** reload
(`useAssistantPanel.ts openThread` → `listRunEvents`), taken *after* the run finishes. Closing
the tab on a live run is therefore a real **UX cliff**: no spinner, no progress, no live view
until you manually reopen the thread and read static history. This is **not** data loss (we
persist everything) — it is a genuine **capability gap** (gap-analysis do-next item 6 / the
biggest genuine one, "Live reconnect / leave-and-return", `2026-07-08-agent-native-gap-analysis.md`
summary para 4).

agent-native makes reconnect first-class: `GET /runs/active?threadId` +
`GET /runs/:id/events?after=N` over a cross-isolate SQL poll
(`docs/design/durable-agent-runs.md` steps 11–12, "How the client UX changes";
`dist/agent/run-manager.d.ts:143 getActiveRunForThread`,
`dist/agent/run-store.d.ts:265 getRunEventsSince`,
`dist/client/active-run-state.d.ts ActiveRunState {threadId,runId,lastSeq}`). This spec adopts
that **pattern** for OUR stack: **plain PostgREST reads under the caller's RLS** — no new
endpoints, no Nitro/Netlify worker, no new infrastructure — plus a cursor-resume loop in the FE.
The recommendation is a **PostgREST poll** (not Supabase Realtime); Realtime is recorded as an
ADR-worthy, deferred alternative.

**Spec ID prefix:** ALR (`FR-ALR-###` functional · `NFR-ALR-###` non-functional · `AC-ALR-###` acceptance)
**ADR refs:** ADR-0043 (agent thread/event persistence & run lifecycle — the durable-resume
foundation; §6 client-disconnect continuation is WHY persistence outlives the socket and thus
WHY reconnect must read SQL), ADR-0036 (deputy invariant — caller JWT, **RLS is the sole
enforcement authority**; reconnect reads stay owner-RLS-scoped, never `service_role`), ADR-0040
(the `AgentRuntime` port + panel — the seam the resume path extends), ADR-0010 (test pyramid —
AC layer ownership below), ADR-0016/0017 (real-JWT + repository seam — the new reads are plain
DAL PostgREST reads, not RPCs), ADR-0001 (org_id seam — column defaults stamp it, never sent).
Sibling spec: **`agent-run-persistence-hardening.spec.md` (ARH)** — its idempotent-event upsert
(`insertEvent` → `ON CONFLICT (run_id,seq) DO NOTHING`, FR-ARH-002 sibling) is the
server-side primitive this FE resume aligns with for de-dupe (FR-ALR-008).
**Layer ownership (ADR-0010):** the two read contracts (active-run probe + cursor replay) →
**Unit** (Vitest, mocked supabase) for query shape + a **pgTAP** proof that the EXISTING
owner-only RLS still hides cross-owner/cross-org rows for the new filter shapes (no policy is
added — we re-prove coverage); FE resume orchestration (`lastSeq` persistence, poll loop,
idempotent reconciliation, stop conditions) → **Unit** (Vitest/RTL, fake timers, mocked DAL/poll);
the headline reconnect journey → one **E2E** (Playwright) cross-stack test. No schema/RLS/policy
change ships, so no integration/pgTAP RLS-authoring layer — only the read-coverage re-proof.
**Status:** Draft — 2026-07-08
**Author:** Director (Claude Opus 4.8)

---

## 1. Context & problem

The shipped transport model is **one SSE response per POST, held for the whole run**
(`pmoNativeRuntime._doSubscribe`, `pmoNativeRuntime.ts:282` `for await (const ev of
decodeSseStream(reader))`). It works while the tab stays open and the socket stays live. It
fails the moment either breaks:

- **The edge fn already does the right thing for durability.** On a dropped socket,
  `index.ts:242–247` flips `socketLive=false` and **keeps draining the generator to completion
  server-side** ("keep draining for persistence; stop trying to enqueue") — so every event is
  still written by `handler.ts:425 withPersistence` → `insertEvent`, the heartbeat still fires,
  and the terminal status still lands on `agent_runs`. ADR-0043 §6 codifies this: persistence
  outlives the socket *by design*, for durable-resume.
- **The FE has no way to read that progress live.** There is no `/runs/active`, no
  `events?after=`, no cursor-resume path anywhere in `pmo-portal/src` (grep-confirm: `grep -rn
  "runs/active\|events?after\|seq=gt" pmo-portal/src` → empty). The only FE reader of
  `agent_events` is `listRunEvents(runId)` (`agentEvents.ts`), which is **cold history**: it
  loads the whole run ordered by seq, and is called only from `useAssistantPanel.ts openThread`
  (the ThreadList "open this thread" action) — which then sets `phase:'idle'` and stops. There
  is no "this run is still going, keep watching it" path.
- **Net effect.** Close/reopen the tab mid-run, or hit a transient socket drop on a long
  (multi-tool-round) run: the panel shows a static transcript frozen at the moment the socket
  died; the user has no signal the run is still progressing server-side; the live view only
  reappears (as static history) after they manually reopen the thread AND the run has finished.
  That is the UX cliff the gap-analysis flags as the biggest genuine capability gap.

We already own every primitive this needs: the tables (`agent_runs`, `agent_events`), the
hot-path indexes (`agent_events_run_seq_idx (run_id, seq)`, `agent_runs_thread_created_idx
(thread_id, created_at)` — `0046_agent_persistence.sql:86–87`), the `UNIQUE(run_id, seq)`
transcript-order constraint (`:95`), the owner-only RLS (`agent_runs_select` /
`agent_events_select` `using (owner_id = auth.uid() and org_id = auth_org_id())`), and a
**production-proven 5s PostgREST poll** over `agent_runs.last_progress_at`
(`useAssistantPanel.ts:31 HEARTBEAT_POLL_MS = 5_000`; `agentRuns.ts:30 getRunHeartbeat`) that
drives `StuckRunBanner`. The gap is purely that **no FE path reconnects a dropped stream to a
still-active run**. This spec adds it, for our stack, with no new infrastructure.

### 1.1 Current-state audit (built vs missing — with file evidence)

Every claim below was verified by reading the code, not trusted from the brief.

| Capability | State | Evidence |
|---|---|---|
| Edge fn persists every event, including after a dropped socket | **BUILT** | `index.ts:242–247` `socketLive` flag — `if (!socketLive) continue; // keep draining for persistence`; `handler.ts:425 withPersistence` → `insertEvent` on every event; ADR-0043 §6 |
| Per-run transcript-order `seq` + unique constraint | **BUILT** | `0046:95 agent_events_run_id_seq_key unique (run_id, seq)`; server seeds seq from `loadMaxSeq+1` (`persistence.ts loadMaxSeq`, consumed in `index.ts startSeq`) — ADR-0043 §2 seq continuity |
| Hot-path indexes for both reads we need | **BUILT** | `0046:86 agent_events_run_seq_idx (run_id, seq)` (cursor replay); `0046:87 agent_runs_thread_created_idx (thread_id, created_at)` (active-run probe) |
| Owner-only RLS on `agent_runs` / `agent_events` | **BUILT** | `0046` `agent_runs_select` / `agent_events_select` `using (owner_id = auth.uid() and org_id = auth_org_id())` — no Admin cross-owner read (FR-AGP-008) |
| FE reads `agent_events` in seq order | **BUILT (cold only)** | `agentEvents.ts listRunEvents(runId)` — `.eq('run_id').order('seq',ascending)`; **no `seq > N` cursor variant exists** |
| FE reads `agent_runs` per-run heartbeat | **BUILT** | `agentRuns.ts:30 getRunHeartbeat(runId)` → `select('last_progress_at, status').eq('id').maybeSingle()` |
| FE resolves a thread's latest run id | **BUILT** | `agentThreads.ts:49 listAgentThreads()` — PostgREST embed `select('*, agent_runs(id)')` ordered `created_at desc` limit 1 → `latestRunId` |
| FE **polls** `agent_runs` on a cadence (production-proven) | **BUILT** | `useAssistantPanel.ts:31 HEARTBEAT_POLL_MS = 5_000`; heartbeat-poll effect calls `getRunHeartbeat(activeRunId)` every 5s while a run is active |
| FE cold-resume rebuilds the transcript from history | **BUILT (static)** | `useAssistantPanel.ts openThread` → `listRunEvents` → folds through `mergeAssistantEvent` (`:189`) → sets `phase:'idle'`. **Does not re-enter a live watch if the run is still active.** |
| **Active-run probe** ("is there an in-flight run for this thread?") | **MISSING** | no `agent_runs?status=in.(…)&thread_id=eq.…` read in `pmo-portal/src` (grep-confirm above); `listAgentThreads` returns `latestRunId` but NOT its `status` |
| **Cursor replay** (`agent_events` where `seq > N`) | **MISSING** | `listRunEvents` has no `afterSeq` param; no `.gt('seq', N)` anywhere in `pmo-portal/src` |
| **`lastSeq` persisted per thread across remount** | **MISSING** | `pmoNativeRuntime.ts:63 _runs` Map is in-memory only; entry deleted on stream end (`:359 this._runs.delete(runId)`); no localStorage/sessionStorage of any agent cursor |
| **Resume poll loop** (cursor replay on a cadence, stop at terminal) | **MISSING** | the only poll is the 5s heartbeat poll; no cursor-replay loop exists |
| StuckRunBanner (long-run/stale-run signal) | **BUILT** | `StuckRunBanner.tsx` (`ACTIVE_STATUSES = ['running','paused','needs-approval']`, `:19`); `stuckRun.constants.ts STUCK_RUN_STALE_MS = 45_000` |

**Verdict:** zero schema/index/RLS work needed (all three tables + indexes + constraints +
policies ship in `0046`). The work is **two new DAL read functions + one FE resume loop + a
localStorage cursor** — a pattern adoption, not infrastructure.

---

## 2. Functional Requirements (EARS)

Conventions: **[PROBE]** active-run probe · **[REPLAY]** cursor replay · **[RESUME]** FE resume
orchestration · **[TRANSPORT]** poll-vs-realtime choice. All reads are plain PostgREST under the
caller's owner-RLS; **no** security-definer RPC, **no** `service_role`, **no** `org_id`/`owner_id`
sent from the client (column defaults + RLS stamp — ADR-0036, ADR-0001).

### 2.1 Active-run probe `[PROBE]`

**FR-ALR-001** (ubiquitous — a plain PostgREST read under RLS, not an RPC)
The system SHALL provide an active-run probe as a single owner-RLS-scoped PostgREST `SELECT`
over `agent_runs` — selecting the most recent run for a given thread whose `status` is in the
active set, ordered by `created_at desc`, `limit 1`, returning at least
`{ id, status, last_progress_at, progress_step }`. It SHALL be backed by the existing
`agent_runs_thread_created_idx (thread_id, created_at)` — **no new index**. It SHALL NOT be a
security-definer RPC (an RPC would re-derive owner scoping and risk a cross-tenant leak; RLS is
the sole enforcement authority, ADR-0036 — a plain read under the caller JWT is strictly safer).
It SHALL NOT send `org_id`/`owner_id` (RLS + column defaults pin them). It SHALL return `null`
when no active run exists for the thread — including when the only runs belong to another owner
or org (RLS hides them).

**FR-ALR-002** (event-driven — when the probe runs)
When the panel remounts or a thread is opened (the existing `openThread` / ThreadList flow),
the system SHALL run the active-run probe for the current thread to decide resume-vs-cold-history
(see FR-ALR-007). The probe SHALL NOT run on every render — it runs on mount / thread-switch /
the moments the live SSE is known to be absent.

**FR-ALR-003** (ubiquitous — the active-status set)
The probe's active-status set SHALL be `{'queued','running','paused','needs-approval'}` — the
in-flight states of the `agent_runs.status` check constraint (`0046`). The eng-plan SHALL
reconcile this set with `StuckRunBanner`'s `ACTIVE_STATUSES` (`['running','paused',
'needs-approval']`, `StuckRunBanner.tsx:19`): `'queued'` is in-flight for *resume* (the run has
not started narrating yet but the user is waiting on it) even though the banner treats it as
not-yet-stale. A terminal run (`'completed'`/`'errored'`) is never returned by the probe.

### 2.2 Cursor replay `[REPLAY]`

**FR-ALR-004** (ubiquitous — a plain PostgREST read under RLS)
The system SHALL provide a cursor replay as a single owner-RLS-scoped PostgREST `SELECT` over
`agent_events` — selecting all rows where `run_id = X` **and** `seq > N`, ordered by `seq`
ascending (the transcript order — **never** `created_at`, which can tie within a turn,
FR-AGP-005), returning the full event row. It SHALL be backed by the existing
`agent_events_run_seq_idx (run_id, seq)` and the `agent_events_run_id_seq_key UNIQUE(run_id, seq)`
(`0046:86,95`) — **no new index, no new constraint, no new policy**. It SHALL NOT send
`org_id`/`owner_id`.

**FR-ALR-005** (ubiquitous — bounded, fail-safe)
The cursor replay SHALL be bounded by the same generous row cap the server-side
`loadMaxSeq`/`loadJournaledWrites` reads use (`MAX_RUN_EVENTS_READ = 1000`, `persistence.ts:78`)
— a wide safety margin above any realistic run's row count (a run is hard-capped at
`MAX_TOOL_ROUNDS = 8` tool rounds, `handler.ts:59`), never an unbounded query. On a PostgREST
error it SHALL fail open (return `[]`), mirroring the existing `getRunHeartbeat` /
`loadJournaledWrites` fail-open posture (NFR-ALR-REL-001).

### 2.3 FE resume orchestration `[RESUME]`

**FR-ALR-006** (ubiquitous — `lastSeq` persists per thread)
The resume layer SHALL persist, per thread, the highest `seq` it has rendered (`lastSeq`) in a
durable client store (localStorage keyed by `threadId`), surviving a panel remount, a route
change, and a tab close/reopen. The stored shape SHALL mirror agent-native's
`ActiveRunState { threadId, runId, lastSeq }` (`dist/client/active-run-state.d.ts`) with
`setActiveRun` / `updateActiveRunSeq` / `clearActiveRun` semantics. `lastSeq` is a **cursor
optimization only**: a missing or stale `lastSeq` degrades to a replay from `seq = 0`
(FR-ALR-004 with `N = -1`), with no data loss — only a bounded re-fetch (NFR-ALR-SEC-002). The
active-run probe (FR-ALR-001), not `lastSeq`, is the correctness authority for *which* run to
resume.

**FR-ALR-007** (event-driven — resume on remount with an active run)
When the panel remounts or a thread is opened AND the active-run probe (FR-ALR-001) returns a
live run for the current thread, the system SHALL resume the live view by replaying events with
`seq > lastSeq` (FR-ALR-004) and reconciling them into the existing transcript — preserving
already-rendered events and adding net-new ones in seq order. When the probe returns no active
run, the system SHALL fall back to the existing cold-history path (`openThread` → `listRunEvents`
→ `phase:'idle'`) unchanged.

**FR-ALR-008** (ubiquitous — idempotent reconciliation; aligns with the ARH upsert)
The resume reconciliation SHALL be idempotent against a cursor overlap: an event already present
in the transcript (matched by event `id` — the `agent_events` PK — and, belt-and-suspenders, by
`seq` under the run's `UNIQUE(run_id,seq)`) SHALL be skipped, not re-appended. This aligns with
the idempotent-event upsert being added in `agent-run-persistence-hardening` (the
`ON CONFLICT (run_id,seq) DO NOTHING` sibling of FR-ARH-002): the server never emits a duplicate
seq, and the FE dedup guards the poll-timing window where a replay overlaps a just-arrived live
event. Replayed `assistant` events SHALL fold through the SAME `mergeAssistantEvent` reducer
(`useAssistantPanel.ts:189`) that `openThread` and the live `drain` loop already use, so a
resumed run renders byte-identically to a live-merged one.

**FR-ALR-009** (state-driven — poll cadence)
While in resume mode (a run is active and the live SSE is absent), the system SHALL poll the
cursor replay (FR-ALR-004) on a **snappier-than-heartbeat** cadence — a recommended **1–3s
band** (the eng-plan owns the exact value). Rationale: agent-native polls every **500ms** for
*token-grade* streaming (`durable-agent-runs.md` step 11, `subscribeFromSQL`); our events are
**whole tool-rounds / turns** under the non-streaming model call (MC-OD-007), so 1–3s is
responsive without spamming PostgREST. The cursor poll SHALL **coexist with — not replace —**
the existing 5s heartbeat poll (`HEARTBEAT_POLL_MS`, `useAssistantPanel.ts:31`) that feeds
`lastProgressAt` → `StuckRunBanner` (FR-ALR-014). The eng-plan MAY merge the two polls onto one
timer iff the merged cadence preserves the stuck-run signal (NFR-ALR-A11Y-001).

**FR-ALR-010** (event-driven — stop at terminal status)
When the active-run probe (or the run's `status` field observed on any read) returns a terminal
status (`'completed'` / `'errored'`), the system SHALL perform ONE final cursor replay to flush
any tail events persisted after the last poll, render them, clear the persisted
`lastSeq`/active-run entry for that thread (FR-ALR-006 `clearActiveRun`), and stop the cursor
poll — never leaving an idle spinner on a finished run.

**FR-ALR-011** (event-driven — stop on lifecycle exits)
The cursor poll SHALL also stop (and clear its timer) on: (a) a thread-switch (opening a
different thread — re-probe for the new thread per FR-ALR-002 instead); (b) a panel-unmount that
is not a remount; (c) an explicit user cancel (`control('cancel')`, which already fires the
server-side terminal-status POST via `pmoNativeRuntime._postCancel`). No orphaned poll timer
SHALL survive any of these.

**FR-ALR-012** (ubiquitous — the first POST still uses the live SSE)
The resume path SHALL NOT replace the primary live stream. A run's FIRST POST (`createRun`)
SHALL still open the existing one-shot SSE (`pmoNativeRuntime._doSubscribe`, `:282`
`fetch`+`getReader` over `decodeSseStream`) and read it to completion while the socket is live.
The cursor-replay resume is the **reconnect** path, taken only when that SSE is gone (socket
drop, panel remount, tab reopen) AND a run is still active. The two paths feed the same
transcript via the same reducer (FR-ALR-008), so a handoff from live-SSE to cursor-poll is
seamless (NFR-ALR-REL-002).

**FR-ALR-013** (ubiquitous — the panel surfaces "still working" during resume)
While in resume mode, the panel SHALL show the same "still working" affordances a live run
shows — the live step trail / activity trail continues to advance as cursor-replayed `status`
and `tool` events arrive, and `StuckRunBanner` continues to surface on server-heartbeat
staleness (FR-ALR-014). The user SHALL NOT be able to tell, from the UI, whether the events are
arriving over the live SSE or the cursor poll (the only acceptable difference is bounded
latency, NFR-ALR-PERF-003).

**FR-ALR-014** (state-driven — coherence with heartbeat / StuckRunBanner)
While a run is active — whether consumed over the live SSE or the cursor poll — the system
SHALL keep deriving staleness from the SERVER heartbeat (`agent_runs.last_progress_at`), not
from client-observed socket liveness (a live SSE can be silently wedged; a dropped SSE can be
genuinely still progressing). The existing 5s heartbeat poll (`useAssistantPanel.ts`) and
`STUCK_RUN_STALE_MS = 45_000` (`stuckRun.constants.ts`) SHALL continue to drive `StuckRunBanner`
unmodified. Resume mode SHALL NOT introduce a second, divergent staleness clock.

### 2.4 Transport choice `[TRANSPORT]` — PostgREST poll (RECOMMENDED) vs Supabase Realtime

**FR-ALR-015** (ubiquitous — v1 transport is PostgREST poll)
The system SHALL implement the live-resume transport as a **PostgREST poll** (FR-ALR-004),
reusing the SPA's existing caller-JWT `supabase` client (the same one `agentEvents.ts` /
`agentRuns.ts` / `agentThreads.ts` use) — and SHALL NOT adopt Supabase Realtime for v1.
Rationale: (a) **no new infrastructure** — no publication, no Realtime channel, no
connect/reconnect/backoff machinery, no additional auth path; (b) **RLS holds by construction**
— the poll is the same owner-RLS-scoped read the cold-history path already makes, so the deputy
invariant (ADR-0036) needs no new reasoning; (c) **production-proven cadence** — the 5s heartbeat
poll proves PostgREST-poll-over-`agent_runs` works in prod, and extending it to `agent_events`
is the smallest possible delta; (d) our events are coarse-grained (whole turns/tool-rounds), so
1–3s poll latency is acceptable where Realtime's sub-100ms push would be over-engineering.

**FR-ALR-016** (optional — Realtime as a documented, deferred alternative)
Where **token-grade streaming** (gap-analysis item 7 — `text-delta` events through the existing
SSE codec) is later adopted, the team MAY revisit Supabase Realtime as the live-resume
transport. That adoption is recorded here as an **ADR-worthy alternative**, NOT v1 scope, and if
taken it SHALL: (a) add `agent_events` to a Realtime publication via a **reversible** migration
(`alter publication supabase_realtime add table agent_events`, with a documented
`drop … from publication` rollback); (b) **preserve owner-only RLS** (Realtime Postgres-Changes
respects the same `agent_events_select` policy — no policy change); (c) **preserve the org_id
seam** (no `org_id` sent; RLS stamps it); (d) keep the PostgREST poll (FR-ALR-015) as the
fallback when Realtime is unavailable or the channel drops. The decision is an Open Question (§10).

---

## 3. Observed / legacy behavior to preserve (OBS)

**OBS-ALR-001 — The tables, indexes, constraints, and RLS policies are UNCHANGED.** This spec
adds two PostgREST `SELECT` shapes over already-shipped, already-indexed, already-RLS-protected
tables (`0046`). No migration ships for the recommended (poll) path. A pgTAP test re-proves the
existing owner-only policies cover the new filter shapes (AC-ALR-003) — it does not author new
policy.

**OBS-ALR-002 — `seq` remains the transcript order; `created_at` is never an ordering key.**
Both the existing cold read (`listRunEvents` `.order('seq',ascending)`) and the new cursor replay
(FR-ALR-004) order by `seq`. A resume and a cold history of the same run produce the identical
transcript (FR-ALR-008).

**OBS-ALR-003 — The deputy invariant is untouched.** No read added here constructs a
`service_role` client, calls an RPC, or sends `org_id`/`owner_id`. The agent's resume-time read
reach is exactly the user's reach — by construction, identical to the cold-history path
(`listRunEvents`/`openThread`) that already ships (ADR-0036 §2, ADR-0043 §6).

**OBS-ALR-004 — The first-POST live SSE is the primary path; resume is the fallback.**
`pmoNativeRuntime._doSubscribe` (`:282`) and `transport.ts decodeSseStream` are unchanged. The
resume path is additive — it is taken only when the SSE is gone and a run is still active
(FR-ALR-012). A regression test (AC-ALR-007) locks this in.

**OBS-ALR-005 — `StuckRunBanner` and the server-heartbeat staleness model are unchanged.**
`STUCK_RUN_STALE_MS = 45_000`, `ACTIVE_STATUSES`, and the 5s heartbeat poll all ship and stay the
staleness authority (FR-ALR-014). Resume mode does not introduce a competing clock.

**OBS-ALR-006 — This spec is coherent with the ARH idempotent-event sibling.** If
`agent-run-persistence-hardening` ships its `insertEvent` upsert first, the server side of
FR-ALR-008 (no duplicate seq) is guaranteed by construction; if not yet, the FE by-`id`/by-`seq`
dedup still makes resume idempotent (it guards the poll-timing overlap regardless). The two
specs are independently shippable and mutually reinforcing.

---

## 4. Non-Functional Requirements

### 4.1 Security (OWASP / STRIDE)

- **NFR-ALR-SEC-001 — No new authorization surface; RLS unchanged and still sole authority.**
  The probe (FR-ALR-001) and replay (FR-ALR-004) are plain PostgREST `SELECT`s over
  owner-RLS-scoped tables. They add no RPC (an RPC would need its own authz and could leak
  cross-tenant if mis-scoped — rejected in FR-ALR-001), no `service_role` use, and send no
  `org_id`/`owner_id` (column defaults + RLS stamp — ADR-0036/ADR-0001). A cross-owner or
  cross-org probe/replay returns nothing (existing `agent_runs_select` / `agent_events_select`,
  `0046`) — proven by AC-ALR-003 (pgTAP). This is defense-by-construction, mirroring the
  cold-history path that already ships.
- **NFR-ALR-SEC-002 — The persisted cursor carries no secrets and is never an authz input.**
  `localStorage` stores only `{ threadId, runId, lastSeq }` (FR-ALR-006) — no JWT, no event
  payloads, no PII. It is a UX cursor; every resume re-derives the active run server-side under
  RLS via the probe (FR-ALR-001). A tampered/stolen cursor cannot widen access: a forged
  `runId` the caller cannot see yields zero rows under RLS (the probe returns `null`; the
  replay returns `[]`), so the resume harmlessly falls back to cold history.
- **NFR-ALR-SEC-003 — Resume never widens access vs the live SSE.** A run invisible to the
  caller under RLS is invisible to both the live SSE and the resume reads (same policies). The
  client applies no new enforcement logic; it may be stricter than RLS but never looser
  (ADR-0016). The resume path is read-only throughout — it issues no writes.

### 4.2 Performance

- **NFR-ALR-PERF-001 — Both reads are cheap, indexed range scans.** The probe →
  `agent_runs_thread_created_idx (thread_id, created_at)` with `limit 1`; the replay →
  `agent_events_run_seq_idx (run_id, seq)` returning only `seq > lastSeq` (typically a handful
  of rows per poll, bounded by `MAX_RUN_EVENTS_READ`). No full table scans, no new index.
- **NFR-ALR-PERF-002 — Poll cadence bounds PostgREST load.** At 1–3s, only while a run is
  active (FR-ALR-009), one user contributes ≤ ~1 cursor-replay req/s on top of the existing 5s
  heartbeat poll. The poll stops at terminal status (FR-ALR-010) and on lifecycle exits
  (FR-ALR-011), so idle sessions poll nothing. No amplification: the poll is per-active-run, not
  per-thread or per-user globally.
- **NFR-ALR-PERF-003 — Reconnect latency is bounded.** A user reconnecting sees new events
  within one poll interval (≤ cadence, ≤ ~3s). A cold reconnect (no `lastSeq`) pays one bounded
  replay of the run's full history (≤ `MAX_RUN_EVENTS_READ = 1000` rows), then catches up to
  live on the next poll. The worst observable is bounded latency, never a lost or doubled event
  (NFR-ALR-REL-002).

### 4.3 Reliability

- **NFR-ALR-REL-001 — Fail-open reads; resume never hard-errors the panel.** A transient
  PostgREST error degrades gracefully (mirrors existing `getRunHeartbeat`/`loadJournaledWrites`
  posture): failed probe ⇒ treat as "no active run" → cold history; failed replay ⇒ retry next
  poll; missing/stale `lastSeq` ⇒ replay from `seq = 0`. No resume read SHALL throw into the
  panel render path.
- **NFR-ALR-REL-002 — No data loss, no duplicates, across any reconnect sequence.** Because the
  edge fn persists every event even after a socket drop (`index.ts:242–247`, ADR-0043 §6), and
  because the cursor replay reads those persisted rows in seq order with by-`id`/by-`seq` dedup
  (FR-ALR-008), a reconnect always converges to the complete, ordered, de-duped transcript —
  whether the handoff is live-SSE→poll, poll→cold-history, or tab-close→reopen. The only
  observable difference from an uninterrupted run is bounded latency (NFR-ALR-PERF-003).

### 4.4 Accessibility (WCAG 2.1 AA)

- **NFR-ALR-A11Y-001 — Resume preserves the transcript's existing live-region semantics.**
  Replayed events feed the SAME render path (same reducer, same `Transcript`/`TranscriptItem`
  components) as live events (FR-ALR-008/013), so the existing `aria-live` announcement behavior
  is unchanged — no re-announcement storm on reconnect, and the live step trail / activity trail
  continue to advance accessibly.

---

## 5. Acceptance Criteria (Given/When/Then)

> Layer per ADR-0010: **Unit** (Vitest, mocked supabase) for the two DAL read contracts'
> query shape + return/null semantics; **Unit** (Vitest/RTL, fake timers) for the FE resume
> orchestration (`lastSeq` persistence, poll loop, idempotent reconciliation, stop conditions);
> **pgTAP** for the read-coverage re-proof (existing owner-only RLS covers the new filter
> shapes — no policy authored); one **E2E** (Playwright) for the headline cross-stack reconnect
> journey. Each AC has exactly one owning layer.

### Active-run probe + cursor replay (DAL contracts)

**AC-ALR-001 — Probe returns the active run for a thread under owner RLS; null otherwise. [Unit]**
Given the caller owns a thread with a run whose `status='running'`,
When the probe runs for that `threadId`,
Then it issues exactly one PostgREST read shaped `.eq('thread_id', X).in('status',
['queued','running','paused','needs-approval']).order('created_at',{ascending:false}).limit(1)`
returning `{id, status, last_progress_at, progress_step}`; and given the thread's only run is
`'completed'` (or belongs to another owner, or does not exist), the probe returns `null`
(FR-ALR-001/003).

**AC-ALR-002 — Replay returns events with `seq > N` in seq order; empty when none. [Unit]**
Given a run with persisted events at seq `0,1,2,3,4`,
When the replay runs with `afterSeq = 2`,
Then it issues `.eq('run_id', X).gt('seq', 2).order('seq', {ascending:true})` and returns exactly
the seq-`3` and seq-`4` rows; and given `afterSeq` ≥ the max seq, it returns `[]` (FR-ALR-004/005).

**AC-ALR-003 — Existing owner-only RLS covers the new filter shapes (no policy authored). [pgTAP]**
Given two owners in the same org and one in a different org, where owner-A has an active run in a
thread,
When owner-B (same org) and owner-C (other org) each run the probe for A's `threadId` and the
replay for A's `runId`,
Then both receive zero rows / `null` (the existing `agent_runs_select` / `agent_events_select`
`owner_id = auth.uid() and org_id = auth_org_id()` policies hide them) — proving no new policy is
needed and the deputy invariant holds for the new reads (NFR-ALR-SEC-001).

### FE resume orchestration

**AC-ALR-004 — `lastSeq` persists per thread across a remount and is cleared on terminal. [Unit]**
Given a run consumed to `lastSeq = 4` for `threadId = T`,
When the panel remounts (or the tab is closed and reopened) and the resume layer re-initializes
for `T`,
Then `localStorage` still holds `{threadId:T, runId:R, lastSeq:4}`; and when the run later reaches
a terminal status, the entry for `T` is cleared (`clearActiveRun`) (FR-ALR-006/010).

**AC-ALR-005 — Remount-with-active-run replays `seq > lastSeq` and reconciles idempotently. [Unit]**
Given a transcript already rendering seq `0..4` and a persisted `lastSeq = 4`, and the probe
returning the run as still `'running'`,
When the resume loop polls the replay (which returns seq `5,6` the first poll and `5,6,7` — a
cursor overlap — the second),
Then only the net-new events append (seq `5,6` then `7`), no event is re-appended (by `id` and by
`seq`), and replayed `assistant` events fold through `mergeAssistantEvent` so the transcript
matches a live-merged one (FR-ALR-007/008).

**AC-ALR-006 — The poll stops at terminal status after a final flush, and on lifecycle exits. [Unit]**
Given the resume loop is polling for an active run,
When the probe returns `status='completed'` (or the user cancels / opens another thread / unmounts
the panel),
Then exactly one final replay flushes any tail events, the poll timer is cleared, the
`lastSeq`/active-run entry is cleared (on terminal), and no further poll fires (FR-ALR-010/011).

**AC-ALR-007 — A fresh `createRun` still takes the live-SSE path, not the resume path. [Unit]**
Given a brand-new run (`createRun`, no prior transcript),
When `subscribe` runs,
Then it opens the one-shot SSE (`pmoNativeRuntime._doSubscribe`, `fetch`+`getReader`) and does NOT
enter the cursor-poll resume path — the resume path is taken only on a reconnect where the SSE is
absent and a run is still active (FR-ALR-012, OBS-ALR-004 — regression guard).

**AC-ALR-008 — Reconnect mid-run resumes the live view with no lost or duplicated events. [E2E]**
Given a signed-in user starts a multi-tool-round run and, while it is still `'running'`, the live
SSE is dropped (socket close) / the tab is closed and reopened,
When the panel re-initializes for that thread,
Then the active-run probe finds the still-running run, the cursor replay replays events from
`lastSeq` onward, the transcript converges to the SAME final terminal state (events + order) as an
uninterrupted run of the same prompt — with no lost events and no duplicated events — and the
spinner/step-trail were live throughout the gap (FR-ALR-007/008/013, NFR-ALR-REL-002). This is the
headline cross-stack journey; it is the one curated e2e for this spec.

### StuckRunBanner coherence

**AC-ALR-009 — During resume mode the stuck-run signal still works off the server heartbeat. [Unit]**
Given a run consumed via the cursor poll whose server heartbeat
(`agent_runs.last_progress_at`) goes older than `STUCK_RUN_STALE_MS = 45_000`,
When the 5s heartbeat poll next reads it,
Then `StuckRunBanner` surfaces (status `'running'`, stale heartbeat) — resume mode does not
regress the stuck-run signal, and a genuinely-wedged server-side run is still surfaced exactly as
on the live-SSE path (FR-ALR-014, OBS-ALR-005).

---

## 6. Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-ALR-001 | Unit (Vitest, mocked supabase) | `AC-ALR-001 active-run probe shape + null` (`pmo-portal/src/lib/db/agentRuns.probe.test.ts`) |
| AC-ALR-002 | Unit (Vitest, mocked supabase) | `AC-ALR-002 cursor replay gt seq + empty` (`pmo-portal/src/lib/db/agentEvents.replay.test.ts`) |
| AC-ALR-003 | pgTAP | `AC-ALR-003 owner-only RLS covers new filters` (`supabase/tests/agent_reconnect_rls.test.sql`) |
| AC-ALR-004 | Unit (RTL, jsdom localStorage) | `AC-ALR-004 lastSeq persists + clears on terminal` (`pmo-portal/src/hooks/useActiveRunResume.persistence.test.ts`) |
| AC-ALR-005 | Unit (Vitest/RTL, fake timers) | `AC-ALR-005 remount replays gt lastSeq, idempotent` (`…/useActiveRunResume.reconcile.test.ts`) |
| AC-ALR-006 | Unit (Vitest/RTL, fake timers) | `AC-ALR-006 poll stops on terminal/lifecycle` (`…/useActiveRunResume.stop.test.ts`) |
| AC-ALR-007 | Unit (Vitest) | `AC-ALR-007 fresh createRun uses live SSE, not resume` (`pmo-portal/src/lib/agent/runtime/pmoNativeRuntime.resume.test.ts`) |
| AC-ALR-008 | E2E (Playwright) | `AC-ALR-008 reconnect mid-run, no loss/dupe` (`pmo-portal/e2e/AC-ALR-008-live-reconnect.spec.ts`) |
| AC-ALR-009 | Unit (RTL, fake timers) | `AC-ALR-009 stuck-run signal survives resume` (`…/useActiveRunResume.stuckrun.test.ts`) |

> The two DAL read functions are the natural new files (`agentRuns.ts` `getActiveRunForThread`,
> `agentEvents.ts` `listRunEventsAfter`); the FE resume orchestration is one hook
> (`useActiveRunResume`) consumed by `useAssistantPanel` on remount/thread-switch. The exact file
> split (new hook vs extending `useAssistantPanel` / `pmoNativeRuntime`) is the eng-plan's call —
> the contracts above are stable regardless of where the code lands.

---

## 7. SoD & Security (OWASP / STRIDE)

**Elevation / deputy invariant (STRIDE-E, ADR-0036 §2, OWASP A01).** No code path added here
constructs a `service_role` client, calls an RPC, or sends `org_id`/`owner_id`. The probe and
replay are plain PostgREST reads under the caller JWT with RLS as the ceiling — identical posture
to the shipped cold-history path. A tampered client-side `lastSeq`/`runId` degrades to
zero-rows/`null` under RLS (NFR-ALR-SEC-002); it cannot elevate.

**Spoofing / tenancy (STRIDE-S, OWASP A01).** Unchanged — the existing owner-only + org-scoped
RLS (`agent_runs_select`/`agent_events_select`, `0046`) is the enforcement authority for both new
reads; this spec authors no policy and adds no table (AC-ALR-003 re-proves coverage). The
`org_id` seam is preserved (column defaults stamp it; ADR-0001).

**Tampering (STRIDE-T).** The reads are read-only; the append-only `agent_events` contract
(`agent_events_feedback_only` trigger, `0046`) is untouched. The persisted cursor
(`localStorage`) is untrusted client state used only as a UX optimization, re-validated against
the server on every resume (NFR-ALR-SEC-002).

**Repudiation (STRIDE-R).** Unchanged — assistant/tool/status events still persist through the
existing append-only journal (ADR-0043); resume reads them, it does not author them.

**Information disclosure (STRIDE-I).** A cross-owner/cross-org probe returns nothing under RLS
(NFR-ALR-SEC-001, AC-ALR-003). There is no new listing endpoint — the probe is scoped to one
thread the caller already owns.

**Depth note (model-tiering for the security review).** This change is **read-path + FE-loop
heavy** and **schema/RLS/policy-untouched** (the recommended path). The security-auditor should
focus depth on: (a) confirming the probe/replay are plain RLS-scoped reads with no RPC and no
`service_role` (NFR-ALR-SEC-001); (b) the tampering-resistance of the client-side cursor
(NFR-ALR-SEC-002); (c) the AC-ALR-003 pgTAP re-proof. A lighter pass than a schema-bearing issue
— but the "no new authz surface" claim must be verified, not assumed.

---

## 8. Error Handling

| Error condition | Surface / behavior | User outcome |
|---|---|---|
| Probe PostgREST error (transient) | Fail open → return `null` → fall back to cold history (`openThread`) | Panel shows static history; no error surfaced; resume silently skipped (NFR-ALR-REL-001) |
| Replay PostgREST error (transient) | Fail open → return `[]` → retry on next poll | No events added this tick; next poll catches up; no spinner stall (NFR-ALR-REL-001) |
| Missing/stale `lastSeq` in localStorage | Replay from `seq = 0` (one bounded full-history read) | Transcript rebuilt from history; then live-resume continues — no data loss, bounded latency (FR-ALR-006, NFR-ALR-PERF-003) |
| Probe finds a run that vanished between probe and replay (RLS race / just-deleted) | Replay returns `[]`; next probe returns `null` → exit resume | Clean exit to cold history; no orphaned spinner |
| Run wedged server-side (no heartbeat > 45s) during resume | 5s heartbeat poll feeds `StuckRunBanner` (unchanged) | "Still working…" reassurance + Stop/Retry — identical to the live-SSE path (AC-ALR-009) |
| localStorage unavailable (private mode / quota) | Treat as "no persisted cursor" → replay from `seq = 0` each remount | Functional with slightly more re-fetching; no crash (NFR-ALR-REL-001) |
| User cancels during resume | `control('cancel')` fires the server-side terminal POST (`_postCancel`); poll stops (FR-ALR-011) | Run reaches terminal status; panel settles — identical to cancel on the live-SSE path |

---

## 9. Non-goals (explicitly out of scope)

- **Token-grade streaming** (`text-delta` events through the existing SSE codec). That is
  gap-analysis item 7 — it removes the "frozen until round completes" feel and is the natural
  trigger for revisiting Realtime (FR-ALR-016). Separate backlog issue. This spec carries
  **whole** events only.
- **Supabase Realtime as the v1 transport.** Deferred to an ADR-worthy alternative
  (FR-ALR-016, §10) — Realtime needs a publication migration, channel/reconnect machinery, and
  Realtime-authorization reasoning we do not need for coarse-grained events.
- **Durable background execution / outliving the edge wall.** agent-native's Netlify
  `-background` 15-min worker is host-specific and a mismatch for our Supabase-edge +
  `MAX_TOOL_ROUNDS=8` cap (gap-analysis "Durable background execution" row — *skip the primitive*).
  We are NOT moving the agent loop off the request path; we are only reading its persisted
  progress after a socket drop.
- **New schema, index, constraint, or RLS policy.** None ship on the recommended path —
  `0046` already has everything (OBS-ALR-001). The only "migration" in this spec is the
  hypothetical Realtime publication (FR-ALR-016), which is explicitly out of v1.
- **A model change.** The model stays pinned `deepseek/deepseek-v4-flash` (binding). This spec
  is transport/read-path only.
- **Cross-session user memory, thread fork/share/search, attachments, MCP.** Each is a separate
  backlog issue (gap-analysis "Chat-thread richness" / skip-list); none are reconnect concerns.
- **Admin/observability trace panel.** gap-analysis top-3 #2 (`TraceSummary` read-model) is a
  separate, complementary issue — it consumes the same `agent_events`/`agent_usage` rows but is
  not required for live reconnect.

---

## 10. Open Questions for the owner

1. **Exact poll cadence (1–3s band, FR-ALR-009).** The eng-plan picks the value. Recommend
   **2s** as the default (responsive for whole-event turns, ~0.5 req/s on top of the 5s heartbeat
   poll, well under agent-native's 500ms token-grade poll). Confirm or override.
2. **One timer or two? (FR-ALR-009 tail.)** The cursor-replay poll and the 5s heartbeat poll can
   stay separate timers (simplest, clearest) or merge onto one (e.g. a single 2s timer that does
   both, halving the heartbeat interval). Recommend **separate** for v1 — the heartbeat poll is
   production-proven at 5s and merging risks the stuck-run signal. Revisit if the timer count
   shows up in profiling.
3. **Merge `lastSeq` into `pmoNativeRuntime` vs a standalone `useActiveRunResume` hook.** The
   brief names `pmoNativeRuntime.ts` as the `lastSeq` owner; but the adapter today has no
   `supabase` handle (it only POSTs the edge-fn URL), so the actual PostgREST reads naturally
   live in the DAL and are orchestrated by a hook. Recommend: **`lastSeq` localStorage +
   `clearActiveRun`/`updateActiveRunSeq` helpers on the adapter side** (honoring the brief and
   mirroring `active-run-state.ts`), **read orchestration in a `useActiveRunResume` hook** that
   calls the DAL. Confirm this split (or mandate a supabase handle on the adapter).
4. **Realtime — defer or pre-plan?** This spec RECOMMENDS PostgREST poll for v1 and defers
   Realtime to a token-streaming follow-up (FR-ALR-016). Confirm the deferral, or instruct an
   ADR now that pre-stages the reversible publication migration so token streaming lands faster
   later.
5. **Should `'queued'` count as active for resume? (FR-ALR-003.)** A `'queued'` run has not
   started narrating; resuming it shows an empty-but-live transcript until the first event. This
   spec says yes (the user is waiting on it). Confirm — or restrict the active set to
   `{'running','paused','needs-approval'}` to match `StuckRunBanner.ACTIVE_STATUSES` exactly and
   avoid a brief empty-resume flash.

---

## 11. Contradictions / conflicts flagged against existing code & locked decisions

None against ADR-0043/0036/0040/0010 (this spec operates strictly inside their boundaries —
plain RLS-scoped reads, deputy invariant preserved, the `AgentRuntime` port extended additively,
no schema change). Facts worth flagging for the eng-plan (none is a contradiction):

1. **`StuckRunBanner.ACTIVE_STATUSES` omits `'queued'`.** `StuckRunBanner.tsx:19` =
   `['running','paused','needs-approval']`. FR-ALR-003 uses the wider `{'queued','running',
   'paused','needs-approval'}` for the probe. The eng-plan should confirm `'queued'` is
   genuinely reachable in practice (the handler inserts runs as `'running'`, `persistence.ts
   createThreadAndRun`) — if `'queued'` is never observed in production, the two sets collapse
   and the reconciliation note in FR-ALR-003 is moot (Open Question 5).
2. **`pmoNativeRuntime` has no `supabase` handle.** The adapter is constructed with only
   `{ getJwt, fnUrl, fetchImpl }` (`AgentRuntimeProvider.tsx`). The PostgREST reads therefore
   cannot live in the adapter today — they go through the SPA's global `supabase` client
   (`agentEvents.ts`/`agentRuns.ts`). FR-ALR-006 honors the brief by placing the `lastSeq`
   *cursor* + helpers on the adapter side, but the *reads* are DAL functions. The eng-plan
   confirms the split (Open Question 3); if the owner mandates reads-in-adapter, a `supabase`
   handle must be threaded into `PmoNativeRuntimeOptions` (a port-adjacent change, scoped here).
3. **The existing heartbeat poll is the precedent and the seam.** `useAssistantPanel.ts:31
   HEARTBEAT_POLL_MS = 5_000` + the heartbeat-poll effect is the production-proven pattern this
   spec extends. The eng-plan should reuse its timer/cancel/cleanup shape verbatim for the
   cursor-replay poll (FR-ALR-009/011) rather than inventing a second lifecycle idiom.
4. **`openThread` already does half the work.** `useAssistantPanel.ts openThread` →
   `listRunEvents` → `mergeAssistantEvent` → `phase:'idle'` is the cold-history path. The resume
   path (FR-ALR-007) is most cleanly an *extension* of `openThread`: after the cold replay, if
   the probe says active, switch `phase` back to `'running'` and start the cursor poll — reusing
   the exact reducer/fold (FR-ALR-008). The eng-plan should confirm no other caller of
   `openThread` is harmed by the conditional re-entry into live mode.
5. **Coherence with ARH ordering.** If `agent-run-persistence-hardening`'s `insertEvent` upsert
   lands first, FR-ALR-008's server-side guarantee is free. If this spec lands first, the FE
   by-`id`/by-`seq` dedup carries correctness alone (OBS-ALR-006). The two are independently
   shippable; the eng-plan should note the merge order is not load-bearing.
