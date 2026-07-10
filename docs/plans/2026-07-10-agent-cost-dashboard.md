# Plan — Agent cost dashboard in the operator layer (2026-07-10)

Surface the agent model-cost telemetry (cache hit-rate, reasoning split, cost/run, latency) in the
existing **Administration › Usage** operator/admin surface, instead of raw SQL. Full-cycle issue,
lands on `dev`. Owner picked "Phase 1 + 2 together."

## Binding design decision — the privacy line (NFR-PRIV-001)

The usage surface is **AGGREGATES ONLY — it must NEVER read `agent_events` / `agent_runs` /
`agent_threads`** (0069 header, `db/usage.ts`, `AdministrationUsage.tsx` all restate this). Therefore
latency must NOT come from `agent_runs`. **Decision: add `duration_ms` to `agent_usage`** (the
sanctioned source) — the edge fn already computes `model_ms = Date.now() - _t0` per round and logs it;
we persist it. Cost-per-run and latency percentiles are then computed by grouping `agent_usage` by
`run_id` — all inside security-definer RPCs, `agent_usage`-only. The privacy line is preserved.

## Contracts (the seam between the two parallel build tracks)

### DB migration `0085_agent_usage_duration.sql`
Additive, mirrors `0084`:
```sql
alter table public.agent_usage add column duration_ms integer not null default 0;
comment on column public.agent_usage.duration_ms is
  'Wall-clock ms of the model call that produced this row (edge-fn model_ms). 0 when unmeasured.';
```

### Capture chain (duration_ms)
- `handler.ts` runToolLoop: it already computes `const _t0 = Date.now()` and `Date.now() - _t0`.
  Pass that ms into `recordUsage` (new optional 4th arg `durationMs`), which forwards to
  `insertUsageRow` → clamped (`clampUsageValue`) → `duration_ms`. `compose-view` passes 0 (no split).
- `usage.ts`: `UsageFields.duration_ms?`, insert it (clamped); `recordUsage(deps, resp, action, durationMs?)`.

### Extended summary RPCs (Phase 1 — add columns; DROP+CREATE, OUT-cols change)
`org_usage_summary()` gains `cached_tokens bigint, reasoning_tokens bigint` (Σ). `operator_usage_summary()`
gains the same two. Column order: append after `completion_tokens`. Keep everything else identical.

### New run-stats RPCs (Phase 2 — per-run percentiles, `agent_usage`-only)
```
org_agent_run_stats() returns table (
  action text, month date,
  runs bigint, avg_rounds numeric,
  p50_cost numeric, p95_cost numeric, max_cost numeric,
  cache_hit_pct numeric,          -- 100*Σcached/Σprompt across the group
  p50_ms integer, p95_ms integer  -- per-run total duration_ms percentiles
)
operator_agent_run_stats(p_org_id uuid default null) returns the same + leading org_id.
```
Both: `security definer set search_path=public`, `is_active_member()` guard, org path `org_id=auth_org_id()`,
operator path `is_operator()`. Inner CTE groups `agent_usage` by `run_id` (→ per-run cost = Σcost,
rounds = count, ms = Σduration_ms, cached/prompt sums), outer groups by action/month with
`percentile_cont`. `revoke all from public; grant execute to authenticated`.

### DAL (`db/usage.ts`)
Add `RunStatsRow` / `OperatorRunStatsRow` types (from `Database['public']['Functions'][...]`) +
`getOrgAgentRunStats()` / `getOperatorAgentRunStats(orgId?)` (mirror the existing two, `AppError` map).
Extend `UsageSummaryRow`/`OperatorUsageSummaryRow` automatically via regenerated `database.types.ts`.

### Hook (`useUsage.ts`)
Add `useAgentRunStats(operatorOrgId?)` mirroring `useUsage` (same operator/admin branch + queryKey
`['agent-run-stats', orgId, isOperator, operatorOrgId]`). Keep `useUsage` as-is (Phase-1 columns ride
its existing rows).

### UI presentational panel — `AgentCostMetrics.tsx` (props-only; the parallel-safe seam)
```ts
export interface AgentCostMetricsProps {
  summaryRows: UsageRow[];      // existing rows (now incl. cached_tokens/reasoning_tokens)
  runStatsRows: RunStatsRow[];  // new per-run percentiles
  isPending: boolean; isError: boolean; onRetry: () => void;
}
```
Renders a KPI tile row (overall cache-hit %, reasoning %, p50/p95 cost/run, p95 latency) + a small
recharts trend (cache-hit % by month) via the existing `ChartFrame`/kit + `DESIGN.md` tokens. All
states (loading/error/empty). Derives percentages in-component from the rows (no new server math beyond
the RPCs). Operator vs admin: provider-cost stays operator-only (unchanged); cache/latency are fine for
both. Mounted inside `AdministrationUsage` (or its container) above the existing table.

## Acceptance criteria (owning layer per ADR-0010)
- AC-ACD-001 `agent_usage.duration_ms` exists, int, not-null default 0, clamped on insert. **pgTAP + Vitest(usage).**
- AC-ACD-002 `recordUsage` forwards a clamped durationMs into the row. **Vitest (usage.test).**
- AC-ACD-003 `org_usage_summary` returns Σcached_tokens/Σreasoning_tokens, owner-scoped, own-org only. **pgTAP.**
- AC-ACD-004 `operator_usage_summary` returns the same two + provider_cost_usd, operator-only. **pgTAP.**
- AC-ACD-005 `org_agent_run_stats` per-run percentiles correct (cost p50/p95, cache_hit_pct, ms), own-org. **pgTAP.**
- AC-ACD-006 `operator_agent_run_stats` operator-only + org filter; non-operator denied. **pgTAP.**
- AC-ACD-007 both run-stats RPCs read ONLY agent_usage (privacy line) — asserted by grep + review, no agent_runs/events in the fn body. **review.**
- AC-ACD-008 DAL maps errors to AppError; hook keys by orgId+operator. **Vitest.**
- AC-ACD-009 AgentCostMetrics renders tiles + chart from rows; loading/error/empty states; a11y (axe). **Vitest/RTL + axe.**
- AC-ACD-010 Admin opens Administration › Usage → cache-hit/cost/latency panel renders. **e2e (one curated journey).**

## Parallel build tracks (worktree-isolated)
- **Track DATA** (opus): migration 0085 + capture chain (handler/usage) + extended summary RPCs +
  new run-stats RPCs + pgTAP (0140+/name-based) + `db/usage.ts` + `database.types.ts` + DAL/usage Vitest
  + `useUsage.ts` (add `useAgentRunStats`) + container wiring in the Administration page.
- **Track UI** (sonnet, opus if gnarly): `AgentCostMetrics.tsx` presentational panel + Vitest/RTL
  states + axe, strictly to the props contract above + DESIGN.md tokens. No db/hook imports (props only).
Integration: DATA's container renders UI's `<AgentCostMetrics …/>` with the derived rows.

## Gates
`npm run verify` green; pgTAP on the dev→main promotion; 3-reviewer battery + design-review Discover
(UI). Coverage ≥80% changed lines. Never prod.
