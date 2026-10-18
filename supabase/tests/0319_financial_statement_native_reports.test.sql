-- AC-005/006: native statement batches, lossless staging, scoped privacy and atomic publication.
begin;
create extension if not exists pgtap;
select no_plan();

select ok(to_regprocedure('public.open_erp_statement_report_batch(uuid,uuid,jsonb)') is not null
  and to_regprocedure('public.stage_erp_statement_report(uuid,uuid,uuid,jsonb)') is not null
  and to_regprocedure('public.publish_erp_financial_statements(uuid,uuid,uuid)') is not null
  and to_regprocedure('public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)') is null,
  'AC-006 three exact native RPCs replace the old calculator publishing route');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=public, pg_temp'])
  from pg_proc where oid in (
    to_regprocedure('public.open_erp_statement_report_batch(uuid,uuid,jsonb)'),
    to_regprocedure('public.stage_erp_statement_report(uuid,uuid,uuid,jsonb)'),
    to_regprocedure('public.publish_erp_financial_statements(uuid,uuid,uuid)'))),
  'AC-006 native RPCs are SECURITY DEFINER with fixed search_path');
select ok((select bool_and(has_function_privilege('service_role',p.oid,'EXECUTE')
  and not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('authenticated',p.oid,'EXECUTE')
  and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where acl.grantee=0 and acl.privilege_type='EXECUTE'))
  from pg_proc p where p.oid in (
    to_regprocedure('public.open_erp_statement_report_batch(uuid,uuid,jsonb)'),
    to_regprocedure('public.stage_erp_statement_report(uuid,uuid,uuid,jsonb)'),
    to_regprocedure('public.publish_erp_financial_statements(uuid,uuid,uuid)'))),
  'AC-006 only service_role can execute native RPCs');
select ok(to_regclass('public.erp_financial_statement_report_batch') is not null
  and to_regclass('public.erp_financial_statement_report_pending') is not null
  and not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='external_org_bindings' and column_name='statement_report_batch'),
  'AC-003 batch context uses a private header and does not expand binding columns');
select is((select array_agg(attname::text order by attnum)::text from pg_attribute
  where attrelid='public.erp_financial_statement_report_batch'::regclass and attnum>0 and not attisdropped),
  '{org_id,batch_id,started_at,context}','AC-005 private header stores context once per organization');
select is((select array_agg(attname::text order by attnum)::text from pg_attribute
  where attrelid='public.erp_financial_statement_report_pending'::regclass and attnum>0 and not attisdropped),
  '{org_id,batch_id,statement,project_id,period_kind,current_start,current_end,prior_start,prior_end,side,ordinal,normalized_report,raw_response_text,raw_sha256,acquired_at}',
  'AC-005 pending table stores only typed selection and nullable capture fields');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid='public.erp_financial_statement_report_batch'::regclass)
  and (select relrowsecurity and relforcerowsecurity from pg_class
  where oid='public.erp_financial_statement_report_pending'::regclass),
  'AC-003 both transient native storage tables enable and force RLS');
select ok(has_table_privilege('service_role','public.erp_financial_statement_report_batch','SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role','public.erp_financial_statement_report_pending','SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.erp_financial_statement_report_batch','SELECT')
  and not has_table_privilege('anon','public.erp_financial_statement_report_batch','SELECT')
  and not has_table_privilege('authenticated','public.erp_financial_statement_report_pending','SELECT')
  and not has_table_privilege('anon','public.erp_financial_statement_report_pending','SELECT')
  and not has_table_privilege('service_role','public.erp_financial_statement_report_batch','TRUNCATE')
  and not has_table_privilege('service_role','public.erp_financial_statement_report_pending','TRUNCATE'),
  'AC-003 real role table grants limit header and pending CRUD to service_role');
select ok(not exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
  where c.oid in ('public.erp_financial_statement_report_batch'::regclass,'public.erp_financial_statement_report_pending'::regclass)
    and acl.grantee=0 and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE')),
  'AC-003 PUBLIC receives no direct table privilege on transient native storage');
select ok((select count(*)=1 from pg_indexes where schemaname='public'
  and indexname='erp_financial_statement_report_pending_next_idx'
  and indexdef ilike '%(org_id, batch_id, ordinal)%where (normalized_report is null)%')
  and exists(select 1 from pg_constraint where conrelid='public.erp_financial_statement_report_pending'::regclass
    and conname='erp_financial_statement_report_pending_batch_fk' and contype='f'),
  'AC-005 next selection uses the missing-ordinal index and cannot outlive its header');
select ok((select count(*)=3 from information_schema.columns where table_schema='public'
  and table_name='erp_financial_statement_snapshot'
  and column_name in ('raw_reports','capture_started_at','capture_completed_at')),
  'AC-006 snapshot stores a private raw pair and scalar capture window');

insert into public.organizations(id,name,default_currency,default_timezone) values
 ('03190000-0000-0000-0000-000000000001','Synthetic native statement org','IDR','UTC'),
 ('03190000-0000-0000-0000-000000000002','Synthetic native statement org B','IDR','UTC');
insert into auth.users(id,email) values ('03190000-0000-0000-0000-0000000000a1','native-finance@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('03190000-0000-0000-0000-0000000000a1','03190000-0000-0000-0000-000000000001','Synthetic Finance','native-finance@example.test','Finance','active');
insert into public.projects
 (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
  tax_base_numerator,tax_base_denominator,subject_to_vat,project_manager_id)
values ('03190000-0000-0000-0000-0000000000d1','03190000-0000-0000-0000-000000000001',
        'Synthetic mapped project','Ongoing Project','IDR',1000,'exclusive',0,0,1,1,false,null);

set local role service_role;
insert into public.external_org_bindings
 (id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at,
  statement_full_ledger_replay_needed,statement_update_delayed,statement_last_attempt_at,statement_calendar)
values ('03190000-0000-0000-0000-000000000001','03190000-0000-0000-0000-000000000001','erpnext',
        'https://example.invalid','synthetic-native-fixture',16,
        '{"company":"Native Test Co","project_map":{"03190000-0000-0000-0000-0000000000d1":"Native Project"}}',
        '2026-10-18T09:00:00Z',true,false,'2026-10-18T09:00:00Z',
        '[{"start":"2024-07-01","end":"2025-06-30"}]');
insert into public.erp_sweep_lock(org_id,locked_until,holder)
values ('03190000-0000-0000-0000-000000000001',clock_timestamp()+interval '15 minutes',
        '03190000-0000-0000-0000-000000000101');
reset role;

-- Preserve an exact prior generation/status for all failed publication cases.
set local role service_role;
insert into public.erp_financial_statement_snapshot
 (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
  current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
values ('03190000-0000-0000-0000-000000000001','Native Test Co','03190000-0000-0000-0000-000000000201',
 '03190000-0000-0000-0000-000000000202','profit_and_loss','company',null,'account_breakdown','month',
 '2025-08-01','2025-08-31','2025-07-01','2025-07-31','IDR','2026-10-17T09:00:00Z',
 '{"rows":[]}',false,2,'Commercial Rounding'),
 ('03190000-0000-0000-0000-000000000002','Native Test Co','03190000-0000-0000-0000-000000000211',
 '03190000-0000-0000-0000-000000000212','profit_and_loss','company',null,'account_breakdown','month',
 '2025-08-01','2025-08-31','2025-07-01','2025-07-31','IDR','2026-10-17T09:00:00Z',
 '{"rows":[]}',false,2,'Commercial Rounding');
reset role;
create temporary table native_other_org_prior(row_json jsonb not null) on commit drop;
insert into native_other_org_prior
select to_jsonb(s) from public.erp_financial_statement_snapshot s
where s.org_id='03190000-0000-0000-0000-000000000002' and s.company='Native Test Co';
create temporary table native_context(context jsonb not null) on commit drop;
insert into native_context values ('{
  "binding":{"id":"03190000-0000-0000-0000-000000000001","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16},
  "company":"Native Test Co",
  "profile":{"erpVersion":"16.33.0","frappeVersion":"16.31.0"},
  "calendar":[{"name":"FY24-25","start":"2024-07-01","end":"2025-06-30"},{"name":"FY25-26","start":"2025-07-01","end":"2026-06-30"}],
  "projectMap":{"03190000-0000-0000-0000-0000000000d1":"Native Project"},
  "language":"en",
  "presentation":{"metadata":{"erpVersion":"16.33.0","frappeVersion":"16.31.0","currency":"IDR","defaultFinanceBook":null,"hasFinanceBooks":false,"calendar":[{"name":"FY24-25","start":"2024-07-01","end":"2025-06-30"},{"name":"FY25-26","start":"2025-07-01","end":"2026-06-30"}],"currencyPrecision":2,"floatPrecision":2,"bsOpeningPrecision":2,"roundingMethod":"Commercial Rounding","fractionUnits":100,"ignoreOpeningCheck":false,"ignoreAccountClosingBalance":false},"context":{"requestLanguage":"en","currencyPrecisionBranch":"db_default","floatPrecisionBranch":"db_default","bsOpeningPrecisionBranch":"db_default","numberFormatBranch":"native_default","raw":{}}},
  "filterProfile":"erpnext-v16-standard-statements-v1"
}'::jsonb);
grant select on native_context to service_role;
create temporary table native_first(result jsonb) on commit drop;
create temporary table native_resume(result jsonb) on commit drop;
create temporary table native_drift(result jsonb) on commit drop;
create temporary table native_first_report(envelope jsonb) on commit drop;
create temporary table native_saved_pending(row_json jsonb) on commit drop;
grant select,insert,update,delete on native_first,native_resume,native_drift,native_first_report,native_saved_pending to service_role;

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
    if v_side='current' and v_statement='trial_balance'
       and p_selection->>'currentStart'='2025-08-01' then
      v_rows:=jsonb_build_array(jsonb_build_object('account','synthetic-native-row','opening_debit','0','opening_credit','-0.0',
        'debit','1e+3','credit','0E-3','closing_debit','-0','closing_credit','0.0'));
    end if;
  else
    v_filters:=v_common||jsonb_build_object('filter_based_on','Date Range',
      'period_start_date',v_period->>'fromDate','period_end_date',v_period->>'toDate',
      'from_fiscal_year',v_period->>'fromFiscalYear','to_fiscal_year',v_period->>'toFiscalYear',
      'periodicity',case v_period_kind when 'month' then 'Monthly' when 'quarter' then 'Quarterly' else 'Yearly' end,
      'accumulated_values',case when v_statement='balance_sheet' then 1 else 0 end,
      'selected_view','Report','report_template','','show_zero_values',0);
    v_columns:=jsonb_build_array(jsonb_build_object('fieldname','amount','label','Amount','type','currency'));
    if v_project_id is not null then
      v_summary:=jsonb_build_array(
        jsonb_build_object('datatype','Currency','currency','IDR','value','1e+3'),
        jsonb_build_object('datatype','Currency','currency','IDR','value','-0.0'),
        jsonb_build_object('datatype','Currency','currency','IDR','value','0E-3'));
      v_rows:=jsonb_build_array(jsonb_build_object('amount','0'));
    end if;
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

-- Opening rejects wrong/expired holders and invalid current context without disturbing the old publication.
select throws_ok($$select public.open_erp_statement_report_batch('03190000-0000-0000-0000-000000000001','03190000-0000-0000-0000-000000000199',(select context from native_context))$$,
  '55000',null,'AC-005 wrong holder cannot open a native batch');
update public.erp_sweep_lock set locked_until=clock_timestamp()-interval '1 second'
where org_id='03190000-0000-0000-0000-000000000001';
select throws_ok($$select public.open_erp_statement_report_batch('03190000-0000-0000-0000-000000000001','03190000-0000-0000-0000-000000000101',(select context from native_context))$$,
  '55000',null,'AC-005 expired holder cannot open a native batch');
update public.erp_sweep_lock set locked_until=clock_timestamp()+interval '15 minutes'
where org_id='03190000-0000-0000-0000-000000000001';
select throws_ok($$select public.open_erp_statement_report_batch('03190000-0000-0000-0000-000000000001','03190000-0000-0000-0000-000000000101',
  jsonb_set((select context from native_context),'{filterProfile}','"wrong-profile"'::jsonb))$$,
  '22023',null,'AC-005 SQL fixes the launched filter profile literal');
select throws_ok($$select public.open_erp_statement_report_batch('03190000-0000-0000-0000-000000000001','03190000-0000-0000-0000-000000000101',
  jsonb_set((select context from native_context),'{projectMap}','{}'::jsonb))$$,
  '55000',null,'AC-005 changed native project map cannot replace the current binding context');

set local role service_role;
insert into native_first select public.open_erp_statement_report_batch(
  '03190000-0000-0000-0000-000000000001','03190000-0000-0000-0000-000000000101',context) from native_context;
reset role;
select is((select array_agg(key order by key)::text from jsonb_object_keys((select result from native_first)) key),
  '{batchId,complete,nextRequest,startedAt}','AC-005 open returns exactly the fixed progress envelope');
select is((select count(*)::int from public.erp_financial_statement_report_pending
  where org_id='03190000-0000-0000-0000-000000000001'),248,
  'AC-005 SQL materializes one complete two-sided company and mapped-project plan');
select is((select result->'nextRequest'->>'statement' from native_first),'trial_balance',
  'AC-005 plan order begins with company Trial Balance');
select is((select result->'nextRequest'->>'side' from native_first),'current',
  'AC-005 each canonical report orders current before prior');
select is((select array_agg(key order by key)::text from jsonb_object_keys((select result->'nextRequest' from native_first)) key),
  '{currentEnd,currentStart,periodKind,priorEnd,priorStart,projectId,side,statement}',
  'AC-005 nextRequest contains only the exact canonical selection');
select is((select count(*)::int from public.erp_financial_statement_report_pending
  where org_id='03190000-0000-0000-0000-000000000001' and normalized_report is null and raw_response_text is null and raw_sha256 is null and acquired_at is null),248,
  'AC-005 every planned row begins with all capture fields NULL');
select ok((select context=(select context from native_context) from public.erp_financial_statement_report_batch
  where org_id='03190000-0000-0000-0000-000000000001')
  and (select count(*)=0 from information_schema.columns where table_schema='public'
    and table_name='erp_financial_statement_report_pending' and column_name='context'),
  'AC-005 frozen context is stored once in the header and never copied into planned requests');
select ok(not has_function_privilege('service_role','public._erp_statement_report_plan(jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public._erp_statement_report_plan(jsonb)','EXECUTE'),
  'AC-005 internal plan helper is not an additional granted interface');

-- Verify actual role reachability, not policy names.
set local role authenticated;
set local request.jwt.claims='{"sub":"03190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select * from public.erp_financial_statement_report_batch$$,
  '42501',null,'AC-003 authenticated cannot read private batch context');
select throws_ok($$select * from public.erp_financial_statement_report_pending$$,
  '42501',null,'AC-003 authenticated cannot read staged raw reports');
reset role;
set local role anon;
set local request.jwt.claims='{}';
select throws_ok($$select * from public.erp_financial_statement_report_batch$$,
  '42501',null,'AC-003 anon cannot read private batch context');
select throws_ok($$select * from public.erp_financial_statement_report_pending$$,
  '42501',null,'AC-003 anon cannot read staged raw reports');
reset role;

-- Capture one exact native response; hash mismatch, unplanned selection and conflicting retry must not alter it.
set local role service_role;
insert into native_first_report
select pg_temp.make_native_report((select context from native_context),result->'nextRequest') from native_first;
select throws_ok($$select public.stage_erp_statement_report('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_first),
  jsonb_set((select envelope from native_first_report),'{report,provenance,rawSha256}',to_jsonb(repeat('0',64))))$$,
  '22023',null,'AC-005 raw hash mismatch is rejected before capture');
select throws_ok($$select public.stage_erp_statement_report('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_first),
  jsonb_set((select envelope from native_first_report),'{selection,currentStart}','"2025-08-02"'::jsonb))$$,
  '22023',null,'AC-005 unplanned request selection cannot be staged');
select public.stage_erp_statement_report('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_first),
  (select envelope from native_first_report));
select public.stage_erp_statement_report('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_first),
  (select envelope from native_first_report));
select throws_ok($$select public.stage_erp_statement_report('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_first),
  jsonb_set((select envelope from native_first_report),'{report,irrelevantExtra}','true'::jsonb))$$,
  '22023',null,'AC-005 same-key changed normalized content cannot replace captured bytes');
select throws_ok($$select public.stage_erp_statement_report('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000199',(select (result->>'batchId')::uuid from native_first),
  (select envelope from native_first_report))$$,
  '55000',null,'AC-005 wrong holder cannot stage even a report retry');
update public.erp_sweep_lock set locked_until=clock_timestamp()-interval '1 second'
where org_id='03190000-0000-0000-0000-000000000001';
select throws_ok($$select public.stage_erp_statement_report('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_first),
  (select envelope from native_first_report))$$,
  '55000',null,'AC-005 expired holder cannot take the identical stage no-op path');
update public.erp_sweep_lock set locked_until=clock_timestamp()+interval '15 minutes'
where org_id='03190000-0000-0000-0000-000000000001';
reset role;
select is((select count(*)::int from public.erp_financial_statement_report_pending
  where org_id='03190000-0000-0000-0000-000000000001' and normalized_report is not null),1,
  'AC-005 identical stage retry is a no-op and changed retry leaves exactly one capture');
update public.external_org_bindings set config=jsonb_set(config,'{project_map}','{}'::jsonb)
where org_id='03190000-0000-0000-0000-000000000001' and external_tier='erpnext';
select throws_ok($$select public.open_erp_statement_report_batch('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select context from native_context))$$,
  '55000',null,'AC-005 actual binding project-map drift cannot resume the frozen plan');
update public.external_org_bindings set config=jsonb_set(config,'{project_map}',
  '{"03190000-0000-0000-0000-0000000000d1":"Native Project"}'::jsonb)
where org_id='03190000-0000-0000-0000-000000000001' and external_tier='erpnext';
select is((select count(*)::int from public.erp_financial_statement_report_pending
  where org_id='03190000-0000-0000-0000-000000000001' and normalized_report is not null),1,
  'AC-005 binding drift rejection preserves previously captured native bytes');

set local role service_role;
insert into native_resume select public.open_erp_statement_report_batch(
  '03190000-0000-0000-0000-000000000001','03190000-0000-0000-0000-000000000101',context) from native_context;
reset role;
select is((select result->>'batchId' from native_resume),(select result->>'batchId' from native_first),
  'AC-005 equal context resumes the same SQL-owned batch identity');
select is((select result->'nextRequest'->>'side' from native_resume),'prior',
  'AC-005 resume returns the first missing canonical ordinal without rebuilding captured work');
select throws_ok($$select public.publish_erp_financial_statements('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_first))$$,
  '55000',null,'AC-006 incomplete native batch cannot publish a prefix');
select ok((select count(*)=1 and bool_and(snapshot_id='03190000-0000-0000-0000-000000000201'::uuid)
  from public.erp_financial_statement_snapshot where org_id='03190000-0000-0000-0000-000000000001')
  and (select statement_update_delayed from public.external_org_bindings
    where org_id='03190000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'AC-006 incomplete rejection preserves the exact prior generation and honest delayed state');

-- Context drift abandons only the owning org's staged batch and atomically creates a fresh plan.
set local role service_role;
insert into native_drift
select public.open_erp_statement_report_batch('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',jsonb_set(jsonb_set(context,'{language}','"id"'::jsonb),
    '{presentation,context,requestLanguage}','"id"'::jsonb)) from native_context;
reset role;
select isnt((select result->>'batchId' from native_drift),(select result->>'batchId' from native_first),
  'AC-005 changed context starts a new batch identity');
select is((select count(*)::int from public.erp_financial_statement_report_batch
  where org_id='03190000-0000-0000-0000-000000000001'),1,
  'AC-005 one header per org replaces only the stale context');
select is((select count(*)::int from public.erp_financial_statement_report_pending
  where org_id='03190000-0000-0000-0000-000000000001' and normalized_report is not null),0,
  'AC-005 context drift removes only old staged responses and starts empty');
select throws_ok($$select public.stage_erp_statement_report('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_first),
  (select envelope from native_first_report))$$,
  '55000',null,'AC-005 stale batch cannot stage after context replacement');

-- A missing prior plan key rejects the exact set before replacing any stored generation.
insert into native_saved_pending
select to_jsonb(p) from public.erp_financial_statement_report_pending p
where p.org_id='03190000-0000-0000-0000-000000000001'
  and p.batch_id=(select (result->>'batchId')::uuid from native_drift)
  and p.ordinal=2;
delete from public.erp_financial_statement_report_pending
where org_id='03190000-0000-0000-0000-000000000001'
  and batch_id=(select (result->>'batchId')::uuid from native_drift) and ordinal=2;
select throws_ok($$select public.publish_erp_financial_statements('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_drift))$$,
  '55000',null,'AC-006 omitted planned prior selection blocks complete publication');
insert into public.erp_financial_statement_report_pending
 (org_id,batch_id,statement,project_id,period_kind,current_start,current_end,prior_start,prior_end,side,ordinal,
  normalized_report,raw_response_text,raw_sha256,acquired_at)
select (row_json->>'org_id')::uuid,(row_json->>'batch_id')::uuid,row_json->>'statement',
  nullif(row_json->>'project_id','')::uuid,row_json->>'period_kind',(row_json->>'current_start')::date,
  (row_json->>'current_end')::date,(row_json->>'prior_start')::date,(row_json->>'prior_end')::date,
  row_json->>'side',(row_json->>'ordinal')::integer,null,null,null,null from native_saved_pending;

-- Stage the immutable full plan using native DTO-shaped data, without consulting chart or GL mirrors.
set local role service_role;
do $$
declare
  v_context jsonb:=(select context from native_context);
  v_batch uuid:=(select (result->>'batchId')::uuid from native_drift);
  v_pending record;
  v_selection jsonb;
begin
  for v_pending in select * from public.erp_financial_statement_report_pending
    where org_id='03190000-0000-0000-0000-000000000001' and batch_id=v_batch order by ordinal loop
    v_selection:=jsonb_build_object('statement',v_pending.statement,'projectId',v_pending.project_id,
      'periodKind',v_pending.period_kind,'currentStart',v_pending.current_start::text,
      'currentEnd',v_pending.current_end::text,'priorStart',v_pending.prior_start::text,
      'priorEnd',v_pending.prior_end::text,'side',v_pending.side);
    perform public.stage_erp_statement_report('03190000-0000-0000-0000-000000000001',
      '03190000-0000-0000-0000-000000000101',v_batch,
      pg_temp.make_native_report(jsonb_set(jsonb_set(v_context,'{language}','"id"'::jsonb),
        '{presentation,context,requestLanguage}','"id"'::jsonb),v_selection));
  end loop;
end $$;
reset role;
select is((select count(*)::int from public.erp_financial_statement_report_pending
  where org_id='03190000-0000-0000-0000-000000000001' and normalized_report is not null),248,
  'AC-005 each immutable expected request is captured once, including every prior report');
select throws_ok($$select public.publish_erp_financial_statements('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000199',(select (result->>'batchId')::uuid from native_drift))$$,
  '55000',null,'AC-006 wrong holder cannot publish a complete batch');

-- A non-monotonic server completion must preserve the full prior publication and binding status.
set local role service_role;
insert into public.erp_financial_statement_snapshot
 (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
  current_start,current_end,prior_start,prior_end,currency,as_of,capture_started_at,capture_completed_at,
  source_report,report_version,filters,settings,payload,raw_reports,has_activity,display_precision,display_rounding_method)
values ('03190000-0000-0000-0000-000000000001','Native Test Co','03190000-0000-0000-0000-000000000301',
 '03190000-0000-0000-0000-000000000302','profit_and_loss','company',null,'account_breakdown','fiscal_year',
 '2998-07-01','2999-06-30','2997-07-01','2998-06-30','IDR','2999-12-31T23:59:59Z',
 '2999-12-31T23:59:00Z','2999-12-31T23:59:59Z','Profit and Loss Statement','synthetic-native-test',null,null,
 '{"current":{"rows":[]},"prior":{"rows":[]}}',
 '{"current":"synthetic prior capture","prior":"synthetic prior capture"}',false,2,'Commercial Rounding');
reset role;
create temporary table native_monotonic_prior(row_json jsonb not null) on commit drop;
insert into native_monotonic_prior
select to_jsonb(s) from public.erp_financial_statement_snapshot s
where s.org_id='03190000-0000-0000-0000-000000000001' and s.company='Native Test Co';
create temporary table native_monotonic_status_prior(status_json jsonb not null) on commit drop;
insert into native_monotonic_status_prior
select jsonb_build_object('delayed',statement_update_delayed,'calendar',statement_calendar,
  'lastAttemptAt',statement_last_attempt_at,'replayNeeded',statement_full_ledger_replay_needed)
from public.external_org_bindings where org_id='03190000-0000-0000-0000-000000000001' and external_tier='erpnext';
set local role service_role;
select throws_ok($$select public.publish_erp_financial_statements('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_drift))$$,
  '55000','native statement completion is not newer',
  'AC-006 older native completion cannot replace the advertised generation');
reset role;
select ok(
  (select jsonb_agg(to_jsonb(s) order by s.id) from public.erp_financial_statement_snapshot s
    where s.org_id='03190000-0000-0000-0000-000000000001' and s.company='Native Test Co')
    is not distinct from (select jsonb_agg(row_json order by row_json->>'id') from native_monotonic_prior)
  and (select jsonb_build_object('delayed',statement_update_delayed,'calendar',statement_calendar,
      'lastAttemptAt',statement_last_attempt_at,'replayNeeded',statement_full_ledger_replay_needed)
    from public.external_org_bindings where org_id='03190000-0000-0000-0000-000000000001' and external_tier='erpnext')
    is not distinct from (select status_json from native_monotonic_status_prior)
  and (select count(*)=248 and bool_and(normalized_report is not null and raw_response_text is not null
      and raw_sha256 is not null and acquired_at is not null)
    from public.erp_financial_statement_report_pending where org_id='03190000-0000-0000-0000-000000000001'
      and batch_id=(select (result->>'batchId')::uuid from native_drift)),
  'AC-006 non-newer completion preserves exact prior rows, binding status and every staged response');
set local role service_role;
delete from public.erp_financial_statement_snapshot
where org_id='03190000-0000-0000-0000-000000000001'
  and snapshot_id='03190000-0000-0000-0000-000000000301';
reset role;

create function public.native_insert_fault() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.org_id='03190000-0000-0000-0000-000000000001' then raise exception 'native_insert_injected'; end if;
  return new;
end $$;
create trigger native_insert_fault before insert on public.erp_financial_statement_snapshot
  for each row execute function public.native_insert_fault();
set local role service_role;
select throws_ok($$select public.publish_erp_financial_statements('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_drift))$$,
  'P0001','native_insert_injected','AC-006 injected insert fault rolls back the complete native replacement');
reset role;
drop trigger native_insert_fault on public.erp_financial_statement_snapshot;
drop function public.native_insert_fault();
select ok((select count(*)=1 and bool_and(snapshot_id='03190000-0000-0000-0000-000000000201'::uuid)
  and bool_and(payload='{"rows":[]}'::jsonb)
  from public.erp_financial_statement_snapshot where org_id='03190000-0000-0000-0000-000000000001')
  and (select statement_update_delayed and statement_calendar='[{"start":"2024-07-01","end":"2025-06-30"}]'::jsonb
    and statement_last_attempt_at='2026-10-18T09:00:00Z'::timestamptz
    and statement_full_ledger_replay_needed
    from public.external_org_bindings where org_id='03190000-0000-0000-0000-000000000001' and external_tier='erpnext')
  and (select count(*)=248 from public.erp_financial_statement_report_pending
    where org_id='03190000-0000-0000-0000-000000000001' and normalized_report is not null),
  'AC-006 failed replacement preserves exact prior rows/status and all staged native bytes');

-- Native publication copies pair data/tokens and summary positions atomically; it never requires mirrors.
set local role service_role;
create temporary table native_published(snapshot_id uuid) on commit drop;
insert into native_published select public.publish_erp_financial_statements('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_drift));
reset role;
select ok(
  (select jsonb_agg(to_jsonb(s) order by s.id) from public.erp_financial_statement_snapshot s
    where s.org_id='03190000-0000-0000-0000-000000000002' and s.company='Native Test Co')
    is not distinct from (select jsonb_agg(row_json order by row_json->>'id') from native_other_org_prior),
  'AC-006 publishing org A preserves the exact pre-existing org B snapshot for the same company');
select is((select count(*)::int from public.erp_financial_statement_snapshot
  where org_id='03190000-0000-0000-0000-000000000001'),155,
  'AC-006 one complete native batch replaces the 31-pair company/project catalogue without unassigned output');
select ok((select count(distinct snapshot_id)=1 and count(distinct source_generation)=1
  and bool_and(source_generation=(select result->>'batchId' from native_drift)::uuid)
  and bool_and(capture_started_at is not null and capture_completed_at is not null and as_of=capture_completed_at)
  and bool_and(capture_started_at< capture_completed_at)
  and bool_and(scope_kind in ('company','project'))
  from public.erp_financial_statement_snapshot where org_id='03190000-0000-0000-0000-000000000001'),
  'AC-006 all rows share one server-owned generation and capture window with no unassigned scope');
select is((select count(*)::int from public.erp_financial_statement_snapshot
  where org_id='03190000-0000-0000-0000-000000000001' and view_kind='account_breakdown'),124,
  'AC-006 output contains company and mapped-project native detail pairs');
select is((select count(*)::int from public.erp_financial_statement_snapshot
  where org_id='03190000-0000-0000-0000-000000000001' and view_kind='project_totals'),31,
  'AC-006 each mapped-project pair has one totals row from native summary positions');
select ok((select bool_and(raw_reports is not null and jsonb_typeof(raw_reports->'current')='string'
  and jsonb_typeof(raw_reports->'prior')='string'
  and payload ?& array['current','prior'] and not (payload ? 'accounts')
  and (raw_reports - array['current','prior'])='{}'::jsonb)
  from public.erp_financial_statement_snapshot where org_id='03190000-0000-0000-0000-000000000001' and view_kind='account_breakdown')
  and (select bool_and(raw_reports is null and source_report is null and report_version is null
    and filters is null and settings is null)
    from public.erp_financial_statement_snapshot where org_id='03190000-0000-0000-0000-000000000001' and view_kind='project_totals'),
  'AC-003 raw text remains on finance detail only and all project totals provenance fields remain SQL NULL');
select ok((select payload->'current'->'rows'->0->>'debit'='1e+3'
  and payload->'current'->'rows'->0->>'credit'='0E-3'
  and payload->'current'->'rows'->0->>'opening_credit'='-0.0'
  and has_activity
  from public.erp_financial_statement_snapshot where org_id='03190000-0000-0000-0000-000000000001'
    and statement='trial_balance' and scope_kind='company' and current_start='2025-08-01'),
  'AC-006 native amount tokens remain lexical and a present zero-valued row is activity');
select ok((select payload='{"current":{"income":"1e+3","expense":"-0.0","net":"0E-3"},
  "prior":{"income":"1e+3","expense":"-0.0","net":"0E-3"}}'::jsonb and has_activity
  from public.erp_financial_statement_snapshot where org_id='03190000-0000-0000-0000-000000000001'
    and view_kind='project_totals' and current_start='2025-08-01'),
  'AC-006 project totals copy the three native summary positions verbatim without arithmetic');
select ok((select statement_update_delayed=false and statement_full_ledger_replay_needed
  and statement_last_attempt_at='2026-10-18T09:00:00Z'::timestamptz
  and statement_calendar='[{"start":"2024-07-01","end":"2025-06-30"},{"start":"2025-07-01","end":"2026-06-30"}]'::jsonb
  from public.external_org_bindings where org_id='03190000-0000-0000-0000-000000000001' and external_tier='erpnext'),
  'AC-006 native success updates only native delayed/calendar while retaining independent ledger replay and last attempt');
select is((select count(*)::int from public.erp_financial_statement_report_batch
  where org_id='03190000-0000-0000-0000-000000000001'),0,
  'AC-006 successful publication removes its transient header');
select is((select count(*)::int from public.erp_financial_statement_report_pending
  where org_id='03190000-0000-0000-0000-000000000001'),0,
  'AC-006 successful publication cascades cleanup of only the owning pending batch');

-- Reconcile a lost publish response by its immutable source_generation without mutation.
update public.erp_sweep_lock set locked_until=clock_timestamp()-interval '1 second'
where org_id='03190000-0000-0000-0000-000000000001';
set local role service_role;
select throws_ok($$select public.publish_erp_financial_statements('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_drift))$$,
  '55000',null,'AC-006 expired holder cannot use the identical publish reconciliation path');
reset role;
update public.erp_sweep_lock set locked_until=clock_timestamp()+interval '15 minutes'
where org_id='03190000-0000-0000-0000-000000000001';
set local role service_role;
select is(public.publish_erp_financial_statements('03190000-0000-0000-0000-000000000001',
  '03190000-0000-0000-0000-000000000101',(select (result->>'batchId')::uuid from native_drift)),
  (select snapshot_id from native_published),'AC-006 repeat publish returns the stored snapshot UUID');
reset role;
select is((select count(*)::int from public.erp_financial_statement_snapshot
  where org_id='03190000-0000-0000-0000-000000000001'),155,
  'AC-006 idempotent publish reconciliation does not mutate a completed generation');

select * from finish();
rollback;
