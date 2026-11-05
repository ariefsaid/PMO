-- 0694_budget_distribution_snapshot.sql
-- Read a persisted whole-project distribution in one MVCC statement snapshot.
-- Reverse: rollback/0694_budget_distribution_snapshot_down.sql.

create or replace function public.get_budget_distribution_snapshot(p_version_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'method', plan.method,
    'inputs', plan.inputs,
    'category_overrides', plan.category_overrides,
    'basis', plan.basis,
    'rows', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'category', distribution.category,
            'fiscal_year', distribution.fiscal_year,
            'ordinal', distribution.ordinal,
            'amount', distribution.amount::text,
            'method', distribution.method,
            'is_override', distribution.is_override
          )
          order by distribution.category, distribution.ordinal, distribution.fiscal_year, distribution.id
        )
        from public.budget_year_distributions as distribution
        where distribution.budget_version_id = p_version_id
      ),
      '[]'::jsonb
    )
  )
  from public.budget_distribution_plans as plan
  where plan.budget_version_id = p_version_id;
$$;

revoke all on function public.get_budget_distribution_snapshot(uuid) from public, anon;
grant execute on function public.get_budget_distribution_snapshot(uuid) to authenticated;
