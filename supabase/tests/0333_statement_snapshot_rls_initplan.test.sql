-- AC-003/AC-006: statement snapshot reads stay set-based at publication volume.
-- The snapshot read policy must resolve the caller's org, membership and role once per
-- statement, not once per row, so the catalogue stays inside the API statement budget.
begin;
create extension if not exists pgtap;
select no_plan();

insert into public.organizations(id,name,default_currency,default_timezone) values
 ('03330000-0000-0000-0000-000000000001','Synthetic statement volume org','IDR','UTC');
insert into auth.users(id,email) values
 ('03330000-0000-0000-0000-0000000000a1','statement-volume-admin@example.test'),
 ('03330000-0000-0000-0000-0000000000a2','statement-volume-pm@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('03330000-0000-0000-0000-0000000000a2','03330000-0000-0000-0000-000000000001','Synthetic PM','statement-volume-pm@example.test','Project Manager','active'),
 ('03330000-0000-0000-0000-0000000000a1','03330000-0000-0000-0000-000000000001','Synthetic Admin','statement-volume-admin@example.test','Admin','active');
insert into public.projects
 (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
  tax_base_numerator,tax_base_denominator,subject_to_vat)
select ('03330000-0000-0000-0000-0000000d'||lpad(g::text,4,'0'))::uuid,'03330000-0000-0000-0000-000000000001',
  'Synthetic project '||g,'Ongoing Project','IDR',1000,'exclusive',0,0,1,1,false
from generate_series(1,34) g;
insert into public.external_org_bindings
 (id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at,
  statement_full_ledger_replay_needed,statement_update_delayed,statement_calendar)
select '03330000-0000-0000-0000-000000000001','03330000-0000-0000-0000-000000000001','erpnext','https://synthetic.invalid','fixture',16,
  jsonb_build_object('company','Synthetic Volume Co','project_map',
    (select jsonb_object_agg(('03330000-0000-0000-0000-0000000d'||lpad(g::text,4,'0')),'Synthetic ERP '||g) from generate_series(1,34) g)),
  '2024-01-01T00:00:00Z',false,false,'[{"start":"2024-01-01","end":"2024-12-31"},{"start":"2025-01-01","end":"2025-12-31"}]';
-- One publication: 24 months + 10 quarters + 2 fiscal years; per period company TB/PL/BS,
-- unassigned PL, and per mapped project a PL breakdown plus totals (36 x 72 = 2,592 rows).
with periods(kind,cs,ce,ps,pe) as (
  select 'month',d::date,(d+interval '1 month'-interval '1 day')::date,(d-interval '1 month')::date,(d-interval '1 day')::date
    from generate_series('2024-01-01'::date,'2025-12-01'::date,interval '1 month') d
  union all
  select 'quarter',d::date,(d+interval '3 month'-interval '1 day')::date,(d-interval '3 month')::date,(d-interval '1 day')::date
    from generate_series('2023-07-01'::date,'2025-10-01'::date,interval '3 month') d
  union all
  select 'fiscal_year',d::date,(d+interval '1 year'-interval '1 day')::date,(d-interval '1 year')::date,(d-interval '1 day')::date
    from generate_series('2024-01-01'::date,'2025-01-01'::date,interval '1 year') d
), shapes(statement,scope_kind,project_id,view_kind) as (
  values ('trial_balance','company',null::uuid,'account_breakdown'),('profit_and_loss','company',null,'account_breakdown'),
         ('balance_sheet','company',null,'account_breakdown'),('profit_and_loss','unassigned',null,'account_breakdown')
  union all
  select 'profit_and_loss','project',('03330000-0000-0000-0000-0000000d'||lpad(g::text,4,'0'))::uuid,v
    from generate_series(1,34) g cross join (values ('account_breakdown'),('project_totals')) v(v)
), body as (
  select jsonb_build_object('rows',(select jsonb_agg(jsonb_build_object('key','A'||i,'accountName','Synthetic account '||i,
    'current',(i*7)::text,'prior',(i*3)::text)) from generate_series(1,40) i)) b
)
insert into public.erp_financial_statement_snapshot
 (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
  current_start,current_end,prior_start,prior_end,currency,as_of,source_report,report_version,filters,
  settings,payload,raw_reports,has_activity,display_precision,display_rounding_method,
  capture_started_at,capture_completed_at,published_at)
select '03330000-0000-0000-0000-000000000001','Synthetic Volume Co','03330000-0000-0000-0000-000000000101',
  '03330000-0000-0000-0000-000000000201',s.statement,s.scope_kind,s.project_id,s.view_kind,p.kind,
  p.cs,p.ce,p.ps,p.pe,'IDR','2026-01-02T00:00:00Z',
  case when s.view_kind='account_breakdown' then 'Synthetic Report' end,
  case when s.view_kind='account_breakdown' then '16.33.0' end,
  case when s.view_kind='account_breakdown' then '{"current":{},"prior":{}}'::jsonb end,
  case when s.view_kind='account_breakdown' then '{"precision":2}'::jsonb end,
  case when s.view_kind='account_breakdown' then jsonb_build_object('current',body.b,'prior',body.b)
       else '{"current":{"income":"7","expense":"3","net":"4"},"prior":{"income":"0","expense":"0","net":"0"}}'::jsonb end,
  case when s.view_kind='account_breakdown' then jsonb_build_object('current',body.b::text,'prior',body.b::text) end,
  true,2,'Commercial Rounding','2026-01-01T00:00:00Z','2026-01-01T23:00:00Z','2026-01-02T00:00:00Z'
from periods p cross join shapes s cross join body;
analyze public.erp_financial_statement_snapshot;

-- Returns the RLS filter text the planner attaches to every snapshot scan node in the
-- given query's plan, so a test can prove which predicates run per row.
create function pg_temp.snapshot_scan_filters(p_query text)
returns text[]
language plpgsql
as $$
declare
  v_plan jsonb;
begin
  execute 'explain (format json) '||p_query into v_plan;
  return coalesce((
    select array_agg(coalesce(node->>'Filter','')||' '||coalesce(node->>'Join Filter',''))
    from jsonb_path_query(v_plan,'strict $.**') node
    where jsonb_typeof(node)='object'
      and node->>'Relation Name'='erp_financial_statement_snapshot'
  ),'{}');
end;
$$;
grant execute on function pg_temp.snapshot_scan_filters(text) to authenticated;

set local role authenticated;
set local request.jwt.claims='{"sub":"03330000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select ok(cardinality(pg_temp.snapshot_scan_filters('select * from public.erp_financial_statement_snapshot'))>0
  and not exists(select 1 from unnest(pg_temp.snapshot_scan_filters('select * from public.erp_financial_statement_snapshot')) f
    where f ~ '(auth_org_id|is_active_member|auth_role)\(\)'),
  'AC-003 Admin snapshot scan evaluates org, membership and role once per statement, not per row');
select ok(cardinality(pg_temp.snapshot_scan_filters($q$select s.id from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id
     and s.org_id='03330000-0000-0000-0000-000000000001'$q$))>0
  and not exists(select 1 from unnest(pg_temp.snapshot_scan_filters($q$select s.id from public.erp_financial_statement_availability a
    join public.erp_financial_statement_snapshot s on s.snapshot_id=a.snapshot_id
     and s.org_id='03330000-0000-0000-0000-000000000001'$q$)) f
    where f ~ '(auth_org_id|is_active_member|auth_role)\(\)'),
  'AC-006 catalogue-shaped availability join keeps auth helpers out of the per-row snapshot filter');

select is(public.get_financial_statement_catalogue()->>'state','complete',
  'AC-006 Admin catalogue is complete at publication volume');
select is(jsonb_array_length(public.get_financial_statement_catalogue()->'periods'),36,
  'AC-007 Admin catalogue lists every published period at volume');
select is(jsonb_array_length(public.get_financial_statement_catalogue()->'scopes'),35,
  'AC-006 Admin catalogue lists the company scope and every mapped project scope at volume');
select is(public.get_financial_statement('month','2025-06-01','trial_balance')->>'state','complete',
  'AC-006 Admin trial balance read is complete at publication volume');
select is((select count(*)::int from public.erp_financial_statement_snapshot),2592,
  'AC-003 Admin reads every same-org publication row at volume');

set local request.jwt.claims='{"sub":"03330000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select ok(cardinality(pg_temp.snapshot_scan_filters('select * from public.erp_financial_statement_snapshot'))>0
  and not exists(select 1 from unnest(pg_temp.snapshot_scan_filters('select * from public.erp_financial_statement_snapshot')) f
    where f ~ '(auth_org_id|is_active_member|auth_role)\(\)'),
  'AC-003 project-staff snapshot scan evaluates auth helpers once per statement, not per row');
select is((select count(*)::int from public.erp_financial_statement_snapshot),36*34,
  'AC-003 Project Manager reads only project totals rows at volume');
select is((select count(*)::int from public.erp_financial_statement_snapshot where view_kind<>'project_totals'),0,
  'AC-003 Project Manager reads no account-detail rows at volume');
select is(public.get_financial_statement_catalogue('03330000-0000-0000-0000-0000000d0001')->>'state','complete',
  'AC-004 Project Manager project catalogue is complete at volume');

select * from finish();
rollback;
