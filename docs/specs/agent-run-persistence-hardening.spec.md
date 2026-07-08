# SDD: Agent Run Persistence Hardening — make the durable-run contract structurally un-rebreakable

**Feature:** Three sibling correctness fixes in the agent-chat persistence layer that together make the
2026-07-08 money-path bug **structurally impossible to reintroduce** and close its two idempotency
siblings. (1) **Codify the run-lifecycle invariant** — the run row is keyed by its *id* and created
*iff-not-exists*; request shape (presence/absence of `runId`) is **never** the run key — and lock it with
a regression test. (2) Make `insertEvent` an **idempotent upsert** on `(run_id, seq)` so a resumed/retried
producer re-emitting a seq is a safe no-op instead of a swallowed error. (3) Give `agent_usage` a
**run/step-scoped dedup key** (`ref_id`) so re-recording a model call **overwrites instead of
double-counting**. All three are expressions of one principle — **natural-keyed, idempotent-on-conflict
persistence** — that the reference framework (`@agent-native/core`) encodes structurally
(`docs/design/durable-agent-runs.md` steps 2–3 + "Idempotency / dedup"; `UsageRecord.refId`) and we encode
defensively. This spec is deliberately **small** (one PR, ~3 changes + one reversible migration) and
**defer-cold-safe**: it restates every binding it depends on.

**Spec ID prefix:** ARH (`FR-ARH-###` functional · `NFR-ARH-###` non-functional · `AC-ARH-###` acceptance)
**ADR refs:** ADR-0043 (agent thread/event persistence & run lifecycle — the **home** ADR; this spec
codifies its lifecycle invariant and adds the two idempotency siblings), ADR-0036 (deputy invariant — run
under caller JWT, RLS is the **sole** enforcement authority; never thread `org_id` from the client),
ADR-0010 (test pyramid — one owning layer per AC), ADR-0017 (DAL/repository seam — `persistence.ts`/`usage.ts`
are the caller-JWT DAL), ADR-0001 (org_id seam — column defaults + stamp trigger), ADR-0039 (untrusted-output
boundary / swallow discipline inherited here).
**Layer ownership (ADR-0010):** lifecycle-gate logic + idempotent-insert/upsert **call shape** →
**Unit** (Vitest, `pmo-portal/src/lib/agent/{handlerPersistence,usage}.test.ts`, importing the edge fns by
relative path — the existing convention); schema/RLS/org_id-seam/append-only **contracts** → **pgTAP**
(`supabase/tests/`, siblings to `0091`/`0092`/`0093`); **no e2e layer needed** (no new route, no UI, no
cross-stack journey — the existing `AC-AGP-023-thread-persistence.spec.ts` already covers the end-to-end
persist path and is referenced, not re-owned). One owning layer per AC (§5).
**Status:** Draft — 2026-07-08
**Author:** Director (Claude Opus 4.8)

---

## 1. Context & problem

The 2026-07-08 gap analysis (`/Users/ariefsaid/Coding/PMO/docs/spikes/2026-07-08-agent-native-gap-analysis.md`)
found that we "didn't lack the primitives — we mis-keyed a lifecycle we already had the tables for." The
**money-path bug** was not a missing capability: it was the run row being created on the wrong key. The FE
adapter (`pmo-portal/src/lib/agent/runtime/pmoNativeRuntime.ts`) mints a `runId` client-side on every
`createRun` (`pmoNativeRuntime.ts:70`, `const runId = crypto.randomUUID();`) and sends it on **every** POST
in the request body (`pmoNativeRuntime.ts:247`, the `runId` field of `AgentChatRequest`). The handler used
to gate thread/run creation on `!req.runId` — so a real browser run (which always carries `runId`) **never
created its `agent_runs` row**. Every downstream `agent_events`/`agent_usage` insert then failed the run-FK
/ RLS `WITH CHECK` with `42501`; short runs silently went unpersisted, and runs of ≥3 model rounds tripped
the fail-closed usage breaker (`_shared/usage.ts:51`, `FAIL_CLOSED_THRESHOLD = 3`) → the turn errored and
monitoring saw nothing.

This is **already fixed** in code: `handler.ts:1050` resolves `const runId = req.runId ?? makeId();`, then
`handler.ts:1062` gates on run **existence** — `if (persist && !(await runExists(persist.deps, runId)))`
→ `createThreadAndRun` (`handler.ts:1073`). `runExists` (`persistence.ts:116`) is a `select id …
maybeSingle()` probe, fail-open to creation. **This spec does not re-do that fix.** It (a) **codifies the
binding invariant** so the `!runId` mistake cannot be reintroduced by a future refactor that re-derives the
gate from request shape, (b) closes the **two idempotency siblings** the same analysis flagged — event
insert and usage record — which share the exact same failure shape (a resumed/retried producer re-emitting
a natural key errors or duplicates instead of no-op'ing/overwriting), and (c) records the invariant in
ADR-0043 as the rule of record.

The reference framework (`@agent-native/core`) makes these three structurally impossible:
`docs/design/durable-agent-runs.md` steps 2–3 insert the run row by natural id *before* dispatch and the
worker *claims* it with a conditional update — so "`!runId` is never a signal" by construction; its event
store is `ON CONFLICT (run_id, seq) DO NOTHING` (cited in the gap-analysis "Run/event persistence
idempotency" row, quoting `run-store.ts insertRunEvent`); and `UsageRecord.refId`
(`dist/usage/store.d.ts`) "any prior row(s) with the same (label, refId) are deleted before insert, so
re-recording the same run overwrites instead of double-counts." We adopt the **patterns**, not their
Nitro/Netlify machinery: we are Supabase-edge + deepseek-pinned (`deepseek/deepseek-v4-flash`, binding) +
single-tenant-with-`org_id`-seam, so the run is driven inline inside the edge fn (capped at
`MAX_TOOL_ROUNDS = 8`, `handler.ts:59`, and the ~150s Supabase-edge wall) — no background worker, no
cross-model fallback, no Nitro. The three fixes here are pure persistence-layer correctness on tables we
already have.

### 1.1 Current-state audit (state vs fix — with file evidence)

Every claim below was verified by reading the code (not trusted from the brief).

| Concern | State | Evidence |
|---|---|---|
| Run created on run **existence**, not request shape | **FIXED (this spec codifies it)** | `handler.ts:1050` `const runId = req.runId ?? makeId();`; `handler.ts:1062` `if (persist && !(await runExists(persist.deps, runId)))`; `handler.ts:1073` `await createThreadAndRun(…)` — existence-gated create, iff-not-exists |
| `runExists` probe (fail-open to creation) | **SHIPPED** | `persistence.ts:116` (`select id … eq('id',runId) … maybeSingle()`; on error returns `false` so create is *attempted*) |
| `createThreadAndRun` (thread iff no `threadId`; run insert; swallows errors) | **SHIPPED** | `persistence.ts:143` |
| FE mints runId on every `createRun` | **SHIPPED (the root cause of the old bug)** | `pmoNativeRuntime.ts:70` `const runId = crypto.randomUUID();` |
| FE sends runId on **every** POST (fresh + followUp + decision + answer re-POST) | **SHIPPED** | `pmoNativeRuntime.ts:247` `runId,` in the POST body (always present in `AgentChatRequest`) |
| Fail-closed usage breaker (tripped by the bug) | **SHIPPED (unchanged — defense-in-depth)** | `_shared/usage.ts:51` `FAIL_CLOSED_THRESHOLD = 3`; `_shared/usage.ts:76` `insertUsageRow` throws `UsageMeteringUnavailableError` after 3 consecutive failures |
| `agent_events (run_id, seq)` UNIQUE constraint + index | **SHIPPED (no migration needed for #2)** | `supabase/migrations/0046_agent_persistence.sql:95` `agent_events_run_id_seq_key unique (run_id, seq)`; `:86` `agent_events_run_seq_idx on agent_events (run_id, seq)` |
| `agent_events` append-only `BEFORE UPDATE` trigger (feedback-only) | **SHIPPED (gates how #2 must upsert)** | `0046_agent_persistence.sql:12` (trigger `agent_events_feedback_only` pins every column except `rating`/`downvote_reason` on owner's own `type='assistant'` row) |
| `insertEvent` is a plain `.insert()` (duplicate seq → error, swallowed) | **THE GAP (#2)** | `persistence.ts:209` `insertEvent`; `.insert({...}).select().single()` ~`:233`; collisions avoided **only** by seeding from `loadMaxSeq+1` (`persistence.ts:312`, `handler.ts:389–390`) |
| `agent_usage` table (no dedup key; `run_id` FK set-null; append-only by omission — no UPDATE/DELETE policy) | **THE GAP (#3)** | `0047_agent_usage_credits.sql:11–21` (`run_id uuid references agent_runs(id) on delete set null`, **no** `ref_id`/dedup column); `:43` comment "a usage row is a historical fact, never corrected in place" |
| `insertUsageRow` / `recordUsage` (plain `.insert()`, no overwrite-dedup) | **THE GAP (#3)** | `_shared/usage.ts:76` `insertUsageRow`; `.insert({...})` at `:82`; `:129` `recordUsage` (one row per `modelClient.create()` resolution, called at `handler.ts:659`) |
| Reference: idempotent event insert (`ON CONFLICT DO NOTHING`) | **PATTERN TO ADOPT (#2)** | gap-analysis row "Run/event persistence idempotency"; `durable-agent-runs.md` "Event persistence" + "Idempotency / dedup" |
| Reference: usage `refId` overwrite-dedup | **PATTERN TO ADOPT (#3)** | `dist/usage/store.d.ts` `UsageRecord.refId` ("any prior row(s) with the same (label, refId) are deleted before insert … overwrites instead of double-counting") |

**Verdict:** #1 is a **codify + regression-test** over an already-shipped fix (no code change to the gate).
#2 is a **one-line upsert** over an existing constraint (no migration). #3 is a **reversible migration +
overwrite call** (the only schema change). All three are persistence-layer-only; no FE change, no new
route, no model change.

---

## 2. Functional Requirements (EARS)

Conventions: **[LIFE]** run-lifecycle invariant (#1) · **[EVT]** idempotent event insert (#2) ·
**[USAGE]** usage dedup overwrite (#3) · **[SIB]** the shared idempotency principle · **[ADR]** the
record-of-rule requirement.

### 2.1 Run-lifecycle invariant `[LIFE]` — **codify the shipped fix (#1)**

**FR-ARH-001** (ubiquitous — the binding invariant)
The system SHALL key every `agent_runs` row by its **id** and SHALL create it **iff it does not already
exist** under the caller's RLS. The system SHALL **NOT** gate run (or thread) creation on the *shape* of
the request — specifically, the presence or absence of `req.runId` SHALL NEVER be the signal that
distinguishes "new run" from "resume." A first POST carrying a `runId` that does not yet exist SHALL still
create the thread + run and persist the turn's events; a POST carrying a `runId` that already exists SHALL
skip creation and continue the run. (This locks `handler.ts:1062`'s existence gate as the rule of record;
the FE mints and always sends `runId` per `pmoNativeRuntime.ts:70`/`:247`, so request shape is permanently
uninformative.)

**FR-ARH-002** (ubiquitous — fail-safe + idempotent create)
`runExists` SHALL remain fail-open to creation (a read error returns `false`, so `createThreadAndRun` is
*attempted* — strictly safer than a false "exists" that would skip creation and `42501` every event).
`createThreadAndRun` SHALL be idempotent: a re-insert of an existing run PK is a swallowed no-op (logged
count/code only), and SHALL never throw (preserving the inherited swallow discipline,
NFR-ARH-SEC-003 / ADR-0043 §6).

### 2.2 Idempotent event insert `[EVT]` — **(#2)**

**FR-ARH-003** (ubiquitous)
`insertEvent` (`persistence.ts:209`) SHALL persist an `agent_events` row as an **idempotent upsert** on the
natural key `(run_id, seq)` — `onConflict: 'run_id,seq'` with **`ignoreDuplicates: true`** — so that a
resumed or retried producer re-emitting an already-persisted `(run_id, seq)` is a **safe no-op**: it SHALL
NOT throw, SHALL NOT log a failure, and SHALL NOT produce a duplicate row. This mirrors the reference's
`ON CONFLICT (run_id, seq) DO NOTHING`.

**FR-ARH-003a** (ubiquitous — append-only-trigger compatibility)
Because `agent_events` carries a `BEFORE UPDATE` append-only trigger (`0046_agent_persistence.sql:12`,
`agent_events_feedback_only`) that pins every column except `rating`/`downvote_reason`, the upsert in
FR-ARH-003 SHALL use `ignoreDuplicates: true` (→ SQL `ON CONFLICT … DO NOTHING`, which issues **no**
`UPDATE`) and SHALL **NOT** use the conflict-overwrite form (`ignoreDuplicates: false` → `ON CONFLICT … DO
UPDATE`), which the append-only trigger would reject. The dedup is a **no-op skip**, never an in-place
edit — this keeps `agent_events` append-only (FR-AGP-009 / OBS-ARH-003) intact by construction.

### 2.3 Usage dedup overwrite `[USAGE]` — **(#3)**

**FR-ARH-004** (event-driven — overwrite on re-record)
When a dedup key (`ref_id`) is supplied to `insertUsageRow` / `recordUsage`, the system SHALL record the
usage row such that any **prior** row with the same `(action, ref_id)` is **overwritten, not duplicated** —
so re-recording a model call's usage (a retried/resumed producer, a re-POST) updates the single
authoritative row instead of inflating the balance (`sum(credits) − sum(agent_usage.cost)`). When no
`ref_id` is supplied, the system SHALL behave **exactly as today** — a plain append (one new row), so this
change is strictly opt-in per call site and non-breaking.

**FR-ARH-005** (ubiquitous — the migration; reversible + RLS/`org_id`-preserving)
To support FR-ARH-004 the system SHALL add, via a **reversible migration**: (a) a nullable `ref_id` column
on `agent_usage` (nullable so non-participating call sites are unaffected); and (b) a **partial** unique
index `unique (action, ref_id) where ref_id is not null` (partial so the millions of historical/legacy
rows with `ref_id is null` never collide and the index stays small). The migration SHALL preserve RLS
(`owner_id = auth.uid() and org_id = auth_org_id()` `WITH CHECK` unchanged from `0047_agent_usage_credits.sql`)
and the `org_id` seam (column `default` + the stamp trigger of `0074_org_id_stamp_trigger.sql` — never a
client-threaded value), and SHALL ship with an explicit `down` path (drop index, drop column, drop any
narrow policy added) so `supabase db reset` and a manual rollback both restore today's schema. See §10 for
the one real tension (append-only stance) and the owner decision it forces.

### 2.5 Cache-token capture `[CACHE]` — **(#4, owner-added 2026-07-08)**

**FR-ARH-008** (event-driven — observe provider cache hits)
DeepSeek/DeepInfra do **automatic** prompt/prefix caching provider-side (no `cache_control` breakpoints are
piped — that is Anthropic-specific; our stable prompt prefix, system-prompt `messages[0]` + append-only
transcript, `handler.ts:1223`, is the only precondition and it is already met). Today the cache is invisible:
`OpenRouterModelClient` reads only `prompt_tokens/completion_tokens/total_tokens/cost` and discards the rest
(`supabase/functions/_shared/openRouterModelClient.ts:152`). **When the OpenRouter `usage` block includes a
provider-reported cached-prompt count** (`usage.prompt_tokens_details.cached_tokens`, or a provider alias
such as DeepSeek's `prompt_cache_hit_tokens`), the system SHALL parse it and persist it on the
`agent_usage` row (new nullable `cached_tokens` integer) so cache effectiveness — and the cost it saves — is
measurable per run. When the field is **absent** (a provider that does not report it), the system SHALL store
`null`/`0` and behave exactly as today. This is capture-only; it changes no request parameter and never sends
`cache_control`. The display of this metric (cache-hit ratio in the "Runs" panel) is owned by
`agent-run-trace-observability.spec.md` (ATO), not here.

**FR-ARH-005a** (ubiquitous — fold into the FR-ARH-005 migration)
The FR-ARH-005 migration SHALL additionally add a nullable `cached_tokens` integer column on `agent_usage`
(nullable, no back-fill — historical rows stay `null`), under the same reversibility + RLS + `org_id`-seam
guarantees as FR-ARH-005 (a) and its `down` path drops the column. No new index (this column is aggregated,
never a lookup key).

### 2.4 The shared principle + the record of rule `[SIB]` / `[ADR]`

**FR-ARH-006** (ubiquitous — the siblings)
FR-ARH-001 (lifecycle), FR-ARH-003 (event insert), and FR-ARH-004 (usage record) SHALL be understood and
reviewed as **three expressions of one principle**: persistence is **natural-keyed and idempotent-on-
conflict**, and **request shape is never the key.** The lifecycle invariant (#1) is the row-creation case;
the event upsert (#2) is the row-append case; the usage overwrite (#3) is the metering case. A future
change that re-introduces a request-shape gate, a plain `.insert()` on a uniqued natural key, or an
un-keyed metering insert SHALL be treated as a regression of this same invariant, not three unrelated
bugs.

**FR-ARH-007** (ubiquitous — record the rule in ADR-0043)
The implementer SHALL add a short, binding note to **ADR-0043** recording the rule of record: **"the run
row is keyed by its id and created iff-not-exists; request shape (presence/absence of `runId`) is never
the run key; event inserts are idempotent on `(run_id, seq)`; usage records overwrite on
`(action, ref_id)`.** (The spec author does not edit the ADR; the implementer does, as part of this
issue.) The note SHALL reference the 2026-07-08 fix and this spec (ARH) as its provenance.

---

## 3. Non-Functional Requirements

### 3.1 Security (OWASP / STRIDE)

- **NFR-ARH-SEC-001 — Deputy invariant preserved, by construction.** All three changes run under the
  caller's JWT via the already-injected `HandlerSupabaseLike` (`persistence.ts:86` `PersistenceDeps`,
  `_shared/usage.ts:20` `UsageDeps`). No path constructs a `service_role` client; `service_role` remains
  `auth.getUser`-only (ADR-0036 §2). RLS is the **sole** enforcement authority; `org_id`/`owner_id` are
  stamped by column defaults + `WITH CHECK` + the stamp trigger — **never** threaded from the client. The
  new `ref_id` (FR-ARH-005) is a caller-supplied *dedup label*, not an authorization input; a forged
  `ref_id` can at worst overwrite the caller's **own** prior row (still owner-scoped under RLS).
- **NFR-ARH-SEC-002 — Metering integrity (the point of #3).** The balance is computed as
  `sum(credits.amount) − sum(agent_usage.cost)` (`0047_agent_usage_credits.sql:3`, `0077_reserve_credits`).
  A re-record that duplicates a cost row directly forges spend. FR-ARH-004's overwrite SHALL guarantee
  that a re-recorded model call contributes **exactly one** row's cost to the sum — never two — closing
  the double-count repudiation/tampering vector (STRIDE-T/R on metering).
- **NFR-ARH-SEC-003 — Swallow discipline unchanged (no PII/model output in logs).** All three paths keep
  the inherited error discipline (ADR-0043 §6 / ADR-0039): persistence failures log **count/code only**,
  never the event text, the tool args, the model prompt/output, or a JWT — and never block the SSE turn
  (except the unchanged fail-closed usage breaker after 3 consecutive insert failures,
  `_shared/usage.ts:51`). The upsert/overwrite SHALL fail open exactly as today's plain insert does.
- **NFR-ARH-SEC-004 — `agent_events` append-only stance is untouched (#2).** FR-ARH-003a's
  `ignoreDuplicates: true` issues `DO NOTHING` (no `UPDATE`), so the `agent_events_feedback_only` trigger
  is never reached by this change. The transcript remains an immutable audit trail (FR-AGP-009); a resumed
  turn cannot fork or rewrite the record of what happened — it can only no-op-skip a re-emitted seq.

### 3.2 Reliability / reversibility

- **NFR-ARH-REL-001 — Every migration is reversible and seam-preserving.** FR-ARH-005's migration SHALL be
  reversible (`supabase db reset` + an explicit `down`), SHALL add no unnullable column without a default
  (`ref_id` is nullable), SHALL preserve every existing RLS policy and the `org_id` stamp trigger, and
  SHALL NOT alter the `agent_usage` `CHECK` constraints (`agent_usage_nonneg_check`, `0050`; `agent_usage_action_chk`,
  `0068`). No other table is touched. (#1 and #2 need **no** migration.)

### 3.3 Performance

- **NFR-ARH-PERF-001 — No extra round-trip per row; within the edge wall.** The upsert (#2) and the
  overwrite (#3) are each a **single** SQL statement (one `INSERT … ON CONFLICT …`, one index lookup) — no
  read-then-write, no added network hop per event/usage row. The change SHALL keep the agent turn inside
  the ~150s Supabase-edge wall and the `MAX_TOOL_ROUNDS = 8` cap (`handler.ts:59`) with no measurable
  per-turn overhead. The partial unique index (#3) SHALL NOT be built over the full historical table in a
  blocking way at migrate time if that table is large (use `concurrently` where the column is nullable-safe
  or accept the one-time build on a small table — the plan owns the call).

---

## 4. Acceptance Criteria (Given/When/Then)

> Layer per ADR-0010 — **one owning layer per AC.** Unit (Vitest) owns the **call-shape/logic**; pgTAP
> owns the **schema/RLS/seam/append-only contracts**. No e2e layer is introduced (no new route/UI). The
> existing `pmo-portal/e2e/AC-AGP-023-thread-persistence.spec.ts` corroborates the persist path end-to-end
> and is **referenced, not re-owned**.

### Run-lifecycle invariant (#1)

**AC-ARH-001 — A first POST carrying a runId that does NOT exist still creates thread+run. [Unit]**
Given a `POST` whose `req.runId` is set (as every real browser POST is) and `runExists` returns `false`,
When `agentChatHandler` runs,
Then `createThreadAndRun` IS invoked with that `runId` (the gate was run-existence, **not** `!req.runId`) —
asserting FR-ARH-001 and locking the 2026-07-08 regression. (Mocked-supabase call-graph assertion in
`handlerPersistence.test.ts`, mirroring the existing `runExists` import/usage there.)

**AC-ARH-002 — A re-POST whose runId already exists does NOT re-create. [Unit]**
Given a `POST` whose `req.runId` is set and `runExists` returns `true`,
When `agentChatHandler` runs,
Then `createThreadAndRun` is NOT invoked (iff-not-exists is idempotent), and the handler proceeds to
continue the run — asserting FR-ARH-001/002.

### Idempotent event insert (#2)

**AC-ARH-003 — A re-emitted `(run_id, seq)` is a safe no-op at the call site. [Unit]**
Given `insertEvent` is called with a `(runId, seq)` that already exists,
When it executes,
Then it issues an upsert with `onConflict: 'run_id,seq'` and `ignoreDuplicates: true` (assertable on the
mocked supabase query builder), it does NOT throw, and it does NOT log an insert failure — asserting
FR-ARH-003/003a. (Owned by `handlerPersistence.test.ts`.)

**AC-ARH-004 — The `(run_id, seq)` uniqueness + append-only stance hold at the DB. [pgTAP]**
Given the `agent_events` schema (constraint `agent_events_run_id_seq_key` + trigger `agent_events_feedback_only`,
`0046`), and a resumed producer that re-inserts an existing `(run_id, seq)`,
When the insert runs under `set local role authenticated` with the owner's JWT,
Then the duplicate is rejected/ skipped (no second row appears) and the append-only trigger is **not**
violated by the `DO NOTHING` path; RLS (`owner_id`/`org_id`) and the `org_id` stamp remain intact —
asserting NFR-ARH-SEC-004 / NFR-ARH-REL-001. (Sibling to `0091`/`0093` in `supabase/tests/`; **no
migration** is exercised here.)

### Usage dedup overwrite (#3)

**AC-ARH-005 — A re-record with the same `(action, ref_id)` overwrites; absent `ref_id` appends. [Unit]**
Given `recordUsage`/`insertUsageRow` is called twice for the same model call (same `ref_id`, second call
with a corrected/larger token count),
When both calls execute,
Then exactly **one** `agent_usage` row exists for that `(action, ref_id)` with the **second** call's values
(overwrite, not duplicate — asserting FR-ARH-004); and given the same calls with **no** `ref_id`, two rows
exist (today's plain-append behavior, non-breaking). (Owned by `usage.test.ts`, extending its existing
`recordUsage`/`insertUsageRow` coverage.)

**AC-ARH-006 — The `ref_id` migration is reversible, RLS/seam-preserving, and append-only-aware. [pgTAP]**
Given the new migration adds `agent_usage.ref_id` (nullable) + the partial unique index
`(action, ref_id) where ref_id is not null`,
When exercised under `set local role authenticated`,
Then: (a) an owner can insert two rows with distinct `ref_id` and cannot insert a duplicate
`(action, ref_id)`; (b) the `WITH CHECK` still requires `owner_id = auth.uid() and org_id = auth_org_id()`
and the `org_id` default/stamp still fire on a caller-JWT insert (NFR-ARH-SEC-001); (c) the overwrite path
is permitted only via the policy the owner chose in Open-Question 1 (narrow owner UPDATE/DELETE, or
ignore-duplicates); (d) the `down` migration restores the pre-change schema exactly; (e) the `nonneg`/
`action` CHECKs are untouched. (Owned by a new `supabase/tests/0NNN_agent_usage_ref_id.test.sql`, sibling
to `0092`/`0093`/`0124`.)

### The siblings + the record of rule

**AC-ARH-007 — A replayed turn duplicates no events and double-counts no usage. [Unit]**
Given a handler persistence path driven through a simulated re-POST (same `runId`, the prior turn's events
already journaled, and the same model call re-recorded),
When the re-POST persists,
Then: zero duplicate `agent_events` rows are produced (FR-ARH-003) **and** zero double-counted
`agent_usage` cost is produced (FR-ARH-004) — the three siblings compose into one idempotent turn
(FR-ARH-006). (Umbrella assertion in `handlerPersistence.test.ts`, asserted at the logic layer; the
DB-level guarantee is owned by AC-ARH-004/006.)

### Cache-token capture (#4)

**AC-ARH-009 — A provider-reported cached-token count is persisted; its absence is a no-op. [Unit]**
Given a stubbed OpenRouter response whose `usage` block carries `prompt_tokens_details.cached_tokens: 512`,
When the model call is recorded,
Then the `agent_usage` row for that call has `cached_tokens = 512` (FR-ARH-008); and given a response whose
`usage` block omits any cached-token field, the recorded row has `cached_tokens` null/0 and every other field
is unchanged from today (no regression). (Owned in `openRouterModelClient.test.ts` for the parse +
`usage.test.ts` for the persisted column.)

**AC-ARH-008 — ADR-0043 records the binding rule. [docs — grep]**
Given the issue is complete,
When the implementer's ADR-0043 edit is reviewed,
Then ADR-0043 contains the binding statement that **"request shape is never the run key; the run row is
keyed by its id and created iff-not-exists"** (and the event/usage idempotency siblings), referencing the
2026-07-08 fix and this spec (FR-ARH-007). Owning verification: a docs `grep` (no test layer; this is a
documentation requirement, evidenced as `manual-notes`).

---

## 5. Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-ARH-001 | Unit | `AC-ARH-001 first POST with runId still creates run` (`pmo-portal/src/lib/agent/handlerPersistence.test.ts`) |
| AC-ARH-002 | Unit | `AC-ARH-002 re-POST with existing runId does not re-create` (same file) |
| AC-ARH-003 | Unit | `AC-ARH-003 insertEvent idempotent upsert ignoreDuplicates on run_id,seq` (same file) |
| AC-ARH-004 | pgTAP | `AC-ARH-004 agent_events run_id,seq uniqueness + append-only preserved` (`supabase/tests/0NNN_agent_events_idempotent.test.sql`, sibling to `0091`/`0093`) |
| AC-ARH-005 | Unit | `AC-ARH-005 usage ref_id overwrite, no-ref_id appends` (`pmo-portal/src/lib/agent/usage.test.ts`) |
| AC-ARH-006 | pgTAP | `AC-ARH-006 agent_usage ref_id migration reversible RLS seam` (`supabase/tests/0NNN_agent_usage_ref_id.test.sql`, sibling to `0092`/`0124`) |
| AC-ARH-007 | Unit | `AC-ARH-007 replayed turn no duplicate events no double-counted usage` (`pmo-portal/src/lib/agent/handlerPersistence.test.ts`) |
| AC-ARH-008 | docs (grep) | `AC-ARH-008 ADR-0043 records the binding rule` (`docs/adr/0043-agent-thread-event-persistence-and-run-lifecycle.md` — grep for the rule string) |
| AC-ARH-009 | Unit | `AC-ARH-009 cached_tokens captured when present, no-op when absent` (`pmo-portal/src/lib/agent/openRouterModelClient.test.ts` + `usage.test.ts`) |

**Cross-reference (not owning):** the end-to-end "a real browser run persists its row + events" journey is
already owned by `pmo-portal/e2e/AC-AGP-023-thread-persistence.spec.ts` (ADR-0043); AC-ARH-001's regression
makes that journey's precondition (the run row exists) structurally guaranteed, but the e2e is not
re-owned here.

---

## 6. SoD & Security (OWASP / STRIDE)

**Tampering / repudiation of metering (STRIDE-T/R, OWASP A01 — the point of #3).** `agent_usage.cost`
feeds the spend balance directly (`sum(credits) − sum(agent_usage.cost)`). A retried/resumed producer that
appends a **second** cost row for one model call silently inflates spend — a tampering/repudiation vector.
FR-ARH-004's overwrite (proven AC-ARH-005/006) closes it: one model call ⇒ exactly one cost row. This is
the security uplift of #3, not just a correctness nicety.

**Elevation / deputy invariant (STRIDE-E, ADR-0036 §2, OWASP A01).** No path here constructs
`service_role` or threads `org_id`/`owner_id` from the client (NFR-ARH-SEC-001). The new `ref_id` is a
dedup label, not an auth input; RLS `WITH CHECK` stays the authority. A forged `ref_id` can overwrite only
the caller's own row under owner-scoped RLS.

**Tampering of the audit trail (STRIDE-T on `agent_events`).** #2's `ignoreDuplicates: true` is a **no-op
skip**, never an edit (NFR-ARH-SEC-004 / FR-ARH-003a) — the append-only trigger is never reached, so the
transcript remains a faithful, immutable record of what the agent did. A resumed turn cannot rewrite
history; it can only decline to duplicate it.

**Spoofing / tenancy (STRIDE-S, OWASP A01).** Unchanged — the agent runs as the caller JWT with RLS as the
ceiling; FR-ARH-005's migration preserves every RLS policy and the `org_id` stamp (AC-ARH-006).

**Depth note (model-tiering for the security review).** This change is **persistence-layer correctness +
one narrow migration**, RLS-as-ceiling preserved. The security-auditor should focus depth on (a) the
`agent_usage` overwrite path (#3) — confirm the narrow owner-scoped UPDATE/DELETE policy (or
ignore-duplicates choice, Open-Question 1) cannot widen to another owner/org or relax the `nonneg`/`action`
CHECKs, and that the partial unique index cannot be defeated by a null `ref_id`; and (b) confirm #2's
`ignoreDuplicates: true` is truly `DO NOTHING` (no `UPDATE` reaching the append-only trigger). A lighter
pass than a full new-surface issue, but #3's policy change is genuine and must not be waved through.

---

## 7. Error Handling

| Error condition | Surface / behavior | User outcome |
|---|---|---|
| `runExists` read errors (RLS/transient) | Returns `false` (fail-open to create) — FR-ARH-002 | `createThreadAndRun` is attempted; at worst a duplicate-PK insert is swallowed. Never blocks the turn |
| `createThreadAndRun` re-inserts an existing run PK | Swallowed no-op (count/code log only) | Resume continues; no error surfaced |
| `insertEvent` hits a duplicate `(run_id, seq)` | `ON CONFLICT … DO NOTHING` no-op (FR-ARH-003) — no throw, no failure log | The re-emitted event is silently skipped; the transcript keeps the original. No duplicate, no error |
| `insertEvent` upsert itself fails (RLS/transient) | Swallowed (count/code log only) — unchanged discipline | Persistence failure never blocks the SSE stream (NFR-ARH-SEC-003) |
| `insertUsageRow` overwrite fails transiently | Swallowed; fail-closed breaker still trips after 3 consecutive failures (`_shared/usage.ts:51`) | Identical to today's plain-insert failure handling — the breaker stays as defense-in-depth even though #3 removes its main trigger (the bug) |
| `ref_id` collision across two *different* model calls (a mis-keyed `ref_id`) | The second overwrites the first (by design) | Cost of the first call is lost from the sum; mitigated by a collision-free key shape (Open-Question 2: `run_id:round`) |

---

## 8. Non-goals (explicitly out of scope)

- **Live reconnect / cursor replay** (`GET /runs/active` + `GET /runs/:id/events?after=N`) — gap-analysis
  "Live reconnect / leave-and-return" row; a medium build needing new endpoints. Separate issue.
- **Run-trace read-model / admin "Runs" panel** (`TraceSummary` from `agent_events`+`agent_usage`) —
  gap-analysis top-3 #3; the observability floor that would have caught this bug. Separate issue.
- **`reliable-mutations` proof-of-done terminals** ("N of N committed") for batch actions — gap-analysis
  top-3 #4. Separate issue.
- **Token streaming (`text-delta`), an agent eval harness, a model bump** — all deliberately out (the
  deepseek pin is binding; the model choice is not in play here).
- **git-commit checkpoints, Netlify `-background` durable execution, cross-model quota-governor,
  multi-provider fallback** — stack mismatches we explicitly skip (gap-analysis §3 "Explicitly skip").
- **Changing the `agent_usage` grain** from per-`modelClient.create()` (one row per model call) to
  per-run. Out — #3 keeps the per-call grain and adds overwrite-dedup *within* it; aggregating to
  per-run would lose per-call cost visibility and is a different decision.
- **Cache-hit RATIO display / a "Runs" cost panel** — the `cached_tokens` *capture* is in scope here
  (§2.5, FR-ARH-008, owner-added 2026-07-08); *surfacing* the ratio is owned by
  `agent-run-trace-observability.spec.md` (ATO).

---

## 9. Open Questions for the owner

1. **Usage overwrite semantics vs the append-only stance (the one real tension — see §10).**
   `agent_usage` is append-only *by omission* today (no UPDATE/DELETE policy; `0047:43` "a usage row is a
   historical fact, never corrected in place; NFR-AUC-SEC-001"). FR-ARH-004 requires **overwrite**, which
   needs one of: (a) a **narrow owner-scoped UPDATE policy** on `agent_usage` (lets the upsert
   `ON CONFLICT … DO UPDATE` land — matches the reference's `refId` overwrite pattern, but relaxes strict
   append-only); or (b) **ignore-duplicates** (`ON CONFLICT … DO NOTHING` — preserves append-only fully,
   but a *corrected* re-record is silently dropped rather than updated; still fixes double-counting, since
   the duplicate is skipped). **Recommendation:** (a) overwrite, matching the reference and the brief's
   "overwrites rather than duplicates" — the narrow UPDATE policy is owner-scoped and the
   `nonneg`/`action` CHECKs stay, so the integrity posture is preserved; the relaxation is "an owner may
   correct their own in-flight metering row," which is exactly what idempotent re-record needs. Confirm (a)
   vs (b). This decides AC-ARH-006(c).

2. **`ref_id` key shape.** The dedup key must be collision-free across a run's model calls. Proposed:
   `${run_id}:${round}` (the run id + the tool-round index), which is unique within the `MAX_TOOL_ROUNDS=8`
   cap (`handler.ts:59`) and costs nothing to compute (both values are in hand at the `recordUsage` call
   site, `handler.ts:659`). Alternative: a provider-reported call id — but deepseek/OpenRouter may not
   surface a stable one. **Recommendation:** `run_id:round`, caller-computed. Confirm.

3. **ADR-0043 note — same PR or docs follow-up?** FR-ARH-007 requires the implementer to record the rule
   in ADR-0043. **Recommendation:** same PR (it is the binding record and is one paragraph). Confirm.

4. **#1 and #2 — confirm they ship together with #3 in the one PR.** #1 is a pure regression-test add
   (no gate change); #2 is a one-line upsert (no migration); #3 is the migration. They are cohesive (one
   principle, FR-ARH-006) and small. The owner may prefer to split #3 (migration-bearing) into its own PR
   if the review wants the schema change isolated. **Recommendation:** ship together; split only if the
   owner prefers a migration-isolated review.

---

## 10. Contradictions / conflicts flagged against existing code & locked decisions

1. **`agent_usage` append-only stance vs FR-ARH-004 overwrite (REAL, flagged — owner decides in
   Open-Question 1).** `0047_agent_usage_credits.sql:43` states "a usage row is a historical fact, never
   corrected in place" (NFR-AUC-SEC-001), and the table enforces this *by omission* (no UPDATE/DELETE
   policy). FR-ARH-004's overwrite **relaxes** that stance narrowly (an owner correcting their own
   in-flight metering row on a re-record). This is **not** a contradiction with ADR-0036 (deputy
   invariant) or the org_id seam — both are preserved (AC-ARH-006) — but it **is** a deliberate, scoped
   relaxation of the append-only *posture*, which the owner must bless (Open-Question 1). The
   zero-tension fallback is ignore-duplicates (option b), which preserves append-only absolutely at the
   cost of dropping a corrected re-record. **The spec does not pick; it requires the choice be explicit.**

2. **No contradiction with ADR-0043 / ADR-0036 / ADR-0010.** All three changes operate strictly *inside*
   the persistence boundary ADR-0043 drew (caller-JWT DAL, swallow-on-error, run-keyed events, seq
   continuity) and the deputy invariant ADR-0036 drew (RLS ceiling, no `service_role`, no client-threaded
   `org_id`). #2 is explicitly **trigger-compatible** (FR-ARH-003a — `DO NOTHING` never reaches the
   append-only trigger), so it does not conflict with `agent_events`'s append-only design either. Facts
   worth flagging for the eng-plan (none is a contradiction):
   - The `agent_events` unique constraint and append-only trigger **already exist** (`0046`); #2 is an
     app-layer one-liner, not a schema change.
   - The FE's always-send-`runId` behavior (`pmoNativeRuntime.ts:70`/`:247`) is the **reason** request
     shape was always uninformative; this spec adapts the server to that reality (and codifies it), it
     does not change the FE.
   - The fail-closed usage breaker (`_shared/usage.ts:51`) is **kept**, not removed — #1 removes its main
     trigger (the bug), but it remains defense-in-depth against any future metering-insert failure.
