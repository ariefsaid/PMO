-- Reverses 0732 (#1418): get_executive_dashboard returns to its 0700 body — attention_projects is gone and the
-- Delivery list reads the five largest contracts again (re-sorted in the browser). Owner and grants unchanged.
-- The executive dashboard (0656 body): the PMO Actual is the spent position; the open commitment is added only
-- where the surface means budget consumption (the at-risk rule), and "checkable" now needs both figures.
create or replace function public.get_executive_dashboard()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with flag as materialized (                         -- 0656: the org's ledger basis is read once, not once per project and column
    select public.org_reads_erp_ledger() as erp,
           coalesce(public.holds_spend_approval_authority(public.auth_role()), false) as holds
  ),
  pma as materialized (                               -- 0376: one org-wide actuals read; 0656: only when the ledger is the basis
    select * from public.project_mapped_actuals_all(null) where (select erp from flag)
  ),
  pma_p as (
    select project_id, count(*) as n, bool_and(mapped and actuals_to_date is not null) as all_ok,
      sum(actuals_to_date) as actual_sum,
      (count(*) filter (where mapped and actuals_to_date is not null))::int as cov_count,
      (count(*) filter (where mapped))::int as cov_total
    from pma group by project_id
  ),
  av as (                                             -- latest Active budget version per project (its currency)
    select distinct on (v.project_id) v.project_id, v.currency as budget_currency
    from public.budget_versions v where v.status = 'Active'
    order by v.project_id, v.version desc, v.created_at desc, v.id desc
  ),
  ab as (
    select v.project_id, sum(li.budgeted_amount) as active_budget
    from public.budget_versions v join public.budget_line_items li on li.budget_version_id = v.id
    where v.status = 'Active' group by v.project_id
  ),
  cat_cov as (                                        -- Active-budget categories vs. mapped, read ledger categories
    select r.project_id, count(r.category) as n, count(ok.category) as n_ok
    from (select distinct v.project_id, li.category
            from public.budget_versions v join public.budget_line_items li on li.budget_version_id = v.id
           where v.status = 'Active') r
    left join (select project_id, category from pma where mapped and actuals_to_date is not null) ok
      on ok.project_id = r.project_id and ok.category = r.category
    group by r.project_id
  ),
  active as (
    select * from public.projects where status = 'Ongoing Project' and archived_at is null
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
      ab.active_budget, av.budget_currency, (av.project_id is not null) as has_active,
      case when f.erp then o.default_currency else p.currency end as actual_currency,
      case when not f.erp then sp.complete
        -- 0381 (#1374): no Active budget → the project header's rule: every cost category mapped and read.
        when av.project_id is null then (coalesce(pp.n, 0) > 0 and pp.all_ok) and f.holds
        else coalesce(cc.n > 0 and cc.n = cc.n_ok, false) end as actual_complete,
      case when f.erp then (case when o.default_currency = p.currency then pp.actual_sum else null end)
           else sp.amount end as actual,
      case when f.erp then null else pos.amount end as committed,
      case when f.erp then true else coalesce(pos.complete, false) end as committed_complete,
      case when f.erp then coalesce(pp.cov_count, 0) else 1 end as actual_coverage_count,
      case when f.erp then coalesce(pp.cov_total, 0) else 1 end as actual_coverage_total,
      f.erp as ledger_owned
    from public.projects p
    cross join flag f
    left join public.organizations o on o.id = p.org_id
    left join av on av.project_id = p.id
    left join ab on ab.project_id = p.id
    left join pma_p pp on pp.project_id = p.id
    left join cat_cov cc on cc.project_id = p.id
    left join lateral (                               -- once per project, only for a PMO-basis org (ERP guard first)
      select c.amount, c.complete from public.project_pmo_commitment_position(p.id) c
      where not f.erp offset 0
    ) pos on true
    left join lateral (                               -- 0700: the PMO spent position, the Budget tab's Spent basis
      select s.amount, s.complete from public.project_pmo_spent_position(p.id) s
      where not f.erp offset 0
    ) sp on true
    where p.archived_at is null
  ),
  project_money as (
    select r.*,
      case when r.actual is null or not r.actual_complete or r.actual_currency <> r.currency
        or not exists (select 1 from billed_work b where b.project_id=r.id and b.currency=r.currency)
        or coalesce((select b.missing_work from billed_work b where b.project_id=r.id and b.currency=r.currency),0)>0 then null
        else coalesce((select b.revenue from billed_work b where b.project_id=r.id and b.currency=r.currency),0)-r.actual
      end as realized_margin,
      case when r.actual is null or not r.actual_complete or r.actual_currency <> r.currency
        or not exists (select 1 from billed_work b where b.project_id=r.id and b.currency=r.currency)
        or coalesce((select b.missing_work from billed_work b where b.project_id=r.id and b.currency=r.currency),0)>0 then null
        else coalesce((select b.revenue from billed_work b where b.project_id=r.id and b.currency=r.currency),0)
      end as known_billed_revenue
    from project_money_raw r
  ),
  on_hand as (
    select p.* from project_money p where p.status::text=any(public.on_hand_project_statuses())
  ),
  on_hand_currency as (
    select currency, sum(contract_value) as contract_value,
      sum(actual) filter(where actual_currency=currency and actual_complete) as actual_known,
      sum(contract_value - actual) filter(where actual_currency=currency and actual_complete) as contract_remaining,
      sum(actual_coverage_count) as actual_coverage_count,
      sum(actual_coverage_total) as actual_coverage_total,
      count(*) filter (where actual is not null and actual_complete and actual_currency=currency) as actual_project_count,
      count(*) as actual_project_total,
      sum(realized_margin) as realized_margin_known,
      sum(known_billed_revenue) as known_billed_revenue,
      count(*) filter (where actual is null or not actual_complete or actual_currency<>currency or realized_margin is null) as unknown_projects
    from on_hand group by currency
  ),
  pipeline as (
    select p.*, coalesce((select c.win_probability from public.pipeline_stage_config c where c.status=p.status),0) as win_prob,
      ab.active_budget
    from public.projects p left join ab on ab.project_id = p.id
    where p.status::text=any(public.pipeline_project_statuses()) and p.archived_at is null
  ),
  pipeline_currency as (
    select currency, sum(contract_value) as total_value,
      sum(contract_value*go_probability*get_probability) as weighted_value,
      sum(case when active_budget > 0 then contract_value-active_budget else null end) as forecast_margin,
      count(*) filter(where active_budget is null or active_budget<=0) as no_active_budget
    from pipeline group by currency
  ),
  active_currency as (select currency,sum(contract_value) as contract_value from active group by currency),
  delivery_risk_basis as (
    select p.* from project_money_raw p
    where p.status::text = any(public.active_delivery_project_statuses())
  ),
  delivery_risk_summary as (
    select count(*)::int as active_delivery_projects,
      count(*) filter (where actual is not null and actual_complete and actual_currency=currency)::int as active_delivery_actual_project_count,
      count(*)::int as active_delivery_actual_project_total,
      coalesce(sum(actual_coverage_count),0)::int as active_delivery_actual_coverage_count,
      coalesce(sum(actual_coverage_total),0)::int as active_delivery_actual_coverage_total,
      count(*) filter (where active_budget is null or active_budget <= 0
        or not actual_complete or actual is null
        or not committed_complete
        or actual_currency is distinct from budget_currency
        or actual_currency is distinct from currency)::int as risk_unchecked_projects
    from delivery_risk_basis
  ),
  attention as (
    select count(*)::int as n from project_money_raw r
    where r.status::text=any(public.active_delivery_project_statuses())
      and r.has_active and r.budget_currency = r.currency and r.actual_complete and r.committed_complete
      -- 0700: budget consumption. A PMO-basis figure is spent + open commitment (one order total, never twice);
      -- a ledger org keeps its ledger Actual. A NULL either side leaves the ratio NULL, i.e. not at risk.
      and (case when r.ledger_owned then r.actual else r.actual + r.committed end)
        / nullif(r.active_budget,0) >= 0.9
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
    'on_hand_realized_margin_by_currency',coalesce((select json_agg(json_build_object('currency',currency,'known_amount',realized_margin_known,'known_billed_revenue',known_billed_revenue,'unknown_projects',unknown_projects) order by currency) from on_hand_currency),'[]'::json),
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
    'active_delivery_projects',(select active_delivery_projects from delivery_risk_summary),
    'active_delivery_actual_project_count',(select active_delivery_actual_project_count from delivery_risk_summary),
    'active_delivery_actual_project_total',(select active_delivery_actual_project_total from delivery_risk_summary),
    'active_delivery_actual_coverage_count',(select active_delivery_actual_coverage_count from delivery_risk_summary),
    'active_delivery_actual_coverage_total',(select active_delivery_actual_coverage_total from delivery_risk_summary),
    'risk_unchecked_projects',(select risk_unchecked_projects from delivery_risk_summary),
    'projects_by_status',coalesce((select json_agg(json_build_object('status',status,'count',c) order by status)
      from (select status,count(*) c from public.projects where archived_at is null group by status) s),'[]'::json),
    'procurements_by_status',coalesce((select json_agg(json_build_object('status',status,'count',c) order by status)
      from (select status,count(*) c from public.procurements group by status) s),'[]'::json),
    'top_projects',coalesce((select json_agg(t order by t.contract_value desc) from (
      select p.id,p.name,coalesce(nullif(btrim(c.short_name),''),c.name) as client_name,
        p.contract_value,p.currency,p.active_budget as budget,p.budget_currency,p.actual as spent,
        p.committed,p.committed_complete,
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
