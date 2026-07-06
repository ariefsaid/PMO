-- 0124_usage_summary_provider_cost_role_split.test.sql
-- AC-USE-007 [pgTAP]: org-Admin-facing usage summary must NOT leak provider_cost_usd (the PMO
-- markup); the Operator-facing summary MUST keep it. Owner decision (ops-admin Discover round,
-- 2026-07-06): org_usage_summary() drops provider_cost_usd from its RETURNS TABLE shape;
-- operator_usage_summary() is unchanged. Proven via pg_proc's RETURNS TABLE column names
-- (proargnames for OUT/TABLE args, proargmodes = 't') rather than seeded rows, so the shape is
-- pinned even with zero usage data.
begin;
select plan(4);

select ok(
  not exists (
    select 1 from pg_proc, unnest(proargnames) as col
     where proname = 'org_usage_summary' and pronamespace = 'public'::regnamespace
       and col = 'provider_cost_usd'
  ),
  'AC-USE-007 org_usage_summary() return shape does NOT include provider_cost_usd'
);

select ok(
  exists (
    select 1 from pg_proc, unnest(proargnames) as col
     where proname = 'operator_usage_summary' and pronamespace = 'public'::regnamespace
       and col = 'provider_cost_usd'
  ),
  'AC-USE-007 operator_usage_summary() return shape STILL includes provider_cost_usd'
);

-- Sanity: the other aggregate columns are still present on org_usage_summary() post-flip.
select ok(
  exists (
    select 1 from pg_proc, unnest(proargnames) as col
     where proname = 'org_usage_summary' and pronamespace = 'public'::regnamespace
       and col = 'cost'
  ),
  'AC-USE-007 org_usage_summary() still returns cost (credits charged)'
);
select ok(
  exists (
    select 1 from pg_proc, unnest(proargnames) as col
     where proname = 'org_usage_summary' and pronamespace = 'public'::regnamespace
       and col = 'margin_usd'
  ),
  'AC-USE-007 org_usage_summary() still returns margin_usd'
);

select * from finish();
rollback;
