-- 0656_dashboard_finance_set_based.test.sql
-- AC-PERF-Q12-001: get_executive_dashboard() and get_finance_budget_review() return, byte for byte, what the pre-0656
-- row-per-project bodies returned, for every role, on an ERP-ledger org and on a PMO-basis org.
-- The oracle functions below are the 0322 / 0396+0591 bodies verbatim, renamed; they live only in this transaction.
begin;
select plan(23);

create or replace function public._old_exec_dashboard()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with pma as materialized (select * from public.project_mapped_actuals_all(null)),  -- 0376: one org-wide actuals read
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
      (select sum(li.budgeted_amount)
        from public.budget_versions v join public.budget_line_items li on li.budget_version_id=v.id
        where v.project_id=p.id and v.status='Active') as active_budget,
      (select v.currency from public.budget_versions v where v.project_id=p.id and v.status='Active'
        order by v.version desc,v.created_at desc,v.id desc limit 1) as budget_currency,
      case when public.org_reads_erp_ledger() then (select o.default_currency from public.organizations o where o.id=p.org_id)
        else p.currency end as actual_currency,
      case when not public.org_reads_erp_ledger() then (select complete from public.project_pmo_commitment_position(p.id))
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
          then (select sum(x.actuals_to_date) from (select * from pma where pma.project_id=p.id) x
            where x.actuals_to_date is not null)
          else null end
      else (select amount from public.project_pmo_commitment_position(p.id))
      end as actual,
      case when public.org_reads_erp_ledger() then
        (select count(*)::int from (select * from pma where pma.project_id=p.id) x
          where x.mapped and x.actuals_to_date is not null)
      else 1 end as actual_coverage_count,
      case when public.org_reads_erp_ledger() then
        (select count(*)::int from (select * from pma where pma.project_id=p.id) x where x.mapped)
      else 1 end as actual_coverage_total,
      public.org_reads_erp_ledger() as ledger_owned
    from public.projects p where p.archived_at is null
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
      (select sum(li.budgeted_amount) from public.budget_versions v
        join public.budget_line_items li on li.budget_version_id=v.id
        where v.project_id=p.id and v.status='Active') as active_budget
    from public.projects p where p.status::text=any(public.pipeline_project_statuses()) and p.archived_at is null
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
    select count(*)::int as n from public.projects p
    where p.status::text=any(public.active_delivery_project_statuses()) and p.archived_at is null
      and exists (select 1 from public.budget_versions v where v.project_id=p.id and v.status='Active')
      and (select v.currency=p.currency from public.budget_versions v where v.project_id=p.id and v.status='Active' order by v.version desc,v.created_at desc,v.id desc limit 1)
      and ((not public.org_reads_erp_ledger() and (select complete from public.project_pmo_commitment_position(p.id))) or (public.org_reads_erp_ledger() and
        (select o.default_currency=p.currency from public.organizations o where o.id=p.org_id)
        and (select v.currency=p.currency from public.budget_versions v where v.project_id=p.id and v.status='Active' order by v.version desc limit 1)
        and (select count(distinct li.category) > 0 and count(distinct li.category) = count(distinct li.category) filter
          (where exists (select 1 from (select * from pma where pma.project_id=p.id) x
            where x.category=li.category and x.mapped and x.actuals_to_date is not null))
         from public.budget_versions v join public.budget_line_items li on li.budget_version_id=v.id
         where v.project_id=p.id and v.status='Active')))
      and (case when public.org_reads_erp_ledger() then
        (select sum(x.actuals_to_date) from (select * from pma where pma.project_id=p.id) x where x.actuals_to_date is not null)
        else (select amount from public.project_pmo_commitment_position(p.id)) end)
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
$function$;

create or replace function public._old_finance_review()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with project_scope as (
    select p.id, p.org_id, p.name, p.status::text as status, p.currency, p.client_id,
      o.default_currency,
      public.org_reads_erp_ledger() as ledger_owned
    from public.projects p
    join public.organizations o on o.id = p.org_id
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
  mapped_actual_rows as (
    select p.id, x.category, x.mapped, x.actuals_to_date, x.actuals_as_of
    from project_scope p
    join active_budget b on b.id = p.id and b.budget > 0
    cross join lateral public.project_mapped_actuals(p.id, null) x
    where p.ledger_owned
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
  erp_completeness as (
    select p.id,
      coalesce(
        count(required.category) > 0
        and count(required.category) filter (where exists (
          select 1 from mapped_actual_rows mapped
          where mapped.id = p.id
            and mapped.category = required.category
            and mapped.mapped
            and mapped.actuals_to_date is not null
        )) = count(required.category)
        and public.holds_spend_approval_authority(public.auth_role()),
        false
      ) as actual_complete
    from project_scope p
    join active_budget b on b.id = p.id and b.budget > 0
    left join active_budget_categories required on required.id = p.id
    where p.ledger_owned
    group by p.id
  ),
  review_basis as (
    select p.id, p.org_id, p.client_id, p.name, p.status, p.currency,
      b.budget, b.budget_currency,
      case when p.ledger_owned then
        case when coalesce(c.actual_complete, false) and a.source_total is not null
          then a.source_total else null::numeric end
      else coalesce((
        select sum(pr.total_value)
        from public.procurements pr
        where pr.project_id = p.id
          and pr.status::text = any(public.committed_procurement_statuses())
      ), 0::numeric) end as spent,
      case when p.ledger_owned then coalesce(c.actual_complete, false) else true end as actual_complete,
      case when p.ledger_owned then coalesce(a.actual_coverage_count, 0) else 1 end as actual_coverage_count,
      case when p.ledger_owned then coalesce(a.actual_coverage_total, 0) else 1 end as actual_coverage_total,
      case when p.ledger_owned then a.actual_as_of else null::timestamptz end as actual_as_of,
      case when p.ledger_owned then p.default_currency else p.currency end as actual_currency
    from project_scope p
    join active_budget b on b.id = p.id and b.budget > 0
    left join erp_actuals a on a.id = p.id
    left join erp_completeness c on c.id = p.id
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
$function$;

grant execute on function public._old_exec_dashboard() to authenticated;
grant execute on function public._old_finance_review() to authenticated;

-- Extra shapes in the seeded org (ERP-ledger + snapshots): an Ongoing project with NO Active budget, one whose Active
-- version has no lines, a fully-mapped budget, a foreign-currency budget, an archived project, and a PMO-basis spend row.
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, client_id) values
  ('06560000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Q12 no budget','Ongoing Project','USD',1000,'exclusive',0,'c0000000-0000-0000-0000-000000000002'),
  ('06560000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Q12 empty active','Ongoing Project','USD',2000,'exclusive',0,'c0000000-0000-0000-0000-000000000002'),
  ('06560000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Q12 eur','Ongoing Project','EUR',3000,'exclusive',0,'c0000000-0000-0000-0000-000000000003'),
  ('06560000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','Q12 pipeline','Tender Submitted','USD',4000,'exclusive',0,'c0000000-0000-0000-0000-000000000003'),
  ('06560000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','Q12 archived','Ongoing Project','USD',5000,'exclusive',0,'c0000000-0000-0000-0000-000000000003');
update projects set archived_at = now() where id = '06560000-0000-0000-0000-000000000005';
insert into budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('06560000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000001','06560000-0000-0000-0000-000000000002',1,'empty','Draft','USD'),
  ('06560000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-000000000001','06560000-0000-0000-0000-000000000003',1,'eur','Draft','EUR'),
  ('06560000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-000000000001','06560000-0000-0000-0000-000000000004',1,'pipe','Draft','USD');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount) values
  ('00000000-0000-0000-0000-000000000001','06560000-0000-0000-0000-0000000000c3','Labor','eur',900),
  ('00000000-0000-0000-0000-000000000001','06560000-0000-0000-0000-0000000000c4','Labor','pipe',2500);
update budget_versions set status = 'Active' where id in
  ('06560000-0000-0000-0000-0000000000c2','06560000-0000-0000-0000-0000000000c3','06560000-0000-0000-0000-0000000000c4');
insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('06560000-0000-0000-0000-000000000e01','00000000-0000-0000-0000-000000000001','Q12 PO','Ordered',2400,'06560000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000a3');

-- I-1: the two shapes the first seed could not tell apart. (a) a budgeted project whose ledger is PARTLY read: Labor read,
-- Subcontractors row is NaN (unobtainable), so "every budgeted category read" is false while "some category read" is true.
-- (b) an UNBUDGETED project whose every category is mapped and read (the categories the seed leaves unmapped are
-- mapped here), so the no-budget branch reaches the spend-authority gate.
insert into budget_category_account_map (org_id, category, erp_account, is_push_target) values
  ('00000000-0000-0000-0000-000000000001','Overheads','Q12 Overheads', false),
  ('00000000-0000-0000-0000-000000000001','Special expenses','Q12 Special', false),
  ('00000000-0000-0000-0000-000000000001','Travel & accommodation','Q12 Travel', false),
  ('00000000-0000-0000-0000-000000000001','Vehicle','Q12 Vehicle', false);
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, client_id) values
  ('06560000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','Q12 partly read','Ongoing Project','USD',6000,'exclusive',0,'c0000000-0000-0000-0000-000000000002'),
  ('06560000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','Q12 unbudgeted fully read','Ongoing Project','USD',7000,'exclusive',0,'c0000000-0000-0000-0000-000000000002');
insert into budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('06560000-0000-0000-0000-0000000000c6','00000000-0000-0000-0000-000000000001','06560000-0000-0000-0000-000000000006',1,'partly','Draft','USD');
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount) values
  ('00000000-0000-0000-0000-000000000001','06560000-0000-0000-0000-0000000000c6','Labor','partly',800),
  ('00000000-0000-0000-0000-000000000001','06560000-0000-0000-0000-0000000000c6','Subcontractors','partly',700);
update budget_versions set status = 'Active' where id = '06560000-0000-0000-0000-0000000000c6';
insert into erp_actuals_snapshot (org_id, project_id, account, fiscal_year, debit, credit, net, as_of, snapshot_id) values
  ('00000000-0000-0000-0000-000000000001','06560000-0000-0000-0000-000000000006','Salary - PSC','2026',300,0,300, now() - interval '1 day','5a000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001','06560000-0000-0000-0000-000000000006','Subcontractor Costs - PSC','2026',0,0,'NaN', now() - interval '1 day','5a000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001','06560000-0000-0000-0000-000000000007','Salary - PSC','2026',200,0,200, now() - interval '1 day','5a000000-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.get_executive_dashboard()::text, public._old_exec_dashboard()::text, 'AC-PERF-Q12-001 dashboard identical: Executive, ERP-ledger org');
select is(public.get_finance_budget_review()::text, public._old_finance_review()::text, 'AC-PERF-Q12-001 finance review identical: Executive, ERP-ledger org');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.get_executive_dashboard()::text, public._old_exec_dashboard()::text, 'AC-PERF-Q12-001 dashboard identical: Project Manager, ERP-ledger org');
select is(public.get_finance_budget_review()::text, public._old_finance_review()::text, 'AC-PERF-Q12-001 finance review identical: Project Manager, ERP-ledger org');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(public.get_executive_dashboard()::text, public._old_exec_dashboard()::text, 'AC-PERF-Q12-001 dashboard identical: Finance, ERP-ledger org');
select is(public.get_finance_budget_review()::text, public._old_finance_review()::text, 'AC-PERF-Q12-001 finance review identical: Finance, ERP-ledger org');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(public.get_executive_dashboard()::text, public._old_exec_dashboard()::text, 'AC-PERF-Q12-001 dashboard identical: Engineer, ERP-ledger org');
select is(public.get_finance_budget_review()::text, public._old_finance_review()::text, 'AC-PERF-Q12-001 finance review identical: Engineer, ERP-ledger org');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(public.get_executive_dashboard()::text, public._old_exec_dashboard()::text, 'AC-PERF-Q12-001 dashboard identical: Admin, ERP-ledger org');
select is(public.get_finance_budget_review()::text, public._old_finance_review()::text, 'AC-PERF-Q12-001 finance review identical: Admin, ERP-ledger org');
reset role;

-- Non-vacuity of the new shapes (ledger basis): the partly-read project is listed with incomplete actuals.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select ok((select bool_or(not (e->>'actual_complete')::boolean) from json_array_elements(public.get_finance_budget_review()) e
  where e->>'id' = '06560000-0000-0000-0000-000000000006'), 'AC-PERF-Q12-001 partly-read project reports incomplete actuals');
reset role;

-- PMO-basis org: the same org with its ERP binding disconnected.
update external_org_bindings set status = 'disconnected' where org_id = '00000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.get_executive_dashboard()::text, public._old_exec_dashboard()::text, 'AC-PERF-Q12-001 dashboard identical: Executive, PMO-basis org');
select is(public.get_finance_budget_review()::text, public._old_finance_review()::text, 'AC-PERF-Q12-001 finance review identical: Executive, PMO-basis org');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.get_executive_dashboard()::text, public._old_exec_dashboard()::text, 'AC-PERF-Q12-001 dashboard identical: Project Manager, PMO-basis org');
select is(public.get_finance_budget_review()::text, public._old_finance_review()::text, 'AC-PERF-Q12-001 finance review identical: Project Manager, PMO-basis org');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(public.get_executive_dashboard()::text, public._old_exec_dashboard()::text, 'AC-PERF-Q12-001 dashboard identical: Finance, PMO-basis org');
select is(public.get_finance_budget_review()::text, public._old_finance_review()::text, 'AC-PERF-Q12-001 finance review identical: Finance, PMO-basis org');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is(public.get_executive_dashboard()::text, public._old_exec_dashboard()::text, 'AC-PERF-Q12-001 dashboard identical: Engineer, PMO-basis org');
select is(public.get_finance_budget_review()::text, public._old_finance_review()::text, 'AC-PERF-Q12-001 finance review identical: Engineer, PMO-basis org');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(public.get_executive_dashboard()::text, public._old_exec_dashboard()::text, 'AC-PERF-Q12-001 dashboard identical: Admin, PMO-basis org');
select is(public.get_finance_budget_review()::text, public._old_finance_review()::text, 'AC-PERF-Q12-001 finance review identical: Admin, PMO-basis org');
reset role;

-- The oracle is not vacuous: the finance review lists the seeded budgets and the dashboard counts delivery projects.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select ok(json_array_length(public.get_finance_budget_review()) >= 5, 'AC-PERF-Q12-001 finance review has rows to compare');
select ok((public.get_executive_dashboard()->>'active_delivery_projects')::int >= 5, 'AC-PERF-Q12-001 dashboard has delivery projects to compare');
select * from finish();
rollback;
