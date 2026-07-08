# SDD: Agent Run-Trace Observability — a per-run read-model + admin "Runs" panel

**Feature:** PMO's agent monitoring is **usage + errors + thumbs only** — `agent_usage` (cost/tokens),
`error_events`, and the `FeedbackControl` rating. There is **no "what happened inside run X" view**:
no per-run trace summary, no tool-call span view, no admin list of runs. That blind spot is *the*
reason the money-path `!runId` persistence bug (`persistence.ts` `runExists` docstring, fixed
2026-07-08) stayed invisible — monitoring could show "cost accruing / errors firing" but never "this
run persisted zero events" or "this run is wedged in `running`." This spec closes gap-analysis **do-now
#3 / "Observability & tracing"** by deriving a **`TraceSummary` read-model** from rows we *already
write* (`agent_runs` + `agent_events` + `agent_usage`) and surfacing it in an in-app **Administration ›
Runs** panel — modeled on agent-native's `TraceSummary` (`dist/observability/types.d.ts`) — with the
two **visibly-flagged** signals (zero-events run; heartbeat-stale run) that would have caught the bug
on day one.

**Spec ID prefix:** ATO (`FR-ATO-###` functional · `NFR-ATO-###` non-functional · `AC-ATO-###` acceptance)
**ADR refs:** ADR-0043 (agent run/event persistence — the tables this reads), ADR-0036 (§2 deputy invariant
— the read-model runs under the caller's JWT and RLS is the SOLE authority; `service_role` is never used),
ADR-0010 (test pyramid — RPC/RLS/tenancy proofed at **pgTAP**; panel states at **Unit/RTL**; the
drill-in journey at one curated **e2e**), ADR-0016/0017 (real-JWT persona + repository seam), ADR-0001
(org_id tenancy seam), ADR-0006 (reversible migrations), ADR-0049 (Operator persona / `is_operator()`),
AC-USE-007 (provider-cost-is-Operator-only — mirrored here for the trace's `cost` column).
**Layer ownership (ADR-0010):** the RPC's RLS/tenancy/persona predicates → **pgTAP** (`supabase test db`);
the panel's states/columns/flag rendering → **Unit/RTL** (Vitest); one cross-stack drill-in journey → a
single curated **e2e** (Playwright). No unit test owns an AC that is really an RLS contract, and no e2e
re-proves what pgTAP already pins — one owning layer each.
**Status:** Draft — 2026-07-08
**Author:** Director (Claude Opus 4.8)

---

## 1. Context & problem

agent-native's gap-analysis row "Observability & tracing" (`docs/spikes/2026-07-08-agent-native-gap-analysis.md`,
summary point 2) is the highest-signal observability gap. The framework ships a `TraceSummary`
(`dist/observability/types.d.ts`: `llmCalls`, `toolCalls`, `successfulTools`, `failedTools`, `cost`,
`durationMs`, `status`, `model`) that is **trivially derivable from rows PMO already writes** — yet PMO
has no such read-model and no surface for it. The consequence is concrete and recent: the `!runId` bug
(`persistence.ts` `runExists` docstring, `supabase/functions/agent-chat/persistence.ts`) — gating run-row
creation on `!req.runId` while the FE (`pmoNativeRuntime.ts`) mints and sends `runId` on every POST — meant
real browser runs never persisted and every downstream `agent_events`/`agent_usage` insert failed
`WITH CHECK` with `42501`. Monitoring saw the symptom (usage breaker tripping, `error_events` firing) but
**never the cause** ("run X persisted zero events"), because no view existed to ask that question.

The fix is a **read-model + panel**, not new write-path plumbing: we persist everything needed already.
Two design forces shape it:

1. **The three tables are owner-only by RLS.** `0046_agent_persistence.sql` deliberately grants **"NO
   Admin cross-owner read grant on any of the three tables (FR-AGP-008) — an agent conversation is more
   sensitive than a saved view."** So an org-Admin cannot read another member's runs through plain
   PostgREST. The trace read-model therefore ships as **security-definer RPCs** that re-scope by persona
   — exactly the pattern `org_usage_summary()` / `operator_usage_summary()` already use
   (`supabase/migrations/0069_usage_summary_rpcs.sql`): org-admin sees their org's runs, operator sees
   cross-org, `is_active_member()` re-asserted, RLS the enforcement authority. This is a **deliberate,
   scoped widening** of the owner-only RLS *for structural aggregates only* (counts/status/tool-names/cost/
   duration) — never for conversation content (see force 2 and §3/NFR-ATO-SEC-002).

2. **Conversation content is the sensitive surface.** The summary MUST expose *structure* (event counts,
   tool names, status, cost) — enough to catch "zero events" / "stuck" — WITHOUT leaking `agent_events.text`
   / `agent_events.payload` (the actual user↔assistant conversation). The drill-in trace exposes the
   ordered event log, but its content fields are gated to the Operator persona only; org-admin sees the
   structural skeleton (`seq`, `type`, `tool_name`, `tool_status`, timestamps). This preserves 0046's
   "more sensitive than a saved view" stance while still giving the observability signal.

### 1.1 Current-state audit (built vs missing — with file evidence)

Every "already built / already written" claim below was verified by reading the code, not trusted from the brief.

| Capability | State | Evidence |
|---|---|---|
| `agent_runs` row (status, progress, heartbeat, timestamps) | **WRITTEN** | `0046_agent_persistence.sql:42-58` — `status` ∈ queued\|running\|paused\|needs-approval\|completed\|errored; `last_progress_at`, `progress_step`, `created_at`, `updated_at`; `persistence.ts` `createThreadAndRun`/`heartbeat`/`setRunStatus` |
| `agent_events` ordered journal (seq, type, tool_status) | **WRITTEN** | `0046_agent_persistence.sql:60-76` — `seq bigint`, `type` ∈ user\|assistant\|tool\|artifact\|status\|system, `tool_status` ∈ completed\|errored; `UNIQUE(run_id, seq)` = `agent_events_run_id_seq_key`; index `agent_events_run_seq_idx on (run_id, seq)` |
| `agent_usage` per-call cost/tokens/model (run-linked) | **WRITTEN** | `database.types.ts:382-443` — `run_id` (FK, nullable, ON DELETE SET NULL), `cost`, `prompt_tokens`, `completion_tokens`, `model`, `action`; `0068_agent_usage_usage_columns.sql` adds `provider_cost_usd` + `action`; `index agent_usage_org_created_idx on (org_id, created_at)` |
| Owner-only RLS on all three tables (no Admin cross-owner read) | **ENFORCED** | `0046_agent_persistence.sql` policies `agent_runs_select` / `agent_events_select` = `using (owner_id = auth.uid() and org_id = auth_org_id())`; migration header: "NO Admin cross-owner read grant on any of the three tables (FR-AGP-008)" |
| Persona helpers for an RPC to re-scope by org/role | **BUILT** | `auth_org_id()` (`0002_rls.sql:9`), `is_active_member()` (`0062_ops_admin_profile_status.sql:20`), `is_operator()` (`0064_platform_operators.sql:39`, plain INVOKER leans on its self-SELECT RLS policy) |
| **The mirror pattern** — security-definer aggregate RPCs (org-admin own-org; operator cross-org; provider-cost-Operator-only) | **BUILT** | `0069_usage_summary_rpcs.sql` — `org_usage_summary()` / `operator_usage_summary(p_org_id)` / `operator_list_orgs()`: `language sql stable security definer set search_path = public`, `revoke … from public; grant execute to authenticated`, AC-USE-007 drops `provider_cost_usd` from the org-admin shape |
| FE consumption of those RPCs (repository → hook → panel) | **BUILT** | `pmo-portal/src/lib/db/usage.ts` (`getOrgUsageSummary`/`getOperatorUsageSummary`/`listOperatorOrgs` via `supabase.rpc(...)`), `pmo-portal/src/hooks/useUsage.ts`, `pmo-portal/pages/AdministrationUsage.tsx` (DataTable + ListState loading/empty/error + conditional columns) |
| Administration section-mount pattern | **BUILT** | `pmo-portal/pages/AdminUsers.tsx` composes `<SectionHeader title="Usage"/>` + `<AdministrationUsage …/>`, `<AdministrationCredits isOperator orgId/>`, `<AdministrationFeatures …/>` blocks |
| Operator persona FE projection | **BUILT** | `pmo-portal/src/auth/useIsOperator.ts` — clarity projection only, "every Operator power is re-asserted server-side by its own RPC" |
| Stuck-run staleness threshold (heartbeat) | **BUILT (FE constant)** | `pmo-portal/src/components/panel/stuckRun.constants.ts` — `STUCK_RUN_STALE_MS = 45_000` ("sits in the spec's suggested 30–60s band"); consumed by `StuckRunBanner.tsx` + `useAssistantPanel.ts` (`now - lastProgressAt > STUCK_RUN_STALE_MS`) |
| PostHog already carries duration + tool-round-count per run | **BUILT** | `pmo-portal/src/lib/analytics/events.ts` — `buildAgentRunCompletedEvent(runId, durationMs, toolRoundCount)` → properties `{ run_id, duration_ms, tool_round_count }`; `buildAgentRunErroredEvent` adds `error_code` |
| **`TraceSummary` read-model (llmCalls/toolCalls/successful/failed/cost/duration/status/model per run)** | **MISSING** | no RPC, no view, no panel; `grep` of `supabase/migrations/` finds no `run_trace`/`trace_summary` function; the framework's `TraceSummary` (`dist/observability/types.d.ts`) is the shape we adopt |
| **Admin "Runs" panel (list runs + drill-in event trace)** | **MISSING** | no `AdministrationRuns.tsx` / `AdministrationRunTrace.tsx`; `pmo-portal/pages/` has `AdministrationUsage`/`AdministrationCredits`/`AdministrationFeatures` only |
| **"Zero-events run" / "stuck run" visible flag** | **MISSING** | no derived `has_zero_events` / `is_stuck` column anywhere; the `!runId` bug's zero-event runs were therefore invisible |

**Verdict per scope group:** Group 1 (read-model RPC) = **NEW SQL RPCs over existing tables** (reversible,
RLS-preserving, no schema change to the three tables, no new write path). Group 2 (admin panel) = **NEW FE
component + repository + hook** mirroring the Usage slice exactly. Group 3 (the bug-catching flags) =
**derived columns** (`has_zero_events`, `is_stuck`) computed server-side in the RPC — the exact signal that
was absent. Group 4 (drill-in trace) = **NEW second RPC** returning a run's events ordered by `seq`, content-gated by persona.

---

## 2. Functional Requirements (EARS)

Conventions: **[MODEL]** the `TraceSummary` read-model / RPCs · **[FLAG]** the two bug-catching flags ·
**[PANEL]** the Administration › Runs panel · **[TRACE]** the per-run event-trace drill-in.

### 2.1 The `TraceSummary` read-model `[MODEL]` — NEW RPCs over existing tables

**FR-ATO-001** (ubiquitous)
The system SHALL expose a per-run **`TraceSummary` read-model** derived by **aggregating rows already
written** to `agent_runs`, `agent_events`, and `agent_usage` — with **no new event type, no new write
path, and no schema change** to those three tables. The shape SHALL mirror agent-native's `TraceSummary`
(`dist/observability/types.d.ts`): per run — `llmCalls`, `toolCalls`, `successfulTools`, `failedTools`,
`cost`, `durationMs`, `status`, `model` — plus PMO-specific `toolRoundCount`, `eventCount`, and the §2.2
flags.

**FR-ATO-002** (ubiquitous — delivery fits OUR stack)
The read-model SHALL be delivered as **Postgres RPC(s) consumed over PostgREST** — NOT a Node service,
NOT an edge function, NOT agent-native's Nitro/Netlify machinery. It SHALL mirror the existing
`org_usage_summary()` / `operator_usage_summary()` RPCs (`0069_usage_summary_rpcs.sql`):
`language sql stable security definer set search_path = public`, `revoke … from public; grant execute on
… to authenticated`. The deputy invariant is preserved by construction — the RPC runs under the caller's
JWT and re-derives persona/tenant server-side; **`service_role` is never used** (ADR-0036 §2).

**FR-ATO-003** (state-driven — persona scoping mirrors the usage RPCs)
**Where** the caller is an **org-Admin who is an active member** of their org, the summary RPC SHALL
return the `TraceSummary` rows for **all runs in the caller's own org** (every member, not just self) —
scoped by `org_id = public.auth_org_id() and public.is_active_member()`. **Where** the caller is an
**Operator** (`public.is_operator()`) who is an active member, the summary RPC SHALL return runs
**cross-org** (optionally filtered to one org by a `p_org_id` argument, mirroring
`operator_usage_summary(p_org_id)`). A caller who is neither SHALL receive zero rows. **RLS remains the
enforcement authority**: the definer re-scopes by these helpers; the client **never sends `org_id`** and
the RPC **never trusts a client-supplied org** (OBS-ATO-002).

**FR-ATO-004** (ubiquitous — derivation mapping)
The summary SHALL derive each column from the three tables as follows, all per `run_id`:
- `llmCalls` = `count(agent_usage rows where run_id = r.id)`
- `toolCalls` = `count(agent_events rows where run_id = r.id and type = 'tool')`
- `successfulTools` = `count(… and tool_status = 'completed')`; `failedTools` = `count(… and tool_status = 'errored')`
- `cost` = `coalesce(sum(agent_usage.cost), 0)`; `prompt_tokens` / `completion_tokens` = `coalesce(sum(…), 0)`
- `cachedTokens` = `coalesce(sum(agent_usage.cached_tokens), 0)` and `cacheHitRatio` = `cachedTokens /
  nullif(prompt_tokens, 0)` — the provider-reported prompt-cache effectiveness (FR-ATO-019). **Depends on the
  `agent_usage.cached_tokens` column added by `agent-run-persistence-hardening.spec.md` FR-ARH-008/005a**; when
  that column is absent/null the ratio is `0`/`null` and the panel shows "—" (no regression, no hard dependency
  for the rest of the read-model)
- `model` = the run's `agent_usage.model` (runs are single-model; `deepseek/deepseek-v4-flash` — pinned,
  surfaced read-only, never changed — OBS-ATO-007)
- `status` = `agent_runs.status`
- `durationMs` = `extract(epoch from (coalesce(last_progress_at, updated_at) - created_at)) * 1000`
  (best-effort — OBS-ATO-005; PostHog's FE `duration_ms` is authoritative)
- `toolRoundCount` = `count(agent_events where type = 'tool')` (row-derived proxy — OBS-ATO-006; PostHog's
  FE `tool_round_count` is authoritative)
- `eventCount` = `count(agent_events where run_id = r.id)`
- plus identifying columns: `run_id`, `thread_id`, `owner_id`, `org_id`, `title`, `created_at`,
  `updated_at`, `last_progress_at`
The aggregation SHALL use a `LEFT JOIN` from `agent_runs` to `agent_usage` / `agent_events` so a run with
**zero** usage rows and/or **zero** events still appears (with `cost=0`, `llmCalls=0`, `eventCount=0`) —
this is what makes the §2.2 flags visible rather than the run vanishing from the panel.

**FR-ATO-005** (ubiquitous — provider-cost privacy mirror, AC-USE-007)
The **org-Admin** summary shape SHALL **NOT** include `provider_cost_usd` (it is PMO's raw provider spend
— Operator-only, exactly as `0069` dropped it from `org_usage_summary()` per AC-USE-007). The **Operator**
summary shape SHALL include `provider_cost_usd = coalesce(sum(agent_usage.provider_cost_usd), 0)`. `cost`
(credits) is present in both shapes.

**FR-ATO-006** (ubiquitous — conversation-content privacy)
The summary RPC SHALL return **structural aggregations only** — it SHALL **NOT** return `agent_events.text`
or `agent_events.payload` (the conversation content). Exposed event-derived fields are limited to counts,
`tool_name` (the *name* of tools called, not their args or results), and the §2.2 flags. This preserves
`0046`'s "an agent conversation is more sensitive than a saved view" stance: an org-Admin sees *that* a
member's run called `query_entity` 3 times and persisted zero assistant events, but never *what* was said.

**FR-ATO-007** (ubiquitous — reversible, RLS-preserving, org_id-seam-compatible migration)
The read-model SHALL ship as a **single reversible migration** that `CREATE OR REPLACE`s the RPC
functions and `REVOKE … / GRANT EXECUTE TO authenticated` on each — mirroring `0069`'s shape. It SHALL
**not** alter any of the three source tables, **not** add/drop a column or policy on them, and **not**
introduce a new table. Reverse (`supabase db reset`, or manual `drop function …` in reverse order) SHALL
restore the prior state exactly. The `org_id` tenancy seam is untouched (the definer reads `org_id` via
`auth_org_id()`; no client-supplied tenant value).

### 2.2 The two bug-catching flags `[FLAG]` — the exact signal that was absent

**FR-ATO-008** (state-driven — zero-events flag)
**While** a run exists in `agent_runs` but has **zero** persisted `agent_events` rows
(`eventCount = 0`), the read-model SHALL flag it with `has_zero_events = true`. This is the structural
invariant the `!runId` bug violated — a real run always persists ≥1 event (a `user` echo at minimum,
`persistence.ts insertEvent`) — and making it a visible flag is precisely the signal that would have
surfaced "runs never persisted / trace empty" on day one (gap-analysis summary point 2).

**FR-ATO-009** (state-driven — stuck-run flag, server-side clock)
**While** a run is in a **non-terminal status** (`queued`, `running`, `paused`, `needs-approval`) **and**
`extract(epoch from (now() - coalesce(last_progress_at, created_at))) * 1000 > STUCK_RUN_STALE_MS`
(`STUCK_RUN_STALE_MS = 45_000`, `pmo-portal/src/components/panel/stuckRun.constants.ts` — the same
threshold the live `StuckRunBanner` uses), the read-model SHALL flag it with `is_stuck = true`. The
comparison SHALL use the **database clock** (`now()`), not a client-supplied or browser time, so the flag
is deterministic and not spoofable.

**FR-ATO-010** (ubiquitous — both flags are derived columns, computed in the RPC)
`has_zero_events` and `is_stuck` SHALL be computed **inside the summary RPC** (returned as boolean columns
on every summary row), so the panel renders them without client-side clock math or recounting and the flag
semantics live in exactly one audited place (the definer SQL). A run MAY carry both flags (e.g. a
`running` run with zero events past the stale threshold) — both SHALL render.

### 2.3 The Administration › Runs panel `[PANEL]` — NEW FE, mirrors the Usage slice

**FR-ATO-011** (ubiquitous — placement + persona)
The system SHALL add an **Administration › Runs** panel, composed onto the Administration page
(`pmo-portal/pages/AdminUsers.tsx`) as a sibling `<SectionHeader title="Runs"/>` + panel block **next to**
the existing `AdministrationUsage` / `AdministrationCredits` / `AdministrationFeatures` blocks. It SHALL
be reachable by the same personas that reach those sections — **org-Admin** (`can('view','user')` clarity
projection) and **Operator** (`useIsOperator()`) — and SHALL call the org-Admin or Operator summary RPC
based on that projection, mirroring how `AdministrationUsage` selects `org_usage_summary` vs
`operator_usage_summary` (`pmo-portal/src/lib/db/usage.ts`). A non-Admin, non-Operator reaching the route
sees the existing Admin-only gate (no new auth surface — RLS/`grant execute` is the authority).

**FR-ATO-012** (ubiquitous — the list)
The panel SHALL list runs (most-recent first) as a `DataTable` with the `TraceSummary` columns: title,
owner, status (as a `StatusPill`), `eventCount`, `llmCalls`, `toolCalls` (with successful/failed
breakdown), `toolRoundCount`, `cost` (credits; `provider_cost_usd` column renders **only** for the
Operator shape — the same conditional-column pattern `AdministrationUsage.tsx` uses for margin/provider
cost), `durationMs` (humanized), a **`cacheHitRatio`** column (FR-ATO-019; "—" when unavailable),
created/last-progress timestamps, and the two flags (FR-ATO-013). It
SHALL support a time-window / recent-rows cap (the design-plan owns the exact bound, e.g. last 200 runs)
so the RPC stays bounded (NFR-ATO-PERF-001).

**FR-ATO-013** (event-driven — flag rendering)
**When** a run's `has_zero_events` is true, the panel SHALL render an unambiguous **"No events
persisted"** flag on that row (a warning `StatusPill` / icon + accessible name). **When** `is_stuck` is
true, it SHALL render a **"Stuck — no heartbeat"** flag. These flags SHALL be the most visually salient
per-row signal (the whole point of the panel); a flagged run SHALL NOT visually blend into healthy runs.

**FR-ATO-019** (ubiquitous — cache-hit visibility, owner-added 2026-07-08)
The read-model SHALL surface `cachedTokens` + `cacheHitRatio` (FR-ATO-004) and the panel SHALL render the
ratio as a percentage column so an operator can SEE that DeepSeek/DeepInfra prompt-caching is working and
how much prompt cost it is saving (the audit found caching is automatic provider-side but was previously
*unmeasured*). The column SHALL render **"—"** when `cached_tokens` is null across a run's usage rows
(provider did not report it, or the run predates FR-ARH-008) — never `0%`, to distinguish "no data" from a
genuine 0% hit rate. This column is derived from the same aggregate as `cost`; it adds no new source table
and no `cache_control` is ever piped (caching is provider-automatic).

**FR-ATO-014** (ubiquitous — all states, strictly DESIGN.md tokens)
The panel SHALL render the **loading** (`ListState variant="loading"`), **empty** (`variant="empty"` —
"No runs yet"), and **error** (`variant="error"` + retry) states exactly as `AdministrationUsage.tsx`
does, sourced from the hook's `isPending` / `isError` / data. All styling SHALL use `DESIGN.md` tokens
only (status-pill variants, spacing, type scale) — no one-off colors for the flags (use the existing
warning/danger pill variants).

**FR-ATO-015** (ubiquitous — in-app counterpart to PostHog, not a replacement)
The panel SHALL be documented and treated as the **in-app counterpart** to the existing PostHog telemetry
(`trackAgentRunCompleted` / `trackAgentRunErrored` already carry `duration_ms` + `tool_round_count`,
`pmo-portal/src/lib/analytics/events.ts`) — it does not replace it. Where the read-model's `durationMs` /
`toolRoundCount` are best-effort row derivations (OBS-ATO-005/006), the PostHog FE-computed values remain
authoritative; the panel's value is the **per-run structural + flagged** view PostHog cannot give.

### 2.4 The per-run event-trace drill-in `[TRACE]` — NEW second RPC, content-gated

**FR-ATO-016** (ubiquitous — drill-in over the ordered journal)
The system SHALL expose a **`run_trace_events(p_run_id)`** RPC returning one row per `agent_events` row
for that run, **ordered by `seq` ascending** (the transcript order — `0046` header: "seq is the total
transcript order per run; NEVER created_at"), with the structural fields: `seq`, `type`, `tool_name`,
`tool_status`, `created_at`, and booleans `has_text` / `has_payload` (whether content exists). The panel's
drill-in SHALL render this as the run's trace skeleton (the same shape the run's owner sees live in the
`AssistantPanel` transcript, minus the content).

**FR-ATO-017** (state-driven — content gating by persona)
**Where** the caller is an **Operator**, the trace-events RPC MAY accept an `p_include_content boolean
default false` and, when true, additionally return `text` / `payload`. **Where** the caller is an
org-Admin (not an Operator), the RPC SHALL **never** return `text` / `payload` regardless of the flag —
content is Operator-only (the most-privileged persona), honoring `0046`'s sensitivity stance. A non-owner,
non-Operator, non-org-Admin caller SHALL receive zero rows.

**FR-ATO-018** (ubiquitous — drill-in scoping)
The trace-events RPC SHALL scope the run to the caller's authority exactly as the summary does: org-Admin
sees the trace only for a run whose `org_id = auth_org_id()`; Operator sees any org's run; both require
`is_active_member()`. A run the caller cannot see (cross-org for an org-Admin) SHALL return zero rows
(not an error) — indistinguishable from a nonexistent run, to avoid an existence-oracle.

---

## 3. Observed / legacy behavior to preserve (OBS)

**OBS-ATO-001 — The owner-only RLS on the three tables is unchanged.** This spec adds **no** policy, **no**
column, and **no** grant on `agent_runs` / `agent_events` / `agent_usage`. The security-definer RPCs are the
**sole** widening, and only for the org-Admin/Operator personas, only for structural aggregates (summary)
or content-gated (trace). An ordinary member's RLS view of their own rows is byte-for-byte unchanged.

**OBS-ATO-002 — The deputy invariant is untouched.** The definer RPCs re-derive persona/tenant from
`is_operator()` / `is_active_member()` / `auth_org_id()` server-side; the client **never** sends `org_id`
and the RPC **never** trusts a client-supplied tenant or persona (mirrors `0069`'s
`where org_id = public.auth_org_id()`). No code path constructs a `service_role` client (ADR-0036 §2).

**OBS-ATO-003 — No new event type, no new write path.** This is a pure read-model. The agent-chat loop
(`handler.ts` / `persistence.ts` / `_shared/usage.ts`) keeps writing the same rows the same way; the
read-model only reads them. (The gap-analysis's separate `insertEvent` idempotent-upsert and run-lifecycle
items are **different** do-now items — not this spec.)

**OBS-ATO-004 — `STUCK_RUN_STALE_MS = 45_000` is the existing FE constant.** `stuckRun.constants.ts`; the
server-side `is_stuck` (FR-ATO-009) reuses the **same value** so the admin panel and the live
`StuckRunBanner` agree on what "stuck" means. The design-plan SHOULD extract a single shared constant
(e.g. an `app.agent_stuck_run_stale_ms` GUC or a documented literal used in both) rather than two magic
numbers — flagged for the plan, not decided here.

**OBS-ATO-005 — `durationMs` is best-effort; PostHog's FE value is authoritative.** `0046` defines
`agent_runs.updated_at … default now()` but ships **no trigger** to bump it on UPDATE — so `updated_at`
only advances when a column is explicitly set (status/progress). The faithful end-time proxy is
`last_progress_at` (the heartbeat stamps it every round, `persistence.ts heartbeat`); the RPC uses
`coalesce(last_progress_at, updated_at)`. PostHog's `duration_ms` (`buildAgentRunCompletedEvent`, FE-clocked
turn start→terminal) remains the authoritative duration; the panel's `durationMs` is the row-derived
approximation for runs the FE clock missed.

**OBS-ATO-006 — `toolRoundCount` is a row-derived proxy; PostHog's FE value is authoritative.** There is
no explicit "round" column; the closest row-derived signal is `count(agent_events where type='tool')`
(one journaled tool event per tool call). PostHog's `tool_round_count` (FE-counted model turns that used
tools) is the authoritative figure; the panel surfaces the row-derived count as a best-effort
observability signal.

**OBS-ATO-007 — The model is pinned `deepseek/deepseek-v4-flash` (binding).** The read-model **surfaces**
`agent_usage.model` read-only; this spec **never** proposes a model change, cross-model fallback, or
provider abstraction (gap-analysis: those agent-native primitives are a deliberate mismatch for our
deepseek-pinned single-key stack).

---

## 4. Non-Functional Requirements

### 4.1 Security (OWASP / STRIDE)

- **NFR-ATO-SEC-001 — The definer RPCs never trust a client-supplied org/tenant/persona.** Summary and
  trace re-scope from `auth_org_id()` / `is_operator()` / `is_active_member()` exactly as `0069` does
  (FR-ATO-003/018, OBS-ATO-002). `security definer set search_path = public` prevents search-path
  injection; `revoke … from public; grant execute to authenticated` is the execute gate. **Proven by
  pgTAP**: a member of org A querying sees zero org-B runs; a disabled member sees zero rows.
- **NFR-ATO-SEC-002 — Conversation content (`text`/`payload`) is the sensitive surface and is gated.**
  The summary **never** returns it (FR-ATO-006); the trace returns it **only** to an Operator with the
  opt-in flag (FR-ATO-017). An org-Admin never receives another member's conversation content — only its
  structure. This preserves `0046`'s "more sensitive than a saved view" stance (STRIDE-I information
  disclosure). **Proven by pgTAP**: org-Admin trace response contains no `text`/`payload` keys.
- **NFR-ATO-SEC-003 — Reversible migration, RLS + org_id seam preserved.** The migration only
  `CREATE OR REPLACE`s functions and sets `REVOKE/GRANT EXECUTE`; it touches no table, no policy, no
  column (FR-ATO-007). Reverse = `drop function` in reverse order (documented in the migration header,
  mirroring `0069`/`0046`). `supabase db reset` restores prior state.
- **NFR-ATO-SEC-004 — No PII / conversation content in logs.** The RPCs and the panel log only structural
  metadata (run id, counts, status, error codes) — never `text`/`payload`. Existing logging discipline
  (`NFR-AGP-SEC-005`: log count/code, never content) is unchanged.
- **NFR-ATO-SEC-005 — Disabled-member / disabled-Operator guard.** Every persona predicate conjoins
  `is_active_member()` (FR-ATO-003/018), mirroring `0069`'s "security review M1: disabled-Operator guard
  re-asserted here." A disabled user's JWT yields zero rows on both RPCs. **Proven by pgTAP.**

### 4.2 Performance

- **NFR-ATO-PERF-001 — The summary is a single bounded aggregate query.** The RPC is `language sql stable`
  and aggregates over the existing hot-path indexes — `agent_events_run_seq_idx (run_id, seq)`,
  `agent_usage_org_created_idx (org_id, created_at)`, `agent_runs_thread_created_idx` — with a recent-rows
  cap (FR-ATO-012, e.g. last 200). It MUST NOT do per-run N+1 reads; the whole summary is one grouped
  query joined to `agent_runs`. The trace drill-in is one PK/seq-indexed range scan per run.
- **NFR-ATO-PERF-002 — The panel is a single `useQuery` per RPC, cached by persona+window.** It mirrors
  the `useUsage` hook pattern; no polling is required for v1 (the panel is a retrospective view, not a
  live tail — gap-analysis's live-reconnect is a separate item). A manual refresh/retry is provided
  (`onRetry` → `refetch`, matching `AdministrationUsage`).

### 4.3 Accessibility (WCAG 2.1 AA)

- **NFR-ATO-A11Y-001 — Flags are named status pills, not color-only.** The "No events persisted" /
  "Stuck" flags render as `StatusPill`s (or icon+text) with discernible text, never as color alone
  (WCAG 1.4.1). The `DataTable` retains its existing table semantics (header cells, row labels).
- **NFR-ATO-A11Y-002 — The drill-in is keyboard-operable and announced.** Opening a run's trace, moving
  through the ordered event list, and closing back to the list are all keyboard-operable; the trace list
  uses a sensible heading/order so a screen reader conveys "event 3 of 7, tool call, errored."

### 4.4 Quality / the honest framing

- **NFR-ATO-QUAL-001 — The panel's primary value is the regression net for the `!runId` class.** The two
  flags (FR-ATO-008/009) are the durable signal; the columns are context. The eng-plan SHOULD add a
  synthetic/seeded "zero-event run" + "stuck run" to the pgTAP fixture and assert both flag true, so the
  invariant "a real run persists ≥1 event and heartbeats" is machine-checked going forward — not just
  rendered. (This is the spec's answer to "make this bug unrepeatable" for the observability axis; the
  *lifecycle* axis is the separate do-now #1 spec.)

---

## 5. Acceptance Criteria (Given/When/Then)

> Layer per ADR-0010: **pgTAP** owns every RLS/tenancy/persona/derivation contract (the RPC is the
> security-bearing surface — proof belongs at the integration layer with a real DB, not a mocked unit);
> **Unit/RTL** owns the panel's states, columns, and flag rendering; **E2E** owns one cross-stack
> drill-in journey. One owning layer each; an AC referenced elsewhere is a non-owning cross-check only.

### The read-model / RPC (pgTAP — the security-bearing layer)

**AC-ATO-001 — Org-Admin sees only their own org's runs; cross-org is denied. [pgTAP]**
Given two runs in two orgs and an authenticated **active org-Admin** of org A (not an Operator),
When the org-Admin summary RPC is invoked,
Then it returns org A's runs only (org B's runs absent) — asserting `org_id = auth_org_id()` scoping
(FR-ATO-003, NFR-ATO-SEC-001).

**AC-ATO-002 — Operator sees cross-org (or one org); disabled caller denied. [pgTAP]**
Given runs across orgs and an authenticated **active Operator**,
When the Operator summary RPC is invoked with `p_org_id = null`,
Then it returns runs across all orgs; and given `p_org_id = <orgB>`, only org B's runs; and given a
**disabled** Operator/member, it returns zero rows (`is_active_member()` conjunct, NFR-ATO-SEC-005).

**AC-ATO-003 — Columns are derived exactly from the three tables. [pgTAP]**
Given a run with 2 `agent_usage` rows (cost 5 + 7), 3 `agent_events` of `type='tool'` (2 `completed`,
1 `errored`), and 6 total events,
When its summary row is read,
Then `llmCalls = 2`, `cost = 12`, `toolCalls = 3`, `successfulTools = 2`, `failedTools = 1`,
`eventCount = 6`, `status` = the run's `agent_runs.status`, and `model` = the run's `agent_usage.model`
(FR-ATO-004) — and a run with **zero** usage/events still appears with `cost=0`/`llmCalls=0`/`eventCount=0`
(LEFT JOIN, FR-ATO-004).

**AC-ATO-004 — `has_zero_events` and `is_stuck` are derived server-side on the DB clock. [pgTAP]**
Given a run with zero `agent_events` rows, its summary row has `has_zero_events = true`; and given a run
in status `running` whose `last_progress_at` is older than `STUCK_RUN_STALE_MS` (per the DB `now()`), its
summary row has `is_stuck = true`; and a completed run with fresh heartbeat has both false (FR-ATO-008/009/010).

**AC-ATO-005 — Provider cost is Operator-only (AC-USE-007 mirror). [pgTAP]**
Given the org-Admin summary shape, its rows carry **no** `provider_cost_usd` column/field; and given the
Operator summary shape, its rows carry `provider_cost_usd = sum(agent_usage.provider_cost_usd)` (FR-ATO-005).

**AC-ATO-006 — The summary never returns conversation content. [pgTAP]**
Given any run and any persona, the summary RPC response contains **no** `text` and **no** `payload` field
anywhere (structural aggregations + `tool_name` only — FR-ATO-006, NFR-ATO-SEC-002).

**AC-ATO-007 — The trace drill-in is ordered by seq and persona-scoped. [pgTAP]**
Given a run with events at seq 0,1,2 and an org-Admin of the run's org,
When `run_trace_events(p_run_id)` is invoked,
Then rows return ordered by `seq` ascending with structural fields (`seq,type,tool_name,tool_status,
created_at,has_text,has_payload`) and **no** `text`/`payload` for the org-Admin (FR-ATO-016/017); and given
an org-Admin of a **different** org, it returns zero rows (FR-ATO-018); and given an Operator with
`p_include_content=true`, the rows additionally include `text`/`payload` (FR-ATO-017).

### The bug-catching regression (pgTAP — the spec's reason for existing)

**AC-ATO-008 — A run that persisted zero events is unambiguously flagged. [pgTAP]**
Given the `!runId`-class regression shape — a run row exists but **zero** `agent_events` persisted (and
optionally zero `agent_usage`) — its summary row has `has_zero_events = true` and `eventCount = 0`, so it
appears in the panel flagged rather than invisible (FR-ATO-008, NFR-ATO-QUAL-001). *(This is the AC that
would have caught the 2026-07-08 bug; the eng-plan seeds exactly this shape as a fixture.)*

### The panel (Unit/RTL)

**AC-ATO-009 — The panel renders loading / empty / error states. [Unit/RTL]**
Given the hook is `isPending`, the panel renders `ListState variant="loading"`; given `isError`, it renders
`variant="error"` with a retry that calls `refetch()`; given empty data, it renders `variant="empty"` —
matching `AdministrationUsage.tsx` (FR-ATO-014), all via `DESIGN.md` tokens.

**AC-ATO-010 — The list shows the TraceSummary columns + conditional provider cost. [Unit/RTL]**
Given Operator-shape rows, the `DataTable` renders a Provider-cost column; given org-Admin-shape rows, it
does not (the same conditional-column logic `AdministrationUsage.tsx` uses for margin/provider cost)
(FR-ATO-005/012).

**AC-ATO-011 — Zero-event and stuck runs render salient flags, not color-only. [Unit/RTL]**
Given a row with `has_zero_events=true`, the panel renders a "No events persisted" pill with discernible
text; given `is_stuck=true`, a "Stuck — no heartbeat" pill; a flagged row is visually distinct from a
healthy row and the signal is not color-only (FR-ATO-013, NFR-ATO-A11Y-001).

**AC-ATO-013 — The cache-hit column shows a ratio when data exists and "—" when it does not. [Unit/RTL]**
Given a summary row whose `cachedTokens > 0` and `prompt_tokens > 0`, the panel's cache column renders the
computed percentage; given a row whose `cachedTokens` is null (provider did not report, or run predates
FR-ARH-008), it renders **"—"** (not "0%"), distinguishing no-data from a real 0% hit rate (FR-ATO-019).

### The cross-stack journey (E2E — one curated)

**AC-ATO-012 — An org-Admin opens Runs, sees their org's runs, and drills into an ordered trace. [E2E]**
Given a signed-in org-Admin with runs in their org,
When they navigate to Administration › Runs and open a run,
Then the run's trace renders with events ordered by `seq` (structural fields; no conversation content for
the org-Admin), and a seeded zero-event run in the fixture shows the "No events persisted" flag in the list
(FR-ATO-011/013/016/017).

---

## 6. Traceability

| AC | Owning layer | Owning test (name / file) |
|---|---|---|
| AC-ATO-001 | pgTAP | `AC-ATO-001 org-admin summary own-org only` (`supabase/tests/agent_run_trace_summary.test.sql`) |
| AC-ATO-002 | pgTAP | `AC-ATO-002 operator cross-org + disabled denied` (same) |
| AC-ATO-003 | pgTAP | `AC-ATO-003 columns derived from three tables` (same) |
| AC-ATO-004 | pgTAP | `AC-ATO-004 has_zero_events + is_stuck on DB clock` (same) |
| AC-ATO-005 | pgTAP | `AC-ATO-005 provider cost operator-only` (same) |
| AC-ATO-006 | pgTAP | `AC-ATO-006 summary omits text/payload` (same) |
| AC-ATO-007 | pgTAP | `AC-ATO-007 trace ordered by seq + persona-scoped` (`supabase/tests/agent_run_trace_events.test.sql`) |
| AC-ATO-008 | pgTAP | `AC-ATO-008 zero-event run flagged (!runId-class regression)` (`supabase/tests/agent_run_trace_summary.test.sql` — seeded fixture) |
| AC-ATO-009 | Unit/RTL | `AC-ATO-009 panel loading/empty/error` (`pmo-portal/pages/__tests__/AdministrationRuns.states.test.tsx`) |
| AC-ATO-010 | Unit/RTL | `AC-ATO-010 columns + conditional provider cost` (`…/AdministrationRuns.columns.test.tsx`) |
| AC-ATO-011 | Unit/RTL | `AC-ATO-011 zero-event + stuck flags render saliently` (`…/AdministrationRuns.flags.test.tsx`) |
| AC-ATO-013 | Unit/RTL | `AC-ATO-013 cache-hit ratio column shows ratio or dash` (`…/AdministrationRuns.cache.test.tsx`) |
| AC-ATO-012 | E2E | `AC-ATO-012 org-admin opens runs + drills ordered trace` (`pmo-portal/e2e/AC-ATO-012-runs-trace.spec.ts`) |

---

## 7. SoD & Security (OWASP / STRIDE)

**Information disclosure / conversation privacy (STRIDE-I, OWASP A01/A04).** This is the primary new
surface. The three source tables are owner-only by `0046` ("more sensitive than a saved view"); this spec
**deliberately widens** read access — but only (a) for the org-Admin/Operator personas, (b) for
**structural aggregates** in the summary (no `text`/`payload`, ever — FR-ATO-006/NFR-ATO-SEC-002), and (c)
for content in the trace **only** to an Operator with an explicit opt-in (FR-ATO-017). An org-Admin can see
*that* a member's run persisted zero events and called `query_entity` 3×, but never *what* was asked or
answered. Proven by AC-ATO-006/007. This is the right-sized trade: the observability signal that catches
the bug, without making admin a conversation reader.

**Elevation / persona spoofing (STRIDE-E/S, OWASP A01).** The definer RPCs re-derive persona/tenant from
`is_operator()` / `is_active_member()` / `auth_org_id()` and **never** trust a client-supplied `org_id` or
persona (OBS-ATO-002) — identical to the audited `0069` predicates. `security definer set search_path =
public` + `revoke from public; grant execute to authenticated` is the execute gate (FR-ATO-002). A member
of org A cannot read org B; a disabled user reads nothing (NFR-ATO-SEC-005). Proven by AC-ATO-001/002.

**Tampering (STRIDE-T).** None — these are `language sql stable` **read-only** RPCs; no `INSERT`/`UPDATE`/
`DELETE`. They cannot mutate `agent_runs`/`agent_events`/`agent_usage`. The append-only
`agent_events_feedback_only` trigger (`0046`) is untouched.

**Repudiation (STRIDE-R).** Unchanged — the source journal is still append-only (`0046`); the read-model
writes nothing. Admin/Operator *reads* of another member's run are out of scope to audit-log here (the
existing admin-access audit, if any, applies); flagged as an Open Question if read-auditing is required.

**Depth note (model-tiering for the security review).** This change is **SQL-definer + FE-read heavy** and
**adds no write path, no table, no policy** on the source tables. The security-auditor should focus depth
on (1) the definer's persona predicates (NFR-ATO-SEC-001/005 — the one place authority is re-derived,
mirror-verified against `0069`), (2) the content-gating boundary (NFR-ATO-SEC-002 / AC-ATO-006/007 —
confirm `text`/`payload` truly cannot reach an org-Admin), and (3) `search_path` pinning on the new
functions. A lighter pass than a schema/RLS-bearing issue; the genuine surface is the definer SQL, not the
FE.

---

## 8. Error Handling

| Error condition | Surface / behavior | User outcome |
|---|---|---|
| Caller is neither org-Admin nor Operator (or is disabled) | RPC returns zero rows; panel renders the Admin-only gate / empty state | Non-admin sees the existing gate; no error, no elevated access |
| RPC call fails (network / DB) | Hook `isError` → panel `ListState variant="error"` + retry (`refetch`) | "Couldn't load runs" with a retry; no crash |
| A run has zero `agent_usage` AND zero `agent_events` | LEFT JOIN keeps the row; `cost=0`, `llmCalls=0`, `eventCount=0`, `has_zero_events=true` | The run appears **flagged** (the bug-catching signal) rather than vanishing |
| `run_trace_events` for a cross-org run (org-Admin) | Returns zero rows (not an error) | Drill-in shows "no events" / empty — indistinguishable from nonexistent (no existence-oracle, FR-ATO-018) |
| `durationMs` / `toolRoundCount` disagree with PostHog | Panel shows the row-derived (best-effort) value; PostHog remains authoritative (OBS-ATO-005/006) | Documented discrepancy; no data loss — the flag/count signal is what matters |
| Recent-runs cap truncates the list | Panel shows the most-recent N runs (design-plan bound); a "showing last N" note | Old runs are reachable via PostHog/warehouse, not hidden data loss in-app |

---

## 9. Non-goals (explicitly out of scope)

- **Live run reconnection / tailing** (gap-analysis do-next #6 — `GET /runs/active` + `events?after=N`).
  This panel is a **retrospective** read-model, not a live stream; live-reconnect is a separate, larger
  build with its own endpoints.
- **The `!runId` lifecycle *fix* / `insertEvent` idempotent upsert / `reliable-mutations` proof-of-done.**
  Those are gap-analysis do-now items #1, #2, #4 — separate specs. This spec only makes their symptoms
  *visible*; it does not change the write path (OBS-ATO-003).
- **A per-user "my runs" view.** The run owner already sees their live transcript in `AssistantPanel`;
  an owner-facing history list is a separate product decision. This panel is org-Admin/Operator-only.
- **Conversation content for org-Admin.** Out by design (FR-ATO-006/017, NFR-ATO-SEC-002) — admin is a
  structural observer, not a conversation reader. Lifting this is an explicit owner decision (Open Q).
- **Token streaming, eval harness, satisfaction scoring, experiments, OTLP export.** agent-native
  primitives deliberately mismatched to our stack (gap-analysis "Explicitly skip"); not adopted here.
- **A model change / provider abstraction.** `deepseek/deepseek-v4-flash` is pinned (OBS-ATO-007); the
  read-model surfaces `model` read-only and never proposes changing it.
- **New source-table columns / policies / a new table.** The migration is RPC-only (FR-ATO-007); any
  schema enrichment (e.g. an explicit `updated_at` trigger for an accurate `durationMs`, or a `round`
  column for an accurate `toolRoundCount`) is deferred — the read-model is best-effort over today's rows.

---

## 10. Open Questions for the owner

1. **RPC count — faithful pair vs. collapsed.** This spec mirrors `0069`'s **pair**
   (`org_run_trace_summary()` + `operator_run_trace_summary(p_org_id)`) for the list, plus a single shared
   `run_trace_events(p_run_id)` for the drill-in (3 functions total). Alternatively the list could collapse
   to one `run_trace_summary(p_org_id)` whose body branches on `is_operator()` (2 functions). The pair is
   the audited 1:1 mirror; the collapse is less SQL. Owner preference? (Recommendation: ship the pair — it
   keeps the persona predicates byte-identical to the security-audited `0069` functions.)

2. **Conversation content for org-Admin — never, or gated?** FR-ATO-017 makes `text`/`payload`
   **Operator-only**. Should an org-Admin ever be able to read another member's conversation (e.g. for
   abuse/support debugging), or is structural-only the permanent line? (Recommendation: structural-only
   for v1 — it is the conservative reading of `0046` and still catches the bug; lift only on an explicit
   owner + security-auditor decision.)

3. **`STUCK_RUN_STALE_MS` — one shared source of truth?** The FE constant (`stuckRun.constants.ts`,
   45_000) and the server-side `is_stuck` literal (FR-ATO-009) must agree. Extract to a single source (an
   `app.agent_stuck_run_stale_ms` GUC read by the RPC, or a documented shared literal) so they cannot
   drift — or accept two literals with a test pinning them equal? (Recommendation: GUC, mirroring how
   `0069` reads `app.credits_per_usd`.)

4. **Recent-runs cap + pagination.** FR-ATO-012 says "most-recent first, bounded" (proposed last 200).
   Is a hard cap + "showing last N" note sufficient for v1, or does the owner want keyset pagination /
   a date filter on the panel? (Recommendation: hard cap + note for v1; paginate if a real org hits it.)

5. **Read-audit of admin cross-member reads.** Should the RPCs (or a trigger) record that an
   org-Admin/Operator read another member's run trace, for repudiation/SOC purposes? Out of scope here
   unless the owner wants it; flagged because `0046` treats these rows as sensitive.

---

## 11. Contradictions / conflicts flagged against existing code & locked decisions

None against ADR-0043/0036/0010/0016/0017/0001/0006/0049 (this spec operates strictly inside their
boundaries — read-only definer RPCs, caller-JWT, RLS authority, org_id seam, reversible migration, real
persona). Facts worth flagging for the eng-plan (none is a contradiction):

1. **The three tables are owner-only by RLS; this spec's RPCs are the SOLE widening.** `0046` header +
   `agent_runs_select`/`agent_events_select` = `using (owner_id = auth.uid() and org_id = auth_org_id())`.
   The definer RPCs are the only path an org-Admin/Operator reads another member's rows through, and only
   for structural aggregates (summary) or Operator-gated content (trace). The eng-plan MUST NOT add a
   permissive `SELECT` policy on these tables to "support" the panel — the definer is the support.
2. **`agent_runs.updated_at` has no trigger (`0046`).** `durationMs` therefore uses
   `coalesce(last_progress_at, updated_at)` (OBS-ATO-005) and is best-effort; if the owner later wants an
   authoritative in-app duration, the plan would add an `updated_at` bump trigger — **not** this spec.
3. **`agent_usage.run_id` is `ON DELETE SET NULL`** (`database.types.ts:438`). Deleting a run orphans its
   usage rows (they lose the run link and won't appear in this run-centric panel). The LEFT JOIN
   (FR-ATO-004) handles run→usage correctly; orphaned usage is invisible to this panel by design (it is a
   run view, not a usage-reconciliation view — `AdministrationUsage` owns that).
4. **`is_operator()` is `security invoker` and leans on its self-SELECT RLS policy** (`0064`). The definer
   RPCs call it under the caller's JWT, so it resolves correctly; the eng-plan must NOT wrap it in a way
   that bypasses that policy (which would make it always-false, exactly the footgun `0064`'s header warns
   of).
5. **PostHog already fires `agent_run_started/completed/errored`** (`events.ts`) regardless of whether the
   run persisted. The panel's "empty / all-zero-event" state vs. PostHog showing starts firing is the
   **meta-signal** of the `!runId` class (activity without persistence); the eng-plan should note this
   cross-check explicitly so the panel is understood as PostHog's in-app counterpart (FR-ATO-015).
