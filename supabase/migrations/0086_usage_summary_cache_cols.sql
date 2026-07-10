-- 0086_usage_summary_cache_cols.sql — agent cost dashboard (docs/plans/2026-07-10-agent-cost-dashboard.md).
--
-- Two things, both AGGREGATES ONLY over public.agent_usage — NEVER agent_events/agent_runs/
-- agent_threads (NFR-PRIV-001, the privacy line restated in 0069/db/usage.ts/AdministrationUsage.tsx):
--
-- Phase 1 — extend the summary RPCs. org_usage_summary()/operator_usage_summary() each gain
--   cached_tokens (Σ) + reasoning_tokens (Σ), appended after completion_tokens. The RETURNS TABLE
--   shape changes, so (like 0069) DROP first — CREATE OR REPLACE cannot change OUT columns. Every
--   other line (margin logic, provider_cost_usd operator-only per AC-USE-007, is_active_member/
--   is_operator guards, grants) is preserved verbatim.
--
-- Phase 2 — new per-run stats RPCs. org_agent_run_stats()/operator_agent_run_stats(uuid) compute
--   per-run cost/latency percentiles + cache-hit % by grouping agent_usage BY RUN in an inner CTE,
--   then percentile_cont by action/month in the outer query. run_id is null for un-persisted rows
--   (compose-view, persistence-off) — grouped as coalesce(run_id, id) so each such row is its own
--   1-round run rather than collapsing every null-run row into one bogus mega-run.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse: drop the run-stats fns; re-create the
-- 0069 summary fns from that migration.

-- ── Phase 1: extend the summary RPCs (OUT cols change → drop first) ──────────────
drop function if exists public.org_usage_summary();
drop function if exists public.operator_usage_summary(uuid);

create or replace function public.org_usage_summary()
returns table (
  owner_id uuid, action text, month date,
  run_count bigint, prompt_tokens bigint, completion_tokens bigint,
  cached_tokens bigint, reasoning_tokens bigint,
  cost numeric, margin_usd numeric
)
language sql stable security definer set search_path = public as $$
  with rates as (
    select nullif(current_setting('app.credits_per_usd', true), '')::numeric as cpu
  )
  select owner_id, action, date_trunc('month', created_at)::date as month,
         count(*)::bigint,
         coalesce(sum(prompt_tokens),0)::bigint,
         coalesce(sum(completion_tokens),0)::bigint,
         coalesce(sum(cached_tokens),0)::bigint,
         coalesce(sum(reasoning_tokens),0)::bigint,
         coalesce(sum(cost),0),
         case when (select cpu from rates) is null or (select cpu from rates) <= 0 then null
              else (coalesce(sum(cost),0) / (select cpu from rates)) - coalesce(sum(provider_cost_usd),0)
         end
    from public.agent_usage
   where org_id = public.auth_org_id() and public.is_active_member()
   group by owner_id, action, date_trunc('month', created_at)
   order by month desc, owner_id, action
$$;

create or replace function public.operator_usage_summary(p_org_id uuid default null)
returns table (
  org_id uuid, owner_id uuid, action text, month date,
  run_count bigint, prompt_tokens bigint, completion_tokens bigint,
  cached_tokens bigint, reasoning_tokens bigint,
  provider_cost_usd numeric, cost numeric, margin_usd numeric
)
language sql stable security definer set search_path = public as $$
  with rates as (select nullif(current_setting('app.credits_per_usd', true), '')::numeric as cpu)
  select org_id, owner_id, action, date_trunc('month', created_at)::date as month,
         count(*)::bigint, coalesce(sum(prompt_tokens),0)::bigint, coalesce(sum(completion_tokens),0)::bigint,
         coalesce(sum(cached_tokens),0)::bigint, coalesce(sum(reasoning_tokens),0)::bigint,
         coalesce(sum(provider_cost_usd),0), coalesce(sum(cost),0),
         case when (select cpu from rates) is null or (select cpu from rates) <= 0 then null
              else (coalesce(sum(cost),0) / (select cpu from rates)) - coalesce(sum(provider_cost_usd),0)
         end
    from public.agent_usage
   where public.is_operator()
     and public.is_active_member()                 -- security review M1: disabled-Operator guard (0064 exempts the table; re-assert here)
     and (p_org_id is null or org_id = p_org_id)
   group by org_id, owner_id, action, date_trunc('month', created_at)
   order by month desc, org_id, owner_id, action
$$;

-- ── Phase 2: per-run stats RPCs (agent_usage-only — NFR-PRIV-001) ────────────────
-- Inner CTE = one row per RUN (Σcost, round count, Σduration_ms, Σcached/Σprompt); outer = per
-- action/month cost + latency percentiles and cache-hit %. Cost/ms percentiles use percentile_cont
-- over double precision (the ordered-set aggregate's required input type); p50/p95_ms are rounded
-- back to integer ms. cache_hit_pct = 100·Σcached/Σprompt across the group (0 when no prompt tokens).

create or replace function public.org_agent_run_stats()
returns table (
  action text, month date,
  runs bigint, avg_rounds numeric,
  p50_cost numeric, p95_cost numeric, max_cost numeric,
  cache_hit_pct numeric,
  p50_ms integer, p95_ms integer
)
language sql stable security definer set search_path = public as $$
  with per_run as (
    select coalesce(run_id, id) as run_key,
           max(action) as run_action,
           date_trunc('month', min(created_at))::date as run_month,
           coalesce(sum(cost),0) as run_cost,
           count(*)::bigint as rounds,
           coalesce(sum(duration_ms),0) as run_ms,
           coalesce(sum(cached_tokens),0)::numeric as run_cached,
           coalesce(sum(prompt_tokens),0)::numeric as run_prompt
      from public.agent_usage
     where org_id = public.auth_org_id() and public.is_active_member()
     group by coalesce(run_id, id)
  )
  select run_action, run_month,
         count(*)::bigint,
         avg(rounds)::numeric,
         percentile_cont(0.5)  within group (order by run_cost::double precision)::numeric,
         percentile_cont(0.95) within group (order by run_cost::double precision)::numeric,
         max(run_cost)::numeric,
         case when sum(run_prompt) <= 0 then 0::numeric
              else round(100 * sum(run_cached) / sum(run_prompt), 2) end,
         (percentile_cont(0.5)  within group (order by run_ms::double precision))::integer,
         (percentile_cont(0.95) within group (order by run_ms::double precision))::integer
    from per_run
   group by run_action, run_month
   order by run_month desc, run_action
$$;

create or replace function public.operator_agent_run_stats(p_org_id uuid default null)
returns table (
  org_id uuid, action text, month date,
  runs bigint, avg_rounds numeric,
  p50_cost numeric, p95_cost numeric, max_cost numeric,
  cache_hit_pct numeric,
  p50_ms integer, p95_ms integer
)
language sql stable security definer set search_path = public as $$
  with per_run as (
    select org_id as run_org_id, coalesce(run_id, id) as run_key,
           max(action) as run_action,
           date_trunc('month', min(created_at))::date as run_month,
           coalesce(sum(cost),0) as run_cost,
           count(*)::bigint as rounds,
           coalesce(sum(duration_ms),0) as run_ms,
           coalesce(sum(cached_tokens),0)::numeric as run_cached,
           coalesce(sum(prompt_tokens),0)::numeric as run_prompt
      from public.agent_usage
     where public.is_operator()
       and public.is_active_member()
       and (p_org_id is null or org_id = p_org_id)
     group by org_id, coalesce(run_id, id)
  )
  select run_org_id, run_action, run_month,
         count(*)::bigint,
         avg(rounds)::numeric,
         percentile_cont(0.5)  within group (order by run_cost::double precision)::numeric,
         percentile_cont(0.95) within group (order by run_cost::double precision)::numeric,
         max(run_cost)::numeric,
         case when sum(run_prompt) <= 0 then 0::numeric
              else round(100 * sum(run_cached) / sum(run_prompt), 2) end,
         (percentile_cont(0.5)  within group (order by run_ms::double precision))::integer,
         (percentile_cont(0.95) within group (order by run_ms::double precision))::integer
    from per_run
   group by run_org_id, run_action, run_month
   order by run_month desc, run_org_id, run_action
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────────
revoke all on function public.org_usage_summary() from public;
grant execute on function public.org_usage_summary() to authenticated;
revoke all on function public.operator_usage_summary(uuid) from public;
grant execute on function public.operator_usage_summary(uuid) to authenticated;
revoke all on function public.org_agent_run_stats() from public;
grant execute on function public.org_agent_run_stats() to authenticated;
revoke all on function public.operator_agent_run_stats(uuid) from public;
grant execute on function public.operator_agent_run_stats(uuid) to authenticated;
