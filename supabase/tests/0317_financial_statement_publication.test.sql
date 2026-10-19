-- AC-006: native publication replaces the unreleased computed-producer fixture contract.
begin;
create extension if not exists pgtap;
select no_plan();

select ok(to_regprocedure('public.publish_erp_financial_statements(uuid,text,uuid,uuid,timestamptz,jsonb,jsonb)') is null
  and to_regprocedure('public.open_erp_statement_report_batch(uuid,uuid,jsonb)') is not null
  and to_regprocedure('public.stage_erp_statement_report(uuid,uuid,uuid,jsonb)') is not null
  and to_regprocedure('public.publish_erp_financial_statements(uuid,uuid,uuid)') is not null,
  'AC-006 old calculator publisher is absent and exact native routes exist');
select ok((select bool_and(has_function_privilege('service_role',p.oid,'EXECUTE')
  and not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('authenticated',p.oid,'EXECUTE'))
  from pg_proc p where p.oid in (
    to_regprocedure('public.open_erp_statement_report_batch(uuid,uuid,jsonb)'),
    to_regprocedure('public.stage_erp_statement_report(uuid,uuid,uuid,jsonb)'),
    to_regprocedure('public.publish_erp_financial_statements(uuid,uuid,uuid)'))),
  'AC-006 each native service route has only its exact service_role execution grant');

insert into public.organizations(id,name,default_currency,default_timezone)
values ('03170000-0000-0000-0000-000000000001','Synthetic native publication org','IDR','UTC');
set local role service_role;
insert into public.external_org_bindings
 (id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at,
  statement_full_ledger_replay_needed,statement_update_delayed,statement_last_attempt_at,statement_calendar)
values ('03170000-0000-0000-0000-000000000001','03170000-0000-0000-0000-000000000001','erpnext',
        'https://example.invalid','native-fixture',16,'{"company":"Native Producer Co"}',
        '2026-10-18T09:00:00Z',true,false,'2026-10-18T08:30:00Z',
        '[{"start":"2024-07-01","end":"2025-06-30"}]');
insert into public.erp_sweep_lock(org_id,locked_until,holder)
values ('03170000-0000-0000-0000-000000000001',clock_timestamp()+interval '15 minutes',
        '03170000-0000-0000-0000-000000000101');
reset role;
create temporary table native_producer_context(context jsonb not null) on commit drop;
insert into native_producer_context values ('{
  "binding":{"id":"03170000-0000-0000-0000-000000000001","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16},
  "company":"Native Producer Co","profile":{"erpVersion":"16.33.0","frappeVersion":"16.31.0"},
  "calendar":[{"name":"FY24-25","start":"2024-07-01","end":"2025-06-30"}],"projectMap":{},"language":"en",
  "presentation":{"metadata":{"erpVersion":"16.33.0","frappeVersion":"16.31.0","currency":"IDR","defaultFinanceBook":null,"hasFinanceBooks":false,"calendar":[{"name":"FY24-25","start":"2024-07-01","end":"2025-06-30"}],"currencyPrecision":2,"roundingMethod":"erpnext_report_output","fractionUnits":100,"ignoreOpeningCheck":false,"ignoreAccountClosingBalance":false},"context":{"requestLanguage":"en","currencyPrecisionBranch":"currency_number_format","raw":{"company":{"name":"Native Producer Co","currency":"IDR","defaultFinanceBook":null},"accountsSettings":{"ignoreOpeningCheck":0,"ignoreAccountClosingBalance":0},"currency":{"fractionUnits":100,"numberFormat":"#,###.##"}}}},
  "filterProfile":"erpnext-v16-standard-statements-v1"
}'::jsonb);
grant select on native_producer_context to service_role;
create temporary table native_producer_open(result jsonb) on commit drop;
grant select,insert on native_producer_open to service_role;
set local role service_role;
insert into native_producer_open
select public.open_erp_statement_report_batch('03170000-0000-0000-0000-000000000001',
  '03170000-0000-0000-0000-000000000101',context) from native_producer_context;
reset role;
select is((select count(*)::int from public.erp_financial_statement_report_pending
  where org_id='03170000-0000-0000-0000-000000000001'),84,
  'AC-006 native capture plans company report pairs without consulting mirrored chart or ledger rows');
select ok((select statement_full_ledger_replay_needed and statement_update_delayed
  and statement_last_attempt_at='2026-10-18T08:30:00Z'::timestamptz
  and statement_calendar='[{"start":"2024-07-01","end":"2025-06-30"}]'::jsonb
  from public.external_org_bindings where org_id='03170000-0000-0000-0000-000000000001' and external_tier='erpnext')
  and not exists(select 1 from public.erp_account_mirror where org_id='03170000-0000-0000-0000-000000000001')
  and not exists(select 1 from public.erp_gl_entry_mirror where org_id='03170000-0000-0000-0000-000000000001'),
  'AC-006 native open preserves replay and prior success/calendar while remaining independent of empty chart/GL mirrors');
select ok((select bool_and(normalized_report is null and raw_response_text is null and raw_sha256 is null and acquired_at is null)
  from public.erp_financial_statement_report_pending where org_id='03170000-0000-0000-0000-000000000001'),
  'AC-006 native plan is immutable and contains no captured payload until each report is staged');

select * from finish();
rollback;
