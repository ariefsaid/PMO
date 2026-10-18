-- AC-005: failed pre-context refreshes preserve the old publication and report delayed status.
begin;
create extension if not exists pgtap;
select no_plan();
select ok(to_regprocedure('public.mark_erp_statement_report_refresh_attempt(uuid,uuid,jsonb)') is not null,
  'AC-005 exact pre-context attempt RPC exists');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp']
  from pg_proc where oid=to_regprocedure('public.mark_erp_statement_report_refresh_attempt(uuid,uuid,jsonb)')),
  'AC-005 attempt RPC is SECURITY DEFINER with fixed search_path');
select ok(has_function_privilege('service_role','public.mark_erp_statement_report_refresh_attempt(uuid,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.mark_erp_statement_report_refresh_attempt(uuid,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.mark_erp_statement_report_refresh_attempt(uuid,uuid,jsonb)','EXECUTE')
  and not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid=to_regprocedure('public.mark_erp_statement_report_refresh_attempt(uuid,uuid,jsonb)')
      and acl.grantee=0 and acl.privilege_type='EXECUTE'),
  'AC-005 only service_role can execute the attempt RPC');

insert into public.organizations(id,name,default_currency,default_timezone) values
 ('03200000-0000-0000-0000-000000000001','Synthetic native status org','IDR','UTC'),
 ('03200000-0000-0000-0000-000000000002','Synthetic foreign status org','IDR','UTC');
insert into auth.users(id,email) values ('03200000-0000-0000-0000-0000000000a1','native-status-finance@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('03200000-0000-0000-0000-0000000000a1','03200000-0000-0000-0000-000000000001',
  'Synthetic status Finance','native-status-finance@example.test','Finance','active');
set local role service_role;
insert into public.external_org_bindings
 (id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at,
  statement_full_ledger_replay_needed,statement_update_delayed,statement_last_attempt_at,statement_calendar)
values
 ('03200000-0000-0000-0000-000000000011','03200000-0000-0000-0000-000000000001','erpnext',
  'https://synthetic.invalid','fixture',16,'{"company":"Status Test Co","project_map":{}}',
  '2026-10-18T09:00:00Z',false,false,'2026-10-18T08:00:00Z','[{"start":"2024-01-01","end":"2024-12-31"}]'),
 ('03200000-0000-0000-0000-000000000012','03200000-0000-0000-0000-000000000002','erpnext',
  'https://synthetic.invalid','fixture',16,'{"company":"Foreign Status Co","project_map":{}}',
  '2026-10-18T09:00:00Z',false,false,'2026-10-18T08:00:00Z','[{"start":"2024-01-01","end":"2024-12-31"}]');
insert into public.erp_sweep_lock(org_id,locked_until,holder) values
 ('03200000-0000-0000-0000-000000000001',clock_timestamp()+interval '15 minutes','03200000-0000-0000-0000-000000000021'),
 ('03200000-0000-0000-0000-000000000002',clock_timestamp()+interval '15 minutes','03200000-0000-0000-0000-000000000022');
insert into public.erp_financial_statement_snapshot
 (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
  current_start,current_end,prior_start,prior_end,currency,as_of,source_report,report_version,filters,settings,
  payload,has_activity,display_precision,display_rounding_method,raw_reports,capture_started_at,capture_completed_at)
values ('03200000-0000-0000-0000-000000000001','Status Test Co',
 '03200000-0000-0000-0000-000000000031','03200000-0000-0000-0000-000000000032',
 'profit_and_loss','company',null,'account_breakdown','month','2024-02-01','2024-02-29','2024-01-01','2024-01-31',
 'IDR','2026-10-18T07:00:02Z','Profit and Loss Statement','16.33.0','{"current":{},"prior":{}}','{"currencyPrecision":2}',
 '{"current":{"reportName":"Profit and Loss Statement","side":"current","source":{"rows":[{"account":"Revenue","value":"42.00"}]}},
   "prior":{"reportName":"Profit and Loss Statement","side":"prior","source":{"rows":[]}}}',
 true,2,'Commercial Rounding','{"current":"native-current-raw","prior":"native-prior-raw"}',
 '2026-10-18T07:00:00Z','2026-10-18T07:00:02Z');
insert into public.erp_financial_statement_report_batch(org_id,batch_id,started_at,context) values
 ('03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000041',
  '2026-10-18T06:00:00Z','{"capture":"retained"}');
insert into public.erp_financial_statement_report_pending
 (org_id,batch_id,statement,period_kind,current_start,current_end,prior_start,prior_end,side,ordinal,
  normalized_report,raw_response_text,raw_sha256,acquired_at)
values ('03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000041',
 'profit_and_loss','month','2024-02-01','2024-02-29','2024-01-01','2024-01-31','current',1,
 '{"captured":true}','private native response',repeat('a',64),'2026-10-18T06:01:00Z');
reset role;

create temporary table before_rows as
select to_jsonb(b)-'statement_update_delayed' binding,to_jsonb(s) snapshot,
       to_jsonb(h) header,to_jsonb(p) pending
from public.external_org_bindings b
join public.erp_financial_statement_snapshot s on s.org_id=b.org_id
join public.erp_financial_statement_report_batch h on h.org_id=b.org_id
join public.erp_financial_statement_report_pending p on p.org_id=h.org_id
where b.org_id='03200000-0000-0000-0000-000000000001';
create temporary table before_read(catalogue jsonb,detail jsonb);
create temporary table after_read(catalogue jsonb,detail jsonb);
grant select,insert on before_read,after_read to authenticated;
grant select on before_rows to service_role;
set local role authenticated;
set local request.jwt.claims='{"sub":"03200000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into before_read values(public.get_financial_statement_catalogue(),
  public.get_financial_statement('month','2024-02-01','profit_and_loss'));
select is((select catalogue->'generation'->>'delayed' from before_read),'false',
  'AC-005 complete old generation begins not delayed');
select is((select detail->'result'->'payload' from before_read),
  '{"current":{"reportName":"Profit and Loss Statement","side":"current","source":{"rows":[{"account":"Revenue","value":"42.00"}]}},
    "prior":{"reportName":"Profit and Loss Statement","side":"prior","source":{"rows":[]}}}'::jsonb,
  'AC-005 Finance reads the old native payload');
reset role;

set local role service_role;
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000099',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16,"company":"Status Test Co","projectMap":{}}')$$,
 '55000',null,'AC-005 wrong holder is rejected');
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-17T09:00:00Z","versionMajor":16,"company":"Status Test Co","projectMap":{}}')$$,
 '55000',null,'AC-005 stale activation epoch is rejected');
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":15,"company":"Status Test Co","projectMap":{}}')$$,
 '55000',null,'AC-005 stale ERP major is rejected');
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16,"company":"Other Co","projectMap":{}}')$$,
 '55000',null,'AC-005 stale company is rejected');
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16,"company":"Status Test Co","projectMap":{"foreign":"Project"}}')$$,
 '55000',null,'AC-005 stale project map is rejected');
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000099","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16,"company":"Status Test Co","projectMap":{}}')$$,
 '55000',null,'AC-005 stale binding id is rejected');
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16,"company":"Status Test Co","projectMap":{},"other":true}')$$,
 '22023',null,'AC-005 extra descriptor field is malformed');
update public.erp_sweep_lock set locked_until=clock_timestamp()-interval '1 second'
 where org_id='03200000-0000-0000-0000-000000000001';
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16,"company":"Status Test Co","projectMap":{}}')$$,
 '55000',null,'AC-005 expired lease is rejected');
update public.erp_sweep_lock set locked_until=clock_timestamp()+interval '15 minutes'
 where org_id='03200000-0000-0000-0000-000000000001';
delete from public.erp_sweep_lock where org_id='03200000-0000-0000-0000-000000000001';
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16,"company":"Status Test Co","projectMap":{}}')$$,
 '55000',null,'AC-005 absent lease is rejected');
insert into public.erp_sweep_lock(org_id,locked_until,holder)
 values('03200000-0000-0000-0000-000000000001',clock_timestamp()+interval '15 minutes','03200000-0000-0000-0000-000000000021');
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000022',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16,"company":"Status Test Co","projectMap":{}}')$$,
 '55000',null,'AC-005 a foreign organization holder cannot mark this binding');
select is((select statement_update_delayed from public.external_org_bindings
 where org_id='03200000-0000-0000-0000-000000000001'),false,'AC-005 every rejected admission leaves current status unchanged');
select is((select statement_update_delayed from public.external_org_bindings
 where org_id='03200000-0000-0000-0000-000000000002'),false,'AC-005 foreign status remains unchanged');

select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00+00:00","versionMajor":16,"company":"Status Test Co","projectMap":{}}');
select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16,"company":"Status Test Co","projectMap":{}}');
select is((select statement_update_delayed from public.external_org_bindings
 where org_id='03200000-0000-0000-0000-000000000001'),true,
 'AC-005 current lease and equal binding epoch marks delayed and repeat stays idempotent');
select ok((select to_jsonb(b)-'statement_update_delayed'=x.binding
 from public.external_org_bindings b cross join before_rows x
 where b.org_id='03200000-0000-0000-0000-000000000001'),'AC-005 other binding status fields remain unchanged');
select ok((select to_jsonb(s)=x.snapshot from public.erp_financial_statement_snapshot s cross join before_rows x
 where s.org_id='03200000-0000-0000-0000-000000000001'),'AC-005 snapshot/raw reports/as-of/capture time remain unchanged');
select ok((select to_jsonb(h)=x.header and to_jsonb(p)=x.pending
 from public.erp_financial_statement_report_batch h join public.erp_financial_statement_report_pending p on p.org_id=h.org_id
 cross join before_rows x where h.org_id='03200000-0000-0000-0000-000000000001'),
 'AC-005 existing batch and pending raw custody remain unchanged');
reset role;

set local role authenticated;
set local request.jwt.claims='{"sub":"03200000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into after_read values(public.get_financial_statement_catalogue(),
  public.get_financial_statement('month','2024-02-01','profit_and_loss'));
select is((select catalogue->'generation'->>'delayed' from after_read),'true',
 'AC-005 Finance catalogue reports the admitted attempt');
select ok((select ((a.catalogue->'generation')-'delayed')=((b.catalogue->'generation')-'delayed')
 and ((a.detail->'generation')-'delayed')=((b.detail->'generation')-'delayed')
 from after_read a cross join before_read b),
 'AC-005 old snapshot id, generation, as-of and capture window remain unchanged');
select is((select detail->'result'->'payload' from after_read),
 (select detail->'result'->'payload' from before_read),
 'AC-005 Finance receives the exact old native payload');
select is((select detail->'result'->'period' from after_read),
 (select detail->'result'->'period' from before_read),
 'AC-005 Finance retains the old comparison window');
reset role;

set local role anon;
set local request.jwt.claims='{}';
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16,"company":"Status Test Co","projectMap":{}}')$$,
 '42501',null,'AC-005 anon cannot execute the service RPC');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"03200000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.mark_erp_statement_report_refresh_attempt(
 '03200000-0000-0000-0000-000000000001','03200000-0000-0000-0000-000000000021',
 '{"id":"03200000-0000-0000-0000-000000000011","activatedAt":"2026-10-18T09:00:00Z","versionMajor":16,"company":"Status Test Co","projectMap":{}}')$$,
 '42501',null,'AC-005 authenticated Finance cannot execute the service RPC');
select * from finish();
rollback;
