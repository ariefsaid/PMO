-- Reverses 0700 (#1739): the PMO position returns the full ordered..paid purchase total again, and the Projects
-- collection, the executive and PM dashboards and the finance review go back to the 0493 / 0656 bodies.
-- A surface that read 500 spent / 500 committed reads one 1,000 figure again (the defect the issue fixes).

drop function public.project_pmo_spent_position(uuid);

create or replace function public.project_pmo_commitment_position(p_project_id uuid)
returns table(amount numeric, complete boolean)
language sql stable security invoker set search_path = public, pg_catalog as $$
  select coalesce(sum(pr.total_value) filter (where pr.currency = p.currency
      and pr.total_value is not null and pr.total_value::text not in ('NaN','Infinity','-Infinity')),0),
    coalesce(bool_and(coalesce(pr.currency = p.currency,false) and pr.total_value is not null
      and pr.total_value::text not in ('NaN','Infinity','-Infinity')) filter (where pr.id is not null),true)
  from public.projects p left join public.procurements pr on pr.project_id=p.id and pr.org_id=p.org_id
    and pr.status::text=any(public.committed_procurement_statuses())
  where p.id=p_project_id and p.org_id=public.auth_org_id()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
  group by p.id
$$;
revoke all on function public.project_pmo_commitment_position(uuid) from public, anon;
grant execute on function public.project_pmo_commitment_position(uuid) to authenticated;

create or replace function public.get_projects_money_collection(p_project_ids uuid[])
returns table(project_id uuid, actuals jsonb, ledger_basis text, active_budget_amount text, active_budget_currency text, has_active_budget boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role := public.auth_role();
  v_erp boolean;
  v_project_id uuid;
  v_actuals jsonb;
  v_finance_actuals jsonb;
  v_categories_complete boolean;
  v_pmo_amount numeric;
  v_pmo_complete boolean;
begin
  if not public.is_active_member() then
    raise exception 'your account is not an active member of this organisation' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('Admin','Finance','Executive','Project Manager') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_project_ids is null or cardinality(p_project_ids) = 0 or cardinality(p_project_ids) > 500 then
    raise exception 'project selection is invalid' using errcode = '22023';
  end if;
  v_erp := public.org_reads_erp_ledger();

  for v_project_id in
    select distinct requested.id
    from unnest(p_project_ids) requested(id)
    join public.projects p on p.id = requested.id and p.org_id = public.auth_org_id()
    order by requested.id
  loop
    if v_erp then
      v_finance_actuals := public.get_project_finances(v_project_id)->'actuals';
      with pma as materialized (select category, mapped, actuals_to_date from public.project_mapped_actuals(v_project_id,null))
      select coalesce((select count(distinct li.category) > 0 and count(distinct li.category) = count(distinct li.category) filter
                   (where exists (select 1 from pma x
                     where x.category=li.category and x.mapped and x.actuals_to_date is not null))
                   from public.budget_versions b join public.budget_line_items li on li.budget_version_id=b.id
                   where b.project_id=v_project_id and b.status='Active'),false)
        into v_categories_complete;
      v_actuals := jsonb_set(v_finance_actuals,'{complete}',to_jsonb(
        v_categories_complete
        and not coalesce((v_finance_actuals->>'excludes_restricted_rows')::boolean,true)));
    else
      select c.amount, c.complete into v_pmo_amount, v_pmo_complete
      from public.project_pmo_commitment_position(v_project_id) c;
      v_actuals := jsonb_build_object(
        'currency', (select p.currency from public.projects p where p.id = v_project_id),
        'total', v_pmo_amount::text,
        'as_of', null,
        'excludes_restricted_rows', false,
        'complete', v_pmo_complete,
        'categories', '[]'::jsonb);
    end if;

    return query
      select v_project_id,
             v_actuals,
             case when v_erp then 'erp' else 'pmo' end,
             case
               when not exists (
                 select 1 from public.budget_versions b
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
               ) then null
               when exists (
                 select 1 from public.budget_versions b
                 join public.budget_line_items li on li.budget_version_id = b.id and li.org_id = b.org_id
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
                   and (li.budgeted_amount is null or li.budgeted_amount::text in ('NaN','Infinity','-Infinity'))
               ) then null
               else coalesce((
                 select sum(li.budgeted_amount)
                 from public.budget_versions b
                 join public.budget_line_items li on li.budget_version_id = b.id and li.org_id = b.org_id
                 where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
               ), 0::numeric)::text
             end,
             (select b.currency from public.budget_versions b
              where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
              order by b.version desc, b.created_at desc, b.id desc limit 1),
             exists (
               select 1 from public.budget_versions b
               where b.org_id = public.auth_org_id() and b.project_id = v_project_id and b.status = 'Active'
             );
  end loop;
end $$;

revoke all on function public.get_projects_money_collection(uuid[]) from public, anon, authenticated;
grant execute on function public.get_projects_money_collection(uuid[]) to authenticated;

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
      case when not f.erp then pos.complete
        -- 0381 (#1374): no Active budget → the project header's rule: every cost category mapped and read.
        when av.project_id is null then (coalesce(pp.n, 0) > 0 and pp.all_ok) and f.holds
        else coalesce(cc.n > 0 and cc.n = cc.n_ok, false) end as actual_complete,
      case when f.erp then (case when o.default_currency = p.currency then pp.actual_sum else null end)
           else pos.amount end as actual,
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
        or actual_currency is distinct from budget_currency
        or actual_currency is distinct from currency)::int as risk_unchecked_projects
    from delivery_risk_basis
  ),
  attention as (
    select count(*)::int as n from project_money_raw r
    where r.status::text=any(public.active_delivery_project_statuses())
      and r.has_active and r.budget_currency = r.currency and r.actual_complete
      and r.actual / nullif(r.active_budget,0) >= 0.9
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

create or replace function public.get_pm_dashboard_projects()
  returns json language sql stable security invoker set search_path = public
as $$
  with pma as materialized (select * from public.project_mapped_actuals_all(null)),  -- 0376: one org-wide actuals read
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
    case when public.org_reads_erp_ledger() then (select o.default_currency from public.organizations o where o.id=p.org_id) else p.currency end as actual_currency,
    case when not public.org_reads_erp_ledger() then pmo_position.complete
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
    case when public.org_reads_erp_ledger() then
      case when (select o.default_currency=p.currency from public.organizations o where o.id=p.org_id)
        then (select sum(x.actuals_to_date) from (select * from pma where pma.project_id=p.id) x where x.actuals_to_date is not null)
        else null end
      else pmo_position.amount end as spent,
    public.org_reads_erp_ledger() as ledger_owned,
    case when public.org_reads_erp_ledger() then
      (select count(*)::int from (select * from pma where pma.project_id=p.id) x where x.mapped and x.actuals_to_date is not null)
      else 1 end as actual_coverage_count,
    case when public.org_reads_erp_ledger() then
      (select count(*)::int from (select * from pma where pma.project_id=p.id) x where x.mapped)
      else 1 end as actual_coverage_total,
    (select bw.revenue from billed_work bw where bw.project_id=p.id and bw.currency=p.currency) as billed_revenue,
    (coalesce((select bw.incomplete from billed_work bw where bw.project_id=p.id and bw.currency=p.currency),false)
      or exists (select 1 from billed_work bw where bw.project_id=p.id and bw.currency<>p.currency)) as billed_incomplete
  from public.projects p left join public.companies c on c.id=p.client_id
  left join lateral (
    select commitment.amount, commitment.complete
    from public.project_pmo_commitment_position(p.id) commitment
    where not public.org_reads_erp_ledger()
    offset 0 -- Keep the ERP guard ahead of the lateral function scan.
  ) pmo_position on true
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
  ) order by p.name),'[]'::json) from rows p;
$$;
revoke all on function public.get_pm_dashboard_projects() from public;
grant execute on function public.get_pm_dashboard_projects() to authenticated;
revoke execute on function public.get_pm_dashboard_projects() from anon;

create or replace function public.get_finance_budget_review()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with flag as materialized (                         -- 0656: the org's ledger basis is read once, not once per project
    select public.org_reads_erp_ledger() as erp,
           public.holds_spend_approval_authority(public.auth_role()) as holds
  ),
  project_scope as (
    select p.id, p.org_id, p.name, p.status::text as status, p.currency, p.client_id,
      o.default_currency,
      f.erp as ledger_owned
    from public.projects p
    join public.organizations o on o.id = p.org_id
    cross join flag f
  ),
  active_budget as (
    select p.id,
      case
        when count(li.id) filter (where li.budgeted_amount is null
          or li.budgeted_amount::text in ('NaN','Infinity','-Infinity')) > 0 then null::numeric
        else coalesce(sum(li.budgeted_amount), 0::numeric)
      end as budget,
      (select v.currency
         from public.budget_versions v
        where v.org_id = p.org_id and v.project_id = p.id and v.status = 'Active'
        order by v.version desc, v.created_at desc, v.id desc
        limit 1) as budget_currency
    from project_scope p
    left join public.budget_versions v
      on v.org_id = p.org_id and v.project_id = p.id and v.status = 'Active'
    left join public.budget_line_items li
      on li.org_id = v.org_id and li.budget_version_id = v.id
    group by p.id, p.org_id
  ),
  active_budget_categories as (
    select distinct p.id, li.category
    from project_scope p
    join active_budget b on b.id = p.id and b.budget > 0
    join public.budget_versions v
      on v.org_id = p.org_id and v.project_id = p.id and v.status = 'Active'
    join public.budget_line_items li
      on li.org_id = v.org_id and li.budget_version_id = v.id
  ),
  mapped_actual_rows as (                             -- 0656: one org-wide read (row for row the per-project one), only on a ledger basis
    select x.project_id as id, x.category, x.mapped, x.actuals_to_date, x.actuals_as_of
    from public.project_mapped_actuals_all(null) x
    join active_budget b on b.id = x.project_id and b.budget > 0
    where (select erp from flag)
  ),
  erp_actuals as (
    select id,
      max(actuals_as_of) as actual_as_of,
      count(*) filter (where mapped and actuals_to_date is not null)::int as actual_coverage_count,
      count(*) filter (where mapped)::int as actual_coverage_total,
      case
        when count(*) filter (where mapped) = 0
          or count(*) filter (where mapped and actuals_to_date is null) > 0 then null::numeric
        else sum(actuals_to_date) filter (where mapped)
      end as source_total
    from mapped_actual_rows
    group by id
  ),
  erp_completeness as (                               -- every Active-budget category mapped and read
    select required.id,
      coalesce(
        count(required.category) > 0
        and count(ok.category) = count(required.category)
        and (select holds from flag),
        false
      ) as actual_complete
    from active_budget_categories required
    left join (select id, category from mapped_actual_rows where mapped and actuals_to_date is not null) ok
      on ok.id = required.id and ok.category = required.category
    group by required.id
  ),
  committed as (                                      -- 0656: PMO-basis spend, one pass (was a subquery per project)
    select pr.project_id, sum(pr.total_value) as total
    from public.procurements pr
    where pr.status::text = any(public.committed_procurement_statuses())
      and not (select erp from flag)
    group by pr.project_id
  ),
  review_basis as (
    select p.id, p.org_id, p.client_id, p.name, p.status, p.currency,
      b.budget, b.budget_currency,
      case when p.ledger_owned then
        case when coalesce(c.actual_complete, false) and a.source_total is not null
          then a.source_total else null::numeric end
      else coalesce(cm.total, 0::numeric) end as spent,
      case when p.ledger_owned then coalesce(c.actual_complete, false) else true end as actual_complete,
      case when p.ledger_owned then coalesce(a.actual_coverage_count, 0) else 1 end as actual_coverage_count,
      case when p.ledger_owned then coalesce(a.actual_coverage_total, 0) else 1 end as actual_coverage_total,
      case when p.ledger_owned then a.actual_as_of else null::timestamptz end as actual_as_of,
      case when p.ledger_owned then p.default_currency else p.currency end as actual_currency
    from project_scope p
    join active_budget b on b.id = p.id and b.budget > 0
    left join erp_actuals a on a.id = p.id
    left join erp_completeness c on c.id = p.id
    left join committed cm on cm.project_id = p.id
  ),
  review_rows as (
    select b.id, b.name,
      coalesce(nullif(btrim(c.short_name), ''), c.name) as client_name,
      b.status, b.currency, b.budget, b.budget_currency, b.spent,
      case when b.actual_complete and b.spent is not null
        and b.spent::text not in ('NaN','Infinity','-Infinity')
        and b.budget > 0
        and b.currency = b.budget_currency
        and b.currency = b.actual_currency
        then b.spent - b.budget else null::numeric end as variance,
      b.actual_currency, b.actual_complete, b.actual_coverage_count,
      b.actual_coverage_total, b.actual_as_of
    from review_basis b
    left join public.companies c on c.id = b.client_id and c.org_id = b.org_id
  )
  select coalesce((
    select json_agg(row_to_json(r) order by r.variance desc nulls last, r.id)
    from review_rows r
  ), '[]'::json);
$$;
