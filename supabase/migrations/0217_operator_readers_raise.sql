-- 0217_operator_readers_raise.sql — #612 item 3 (isolation probe follow-up to #490).
-- operator_usage_summary(uuid) and operator_agent_run_stats(uuid) answered a non-operator with an EMPTY
-- result (the is_operator() predicate sat inside the WHERE clause), so "denied" and "no usage yet" were
-- indistinguishable to a caller and a bug that emptied the real operator view would be invisible. Every
-- sibling operator RPC (0191 / 0192 / 0213) raises `operator_only` 42501; these two now match. Bodies
-- are 0086's, unchanged; grants unchanged (authenticated keeps EXECUTE — the raise is the gate).
-- The FE only calls these for a caller its own `useIsOperator` says is an operator (useUsage.ts).
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback (same signatures, so CREATE OR REPLACE
-- suffices): re-run the `create or replace function public.operator_usage_summary(uuid)` and
-- `public.operator_agent_run_stats(uuid)` statements from 0086_usage_summary_cache_cols.sql (lines 52-157).

create or replace function public.operator_usage_summary(p_org_id uuid default null)
returns table (
  org_id uuid, owner_id uuid, action text, month date,
  run_count bigint, prompt_tokens bigint, completion_tokens bigint,
  cached_tokens bigint, reasoning_tokens bigint,
  provider_cost_usd numeric, cost numeric, margin_usd numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;
  return query
  with rates as (select nullif(current_setting('app.credits_per_usd', true), '')::numeric as cpu)
  select u.org_id, u.owner_id, u.action, date_trunc('month', u.created_at)::date as month,
         count(*)::bigint, coalesce(sum(u.prompt_tokens),0)::bigint, coalesce(sum(u.completion_tokens),0)::bigint,
         coalesce(sum(u.cached_tokens),0)::bigint, coalesce(sum(u.reasoning_tokens),0)::bigint,
         coalesce(sum(u.provider_cost_usd),0), coalesce(sum(u.cost),0),
         case when (select cpu from rates) is null or (select cpu from rates) <= 0 then null
              else (coalesce(sum(u.cost),0) / (select cpu from rates)) - coalesce(sum(u.provider_cost_usd),0)
         end
    from public.agent_usage u
   where (p_org_id is null or u.org_id = p_org_id)
   group by u.org_id, u.owner_id, u.action, date_trunc('month', u.created_at)
   order by month desc, u.org_id, u.owner_id, u.action;
end;
$$;

create or replace function public.operator_agent_run_stats(p_org_id uuid default null)
returns table (
  org_id uuid, action text, month date,
  runs bigint, avg_rounds numeric,
  p50_cost numeric, p95_cost numeric, max_cost numeric,
  cache_hit_pct numeric,
  p50_ms integer, p95_ms integer
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  if not public.is_operator() then
    raise exception 'operator_only' using errcode = '42501';
  end if;
  return query
  with per_run as (
    select u.org_id as run_org_id, coalesce(u.run_id, u.id) as run_key,
           max(u.action) as run_action,
           date_trunc('month', min(u.created_at))::date as run_month,
           coalesce(sum(u.cost),0) as run_cost,
           count(*)::bigint as rounds,
           coalesce(sum(u.duration_ms),0) as run_ms,
           coalesce(sum(u.cached_tokens),0)::numeric as run_cached,
           coalesce(sum(u.prompt_tokens),0)::numeric as run_prompt
      from public.agent_usage u
     where (p_org_id is null or u.org_id = p_org_id)
     group by u.org_id, coalesce(u.run_id, u.id)
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
   order by run_month desc, run_org_id, run_action;
end;
$$;
