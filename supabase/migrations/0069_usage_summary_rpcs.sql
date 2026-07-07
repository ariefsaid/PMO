-- 0069_usage_summary_rpcs.sql — usage aggregate RPCs (FR-USE-002/003/004/006, FR-OPR-004,
-- ops-admin-surface S5). AGGREGATES ONLY — never read agent_events/agent_runs/agent_threads
-- (NFR-PRIV-001, AC-PRIV-001). margin_usd is conditional on app.credits_per_usd (null when unset,
-- FR-USE-006). operator_list_orgs returns directory columns only (no business-data aggregates).
-- Reversibility (ADR-0006): supabase db reset. Manual: drop the 3 fns below.
--
-- AC-USE-007 (owner decision, ops-admin Discover round 2026-07-06): org_usage_summary() does NOT
-- return provider_cost_usd — that is PMO's raw provider spend (the markup), which an org-Admin
-- must never see next to their own credits-spent figure. operator_usage_summary() KEEPS it (the
-- Operator/platform persona is the only one entitled to provider cost).

-- Return-column shape changed (provider_cost_usd removed, AC-USE-007): CREATE OR REPLACE cannot
-- change OUT columns, so drop first (this migration is unmerged/never-deployed — in-place edit).
drop function if exists public.org_usage_summary();

create or replace function public.org_usage_summary()
returns table (
  owner_id uuid, action text, month date,
  run_count bigint, prompt_tokens bigint, completion_tokens bigint,
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
  provider_cost_usd numeric, cost numeric, margin_usd numeric
)
language sql stable security definer set search_path = public as $$
  with rates as (select nullif(current_setting('app.credits_per_usd', true), '')::numeric as cpu)
  select org_id, owner_id, action, date_trunc('month', created_at)::date as month,
         count(*)::bigint, coalesce(sum(prompt_tokens),0)::bigint, coalesce(sum(completion_tokens),0)::bigint,
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

-- operator_list_orgs: directory columns ONLY (FR-OPR-004) — no business-data aggregates leak here.
create or replace function public.operator_list_orgs()
returns table (id uuid, name text)
language sql stable security definer set search_path = public as $$
  select id, name from public.organizations
   where public.is_operator() and public.is_active_member()    -- security review M1
   order by name
$$;

revoke all on function public.org_usage_summary() from public;
grant execute on function public.org_usage_summary() to authenticated;
revoke all on function public.operator_usage_summary(uuid) from public;
grant execute on function public.operator_usage_summary(uuid) to authenticated;
revoke all on function public.operator_list_orgs() from public;
grant execute on function public.operator_list_orgs() to authenticated;
