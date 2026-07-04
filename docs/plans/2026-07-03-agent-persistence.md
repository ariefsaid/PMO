# Implementation plan — Agent thread/event persistence & run lifecycle (batteries-included A, item 2)

- **Date:** 2026-07-03
- **Issue:** PMO #2 (batteries-included A) — ADR-0043 agent persistence.
- **Author:** eng-planner (Claude Opus 4.8 · 1M)
- **Spec:** `docs/specs/agent-persistence.spec.md` (FR-AGP-001..026, OBS-AGP-001..005, NFR-AGP-SEC/PERF/A11Y, AC-AGP-001..023 + traceability table)
- **Binding ADR:** `docs/adr/0043-agent-thread-event-persistence-and-run-lifecycle.md` (**ADR wins over spec on any conflict**)
- **Migration high-water mark:** current top is `supabase/migrations/0045_user_views.sql` → **this plan adds `0046_agent_persistence.sql`** (confirmed by `ls supabase/migrations/`, 2026-07-03).
- **Reference slice (pattern to copy, do not reinvent):** `supabase/migrations/0045_user_views.sql` + `supabase/tests/0089_user_views_tenancy.test.sql` + `pmo-portal/src/lib/db/userViews.ts`.
- **Panel plan this one mirrors in structure:** `docs/plans/2026-06-30-agent-assistant-panel.md`.

---

## 0. Authority reconciliation & conflicts found (binding — read before building)

ADR-0043 is Accepted and is the controlling authority; the spec operationalizes it faithfully. **Two divergences between the spec's stated file paths and the repo's actual layout were found and are corrected here** (the ADR/spec *intent* is unchanged — only file paths move to where the code actually lives). These are mechanical corrections, not requirement changes; no owner adjudication needed (per the spec's own "Open Questions": file names are the eng-plan's to pick).

| ID | Spec/ADR says | Repo reality (verified) | Resolution (binding for this plan) |
|---|---|---|---|
| **REC-1** — handler unit-test location | Traceability table places handler tests at `supabase/functions/agent-chat/handler.persistence.test.ts` / `handler.deputy-invariant.test.ts`. | The agent-chat edge fn is **not** unit-tested in-place; all handler unit tests live under **`pmo-portal/src/lib/agent/*.test.ts`** and import the handler via a relative path (`../../../../supabase/functions/agent-chat/handler`). There is **no Vitest project rooted in `supabase/`** (`glob supabase/functions/**/*.test.ts` → none; `agentChatHandler.test.ts` etc. all live under `pmo-portal`). | Handler persistence tests go to **`pmo-portal/src/lib/agent/handlerPersistence.test.ts`** and **`pmo-portal/src/lib/agent/handlerDeputyInvariant.test.ts`**, matching the existing `agentChatHandler.test.ts` pattern (same `import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler'`). AC-ids unchanged (AC-AGP-013..018). |
| **REC-2** — panel component location | Traceability names `pmo-portal/src/components/panel/ThreadList.test.tsx` etc. | ✅ Correct — panel components DO live at `pmo-portal/src/components/panel/*`. But the orchestration **hook** lives at `pmo-portal/src/hooks/useAssistantPanel.ts` (NOT `src/components/panel/`, despite the ADR-0040 plan's original file tree). | Panel components stay under `src/components/panel/`; hook edits target `pmo-portal/src/hooks/useAssistantPanel.ts`. Repository/DAL files follow the `src/lib/db/*` slice pattern (`userViews.ts`), consumed by the hook — **not** `src/lib/repositories/*` (the spec's TODO says "repositories" but the shipped agent/user_views code uses `src/lib/db/*`; we follow the shipped pattern). |

**No requirement-level conflict** between ADR-0043 and the spec was found — the spec's "Contradictions / conflicts flagged" section already confirms this, and the one deliberate divergence from `user_views` (no Admin cross-owner read, FR-AGP-008) is called out in ADR-0043 §1 itself as intentional.

**Constants this plan fixes (spec left them to the eng-plan):**
- **Migration number:** `0046` (REC above).
- **Stuck-run staleness threshold (FR-AGP-022):** **`STUCK_RUN_STALE_MS = 45_000`** (45s). Exported from `pmo-portal/src/components/panel/stuckRun.constants.ts`. Rationale: a normal tool round + model turn under `MAX_TOOL_ROUNDS=8` completes well inside 45s; 45s is long enough to avoid false-positives on a slow-but-live model turn, short enough that a genuinely wedged run surfaces before the user gives up. Sits in the spec's suggested 30–60s band.
- **Heartbeat write cadence:** once per tool round and once per model turn (FR-AGP-014), via a `now()`-stamped `UPDATE agent_runs`.

---

## 1. Architecture & data flow

```
Browser (flag agentAssistant ON)
  AssistantPanel  ── reads ──►  useAssistantPanel (hook, src/hooks/)
     ├─ ThreadList         (NEW) ──► listAgentThreads()      ─┐
     ├─ Transcript          (EDIT: +thumbs on assistant rows) │  src/lib/db/agentThreads.ts
     ├─ StuckRunBanner     (NEW)  ──► rateAgentEvent()        │  src/lib/db/agentEvents.ts   (caller-JWT supabase client)
     └─ resume-on-open     (EDIT: hook)  ──► listRunEvents()  ─┘
                                                              │
  PmoNativeRuntime (transport) ── POST /functions/v1/agent-chat (SSE, unchanged wire) ──►
                                                              │
supabase/functions/agent-chat/ (Deno edge fn, caller-JWT deputy — NEVER service_role on agent_* tables)
  index.ts   (EDIT: build a *persistence* helper bound to callerClient; pass into deps)
  handler.ts (EDIT: on request start resolve/create thread+run; wrap emit() → also INSERT agent_events
              with monotonic seq; journal tool_name/tool_args_hash/tool_status on type='tool';
              heartbeat UPDATE agent_runs.last_progress_at each round; persist terminal status;
              de-dupe gate inside dispatchAction/dispatchActionForced on resume)
  persistence.ts (NEW: pure persistence functions taking the injected HandlerSupabaseLike —
              createThreadAndRun / insertEvent / journalToolEvent / heartbeat / setRunStatus /
              loadJournaledWrites / hashToolArgs. All caller-JWT. Unit-tested with mocked supabase.)
                                                              │
Postgres (RLS: owner-only on all three; append-only-except-feedback on events)
  agent_threads ─1:N─► agent_runs ─1:N─► agent_events   (migration 0046)
```

**Port contract is untouched (OBS-AGP-002).** `AgentRun`/`AgentEvent`/`AgentRunStatus`/`AgentEventType` in `port.ts` gain **no** fields. `agent_runs`/`agent_events` are the durable *backing* of those shapes; the DB-only lifecycle columns (`seq`, `last_progress_at`, `tool_*`, `rating`, `downvote_reason`) are storage concerns that never appear on the port types.

**Deputy invariant (NFR-AGP-SEC-001, AC-AGP-018).** Every `agent_*` write/read uses the **caller-JWT** `callerClient` already built in `index.ts` (line 71-74). `persistence.ts` receives that same `HandlerSupabaseLike` — it constructs **no** client and takes **no** `service_role` parameter, by construction. The client-disconnect continuation (FR-AGP-016) reuses the JWT captured at request start (the `callerClient` outlives the SSE socket, not the JWT).

**Stateless replay is preserved (OBS-AGP-001).** The client still POSTs the full `messages` array each turn; persistence is an *additional* write path, not a replacement. Resume de-dupe (FR-AGP-013) reads the DB journal to short-circuit re-executed writes — the `messages` replay is unchanged.

---

## 2. File tree (exact paths — NEW unless marked EDIT)

```
supabase/
  migrations/
    0046_agent_persistence.sql                         NEW   3 tables + indexes + RLS (owner-only, append-only-except-feedback)
  tests/
    0090_agent_persistence_schema.test.sql             NEW   AC-AGP-001..003 (columns, indexes, seq ordering)
    0091_agent_persistence_tenancy.test.sql            NEW   AC-AGP-004..008 (owner iso, cross-org, no-admin, insert-pin, archive)
    0092_agent_persistence_append_only.test.sql        NEW   AC-AGP-009..012 (append-only + feedback UPDATE)
  functions/agent-chat/
    persistence.ts                                     NEW   pure caller-JWT persistence helpers + hashToolArgs
    handler.ts                                         EDIT  wire persistence into emit()/dispatch/heartbeat/terminal
    index.ts                                           EDIT  build persistence bound to callerClient; pass into deps
pmo-portal/
  src/
    lib/
      features.ts                                      (unchanged — agentAssistant flag already present, line 15)
      db/
        agentThreads.ts                                NEW   listAgentThreads() (live, pinned-first, recency)
        agentThreads.test.ts                           NEW   ordering/scoping unit (mocked supabase client)
        agentEvents.ts                                 NEW   listRunEvents(runId) + rateAgentEvent(id, rating, reason)
        agentEvents.test.ts                            NEW   order-by-seq + feedback-payload-shape unit
      agent/
        handlerPersistence.test.ts                     NEW   AC-AGP-013..017 (journal/de-dupe/heartbeat/cancel)  [REC-1]
        handlerDeputyInvariant.test.ts                 NEW   AC-AGP-018 (no service_role on persistence path)     [REC-1]
    hooks/
      useAssistantPanel.ts                             EDIT  resume-on-open (listRunEvents→transcript); stuck detection state
      useAssistantPanel.persistence.test.ts            NEW   resume restores order + stuck-run flag (unit)
    components/
      panel/
        stuckRun.constants.ts                          NEW   STUCK_RUN_STALE_MS = 45_000
        ThreadList.tsx                                 NEW   semantic <ul>, pinned-first, own-threads-only
        ThreadList.test.tsx                            NEW   AC-AGP-019 (pinned above unpinned, recency)
        StuckRunBanner.tsx                             NEW   role="status", Retry/Cancel, heartbeat-keyed
        StuckRunBanner.test.tsx                        NEW   AC-AGP-020/021 (staleness render + cancel)
        Transcript.tsx                                 EDIT  +thumbs up/down + downvote-reason on assistant rows
        Transcript.test.tsx                            EDIT  AC-AGP-022 (thumbs feedback persists)
        AssistantPanel.tsx                             EDIT  render ThreadList + StuckRunBanner (flag-gated)
  e2e/
    AC-AGP-023-thread-persistence.spec.ts              NEW   converse→reload→restored; second user sees nothing
docs/
  adr/                                                  (0043 already exists — no new ADR; this plan records no new arch decision)
```

**No new ADR.** ADR-0043 already records every architectural decision (table shapes, RLS posture, journal, heartbeat, feedback, feature-flag gating). This plan introduces no irreversible/cross-cutting decision beyond it. The two mechanical choices (migration number, staleness constant) are recorded in §0, not an ADR.

---

## 3. Traceability (AC → owning test, ADR-0010 lowest-sufficient layer)

| AC | Layer | Owning test (title / file) |
|---|---|---|
| AC-AGP-001 | pgTAP | `AC-AGP-001 three tables exist with required columns` · `supabase/tests/0090_agent_persistence_schema.test.sql` |
| AC-AGP-002 | pgTAP | `AC-AGP-002 required indexes exist` · `0090_agent_persistence_schema.test.sql` |
| AC-AGP-003 | pgTAP | `AC-AGP-003 seq orders transcript not created_at` · `0090_agent_persistence_schema.test.sql` |
| AC-AGP-004 | pgTAP | `AC-AGP-004 non-owner same-org reads zero` · `supabase/tests/0091_agent_persistence_tenancy.test.sql` |
| AC-AGP-005 | pgTAP | `AC-AGP-005 cross-org read zero incl admin` · `0091_agent_persistence_tenancy.test.sql` |
| AC-AGP-006 | pgTAP | `AC-AGP-006 admin no cross-owner read` · `0091_agent_persistence_tenancy.test.sql` |
| AC-AGP-007 | pgTAP | `AC-AGP-007 insert pins org and owner, spoofed owner denied` · `0091_agent_persistence_tenancy.test.sql` |
| AC-AGP-008 | pgTAP | `AC-AGP-008 soft-archive hides from live index` · `0091_agent_persistence_tenancy.test.sql` |
| AC-AGP-009 | pgTAP | `AC-AGP-009 non-owner insert denied` · `supabase/tests/0092_agent_persistence_append_only.test.sql` |
| AC-AGP-010 | pgTAP | `AC-AGP-010 payload-touching update rejected` · `0092_agent_persistence_append_only.test.sql` |
| AC-AGP-011 | pgTAP | `AC-AGP-011 feedback update succeeds owner assistant row` · `0092_agent_persistence_append_only.test.sql` |
| AC-AGP-012 | pgTAP | `AC-AGP-012 feedback update denied non-owner` · `0092_agent_persistence_append_only.test.sql` |
| AC-AGP-013 | Unit | `AC-AGP-013 resumed write matching journal is hard-blocked` · `pmo-portal/src/lib/agent/handlerPersistence.test.ts` |
| AC-AGP-014 | Unit | `AC-AGP-014 repeated read never blocked` · `handlerPersistence.test.ts` |
| AC-AGP-015 | Unit | `AC-AGP-015 different-args write allowed` · `handlerPersistence.test.ts` |
| AC-AGP-016 | Unit | `AC-AGP-016 heartbeat advances each round` · `handlerPersistence.test.ts` |
| AC-AGP-017 | Unit | `AC-AGP-017 cancel drives terminal status` · `handlerPersistence.test.ts` |
| AC-AGP-018 | Unit | `AC-AGP-018 no service_role on persistence path` · `pmo-portal/src/lib/agent/handlerDeputyInvariant.test.ts` |
| AC-AGP-019 | Unit | `AC-AGP-019 thread list pinned above unpinned` · `pmo-portal/src/components/panel/ThreadList.test.tsx` |
| AC-AGP-020 | Unit | `AC-AGP-020 stuck-run banner on heartbeat staleness` · `pmo-portal/src/components/panel/StuckRunBanner.test.tsx` |
| AC-AGP-021 | Unit | `AC-AGP-021 cancel from stuck-run banner terminal state` · `StuckRunBanner.test.tsx` |
| AC-AGP-022 | Unit | `AC-AGP-022 thumbs feedback persists` · `pmo-portal/src/components/panel/Transcript.test.tsx` |
| AC-AGP-023 | E2E | `AC-AGP-023 converse reload transcript restored second user cannot see` · `pmo-portal/e2e/AC-AGP-023-thread-persistence.spec.ts` |

Supporting (non-owning) references: `useAssistantPanel.persistence.test.ts` exercises FR-AGP-021 resume ordering and FR-AGP-022 stuck-flag derivation at the hook layer; the owning render assertions stay on `StuckRunBanner.test.tsx` / e2e.

---

## PHASE A — Migration + pgTAP (schema is the foundation; RLS/tenancy owned here)

> TDD note for SQL: pgTAP is the failing-test-first vehicle. Write the test file, run `supabase test db` → it fails (table absent), then write the migration → it passes. Reset DB between edits with `supabase db reset` (all commands from repo root).

### Task A1 — Write the schema pgTAP (RED) — AC-AGP-001..003
**File:** `supabase/tests/0090_agent_persistence_schema.test.sql` (NEW)
Copy the `begin; select plan(N); … select * from finish(); rollback;` frame from `supabase/tests/0089_user_views_tenancy.test.sql`. Assert:
- `has_table('agent_threads')`, `has_table('agent_runs')`, `has_table('agent_events')`.
- `has_column('agent_threads','scope')` + `col_type_is('agent_threads','scope','jsonb')`; `has_column('agent_threads','pinned_at')`; `has_column('agent_threads','archived_at')`.
- `has_column('agent_runs','last_progress_at')`, `has_column('agent_runs','progress_step')`, `has_column('agent_runs','status')`.
- `has_column('agent_events','seq')` + `col_type_is('agent_events','seq','bigint')`; `has_column('agent_events','tool_args_hash')`, `has_column('agent_events','tool_status')`, `has_column('agent_events','rating')`, `has_column('agent_events','downvote_reason')`.
- `has_index('agent_events','agent_events_run_seq_idx')`, `has_index('agent_runs','agent_runs_thread_created_idx')`, `has_index('agent_threads','agent_threads_owner_live_idx')`.
- **seq ordering (AC-AGP-003):** insert (as table owner, bypassing RLS) one thread, one run, and three events with identical `created_at` (`'2026-07-03T00:00:00.000000Z'`) but `seq` 3,1,2; assert `select array_agg(seq order by seq) from agent_events where run_id = <id>` equals `{1,2,3}` AND `select seq from agent_events where run_id=<id> order by seq limit 1` = 1 (proving `seq`, not insert/`created_at` order, is the total order).

**Verify (fails):** `supabase db reset && supabase test db 2>&1 | grep 0090` → expect failure "relation agent_threads does not exist".

### Task A2 — Write the tenancy pgTAP (RED) — AC-AGP-004..008
**File:** `supabase/tests/0091_agent_persistence_tenancy.test.sql` (NEW)
Model on `0089_user_views_tenancy.test.sql` exactly (fixtures inserted as table owner, then `set local role authenticated` + `set local request.jwt.claims`). Fixture namespace `00910000-…`. Org A = default `00000000-…-0001`; Org B = `00910000-…-0002`. Users: Ann (org A, Engineer, owns thread/run/event), Bob (org A, Engineer, non-owner), Carol (org B, Engineer), Dana (**org A, Admin**, non-owner). Assert:
- **AC-AGP-004:** as Bob → `count(*) from agent_threads/agent_runs/agent_events` for Ann's rows = 0 each.
- **AC-AGP-005:** as Carol → `count(*)` for Ann's rows = 0 (cross-org wall); repeat for a **Carol-as-Admin** variant is unnecessary — instead assert the org-2-Admin case by making Carol Admin in a second sub-block, or add an org-B Admin user `Erin`; assert 0.
- **AC-AGP-006:** as **Dana (org-A Admin)** → `count(*)` for Ann's thread/run/event = 0 each (the explicit no-Admin-read divergence from `user_views` OD-2).
- **AC-AGP-007:** as Bob → `insert into agent_threads (owner_id, ...) values (<Ann's id>, ...)` **throws** (RLS `WITH CHECK`); use `throws_ok(...)` / `results_eq` on a `count` after a guarded insert. Also assert Bob inserting with his *own* owner but Ann's org is denied.
- **AC-AGP-008:** as Ann → insert a thread with `archived_at = now()`; assert the live-index query `select count(*) from agent_threads where owner_id = auth.uid() and archived_at is null` excludes it.

**Verify (fails):** `supabase test db 2>&1 | grep 0091` → failure (tables absent).

### Task A3 — Write the append-only + feedback pgTAP (RED) — AC-AGP-009..012
**File:** `supabase/tests/0092_agent_persistence_append_only.test.sql` (NEW)
Fixtures as above (namespace `00920000-…`). Assert as the relevant JWT:
- **AC-AGP-009:** Bob inserting an `agent_events` row under Ann's `run_id` → denied (`throws_ok`).
- **AC-AGP-010:** Ann `UPDATE agent_events SET payload = '{"x":1}'` on her own row → denied (append-only). Repeat for `text`, `type`, `tool_name`, `tool_args_hash`, `tool_status` in one `throws_ok` block each (or a helper).
- **AC-AGP-011:** Ann `UPDATE agent_events SET rating='down', downvote_reason='inaccurate'` on her own `type='assistant'` row → **succeeds** (`lives_ok`); then assert `payload`/`text`/`type` unchanged via `is(...)`.
- **AC-AGP-012:** Bob `UPDATE ... SET rating='up'` on Ann's assistant row → 0 rows affected / denied.

**Verify (fails):** `supabase test db 2>&1 | grep 0092` → failure.

### Task A4 — Write the migration (GREEN) — FR-AGP-001..009
**File:** `supabase/migrations/0046_agent_persistence.sql` (NEW)
Copy the header/reversibility comment style from `0045_user_views.sql`. Reuse `auth_org_id()` / `auth_role()` from `0002_rls.sql` (do **not** redefine). Emit exactly (per ADR-0043 §1/§2):

```sql
create table agent_threads (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id    uuid not null references profiles(id) default auth.uid(),
  title       text not null default 'New conversation',
  scope       jsonb,
  pinned_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);
create table agent_runs (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null references agent_threads(id) on delete cascade,
  org_id           uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id         uuid not null references profiles(id) default auth.uid(),
  title            text not null default '',
  status           text not null default 'queued'
                     check (status in ('queued','running','paused','needs-approval','completed','errored')),
  progress         numeric,
  last_progress_at timestamptz,
  progress_step    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create table agent_events (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references agent_runs(id) on delete cascade,
  org_id          uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id        uuid not null references profiles(id) default auth.uid(),
  seq             bigint not null,
  type            text not null check (type in ('user','assistant','tool','artifact','status','system')),
  text            text,
  payload         jsonb,
  tool_name       text,
  tool_args_hash  text,
  tool_status     text check (tool_status in ('completed','errored')),
  rating          text check (rating in ('up','down')),
  downvote_reason text check (downvote_reason in ('inaccurate','not_helpful','wrong_tool','too_slow')),
  created_at      timestamptz not null default now()
);
create index agent_events_run_seq_idx      on agent_events (run_id, seq);
create index agent_runs_thread_created_idx  on agent_runs (thread_id, created_at);
create index agent_threads_owner_live_idx   on agent_threads (owner_id) where archived_at is null;
```
Then `enable` + `force` RLS on all three; owner-only `select`/`insert`/`update`/`delete` using `owner_id = auth.uid() and org_id = auth_org_id()` for `agent_threads` and `agent_runs` (**no** `auth_role()='Admin'` branch — FR-AGP-008). For `agent_events`:
- `select`/`insert`/`delete`: owner-only (`owner_id = auth.uid() and org_id = auth_org_id()`; INSERT `with check` the same).
- **`update` (feedback-only, FR-AGP-009):** a single `for update` policy `using (owner_id = auth.uid() and org_id = auth_org_id() and type = 'assistant')` `with check (owner_id = auth.uid() and org_id = auth_org_id() and type = 'assistant')`. RLS `WITH CHECK` cannot by itself forbid touching `payload`/`text`; the append-only-except-two-columns guarantee is enforced by a **`before update` trigger** `agent_events_feedback_only()` that raises `unless (NEW.text is not distinct from OLD.text and NEW.payload is not distinct from OLD.payload and NEW.type = OLD.type and NEW.tool_name is not distinct from OLD.tool_name and NEW.tool_args_hash is not distinct from OLD.tool_args_hash and NEW.tool_status is not distinct from OLD.tool_status and NEW.seq = OLD.seq)` → `raise exception 'agent_events is append-only except rating/downvote_reason' using errcode = '42501'`. (This is the AC-AGP-010 authority; the `for update` policy alone permits the row, the trigger blocks column drift.) Include the manual-rollback DROP block in the header comment (drop policies, trigger, function, indexes, tables — reverse order).

**Verify (green):** `supabase db reset && supabase test db 2>&1 | grep -E '0090|0091|0092'` → all pass. Then targeted: `supabase test db` full green.

### Task A5 — Deputy-invariant gate at the DB layer (append to Task A2 file) — reinforces AC-AGP-005/006
**File:** `supabase/tests/0091_agent_persistence_tenancy.test.sql` (EDIT — same file as A2, add plan count)
Add one assertion that no policy on the three tables grants read to a non-owner: query `pg_policies` for `tablename in ('agent_threads','agent_runs','agent_events') and cmd='SELECT'` and assert every `qual` contains `owner_id = auth.uid()` and none contains `auth_role`. Titled `AC-AGP-006 no SELECT policy references auth_role (owner-only wall)`. This is the schema-level twin of the code-level deputy gate (Task C7).

**Verify:** `supabase test db 2>&1 | grep 0091` → pass.

---

## PHASE B — Edge-fn persistence (journal / heartbeat / de-dupe; unit-tested with mocked Supabase)

> Follows the existing handler-test pattern (`pmo-portal/src/lib/agent/agentChatHandler.test.ts`: inject `HandlerDeps` with a `vi.fn()`-mocked `supabase` + `anthropic`). Persistence logic is extracted into `persistence.ts` so it is unit-testable in isolation and the handler wiring stays thin.

### Task B1 — `hashToolArgs` failing test (RED) — supports FR-AGP-012, NFR-AGP-SEC-004
**File:** `pmo-portal/src/lib/agent/handlerPersistence.test.ts` (NEW) [REC-1]
Import `{ hashToolArgs }` from `'../../../../supabase/functions/agent-chat/persistence'`. Assert:
- `hashToolArgs({ b: 2, a: 1 })` === `hashToolArgs({ a: 1, b: 2 })` (canonical key order → same sha-256 hex).
- `hashToolArgs({ a: 1 })` !== `hashToolArgs({ a: 2 })`.
- Return value matches `/^[0-9a-f]{64}$/`.

**Verify (fails):** from `pmo-portal/`: `npx vitest run src/lib/agent/handlerPersistence.test.ts -t 'hashToolArgs'` → module-not-found.

### Task B2 — `persistence.ts` scaffold (GREEN for B1) — FR-AGP-012, NFR-AGP-SEC-004
**File:** `supabase/functions/agent-chat/persistence.ts` (NEW)
Export pure functions taking the injected `HandlerSupabaseLike` (never constructing a client — deputy invariant by construction). Signatures (types imported from `handler.ts`'s `HandlerSupabaseLike` / `../../../pmo-portal/src/lib/agent/runtime/port`):
```ts
export function hashToolArgs(validatedArgs: unknown): string  // sha-256 hex of canonicalized (sorted-key) JSON
export interface PersistenceDeps { supabase: HandlerSupabaseLike; ownerId: string; orgId: string; now: () => Date; }
export async function createThreadAndRun(deps, input: { title: string; scope?: unknown; runId: string }): Promise<void>
export async function insertEvent(deps, runId: string, seq: number, ev: AgentEvent): Promise<void>
export async function journalToolEvent(deps, runId, seq, ev, j: { toolName: string; argsHash: string; status: 'completed'|'errored' }): Promise<void>
export async function heartbeat(deps, runId: string, step?: string, progress?: number): Promise<void>  // UPDATE agent_runs SET last_progress_at=now()...
export async function setRunStatus(deps, runId: string, status: AgentRunStatus): Promise<void>
export async function loadJournaledWrites(deps, runId: string): Promise<Array<{ toolName: string; argsHash: string; payload: unknown }>>
```
Use `crypto.subtle.digest('SHA-256', …)` (available in Deno + Node 20 test env) — canonicalize via a recursive stable-key `JSON.stringify`. `insertEvent`/`journalToolEvent` write `owner_id`/`org_id`? **No** — rely on the column DEFAULTs (`auth.uid()` / seed-org) + RLS `WITH CHECK`, exactly like `userViews.ts` never sends them; but the edge fn's `callerClient` runs under the JWT so `auth.uid()` resolves. Pass `seq` explicitly. `heartbeat`/`setRunStatus` are `UPDATE ... WHERE id = runId` (owner RLS scopes them). Swallow heartbeat errors per the spec Error-Handling table (log count/code only, NFR-AGP-SEC-005).

**Verify (green):** `npx vitest run src/lib/agent/handlerPersistence.test.ts -t 'hashToolArgs'` → pass.

### Task B3 — De-dupe gate failing tests (RED) — AC-AGP-013/014/015
**File:** `pmo-portal/src/lib/agent/handlerPersistence.test.ts` (EDIT)
Add three `it(...)` titled with the AC-ids. Build `HandlerDeps` (copy `baseDeps`/`mockOrgAnd` helpers from `agentChatHandler.test.ts`), plus a persistence-enabled dep flag (see B4). Seed the mock `loadJournaledWrites` to return `[{ toolName: 'create_activity', argsHash: H, payload: { ok: true, id: 'x' } }]` where `H = hashToolArgs(validatedArgs)`. Drive the handler on a resume request (`runId` present) where the model proposes `create_activity` with those args:
- **AC-AGP-013:** assert the `create_activity` action's `run` (a `vi.fn()`) is **NOT** called, and the emitted `tool` event's `payload.result` deep-equals the journaled `{ ok: true, id: 'x' }`.
- **AC-AGP-014:** journal a completed `query_entity` (read, `confirm:false`), propose the same read on resume → the read action's `run` **IS** called (reads never blocked).
- **AC-AGP-015:** journal `(create_activity, H1)`, propose `create_activity` with args hashing to `H2 ≠ H1` → `run` **IS** called.

**Verify (fails):** `npx vitest run src/lib/agent/handlerPersistence.test.ts` → the three AC tests fail (no gate yet).

### Task B4 — Wire persistence into the handler (GREEN for B3) — FR-AGP-010..015, FR-AGP-018/019
**File:** `supabase/functions/agent-chat/handler.ts` (EDIT)
Extend `HandlerDeps` with an **optional** `persistence?: PersistenceDeps & { journaledWrites?: Array<{toolName;argsHash;payload}> }` (optional so flag-off / existing tests pass unchanged — FR-AGP-026 gating). In `agentChatHandler`:
1. **On start (no `req.decision`):** if `deps.persistence`, `await createThreadAndRun(...)` for a new run (`req.runId` absent) using `req.messages[last user].content.slice(0,60)` as title and `req.context` mapped to `scope` when it names an entity. (FR-AGP-010.)
2. **Wrap `emit`:** after building each `AgentEvent`, if `deps.persistence`, `await insertEvent(...)` with a per-run monotonic `seq` counter (`let seq = 0; …insertEvent(deps, runId, seq++, ev)`), then `journalToolEvent(...)` when `ev.type==='tool'` (compute `argsHash = hashToolArgs(validatedInput)`; `status` from whether the result carried an error). (FR-AGP-011/012, FR-AGP-005.)
3. **De-dupe in `dispatchAction`/`dispatchActionForced`:** before calling `action.run`, if `action.confirm` (a write) AND `deps.persistence?.journaledWrites` contains a match on `(toolName, hashToolArgs(validatedInput))`, **return the journaled `payload`** instead of running (FR-AGP-013). Reads (`action.confirm !== true`) always run (FR-AGP-014/019). Load `journaledWrites` once at handler start via `loadJournaledWrites` when resuming.
4. **Resume context injection (FR-AGP-018):** on resume, prepend a synthetic tool_result-style summary of journaled completed writes into `messages` so the model does not re-plan a done step. Keep it minimal (name + result JSON), gated on `deps.persistence`.
5. **Heartbeat (FR-AGP-014):** call `await heartbeat(...)` at the top of each `for (round …)` iteration in both `agentChatHandler`'s loop and `runLoop`.
6. **Terminal status (FR-AGP-015):** wherever a terminal `statusEvent('completed'|'errored', …)` is yielded, also `await setRunStatus(deps, runId, status)` when `deps.persistence`.

All persistence calls are `deps.persistence`-guarded so the existing `agentChatHandler.test.ts` (no persistence dep) is unaffected — run it to confirm.

**Verify (green):** `npx vitest run src/lib/agent/handlerPersistence.test.ts` → AC-AGP-013/014/015 pass; `npx vitest run src/lib/agent/agentChatHandler.test.ts` → still green (no regression).

### Task B5 — Heartbeat + cancel failing tests (RED) then confirm (GREEN) — AC-AGP-016/017
**File:** `pmo-portal/src/lib/agent/handlerPersistence.test.ts` (EDIT)
- **AC-AGP-016:** run the handler across N=2 tool rounds (mock anthropic to return a tool_use then end_turn); spy on the mocked `agent_runs` UPDATE (via the `supabase.from('agent_runs').update` mock capturing calls) and assert `last_progress_at` was set with an advancing `now()` after each round (inject `deps.persistence.now` returning increasing timestamps).
- **AC-AGP-017:** simulate `control('cancel')` by aborting mid-stream (the handler's cancel path) OR by asserting that on the cancel branch `setRunStatus(deps, runId, 'errored')` is invoked with a terminal status and no further model turn fires. (Cancel reuses the port's existing `control(runId,'cancel')`; the handler's server-abort persists the terminal status per FR-AGP-015/017.)

If B4's heartbeat/terminal wiring is complete these pass; otherwise adjust B4. **Verify:** `npx vitest run src/lib/agent/handlerPersistence.test.ts` → all AC-AGP-013..017 pass.

### Task B6 — Deputy-invariant gate test (RED→GREEN) — AC-AGP-018, NFR-AGP-SEC-001
**File:** `pmo-portal/src/lib/agent/handlerDeputyInvariant.test.ts` (NEW) [REC-1]
Port the shape of the retired sidecar's `deputy-invariant.gate.test`. Assert, statically + dynamically:
- **Static:** read `supabase/functions/agent-chat/persistence.ts` source (via `fs.readFileSync`) and assert it contains **no** `service_role` / `SERVICE_ROLE` / `createClient(` token — persistence never constructs a privileged client. Titled `AC-AGP-018 persistence.ts constructs no service_role client`.
- **Dynamic:** build `HandlerDeps` where the mocked `supabase` records every `.from(table)` call; drive a persistence-enabled run that creates a thread/run/event + heartbeat; assert **every** `agent_*` table access went through the single injected `deps.persistence.supabase` object (identity check — the same mock instance passed as `callerClient`), and that no second client object was ever referenced.

**Verify:** `npx vitest run src/lib/agent/handlerDeputyInvariant.test.ts` → pass.

### Task B7 — Wire persistence into the Deno entry (`index.ts`) — FR-AGP-016/017, FR-AGP-026
**File:** `supabase/functions/agent-chat/index.ts` (EDIT)
Construct `PersistenceDeps` bound to the existing `callerClient` (line 71-74 — the caller-JWT client; **never** `verifierClient`): resolve `orgId` from the handler's existing profiles lookup path is internal, so pass `ownerId: userId` and let the handler read `orgId` as it already does; simplest: pass `persistence: { supabase: callerClient, ownerId: userId, now: () => new Date() }` and have the handler fill `orgId` after its gate-2 lookup (adjust `PersistenceDeps.orgId` to be set inside the handler once `orgId` is known). Gate the whole block on an env flag mirroring the SPA's `agentAssistant` (read `Deno.env.get('AGENT_PERSISTENCE')` — default ON in deployed env; when unset/`'false'`, pass `persistence: undefined` so no `agent_*` writes occur, satisfying FR-AGP-026's "flag off → tables exist, no writes"). **Client-disconnect continuation (FR-AGP-016):** in the `ReadableStream.start`, wrap `controller.enqueue` so an enqueue error (dropped socket) is swallowed but the `for await (const ev of agentChatHandler(...))` loop **continues to completion** (persisting remaining events) rather than breaking — the generator drains server-side to a terminal status. This file is integration-only (not unit-tested, per its header) — verified by the e2e (Task E1) + deploy-time BUILD-TIME-VERIFY checklist.

**Verify:** `cd pmo-portal && npm run typecheck` (the shared `transport.ts`/`port.ts` types must still compile against the edits) → zero errors. Deno lint of the function is a deploy-time gate (not CI).

---

## PHASE C — Client runtime + repository seam (port unchanged)

### Task C1 — `agentThreads.ts` DAL + failing test (RED) — FR-AGP-020, supports AC-AGP-019
**Files:** `pmo-portal/src/lib/db/agentThreads.test.ts` (NEW), `pmo-portal/src/lib/db/agentThreads.ts` (NEW)
Follow `userViews.ts` exactly (import `supabase` from `@/src/lib/supabase/client`, `AppError` on error, never send `org_id`/`owner_id`). Test asserts `listAgentThreads()` issues `.from('agent_threads').select('*').is('archived_at', null).order('pinned_at', { ascending: false, nullsFirst: false }).order('updated_at', { ascending: false })` (pinned-first, then recency) and maps rows to `AgentThreadRow[]`. Mock the `supabase` client. Titled `listAgentThreads orders pinned above unpinned then by recency`.

**Verify (fails then passes):** `cd pmo-portal && npx vitest run src/lib/db/agentThreads.test.ts`.

### Task C2 — `agentEvents.ts` DAL + failing test (RED) — FR-AGP-021, FR-AGP-024/025
**Files:** `pmo-portal/src/lib/db/agentEvents.test.ts` (NEW), `pmo-portal/src/lib/db/agentEvents.ts` (NEW)
Export `listRunEvents(runId): Promise<AgentEventRow[]>` → `.from('agent_events').select('*').eq('run_id', runId).order('seq', { ascending: true })` (FR-AGP-021, the `(run_id, seq)` index path). Export `rateAgentEvent(id, rating: 'up'|'down', reason?: DownvoteReason): Promise<void>` → `.from('agent_events').update({ rating, downvote_reason: reason ?? null }).eq('id', id)` (the single narrow feedback UPDATE; RLS + trigger enforce owner + column limits — the DAL sends only the two columns). Tests assert the query shape + that `rateAgentEvent` sends **only** `rating`/`downvote_reason`. Titled `listRunEvents orders by seq ascending` / `rateAgentEvent sends only feedback columns`.

**Verify:** `npx vitest run src/lib/db/agentEvents.test.ts`.

### Task C3 — Resume-on-open in the hook + failing test (RED) — FR-AGP-021
**Files:** `pmo-portal/src/hooks/useAssistantPanel.persistence.test.ts` (NEW), `pmo-portal/src/hooks/useAssistantPanel.ts` (EDIT)
Add `openThread(threadId, runId)`: calls `listRunEvents(runId)`, maps each `AgentEventRow` → `TranscriptEntry` (reusing `mergeAssistantEvent` for consecutive assistant rows so the reload reproduces the client-side merge, FR-AGP-011 note), sets `transcript` + `runId`. Test (renderHook, mocked `agentEvents` module) asserts an out-of-insertion-order-but-seq-ordered event array restores in `seq` order with user→assistant→tool interleaving intact. Titled `openThread restores transcript in seq order`. Also add derived `isStuck` state (Task C4 consumes it) computed from a run's `last_progress_at` vs `STUCK_RUN_STALE_MS` — but keep the banner render in `StuckRunBanner` (this hook only exposes the boolean + `cancel`/`retry`).

**Verify:** `npx vitest run src/hooks/useAssistantPanel.persistence.test.ts`.

### Task C4 — `stuckRun.constants.ts` — FR-AGP-022
**File:** `pmo-portal/src/components/panel/stuckRun.constants.ts` (NEW)
`export const STUCK_RUN_STALE_MS = 45_000;` + a JSDoc citing FR-AGP-022 and §0 rationale. No test of its own (consumed by C5/StuckRunBanner). One-liner.

**Verify:** `npx vitest run` picks it up transitively; `npm run typecheck` clean.

---

## PHASE D — Panel UI (component TDD, DESIGN.md tokens)

> Rendered Discover pass (MEMORY: rendered-review-catches-what-tests-pass) required for: the ThreadList (pinned/recency visual grouping + empty state), the StuckRunBanner (banner styling + Retry/Cancel affordance), and the thumbs/downvote-reason control (down-state + reason picker). Note these three states for the design-reviewer render round before promote.

### Task D1 — `ThreadList` failing test (RED) — AC-AGP-019, NFR-AGP-A11Y-003
**File:** `pmo-portal/src/components/panel/ThreadList.test.tsx` (NEW)
Render `<ThreadList threads={…} onOpen={vi.fn()} />` with three threads: one `pinned_at` set + two unpinned with descending `updated_at`. Assert (RTL): the rendered order (query `getAllByRole('listitem')`) is pinned-first then unpinned-by-recency; the container is a semantic `<ul>` with `aria-label="Recent conversations"` (NFR-AGP-A11Y-003); each item exposes its title as accessible text (pinned state conveyed by a text/`aria` marker, not color alone). Titled `AC-AGP-019 thread list pinned above unpinned`.

**Verify (fails):** `npx vitest run src/components/panel/ThreadList.test.tsx`.

### Task D2 — `ThreadList.tsx` (GREEN) — FR-AGP-020, NFR-AGP-A11Y-003
**File:** `pmo-portal/src/components/panel/ThreadList.tsx` (NEW)
Semantic `<ul aria-label="Recent conversations">`; each `<li>` a `<button>` (keyboard-operable, focus ring per DESIGN.md tokens `focus:ring-2 focus:ring-ring`) showing `thread.title` + a pinned marker (`<Icon name="pin" />` + `aria-label` or sr-only "Pinned"). Props are already sorted (DAL owns order, C1) — the component renders as given. Use existing panel token classes (copy from `AssistantPanel.tsx`: `text-muted-foreground hover:bg-accent`, `rounded-md`, `size-8`). Scope safety: the DAL only returns the caller's own rows (RLS) — the component never receives another user's thread.

**Verify (green):** `npx vitest run src/components/panel/ThreadList.test.tsx`.

### Task D3 — `StuckRunBanner` failing tests (RED) — AC-AGP-020/021, NFR-AGP-A11Y-001
**File:** `pmo-portal/src/components/panel/StuckRunBanner.test.tsx` (NEW)
- **AC-AGP-020:** render `<StuckRunBanner lastProgressAt={<now - 46s>} status="running" now={<now>} onRetry onCancel />`; assert the banner renders (`role="status"` + `aria-live="polite"`, NFR-AGP-A11Y-001) with visible "This is taking longer than expected." text and **Retry** + **Cancel** buttons — keyed on `now - lastProgressAt > STUCK_RUN_STALE_MS`, **independent** of any SSE prop (there is no SSE prop). Also assert it does **not** render when `lastProgressAt` is fresh (`now - 10s`).
- **AC-AGP-021:** `fireEvent.click` Cancel → `onCancel` called once (the panel wires `onCancel` to `runtime.control(runId,'cancel')`, driving terminal state).
Titled `AC-AGP-020 stuck-run banner on heartbeat staleness` / `AC-AGP-021 cancel from stuck-run banner terminal state`.

**Verify (fails):** `npx vitest run src/components/panel/StuckRunBanner.test.tsx`.

### Task D4 — `StuckRunBanner.tsx` (GREEN) — FR-AGP-022/023, NFR-AGP-A11Y-001/002
**File:** `pmo-portal/src/components/panel/StuckRunBanner.tsx` (NEW)
Renders `null` unless `status` is active (`running`/`paused`/`needs-approval`) AND `now - lastProgressAt > STUCK_RUN_STALE_MS` (import from `stuckRun.constants.ts`). When shown: a `role="status" aria-live="polite"` card (reuse `ErrorCard` styling from `AssistantPanel.tsx` — `rounded-md border … px-3 py-2 text-sm`) with the message + two keyboard-operable buttons (`Retry` → `onRetry`, `Cancel` → `onCancel`) with visible focus rings (NFR-AGP-A11Y-002). Retry starts a fresh run on the same thread via the hook's existing `retry()` (FR-AGP-023).

**Verify (green):** `npx vitest run src/components/panel/StuckRunBanner.test.tsx`.

### Task D5 — Transcript thumbs feedback failing test (RED) — AC-AGP-022, NFR-AGP-A11Y-002
**File:** `pmo-portal/src/components/panel/Transcript.test.tsx` (EDIT)
Add: render a transcript containing one `assistant` event with a known `event.id`; pass an `onRate={vi.fn()}` prop. Assert thumbs-up + thumbs-down buttons appear **only on assistant rows** (not user/tool), are keyboard-operable with `aria-label` ("Good response"/"Bad response", NFR-AGP-A11Y-002). Click thumbs-down → a downvote-reason picker appears with the four options `{inaccurate, not_helpful, wrong_tool, too_slow}`; pick `inaccurate` → `onRate` called with `(event.id, 'down', 'inaccurate')`. Titled `AC-AGP-022 thumbs feedback persists`.

**Verify (fails):** `npx vitest run src/components/panel/Transcript.test.tsx`.

### Task D6 — Transcript thumbs feedback (GREEN) — FR-AGP-024/025
**File:** `pmo-portal/src/components/panel/Transcript.tsx` (EDIT)
On `assistant`-type transcript items, render a small thumbs row (up/down `<button>`s, DESIGN.md tokens, `aria-label`s). Thumbs-down reveals a reason picker (`<select>` or four token-styled buttons) for `{inaccurate, not_helpful, wrong_tool, too_slow}`. Wire to a new `onRate?(eventId, rating, reason?)` prop; `AssistantPanel` passes `onRate={rateAgentEvent}` (from `agentEvents.ts`, C2) flag-gated. Optimistic UI: on click, mark the local item's rating (the DB row is the durable record; a denied UPDATE, e.g. non-owner, simply doesn't change the row — Error-Handling table). NO PostHog emit here (out of scope — batteries-A item 4).

**Verify (green):** `npx vitest run src/components/panel/Transcript.test.tsx`.

### Task D7 — Wire ThreadList + StuckRunBanner into `AssistantPanel` (flag-gated) — FR-AGP-020/022, FR-AGP-026
**File:** `pmo-portal/src/components/panel/AssistantPanel.tsx` (EDIT)
Behind `isFeatureEnabled('agentAssistant')` (already the panel's own gate — the panel only mounts when on, so this is implicit, but the new DAL calls must not fire when off): add a collapsible ThreadList region in the header/top of the transcript area (opens a thread via `openThread` from the hook, C3); render `<StuckRunBanner … />` inside the transcript region using the hook's derived `isStuck`/`lastProgressAt` + `onRetry={retry}` `onCancel={stop}`. Keep the existing `Transcript`/`Composer` layout; pass `onRate` to `Transcript`. Update `AssistantPanel.test.tsx` only if the new regions break an existing query (adjust, do not weaken assertions — BDD rule).

**Verify:** `npx vitest run src/components/panel/AssistantPanel.test.tsx src/components/panel/AssistantPanel.mobile.test.tsx` → green.

---

## PHASE E — Curated e2e + full gate

### Task E1 — Persistence e2e (RED→GREEN) — AC-AGP-023
**File:** `pmo-portal/e2e/AC-AGP-023-thread-persistence.spec.ts` (NEW)
Playwright, leading `test('AC-AGP-023 …')` title. Two-user journey against local Supabase (real cross-stack per ADR-0010):
1. Sign in as user A (seed user); open the panel (⌘J / Rail entry); send "how many of my projects are active?"; wait for an assistant reply to render.
2. `page.reload()`; reopen the panel; open the same thread from the ThreadList → assert the full transcript restores **in order** (user message text, then assistant reply, in sequence — assert DOM order of transcript items).
3. Sign out; sign in as user B (different seed user); open the panel → assert user A's thread does **not** appear in B's ThreadList (and a direct `listRunEvents(runIdOfA)` in-page returns empty — RLS wall).
Follow the existing agent e2e patterns (`e2e/AC-AR-013-*` / `AC-CV-015-*` — full-serial, dedicated fixtures per MEMORY). Requires `VITE_FEATURES_AGENT_ASSISTANT=true` + `AGENT_PERSISTENCE` on for the e2e env.

**Verify:** from `pmo-portal/`: `npx playwright test e2e/AC-AGP-023-thread-persistence.spec.ts`.

### Task E2 — FULL verify + integration gate (binding pre-PR)
Run, from `pmo-portal/`, in order:
1. `npm run verify` (= `typecheck && lint:ci && test && build`) — the WHOLE suite, never just touched files (a shared-component edit like `Transcript.tsx` can break other renders).
2. From repo root: `supabase db reset && supabase test db` — all pgTAP incl. `0090/0091/0092` green.
3. From `pmo-portal/`: `npx playwright test e2e/AC-AGP-023-thread-persistence.spec.ts` (+ the agent panel journeys `AC-AR-013`/`AC-CV-015` to confirm no persistence regression).
4. **Rendered Discover pass** on a clean build (`npm run build && npm run preview`): render the ThreadList (pinned/recency + empty), StuckRunBanner (stale state), and thumbs/downvote control — MEMORY: render-before-promote; stub unit tests are not the rendered pass.

**Only after all four are green** does the issue go to the review battery (3-lens + rendered Discover + BDD) → PR to `dev`. Never open the PR before the full battery is green locally (MEMORY: pr-after-review-battery).

---

## 4. Type/signature consistency (guard across tasks)

- `hashToolArgs(validatedArgs: unknown): string` — identical in `persistence.ts` (B2), handler de-dupe (B4), and all `handlerPersistence.test.ts` assertions (B1/B3). The de-dupe key is `(toolName, hashToolArgs(validatedInput))` everywhere; args are the **validated** (post-`action.validate`) value, never raw model output (NFR-AGP-SEC-004).
- `AgentThreadRow` / `AgentEventRow` = `Tables<'agent_threads'>` / `Tables<'agent_events'>` from regenerated `src/lib/supabase/database.types.ts` (regen after the migration — `supabase gen types`; **do not hand-cast**, MEMORY: type-regen-not-casts). `DownvoteReason = AgentEventRow['downvote_reason']` (the DB check-constraint union) — reused by `rateAgentEvent` (C2) and the Transcript picker (D6).
- `openThread(threadId: string, runId: string)`, `isStuck: boolean`, `lastProgressAt: string | null` — added to `UseAssistantPanel` (C3) and consumed identically by `AssistantPanel` (D7).
- `StuckRunBanner` props `{ status: AgentRunStatus; lastProgressAt: string | null; now?: number; onRetry(): void; onCancel(): void }` — same in test (D3) and component (D4); `STUCK_RUN_STALE_MS` imported from `stuckRun.constants.ts` in both.
- Handler `PersistenceDeps` (B2) is the single persistence-dep shape passed from `index.ts` (B7) and asserted in the deputy gate (B6).

## 5. Scaling / risk notes (Performance + Architecture lenses)

- **Transcript fetch is O(1) indexed** (`agent_events_run_seq_idx` on `(run_id, seq)`) — no N+1 per event (NFR-AGP-PERF-001). Thread list uses the partial `agent_threads_owner_live_idx` (owner, `where archived_at is null`).
- **Heartbeat = one PK UPDATE per round** on `agent_runs` (NFR-AGP-PERF-002) — bounded by `MAX_TOOL_ROUNDS=8`.
- **Write amplification:** every SSE event now also does one INSERT. Acceptable (all owner-RLS, all indexed); at millions-of-users scale the `agent_events` table is the growth driver — the append-only + `(run_id, seq)` design is partition-ready (future `PARTITION BY RANGE (created_at)` is additive, no rewrite). Flag as a future-scale note, not a v1 action.
- **`seq` assignment race:** the handler assigns `seq` from an in-request counter (single writer per run — the edge fn owns the run's turn), so no cross-request contention within a run. If a future `AgentNativeRuntime` writes concurrently, move `seq` to a per-run sequence/`max(seq)+1` under a row lock (recorded for the future adapter; not needed now — one writer).
- **Client-disconnect continuation (FR-AGP-016)** is bounded by the edge fn's wall-clock + `MAX_TOOL_ROUNDS`; it is **not** an unbounded background job and **not** a `service_role` escalation. The one reviewer-guarded invariant: the `index.ts` enqueue-swallow must not break the generator loop (Task B7) — a broken loop would leave the journal incomplete and defeat durable-resume.
- **Duplicate-logic avoidance:** `listAgentThreads`/`listRunEvents`/`rateAgentEvent` follow the `userViews.ts` DAL shape verbatim (never send `org_id`/`owner_id`; `AppError` with preserved code) — no new error-classification path. The de-dupe gate is added **inside** the existing `dispatchAction`/`dispatchActionForced` (OBS-AGP-004), not as a parallel gate.

## 6. Open questions for the Director

1. **`AGENT_PERSISTENCE` env flag vs. always-on.** ADR-0043 §"Feature-flag gating" gates persistence behind `agentAssistant` (a Vite/SPA flag Deno cannot read). Plan uses a mirrored Deno env flag `AGENT_PERSISTENCE` (default ON) so the edge fn can gate its own writes independently — analogous to how `composeEnabled` is passed from `index.ts` (handler.ts line 331) and how ADR-0039's `aiComposer` sub-flag works. **Confirm this mirrored-flag approach** (vs. threading the SPA flag through the request body). Recommendation: mirrored env flag, default ON in deployed envs.
2. **Scope binding on first message (FR-AGP-010).** The plan maps `req.context` (`{route, entityId}`) → `agent_threads.scope` when it names an entity, but `RunContext` today carries only `route`/`entityId` (no `type`/`label`). Deriving `scope.type`/`scope.label` from the route is a small mapping the plan leaves to build-time; **confirm** whether v1 should populate `scope` at all or ship it always-`null` (unscoped) and defer entity-binding to the ADR-0045 live-half work. Recommendation: ship `scope` nullable + populate only when `entityId` is present with a trivially-derivable label; otherwise null (graceful per FR-AGP-002).
3. **Type regen ownership.** The plan assumes `supabase gen types` is run after migration 0046 to add `agent_*` to `database.types.ts` (needed by the DAL, C1/C2). Confirm the implementer runs regen (not a hand-written type) — standing MEMORY rule, restated here because three new tables land at once.
