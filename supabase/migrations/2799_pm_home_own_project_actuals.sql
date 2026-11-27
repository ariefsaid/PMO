-- 2799: the Project Manager home reads the by-category actuals of the caller's own projects only.
-- It read project_mapped_actuals_all(null) (every project of the organisation) and used the rows of the caller's own projects.
-- project_mapped_actuals(project) returns the same rows for one project (same guards, same money-scope rule, same figures;
-- the pgTAP file proves it row by row), so the ledger-basis read now costs the caller's projects, not the organisation's.
-- Only the pma CTE of the 0770 body changes. No begin/commit: the rollback round trip wraps this file in its own transaction.
-- Rollback: supabase/migrations/rollback/2799_pm_home_own_project_actuals_down.sql

create or replace function public.get_pm_dashboard_projects()
  returns json language plpgsql stable security invoker set search_path = public
as $$
begin
  return (
  with flag as materialized (select public.org_reads_erp_ledger() as erp),  -- 0770: the ledger basis is read once, not once per project and column
  pma as materialized (                              -- 2799: the by-category actuals of the caller's own projects, read per project (ledger basis only), not the whole organisation
    select p.id as project_id, a.category, a.mapped, a.has_rows, a.actuals_to_date, a.actuals_as_of, a.source_sum,
           a.tagged_to_date, a.attributed_to_date, a.equipment_charge_to_date
      from public.projects p
      cross join lateral public.project_mapped_actuals(p.id, null) a
     where (select erp from flag) and p.project_manager_id = auth.uid() and p.org_id = public.auth_org_id()
  ),
  pmo_spent as materialized (                         -- 0770: the spent position of the caller's projects in one pass, not one call per project
    select s.project_id, s.spent, s.spent_complete
      from public.project_pmo_positions(coalesce((select array_agg(x.id) from public.projects x where x.project_manager_id = auth.uid() and x.org_id = public.auth_org_id()), '{}')) s
     where not (select erp from flag)
  ),
  billed_work as (
    select si.project_id,si.currency,sum(w.net+w.recovery) as revenue,
      bool_or(w.net is null or w.recovery is null
        or w.net::text in ('NaN','Infinity','-Infinity')
        or w.recovery::text in ('NaN','Infinity','-Infinity')) as incomplete
    from public.sales_invoice_work_billed w
    join public.sales_invoices si on si.id=w.id and si.org_id=w.org_id
    where si.org_id=public.auth_org_id() and si.status in ('Submitted','Unpaid','Paid') and coalesce(si.erp_docstatus,1)<>2
      and si.erp_cancelled_at is null and not w.is_down_payment
    group by si.project_id,si.currency
  ), rows as materialized (
  select p.id,p.name,p.short_name,coalesce(nullif(btrim(c.short_name),''),c.name) as client_name,
    p.contract_value,p.currency,p.status,
    (select sum(li.budgeted_amount) from public.budget_versions v
      join public.budget_line_items li on li.budget_version_id=v.id where v.project_id=p.id and v.status='Active') as budget,
    (select v.currency from public.budget_versions v where v.project_id=p.id and v.status='Active' order by v.version desc,v.created_at desc,v.id desc limit 1) as budget_currency,
    case when (select erp from flag) then (select o.default_currency from public.organizations o where o.id=p.org_id) else p.currency end as actual_currency,
    case when not (select erp from flag) then pmo_spent.spent_complete
      -- 0381 (#1374): no Active budget → the project header's rule: every cost category mapped and read.
      when not exists (select 1 from public.budget_versions v where v.project_id=p.id and v.status='Active') then
        (select count(*) > 0 and bool_and(x.mapped and x.actuals_to_date is not null) from pma x where x.project_id=p.id)
        and coalesce(public.holds_spend_approval_authority(public.auth_role()),false)
      else
      (select count(distinct li.category) > 0 and count(distinct li.category) = count(distinct li.category) filter
        (where exists (select 1 from (select * from pma where pma.project_id=p.id) x
          where x.category=li.category and x.mapped and x.actuals_to_date is not null))
       from public.budget_versions v join public.budget_line_items li on li.budget_version_id=v.id
       where v.project_id=p.id and v.status='Active') end as actual_complete,
    case when (select erp from flag) then
      case when (select o.default_currency=p.currency from public.organizations o where o.id=p.org_id)
        then (select sum(x.actuals_to_date) from (select * from pma where pma.project_id=p.id) x where x.actuals_to_date is not null)
        else null end
      else pmo_spent.spent end as spent,
    (select erp from flag) as ledger_owned,
    case when (select erp from flag) then
      (select count(*)::int from (select * from pma where pma.project_id=p.id) x where x.mapped and x.actuals_to_date is not null)
      else 1 end as actual_coverage_count,
    case when (select erp from flag) then
      (select count(*)::int from (select * from pma where pma.project_id=p.id) x where x.mapped)
      else 1 end as actual_coverage_total,
    (select bw.revenue from billed_work bw where bw.project_id=p.id and bw.currency=p.currency) as billed_revenue,
    (coalesce((select bw.incomplete from billed_work bw where bw.project_id=p.id and bw.currency=p.currency),false)
      or exists (select 1 from billed_work bw where bw.project_id=p.id and bw.currency<>p.currency)) as billed_incomplete
  from public.projects p left join public.companies c on c.id=p.client_id
  left join pmo_spent on pmo_spent.project_id = p.id
  where p.project_manager_id=auth.uid() and p.org_id=public.auth_org_id()
  )
  select coalesce(json_agg(json_build_object(
    'id',p.id,'name',p.name,'short_name',p.short_name,'client_name',p.client_name,
    'contract_value',p.contract_value,'currency',p.currency,'status',p.status,
    'budget',p.budget,'budget_currency',p.budget_currency,'spent',p.spent,
    'actual_currency',p.actual_currency,'actual_complete',p.actual_complete,
    'actual_coverage_count',p.actual_coverage_count,'actual_coverage_total',p.actual_coverage_total,
    'realized_margin',case when p.spent is null or not p.actual_complete or p.actual_currency<>p.currency or p.billed_incomplete then null else coalesce(p.billed_revenue,0)-p.spent end,
    'realized_margin_pct',case when p.spent is null or not p.actual_complete or p.actual_currency<>p.currency or p.billed_incomplete or coalesce(p.billed_revenue,0)<=0 then null
      else (p.billed_revenue-p.spent)/p.billed_revenue end,
    'contract_remaining',case when p.spent is null or not p.actual_complete or p.actual_currency<>p.currency then null else p.contract_value-p.spent end
  ) order by p.name),'[]'::json) from rows p
  );
end $$;
revoke all on function public.get_pm_dashboard_projects() from public;
grant execute on function public.get_pm_dashboard_projects() to authenticated;
revoke execute on function public.get_pm_dashboard_projects() from anon;
