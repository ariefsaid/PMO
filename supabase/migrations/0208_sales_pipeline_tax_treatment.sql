-- 0208_sales_pipeline_tax_treatment.sql — add the deal's OWN tax_treatment to get_sales_pipeline().
--
-- OD-TAX-1 §2: no bare number anywhere the treatment exists. #548 labelled every money surface it
-- could reach; the sales pipeline list and kanban were the one exception, because their rows come
-- from this RPC and its projection does not carry `tax_treatment` — the column exists on `projects`,
-- the RPC simply never returned it. So the FE had nothing to render and left the figure bare.
--
-- ⛔ WHY THE FE COULD NOT JUST FILL IT IN. Deriving the label from the org-wide
-- `default_tax_treatment` (0207) is precisely what OD-TAX-1 forbids: the default pre-selects a form
-- and is NEVER consulted at read time, because re-deriving a stored figure's basis from a current
-- setting silently re-interprets history. A bare number is honest; a guessed label is a confident
-- lie about someone's contract, and no later correction undoes a decision made against it.
--
-- Same additive discipline as 0201 (which added `currency` for the same reason): the JSON return
-- type is unchanged, the drop/recreate makes the ACL restoration explicit, and no STAGE AGGREGATE
-- gains a treatment — a stage total sums across deals that may differ, so it has no single basis.
-- That is the OD-CR-5 shape, and it stays unlabelled rather than guessing, exactly like `currency`.
--
-- MANUAL REVERSAL: restore 0201's body (no `p.tax_treatment` in the `pl` CTE, no `'tax_treatment'`
-- projects JSON key) and re-run the three ACL statements. Pre-production rollback is `db reset`.

drop function if exists public.get_sales_pipeline();

-- ⚑ VERBATIM from 0201_sales_pipeline_currency.sql (security invoker, stable, set search_path)
-- EXCEPT the added `p.tax_treatment` CTE column + `'tax_treatment', pl.tax_treatment` JSON key.
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
      p.tax_treatment,
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
          'tax_treatment',  pl.tax_treatment,
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

-- Reapply the exact ACLs from the LATEST definition (0201) — a dropped function takes its grants.
revoke all     on function public.get_sales_pipeline() from public;
grant  execute on function public.get_sales_pipeline() to authenticated;
revoke execute on function public.get_sales_pipeline() from anon;
