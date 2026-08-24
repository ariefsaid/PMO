-- 0200_sales_pipeline_currency.sql — add the deal's OWN currency to get_sales_pipeline().
-- FR-L10N-020 / OD-CR-5: every row-backed money surface renders the RECORD's currency; a pipeline
-- deal card is a money surface and must render projects.currency, not the org default. 0044 does
-- not project `currency`, so a foreign-currency deal renders in the org's denomination on the
-- pipeline card/table while every other per-record surface is correct.
--
-- The live definition (0044_dashboard_status_helpers.sql) returns ONE json value (json_build_object),
-- NOT `returns table(...)`. This migration is additive: the JSON return type is unchanged, so it
-- honors the requested drop/recreate discipline conservatively (the drop also makes ACL
-- restoration explicit — a dropped function takes its `grant execute` with it).
--
-- MANUAL REVERSAL: restore the pre-change 0044 body (no `p.currency` in the `pl` CTE / projects
-- JSON) and its three ACL statements below. Pre-production rollback remains `supabase db reset`.

drop function if exists public.get_sales_pipeline();

-- ⚑ VERBATIM from 0044_dashboard_status_helpers.sql (security invoker, stable, set search_path)
-- EXCEPT the added `p.currency` CTE column + `'currency', pl.currency` projects JSON key. None of
-- the stage aggregates gain a currency: a stage total sums across deals and has no single record
-- currency (it stays org-default-denominated on the FE).
create or replace function public.get_sales_pipeline()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with pl as (
    select
      p.id,
      p.name,
      p.client_id,
      p.status,
      p.contract_value,
      p.currency,
      p.last_update,
      p.project_manager_id,
      coalesce(c.win_probability, 0) as win_prob
    from projects p
    left join pipeline_stage_config c on c.status = p.status
    where p.status::text = any(pipeline_project_statuses())
  )
  select json_build_object(
    'stages', coalesce((
      select json_agg(
        json_build_object(
          'status',        s.status,
          'count',         s.cnt,
          'total_value',   s.total_value,
          'win_probability', s.win_prob,
          'weighted_value',  s.total_value * s.win_prob
        )
        order by s.status
      )
      from (
        select
          status,
          count(*)::int           as cnt,
          sum(contract_value)     as total_value,
          max(win_prob)           as win_prob
        from pl
        group by status
      ) s
    ), '[]'::json),
    'projects', coalesce((
      select json_agg(
        json_build_object(
          'id',             pl.id,
          'name',           pl.name,
          'client_name',    co.name,
          'status',         pl.status,
          'contract_value', pl.contract_value,
          'currency',       pl.currency,
          'win_probability', pl.win_prob,
          'last_update',    pl.last_update,
          'pm_name',        pm.full_name
        )
        order by pl.contract_value desc
      )
      from pl
      left join companies co on co.id = pl.client_id
      left join profiles  pm on pm.id = pl.project_manager_id
    ), '[]'::json)
  );
$$;

-- Reapply the exact ACLs from the LATEST definition (0044) — a dropped function takes its grants.
revoke all     on function public.get_sales_pipeline() from public;
grant  execute on function public.get_sales_pipeline() to authenticated;
revoke execute on function public.get_sales_pipeline() from anon;