-- Rollback to the prior executive dashboard RPC definition.
begin;
create or replace function public.get_executive_dashboard()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with active as (
    select * from public.projects where status = 'Ongoing Project'
  ),
  billed_work as (
    select si.project_id,si.currency,sum(w.net+w.recovery) as revenue,
      count(*) filter(where w.net is null or w.recovery is null
        or w.net::text in ('NaN','Infinity','-Infinity')
        or w.recovery::text in ('NaN','Infinity','-Infinity'))::int as missing_work
    from public.sales_invoice_work_billed w
    join public.sales_invoices si on si.id=w.id and si.org_id=w.org_id
    where si.org_id=public.auth_org_id() and si.status in ('Submitted','Unpaid','Paid')
      and coalesce(si.erp_docstatus,1)<>2 and si.erp_cancelled_at is null and not w.is_down_payment
    group by si.project_id,si.currency
  ),
  project_money_raw as (
    select p.id, p.org_id, p.name, p.status, p.currency, p.contract_value,
      (select sum(li.budgeted_amount)
        from public.budget_versions v join public.budget_line_items li on li.budget_version_id=v.id
        where v.project_id=p.id and v.status='Active') as active_budget,
      (select v.currency from public.budget_versions v where v.project_id=p.id and v.status='Active'
        order by v.version desc,v.created_at desc,v.id desc limit 1) as budget_currency,
      case when public.org_reads_erp_ledger() then (select o.default_currency from public.organizations o where o.id=p.org_id)
        else p.currency end as actual_currency,
      case when not public.org_reads_erp_ledger() then true else
        (select count(distinct li.category) > 0 and count(distinct li.category) = count(distinct li.category) filter
          (where exists (select 1 from public.project_mapped_actuals(p.id,null) x
            where x.category=li.category and x.mapped and x.actuals_to_date is not null))
         from public.budget_versions v join public.budget_line_items li on li.budget_version_id=v.id
         where v.project_id=p.id and v.status='Active') end as actual_complete,
      case when public.org_reads_erp_ledger() then
        case when (select o.default_currency=p.currency from public.organizations o where o.id=p.org_id)
          then (select sum(x.actuals_to_date) from public.project_mapped_actuals(p.id,null) x
            where x.actuals_to_date is not null)
          else null end
      else coalesce((select sum(pr.total_value) from public.procurements pr
        where pr.project_id=p.id and pr.status::text=any(public.committed_procurement_statuses())),0)
      end as actual,
      case when public.org_reads_erp_ledger() then
        (select count(*)::int from public.project_mapped_actuals(p.id,null) x
          where x.mapped and x.actuals_to_date is not null)
      else 1 end as actual_coverage_count,
      case when public.org_reads_erp_ledger() then
        (select count(*)::int from public.project_mapped_actuals(p.id,null) x where x.mapped)
      else 1 end as actual_coverage_total,
      public.org_reads_erp_ledger() as ledger_owned
    from public.projects p
  ),
  project_money as (
    select r.*,
      case when r.actual is null or not r.actual_complete or r.actual_currency <> r.currency
        or not exists (select 1 from billed_work b where b.project_id=r.id and b.currency=r.currency)
        or coalesce((select b.missing_work from billed_work b where b.project_id=r.id and b.currency=r.currency),0)>0 then null
        else coalesce((select b.revenue from billed_work b where b.project_id=r.id and b.currency=r.currency),0)-r.actual
      end as realized_margin
    from project_money_raw r
  ),
  on_hand as (
    select p.* from project_money p where p.status::text=any(public.on_hand_project_statuses())
  ),
  on_hand_currency as (
    select currency, sum(contract_value) as contract_value,
      sum(actual) filter(where actual_currency=currency) as actual_known,
      sum(contract_value - actual) filter(where actual_currency=currency) as contract_remaining,
      sum(actual_coverage_count) as actual_coverage_count,
      sum(actual_coverage_total) as actual_coverage_total,
      count(*) filter (where actual is not null and actual_complete and actual_currency=currency) as actual_project_count,
      count(*) as actual_project_total,
      sum(realized_margin) as realized_margin_known,
      count(*) filter (where actual is null or not actual_complete or actual_currency<>currency or realized_margin is null) as unknown_projects
    from on_hand group by currency
  ),
  pipeline as (
    select p.*, coalesce((select c.win_probability from public.pipeline_stage_config c where c.status=p.status),0) as win_prob,
      (select sum(li.budgeted_amount) from public.budget_versions v
        join public.budget_line_items li on li.budget_version_id=v.id
        where v.project_id=p.id and v.status='Active') as active_budget
    from public.projects p where p.status::text=any(public.pipeline_project_statuses())
  ),
  pipeline_currency as (
    select currency, sum(contract_value) as total_value,
      sum(contract_value*win_prob) as weighted_value,
      sum(case when active_budget > 0 then contract_value-active_budget else null end) as forecast_margin,
      count(*) filter(where active_budget is null or active_budget<=0) as no_active_budget
    from pipeline group by currency
  ),
  active_currency as (select currency,sum(contract_value) as contract_value from active group by currency),
  attention as (
    select count(*)::int as n from public.projects p
    where p.status::text=any(public.active_delivery_project_statuses())
      and exists (select 1 from public.budget_versions v where v.project_id=p.id and v.status='Active')
      and (not public.org_reads_erp_ledger() or (
        (select o.default_currency=p.currency from public.organizations o where o.id=p.org_id)
        and (select v.currency=p.currency from public.budget_versions v where v.project_id=p.id and v.status='Active' order by v.version desc limit 1)
        and (select count(distinct li.category) > 0 and count(distinct li.category) = count(distinct li.category) filter
          (where exists (select 1 from public.project_mapped_actuals(p.id,null) x
            where x.category=li.category and x.mapped and x.actuals_to_date is not null))
         from public.budget_versions v join public.budget_line_items li on li.budget_version_id=v.id
         where v.project_id=p.id and v.status='Active')))
      and (case when public.org_reads_erp_ledger() then
        (select sum(x.actuals_to_date) from public.project_mapped_actuals(p.id,null) x where x.actuals_to_date is not null)
        else coalesce((select sum(pr.total_value) from public.procurements pr
          where pr.project_id=p.id and pr.status::text=any(public.committed_procurement_statuses())),0) end)
        / nullif((select sum(li.budgeted_amount) from public.budget_versions v
          join public.budget_line_items li on li.budget_version_id=v.id
          where v.project_id=p.id and v.status='Active'),0) >= 0.9
  )
  select json_build_object(
    'active_projects',(select count(*) from active),
    'total_contract_value',case when (select count(*) from active_currency)<=1
      then (select sum(contract_value) from active_currency) else null end,
    'total_contract_value_by_currency',coalesce((select json_object_agg(currency,contract_value) from active_currency),'{}'::json),
    'on_hand_value',case when (select count(*) from on_hand_currency)<=1
      then (select sum(contract_value) from on_hand_currency) else null end,
    'on_hand_value_by_currency',coalesce((select json_agg(to_jsonb(c) order by currency) from on_hand_currency c),'[]'::json),
    'on_hand_contract_remaining',case when (select count(*) from on_hand_currency)<=1
      then (select sum(contract_remaining) from on_hand_currency) else null end,
    'on_hand_margin',case when (select count(*) from on_hand_currency)=0 then 0
      when (select count(*) from on_hand_currency)=1
      then (select case when contract_value<>0 then contract_remaining/contract_value else null end from on_hand_currency)
      else null end,
    'on_hand_realized_margin',case when (select count(*) from on_hand_currency)<=1 then (select sum(realized_margin_known) from on_hand_currency) else null end,
    'on_hand_realized_margin_by_currency',coalesce((select json_agg(json_build_object('currency',currency,'known_amount',realized_margin_known,'unknown_projects',unknown_projects) order by currency) from on_hand_currency),'[]'::json),
    'on_hand_actual_known',case when (select count(*) from on_hand_currency)<=1 then (select actual_known from on_hand_currency) else null end,
    'on_hand_actual_project_count',coalesce((select sum(actual_project_count) from on_hand_currency),0),
    'on_hand_actual_project_total',coalesce((select sum(actual_project_total) from on_hand_currency),0),
    'on_hand_actual_coverage_count',coalesce((select sum(actual_coverage_count) from on_hand_currency),0),
    'on_hand_actual_coverage_total',coalesce((select sum(actual_coverage_total) from on_hand_currency),0),
    'pipeline_total_value',case when (select count(*) from pipeline_currency)<=1 then (select sum(total_value) from pipeline_currency) else null end,
    'pipeline_total_value_by_currency',coalesce((select json_agg(to_jsonb(c) order by currency) from pipeline_currency c),'[]'::json),
    'pipeline_weighted_value',case when (select count(*) from pipeline_currency)=0 then 0 when (select count(*) from pipeline_currency)=1 then (select sum(weighted_value) from pipeline_currency) else null end,
    'pipeline_projected_margin',case when (select count(*) from pipeline_currency)=0 then 0 when (select count(*) from pipeline_currency)=1 and (select no_active_budget from pipeline_currency)=0 then (select sum(forecast_margin)/nullif(sum(total_value),0) from pipeline_currency) else null end,
    'projects_at_risk',(select n from attention),
    'projects_by_status',coalesce((select json_agg(json_build_object('status',status,'count',c) order by status)
      from (select status,count(*) c from public.projects group by status) s),'[]'::json),
    'procurements_by_status',coalesce((select json_agg(json_build_object('status',status,'count',c) order by status)
      from (select status,count(*) c from public.procurements group by status) s),'[]'::json),
    'top_projects',coalesce((select json_agg(t order by t.contract_value desc) from (
      select p.id,p.name,coalesce(nullif(btrim(c.short_name),''),c.name) as client_name,
        p.contract_value,p.currency,p.active_budget as budget,p.budget_currency,p.actual as spent,
        p.actual_currency,p.actual_complete,p.actual_coverage_count,p.actual_coverage_total,p.realized_margin,p.status
      from project_money p left join public.companies c on c.id=(select pr.client_id from public.projects pr where pr.id=p.id)
      where p.status::text = any(public.on_hand_project_statuses()) or p.status::text = 'Internal Project'
      order by p.contract_value desc limit 5
    ) t),'[]'::json)
  );
$$;
revoke all on function public.get_executive_dashboard() from public;
grant execute on function public.get_executive_dashboard() to authenticated;
revoke execute on function public.get_executive_dashboard() from anon;
commit;
