-- #1931: a change-driven nightly or "Refresh now" pass refetches every planned period (FR-CD-003/004);
-- the 0332 retained-period plan applies only to the legacy path, a first publication and a disabled
-- state. Off by default: no pass cut, a disabled state or a mismatched binding activation never forces
-- the full plan, so the per-org enable flag alone keeps today's behaviour.
begin;
create extension if not exists pgtap;
select no_plan();

insert into public.organizations(id,name,default_currency,default_timezone) values
 ('06970000-0000-0000-0000-000000000001','Refetch fixture org','IDR','UTC');
set local role service_role;
insert into public.external_org_bindings
 (id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at,statement_calendar)
values ('06970000-0000-0000-0000-000000000011','06970000-0000-0000-0000-000000000001','erpnext',
        'https://example.invalid','refetch-fixture',16,
        '{"company":"Native Test Co","project_map":{}}','2026-10-18T09:00:00Z',
        '[{"name":"FY24-25","start":"2024-07-01","end":"2025-06-30"},'
          '{"name":"FY25-26","start":"2025-07-01","end":"2026-06-30"}]');
insert into public.erp_sweep_lock(org_id,locked_until,holder)
values ('06970000-0000-0000-0000-000000000001',clock_timestamp()+interval '60 minutes',
        '06970000-0000-0000-0000-000000000101');
-- The change state exists (the sweep syncs it every tick) but the feature is OFF at deploy.
select is(public.sync_erp_statement_change_scope('06970000-0000-0000-0000-000000000001',
  '06970000-0000-0000-0000-000000000101','06970000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')
  ->>'enabled','false','#1931 the change state is off by default at deploy');
create temporary table fx as
  select scope_epoch epoch from public.erp_statement_change_state
 where org_id='06970000-0000-0000-0000-000000000001';
reset role;
grant select on fx to service_role;

create temporary table nat_ctx(context jsonb not null) on commit drop;
insert into nat_ctx values ('{
  "binding":{"id":"06970000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16},
  "company":"Native Test Co",
  "profile":{"erpVersion":"16.33.0","frappeVersion":"16.31.0"},
  "calendar":[{"name":"FY24-25","start":"2024-07-01","end":"2025-06-30"},{"name":"FY25-26","start":"2025-07-01","end":"2026-06-30"}],
  "projectMap":{},
  "language":"en",
  "presentation":{"metadata":{"erpVersion":"16.33.0","frappeVersion":"16.31.0","currency":"IDR","defaultFinanceBook":null,"hasFinanceBooks":false,"calendar":[{"name":"FY24-25","start":"2024-07-01","end":"2025-06-30"},{"name":"FY25-26","start":"2025-07-01","end":"2026-06-30"}],"currencyPrecision":2,"roundingMethod":"erpnext_report_output","fractionUnits":100,"ignoreOpeningCheck":false,"ignoreAccountClosingBalance":false},"context":{"requestLanguage":"en","currencyPrecisionBranch":"currency_number_format","raw":{"company":{"name":"Native Test Co","currency":"IDR","defaultFinanceBook":null},"accountsSettings":{"ignoreOpeningCheck":0,"ignoreAccountClosingBalance":0},"currency":{"fractionUnits":100,"numberFormat":"#,###.##"}}}},
  "filterProfile":"erpnext-v16-standard-statements-v1"
}'::jsonb);
grant select on nat_ctx to service_role;

create function pg_temp.make_native_report(p_context jsonb,p_selection jsonb) returns jsonb
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_statement text:=p_selection->>'statement';
  v_period_kind text:=p_selection->>'periodKind';
  v_side text:=p_selection->>'side';
  v_name text;
  v_native_kind text:=case when v_period_kind='fiscal_year' then 'year' else v_period_kind end;
  v_current_period jsonb;
  v_prior_period jsonb;
  v_period_pair jsonb;
  v_period jsonb;
  v_project jsonb;
  v_project_filter jsonb:='[]'::jsonb;
  v_common jsonb;
  v_filters jsonb;
  v_columns jsonb;
  v_rows jsonb:='[]'::jsonb;
  v_summary jsonb:=null;
  v_raw text:='{"fixture":"native report response"}';
  v_hash text;
  v_acquired text;
  v_project_id uuid;
  v_project_name text;
begin
  v_name:=case v_statement when 'trial_balance' then 'Trial Balance'
    when 'profit_and_loss' then 'Profit and Loss Statement' else 'Balance Sheet' end;
  v_current_period:=jsonb_build_object(
    'fromDate',p_selection->>'currentStart','toDate',p_selection->>'currentEnd',
    'fromFiscalYear',(select fy->>'name' from jsonb_array_elements(p_context->'calendar') fy
      where (fy->>'start')::date<=(p_selection->>'currentStart')::date and (fy->>'end')::date>=(p_selection->>'currentStart')::date),
    'toFiscalYear',(select fy->>'name' from jsonb_array_elements(p_context->'calendar') fy
      where (fy->>'start')::date<=(p_selection->>'currentEnd')::date and (fy->>'end')::date>=(p_selection->>'currentEnd')::date),
    'kind',v_native_kind);
  v_prior_period:=jsonb_build_object(
    'fromDate',p_selection->>'priorStart','toDate',p_selection->>'priorEnd',
    'fromFiscalYear',(select fy->>'name' from jsonb_array_elements(p_context->'calendar') fy
      where (fy->>'start')::date<=(p_selection->>'priorStart')::date and (fy->>'end')::date>=(p_selection->>'priorStart')::date),
    'toFiscalYear',(select fy->>'name' from jsonb_array_elements(p_context->'calendar') fy
      where (fy->>'start')::date<=(p_selection->>'priorEnd')::date and (fy->>'end')::date>=(p_selection->>'priorEnd')::date),
    'kind',v_native_kind);
  v_period_pair:=jsonb_build_object('current',v_current_period,'prior',v_prior_period);
  v_period:=v_period_pair->v_side;
  if jsonb_typeof(p_selection->'projectId')<>'null' then
    v_project_id:=(p_selection->>'projectId')::uuid;
    v_project_name:=p_context->'projectMap'->>v_project_id::text;
    v_project:=jsonb_build_object('projectId',v_project_id,'erpProjectName',v_project_name);
    v_project_filter:=jsonb_build_array(v_project_name);
  else
    v_project:='null'::jsonb;
  end if;
  v_common:=jsonb_build_object('company',p_context->>'company','finance_book','',
    'presentation_currency','IDR','cost_center','[]'::jsonb,'include_default_book_entries',1,'project',v_project_filter);
  if v_statement='trial_balance' then
    v_filters:=v_common||jsonb_build_object('fiscal_year',v_period->>'fromFiscalYear',
      'from_date',v_period->>'fromDate','to_date',v_period->>'toDate',
      'with_period_closing_entry_for_opening',1,'with_period_closing_entry_for_current_period',1,
      'show_group_accounts',1,'show_net_values',1,'show_zero_values',0,'show_unclosed_fy_pl_balances',0);
    v_columns:=jsonb_build_array(
      jsonb_build_object('fieldname','account','label','Account','type','text'),
      jsonb_build_object('fieldname','opening_debit','label','Opening debit','type','currency'),
      jsonb_build_object('fieldname','opening_credit','label','Opening credit','type','currency'),
      jsonb_build_object('fieldname','debit','label','Debit','type','currency'),
      jsonb_build_object('fieldname','credit','label','Credit','type','currency'),
      jsonb_build_object('fieldname','closing_debit','label','Closing debit','type','currency'),
      jsonb_build_object('fieldname','closing_credit','label','Closing credit','type','currency'));
  else
    v_filters:=v_common||jsonb_build_object('filter_based_on','Date Range',
      'period_start_date',v_period->>'fromDate','period_end_date',v_period->>'toDate',
      'from_fiscal_year',v_period->>'fromFiscalYear','to_fiscal_year',v_period->>'toFiscalYear',
      'periodicity',case v_period_kind when 'month' then 'Monthly' when 'quarter' then 'Quarterly' else 'Yearly' end,
      'accumulated_values',case when v_statement='balance_sheet' then 1 else 0 end,
      'selected_view','Report','report_template','','show_zero_values',0);
    v_columns:=jsonb_build_array(jsonb_build_object('fieldname','amount','label','Amount','type','currency'));
  end if;
  v_hash:=encode(extensions.digest(convert_to(v_raw,'UTF8'),'sha256'),'hex');
  v_acquired:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  return jsonb_build_object('selection',p_selection,'rawText',v_raw,'report',jsonb_build_object(
    'reportName',v_name,'company',p_context->>'company','side',v_side,'period',v_period,
    'periodPair',v_period_pair,'project',v_project,'language',p_context->>'language','profile',p_context->'profile',
    'columns',v_columns,'rows',v_rows,'summary',v_summary,
    'provenance',jsonb_build_object('endpoint','/api/method/frappe.desk.query_report.run','method','GET',
      'ignorePreparedReport',1,'rawSha256',v_hash,'acquiredAt',v_acquired,'filters',v_filters)));
end;
$$;
grant execute on function pg_temp.make_native_report(jsonb,jsonb) to service_role;

-- First publication: stage and publish the full catalogue so later batches have validated sources to retain.
create temporary table nat_first(result jsonb not null) on commit drop;
grant insert,select on nat_first to service_role;
set local role service_role;
insert into nat_first
select public.open_erp_statement_report_batch('06970000-0000-0000-0000-000000000001',
  '06970000-0000-0000-0000-000000000101',(select context from nat_ctx));
do $$
declare
  v_context jsonb:=(select context from nat_ctx);
  v_batch uuid:=(select (result->>'batchId')::uuid from nat_first);
  v_pending record;
  v_selection jsonb;
begin
  for v_pending in select * from public.erp_financial_statement_report_pending
    where org_id='06970000-0000-0000-0000-000000000001' and batch_id=v_batch order by ordinal loop
    v_selection:=jsonb_build_object('statement',v_pending.statement,'projectId',v_pending.project_id,
      'periodKind',v_pending.period_kind,'currentStart',v_pending.current_start::text,
      'currentEnd',v_pending.current_end::text,'priorStart',v_pending.prior_start::text,
      'priorEnd',v_pending.prior_end::text,'side',v_pending.side);
    perform public.stage_erp_statement_report('06970000-0000-0000-0000-000000000001',
      '06970000-0000-0000-0000-000000000101',v_batch,pg_temp.make_native_report(v_context,v_selection));
  end loop;
end $$;
reset role;
create temporary table nat_pub(snapshot_id uuid not null) on commit drop;
grant insert,select on nat_pub to service_role;
set local role service_role;
insert into nat_pub
select public.publish_erp_financial_statements('06970000-0000-0000-0000-000000000001',
  '06970000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from nat_first));
reset role;
select is((select count(*)::int from nat_pub),1,'the first publication produced one trusted generation');

-- A later batch header is deleted so the same context can open a fresh batch (pending rows cascade).
delete from public.erp_financial_statement_report_batch where org_id='06970000-0000-0000-0000-000000000001';

-- Legacy control: the state exists but is disabled, so the retained-period plan (0332) still applies.
create temporary table nat_legacy(result jsonb not null) on commit drop;
grant insert,select on nat_legacy to service_role;
set local role service_role;
insert into nat_legacy
select public.open_erp_statement_report_batch('06970000-0000-0000-0000-000000000001',
  '06970000-0000-0000-0000-000000000101',(select context from nat_ctx));
reset role;
create temporary table nat_adm(effective date not null, cutoff bigint not null, total integer not null) on commit drop;
insert into nat_adm
select b.effective_date,b.dirty_revision_cutoff,count(*)::integer
  from public.erp_financial_statement_report_batch b
 cross join public._erp_statement_report_plan((select context from nat_ctx))
 where b.org_id='06970000-0000-0000-0000-000000000001'
 group by b.effective_date,b.dirty_revision_cutoff;
grant select on nat_adm to service_role;
select is((select total from nat_adm),
  (select count(*)::int from public.erp_financial_statement_report_pending
    where org_id='06970000-0000-0000-0000-000000000001'
      and batch_id=(select (result->>'batchId')::uuid from nat_legacy)),
  'every planned period is staged again');
select is((select count(*)::int from public.erp_financial_statement_report_pending
    where org_id='06970000-0000-0000-0000-000000000001'
      and batch_id=(select (result->>'batchId')::uuid from nat_legacy)
      and retained_source_snapshot_id is not null),
  (select total from nat_adm) - (select count(*)::int from public._erp_statement_report_refresh_plan(
    '06970000-0000-0000-0000-000000000001',(select context from nat_ctx),
    (select effective from nat_adm),(select cutoff from nat_adm))),
  'with the state disabled the batch retains the validated historical sides');
select ok((select count(*)::int from public.erp_financial_statement_report_pending
    where org_id='06970000-0000-0000-0000-000000000001'
      and batch_id=(select (result->>'batchId')::uuid from nat_legacy)
      and retained_source_snapshot_id is not null)>0,
  'control: the fixture has retainable history');
create temporary table nat_retained_pair(statement text not null, period_kind text not null, current_start date not null) on commit drop;
insert into nat_retained_pair
select p.statement,p.period_kind,p.current_start
  from public.erp_financial_statement_report_pending p
 where p.org_id='06970000-0000-0000-0000-000000000001'
   and p.batch_id=(select (result->>'batchId')::uuid from nat_legacy)
   and p.side='current' and p.retained_source_snapshot_id is not null
 order by p.current_start desc limit 1;
select is((select count(*)::int from nat_retained_pair),1,'control: captured one concrete retained historical pair');

-- Nightly: the admitted nightly pass refetches every planned period; nothing is retained.
reset role;
update public.erp_statement_change_state
   set enabled=true,pass_cut=null,next_nightly_date=((clock_timestamp() at time zone 'UTC')::date-2)
 where org_id='06970000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.record_erp_statement_nightly_due('06970000-0000-0000-0000-000000000001',
  '06970000-0000-0000-0000-000000000101','06970000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')
  ->>'status','recorded','the overdue nightly obligation is recorded');
create temporary table ncut as
  select public.plan_erp_statement_pass('06970000-0000-0000-0000-000000000001',
    '06970000-0000-0000-0000-000000000101','06970000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',
    (select epoch from fx)) p;
reset role;
grant select on ncut to service_role;
select is((select p->>'reason' from ncut),'nightly','the admitted pass is a nightly pass');
delete from public.erp_financial_statement_report_batch where org_id='06970000-0000-0000-0000-000000000001';
create temporary table nat_nightly(result jsonb not null) on commit drop;
grant insert,select on nat_nightly to service_role;
set local role service_role;
insert into nat_nightly
select public.open_erp_statement_report_batch('06970000-0000-0000-0000-000000000001',
  '06970000-0000-0000-0000-000000000101',(select context from nat_ctx));
reset role;
select is((select count(*)::int from public.erp_financial_statement_report_pending
    where org_id='06970000-0000-0000-0000-000000000001'
      and batch_id=(select (result->>'batchId')::uuid from nat_nightly)
      and retained_source_snapshot_id is not null),0,
  '#1931 the nightly pass refetches every planned period; no side is retained');
select is((select count(*)::int from public.erp_financial_statement_report_pending p
    where p.org_id='06970000-0000-0000-0000-000000000001'
      and p.batch_id=(select (result->>'batchId')::uuid from nat_nightly)
      and p.side='current' and p.statement=(select statement from nat_retained_pair)
      and p.period_kind=(select period_kind from nat_retained_pair)
      and p.current_start=(select current_start from nat_retained_pair)
      and p.retained_source_snapshot_id is null),1,
  '#1931 the pair the legacy plan retained is staged for a fresh fetch');

-- "Refresh now": an unacknowledged intent also refetches every planned period.
reset role;
delete from public.erp_statement_nightly_obligation where org_id='06970000-0000-0000-0000-000000000001';
update public.erp_statement_change_state set pass_cut=null
 where org_id='06970000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.request_erp_statement_manual_intent('06970000-0000-0000-0000-000000000001',
  '06970000-0000-0000-0000-000000000101','06970000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z')
  ->>'status','accepted','the manual intent is accepted');
create temporary table icut as
  select public.plan_erp_statement_pass('06970000-0000-0000-0000-000000000001',
    '06970000-0000-0000-0000-000000000101','06970000-0000-0000-0000-000000000011','2026-10-18T09:00:00Z',
    (select epoch from fx)) p;
reset role;
grant select on icut to service_role;
select is((select p->>'reason' from icut),'intent','the admitted pass is an intent pass');
delete from public.erp_financial_statement_report_batch where org_id='06970000-0000-0000-0000-000000000001';
create temporary table nat_intent(result jsonb not null) on commit drop;
grant insert,select on nat_intent to service_role;
set local role service_role;
insert into nat_intent
select public.open_erp_statement_report_batch('06970000-0000-0000-0000-000000000001',
  '06970000-0000-0000-0000-000000000101',(select context from nat_ctx));
reset role;
select is((select count(*)::int from public.erp_financial_statement_report_pending
    where org_id='06970000-0000-0000-0000-000000000001'
      and batch_id=(select (result->>'batchId')::uuid from nat_intent)
      and retained_source_snapshot_id is not null),0,
  '#1931 the intent pass refetches every planned period; no side is retained');

-- Guards: a disabled state or a pass cut from another binding activation keeps the legacy plan.
reset role;
update public.erp_statement_change_state set enabled=false
 where org_id='06970000-0000-0000-0000-000000000001';
delete from public.erp_financial_statement_report_batch where org_id='06970000-0000-0000-0000-000000000001';
create temporary table nat_off(result jsonb not null) on commit drop;
grant insert,select on nat_off to service_role;
set local role service_role;
insert into nat_off
select public.open_erp_statement_report_batch('06970000-0000-0000-0000-000000000001',
  '06970000-0000-0000-0000-000000000101',(select context from nat_ctx));
reset role;
select is((select count(*)::int from public.erp_financial_statement_report_pending
    where org_id='06970000-0000-0000-0000-000000000001'
      and batch_id=(select (result->>'batchId')::uuid from nat_off)
      and retained_source_snapshot_id is not null),
  (select total from nat_adm) - (select count(*)::int from public._erp_statement_report_refresh_plan(
    '06970000-0000-0000-0000-000000000001',(select context from nat_ctx),
    (select effective from nat_adm),(select cutoff from nat_adm))),
  'a disabled state keeps the retained-period plan even with a frozen pass cut (off by default)');
reset role;
update public.erp_statement_change_state set enabled=true,activated_at='2020-01-01T00:00:00Z'
 where org_id='06970000-0000-0000-0000-000000000001';
delete from public.erp_financial_statement_report_batch where org_id='06970000-0000-0000-0000-000000000001';
create temporary table nat_fence(result jsonb not null) on commit drop;
grant insert,select on nat_fence to service_role;
set local role service_role;
insert into nat_fence
select public.open_erp_statement_report_batch('06970000-0000-0000-0000-000000000001',
  '06970000-0000-0000-0000-000000000101',(select context from nat_ctx));
reset role;
select is((select count(*)::int from public.erp_financial_statement_report_pending
    where org_id='06970000-0000-0000-0000-000000000001'
      and batch_id=(select (result->>'batchId')::uuid from nat_fence)
      and retained_source_snapshot_id is not null),
  (select total from nat_adm) - (select count(*)::int from public._erp_statement_report_refresh_plan(
    '06970000-0000-0000-0000-000000000001',(select context from nat_ctx),
    (select effective from nat_adm),(select cutoff from nat_adm))),
  'a pass cut from another binding activation never forces the full plan');
select * from finish();
rollback;
