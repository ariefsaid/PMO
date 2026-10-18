-- AC-003/004/006/007/008 support: one authorized, coherent read envelope over stored publication rows.
begin;
create extension if not exists pgtap;
select no_plan();

select has_function('public', 'get_financial_statement_catalogue', array['uuid'],
  'AC-006 catalogue RPC has one exact UUID signature');
select has_function('public', 'get_financial_statement', array['text','date','text','uuid','text','boolean'],
  'AC-006 read RPC has one exact six-argument signature');
select has_view('public', 'erp_financial_statement_availability',
  'AC-003 safe availability view exists');

insert into public.organizations(id,name,default_currency,default_timezone) values
 ('03180000-0000-0000-0000-000000000001','Synthetic statement read org','IDR','UTC'),
 ('03180000-0000-0000-0000-000000000002','Synthetic statement no-run org','IDR','UTC'),
 ('03180000-0000-0000-0000-000000000003','Synthetic statement other org','IDR','UTC');
insert into auth.users(id,email) values
 ('03180000-0000-0000-0000-0000000000a1','statement-read-admin@example.test'),
 ('03180000-0000-0000-0000-0000000000a2','statement-read-finance@example.test'),
 ('03180000-0000-0000-0000-0000000000a3','statement-read-executive@example.test'),
 ('03180000-0000-0000-0000-0000000000a4','statement-read-pm@example.test'),
 ('03180000-0000-0000-0000-0000000000a5','statement-read-engineer@example.test'),
 ('03180000-0000-0000-0000-0000000000a6','statement-read-no-profile@example.test'),
 ('03180000-0000-0000-0000-0000000000a7','statement-read-no-run@example.test'),
 ('03180000-0000-0000-0000-0000000000a8','statement-read-foreign@example.test'),
 ('03180000-0000-0000-0000-0000000000a9','statement-read-banned@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('03180000-0000-0000-0000-0000000000a1','03180000-0000-0000-0000-000000000001','Synthetic Admin','statement-read-admin@example.test','Admin','active'),
 ('03180000-0000-0000-0000-0000000000a2','03180000-0000-0000-0000-000000000001','Synthetic Finance','statement-read-finance@example.test','Finance','active'),
 ('03180000-0000-0000-0000-0000000000a3','03180000-0000-0000-0000-000000000001','Synthetic Executive','statement-read-executive@example.test','Executive','active'),
 ('03180000-0000-0000-0000-0000000000a4','03180000-0000-0000-0000-000000000001','Synthetic PM','statement-read-pm@example.test','Project Manager','active'),
 ('03180000-0000-0000-0000-0000000000a5','03180000-0000-0000-0000-000000000001','Synthetic Engineer','statement-read-engineer@example.test','Engineer','active'),
 ('03180000-0000-0000-0000-0000000000a7','03180000-0000-0000-0000-000000000002','Synthetic Finance no-run','statement-read-no-run@example.test','Finance','active'),
 ('03180000-0000-0000-0000-0000000000a8','03180000-0000-0000-0000-000000000003','Synthetic foreign Finance','statement-read-foreign@example.test','Finance','active'),
 ('03180000-0000-0000-0000-0000000000a9','03180000-0000-0000-0000-000000000001','Synthetic banned Finance','statement-read-banned@example.test','Finance','active');
insert into public.projects
 (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
  tax_base_numerator,tax_base_denominator,subject_to_vat,project_manager_id)
values
 ('03180000-0000-0000-0000-0000000000d1','03180000-0000-0000-0000-000000000001','Visible synthetic project','Ongoing Project','IDR',1000,'exclusive',0,0,1,1,false,'03180000-0000-0000-0000-0000000000a4'),
 ('03180000-0000-0000-0000-0000000000d2','03180000-0000-0000-0000-000000000003','Foreign synthetic project','Ongoing Project','IDR',1000,'exclusive',0,0,1,1,false,null),
 ('03180000-0000-0000-0000-0000000000d3','03180000-0000-0000-0000-000000000001','Visible unmapped synthetic project','Ongoing Project','IDR',1000,'exclusive',0,0,1,1,false,'03180000-0000-0000-0000-0000000000a4');
update auth.users set banned_until=now()+interval '1 hour'
where id='03180000-0000-0000-0000-0000000000a9';

reset role;
set local request.jwt.claims='{}';
set local role service_role;
insert into public.external_org_bindings
 (id,org_id,external_tier,site_url,secret_ref,version_major,config,activated_at,
  statement_full_ledger_replay_needed,statement_update_delayed,statement_last_attempt_at,statement_calendar)
values
 ('03180000-0000-0000-0000-000000000001','03180000-0000-0000-0000-000000000001','erpnext','https://synthetic.invalid','fixture',16,
  '{"company":"Synthetic Current Co","project_map":{"03180000-0000-0000-0000-0000000000d1":"Synthetic ERP Project"}}',
  '2024-02-01T00:00:00Z',false,true,'2024-03-01T12:35:00Z','[{"start":"2024-01-01","end":"2024-12-31","name":"MUST NOT LEAK"}]'),
 ('03180000-0000-0000-0000-000000000002','03180000-0000-0000-0000-000000000002','erpnext','https://synthetic.invalid','fixture',16,
  '{"company":"Synthetic No Run Co"}','2024-02-01T00:00:00Z',false,true,null,'[{"start":"2024-01-01","end":"2024-12-31"}]');
insert into public.erp_financial_statement_snapshot
 (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
  current_start,current_end,prior_start,prior_end,currency,as_of,source_report,report_version,filters,
  settings,payload,has_activity,display_precision,display_rounding_method)
values
 ('03180000-0000-0000-0000-000000000001','Synthetic Current Co','03180000-0000-0000-0000-000000000101','03180000-0000-0000-0000-000000000201','trial_balance','company',null,'account_breakdown','month','2024-02-01','2024-02-29','2024-01-01','2024-01-31','IDR','2024-03-01T12:34:56Z','Trial Balance','16.33.0','{"current":{},"prior":{}}','{"precision":3}','{"rows":[]}',false,3,'Commercial Rounding'),
 ('03180000-0000-0000-0000-000000000001','Synthetic Current Co','03180000-0000-0000-0000-000000000101','03180000-0000-0000-0000-000000000201','profit_and_loss','company',null,'account_breakdown','month','2024-02-01','2024-02-29','2024-01-01','2024-01-31','IDR','2024-03-01T12:34:56Z','Profit and Loss Statement','16.33.0','{"current":{},"prior":{}}','{"precision":3}','{"rows":[{"key":"SYNTHETIC-REVENUE","parentKey":null,"depth":0,"accountName":"Synthetic revenue","accountNumber":"4000","kind":"account","current":"7.25","prior":"0"}]}',true,3,'Commercial Rounding'),
 ('03180000-0000-0000-0000-000000000001','Synthetic Current Co','03180000-0000-0000-0000-000000000101','03180000-0000-0000-0000-000000000201','balance_sheet','company',null,'account_breakdown','month','2024-02-01','2024-02-29','2024-01-01','2024-01-31','IDR','2024-03-01T12:34:56Z','Balance Sheet','16.33.0','{"current":{},"prior":{}}','{"precision":3}','{"rows":[]}',false,3,'Commercial Rounding'),
 ('03180000-0000-0000-0000-000000000001','Synthetic Current Co','03180000-0000-0000-0000-000000000101','03180000-0000-0000-0000-000000000201','profit_and_loss','unassigned',null,'account_breakdown','month','2024-02-01','2024-02-29','2024-01-01','2024-01-31','IDR','2024-03-01T12:34:56Z','Profit and Loss Statement','16.33.0','{"current":{},"prior":{}}','{"precision":3}','{"rows":[]}',false,3,'Commercial Rounding'),
 ('03180000-0000-0000-0000-000000000001','Synthetic Current Co','03180000-0000-0000-0000-000000000101','03180000-0000-0000-0000-000000000201','profit_and_loss','project','03180000-0000-0000-0000-0000000000d1','account_breakdown','month','2024-02-01','2024-02-29','2024-01-01','2024-01-31','IDR','2024-03-01T12:34:56Z','Profit and Loss Statement','16.33.0','{"current":{},"prior":{}}','{"precision":3}','{"rows":[]}',false,3,'Commercial Rounding'),
 ('03180000-0000-0000-0000-000000000001','Synthetic Current Co','03180000-0000-0000-0000-000000000101','03180000-0000-0000-0000-000000000201','profit_and_loss','project','03180000-0000-0000-0000-0000000000d1','project_totals','month','2024-02-01','2024-02-29','2024-01-01','2024-01-31','IDR','2024-03-01T12:34:56Z',null,null,null,null,
  '{"current":{"income":"7.25","expense":"3","net":"4.25"},"prior":{"income":"0","expense":"0","net":"0"}}',true,3,'Commercial Rounding'),
 ('03180000-0000-0000-0000-000000000001','Synthetic Current Co','03180000-0000-0000-0000-000000000101','03180000-0000-0000-0000-000000000201','profit_and_loss','company',null,'account_breakdown','month','2024-03-01','2024-03-31','2024-02-01','2024-02-29','IDR','2024-03-01T12:34:56Z','Profit and Loss Statement','16.33.0','{"current":{},"prior":{}}','{"precision":3}','{"rows":[]}',false,3,'Commercial Rounding'),
 ('03180000-0000-0000-0000-000000000001','Synthetic Current Co','03180000-0000-0000-0000-000000000101','03180000-0000-0000-0000-000000000201','profit_and_loss','company',null,'account_breakdown','quarter','2023-10-01','2023-12-31','2023-07-01','2023-09-30','IDR','2024-03-01T12:34:56Z','Profit and Loss Statement','16.33.0','{"current":{},"prior":{}}','{"precision":3}','{"rows":[]}',false,3,'Commercial Rounding'),
 ('03180000-0000-0000-0000-000000000001','Synthetic Current Co','03180000-0000-0000-0000-000000000101','03180000-0000-0000-0000-000000000201','profit_and_loss','company',null,'account_breakdown','fiscal_year','2023-04-01','2024-03-31','2022-04-01','2023-03-31','IDR','2024-03-01T12:34:56Z','Profit and Loss Statement','16.33.0','{"current":{},"prior":{}}','{"precision":3}','{"rows":[]}',false,3,'Commercial Rounding'),
 -- A newer obsolete-company row must not become availability or satisfy the current binding.
 ('03180000-0000-0000-0000-000000000001','Synthetic Old Co','03180000-0000-0000-0000-000000000199','03180000-0000-0000-0000-000000000299','profit_and_loss','company',null,'account_breakdown','month','2024-04-01','2024-04-30','2024-03-01','2024-03-31','IDR','2099-01-01T00:00:00Z','Profit and Loss Statement','16.33.0','{}','{}','{"rows":[]}',false,1,'Banker''s Rounding');
update public.erp_financial_statement_snapshot
set payload=case when view_kind='account_breakdown' then jsonb_build_object(
      'current',jsonb_build_object('reportName',source_report,'side','current','source',payload),
      'prior',jsonb_build_object('reportName',source_report,'side','prior','source',payload)) else payload end,
    raw_reports=case when view_kind='account_breakdown' then
      '{"current":"{}","prior":"{}"}'::jsonb else null end,
    capture_started_at=as_of-interval '1 second',capture_completed_at=as_of
where org_id='03180000-0000-0000-0000-000000000001' and company='Synthetic Current Co'
  and scope_kind<>'unassigned';
reset role;

select ok((select not prosecdef and provolatile='s' and proconfig @> array['search_path=public, pg_temp']
  from pg_proc where oid=to_regprocedure('public.get_financial_statement_catalogue(uuid)')),
  'AC-006 catalogue is STABLE SECURITY INVOKER with fixed search_path');
select ok((select not prosecdef and provolatile='s' and proconfig @> array['search_path=public, pg_temp']
  from pg_proc where oid=to_regprocedure('public.get_financial_statement(text,date,text,uuid,text,boolean)')),
  'AC-006 read is STABLE SECURITY INVOKER with fixed search_path');
select is((select proargnames::text from pg_proc where oid=to_regprocedure('public.get_financial_statement_catalogue(uuid)')),
  '{p_project_id}', 'AC-006 catalogue has only its exact named argument');
select is((select proargnames::text from pg_proc where oid=to_regprocedure('public.get_financial_statement(text,date,text,uuid,text,boolean)')),
  '{p_period_kind,p_period_start,p_statement,p_project_id,p_view_kind,p_unassigned}',
  'AC-006 read has only its exact named arguments');
select ok(has_function_privilege('authenticated','public.get_financial_statement_catalogue(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.get_financial_statement(text,date,text,uuid,text,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.get_financial_statement_catalogue(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_financial_statement(text,date,text,uuid,text,boolean)','EXECUTE')
  and not has_function_privilege('service_role','public.get_financial_statement_catalogue(uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.get_financial_statement(text,date,text,uuid,text,boolean)','EXECUTE')
  and not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid in (to_regprocedure('public.get_financial_statement_catalogue(uuid)'),to_regprocedure('public.get_financial_statement(text,date,text,uuid,text,boolean)'))
      and acl.grantee=0 and acl.privilege_type='EXECUTE'),
  'AC-006 only authenticated can execute the two exact read RPCs');
select is((select array_agg(a.attname::text order by a.attnum)::text
  from pg_attribute a where a.attrelid='public.erp_financial_statement_availability'::regclass and a.attnum>0 and not a.attisdropped),
  '{company_label,calendar,last_success_at,snapshot_id,source_generation,delayed,capture_started_at,capture_completed_at}',
  'AC-003 availability view exposes safe native generation window fields');
select ok((select reloptions @> array['security_barrier=true']
  and not reloptions @> array['security_invoker=true']
  from pg_class where oid='public.erp_financial_statement_availability'::regclass)
  and (select pg_get_userbyid(relowner)='postgres' from pg_class where oid='public.erp_financial_statement_availability'::regclass),
  'AC-003 availability view is security-barrier and owned by the migration owner');
select ok(has_table_privilege('authenticated','public.erp_financial_statement_availability','SELECT')
  and not has_table_privilege('authenticated','public.erp_financial_statement_availability','INSERT')
  and not has_table_privilege('authenticated','public.erp_financial_statement_availability','UPDATE')
  and not has_table_privilege('authenticated','public.erp_financial_statement_availability','DELETE')
  and not has_table_privilege('anon','public.erp_financial_statement_availability','SELECT')
  and not has_table_privilege('service_role','public.erp_financial_statement_availability','SELECT'),
  'AC-003 availability grants are authenticated SELECT only');

set local role authenticated;
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select ok((select company_label='Synthetic Current Co' and last_success_at='2024-03-01T12:34:56Z'
  and snapshot_id='03180000-0000-0000-0000-000000000101'::uuid
  and source_generation='03180000-0000-0000-0000-000000000201'::uuid and delayed
  and calendar='[{"start":"2024-01-01","end":"2024-12-31"}]'::jsonb
  and (to_jsonb(availability)-array['company_label','calendar','last_success_at','snapshot_id','source_generation','delayed','capture_started_at','capture_completed_at'])='{}'::jsonb
  from public.erp_financial_statement_availability availability),
  'AC-003 view anchors current bound company tuple and exposes only start/end safe calendar pairs');
select is(public.get_financial_statement_catalogue()->>'state','complete',
  'AC-006 Finance catalogue is complete only from stored current-generation rows');
select is((select array_agg(key order by key)::text from jsonb_object_keys(public.get_financial_statement_catalogue()) as keys(key)),
  '{companyLabel,generation,periods,scopes,state}',
  'AC-006 catalogue envelope has exactly the five signed top-level keys');
select is((select count(*)::int from pg_proc where proname in ('get_financial_statement_catalogue','get_financial_statement')),
  2,'AC-006 no alternate read RPC overloads exist');
select is(public.get_financial_statement_catalogue()->'companyLabel','"Synthetic Current Co"'::jsonb,
  'AC-003 Finance catalogue carries the active bound company label');
select is(jsonb_array_length(public.get_financial_statement_catalogue()->'periods'),4,
  'AC-007 catalogue periods come from stored current generation, not the mutable calendar');
select is(public.get_financial_statement_catalogue()->'periods'->0,
  '{"kind":"fiscal_year","currentStart":"2023-04-01","currentEnd":"2024-03-31","priorStart":"2022-04-01","priorEnd":"2023-03-31"}'::jsonb,
  'AC-007 non-January fiscal-year dates are read from their stored row');
select is(public.get_financial_statement_catalogue()->'periods'->1,
  '{"kind":"quarter","currentStart":"2023-10-01","currentEnd":"2023-12-31","priorStart":"2023-07-01","priorEnd":"2023-09-30"}'::jsonb,
  'AC-007 non-January quarter and prior dates are read from their stored row');
select is(public.get_financial_statement_catalogue()->'periods'->2->>'currentStart','2024-02-01',
  'AC-007 stored month pairs sort by current start');
select is(public.get_financial_statement_catalogue()->'scopes',
  '[{"scopeKind":"company","projectId":null,"statements":["trial_balance","profit_and_loss","balance_sheet"],"viewKinds":["account_breakdown"]}]'::jsonb,
  'AC-006 native company catalogue contains only the company scope and never unassigned or project detail');
select is(public.get_financial_statement_catalogue('03180000-0000-0000-0000-0000000000d1')->'scopes',
  '[{"scopeKind":"project","projectId":"03180000-0000-0000-0000-0000000000d1","statements":["profit_and_loss"],"viewKinds":["account_breakdown","project_totals"]}]'::jsonb,
  'AC-004 project catalogue contains only that visible project and its stored views');
select ok((public.get_financial_statement_catalogue()->'generation') =
  '{"snapshotId":"03180000-0000-0000-0000-000000000101","sourceGeneration":"03180000-0000-0000-0000-000000000201","asOf":"2024-03-01T12:34:56+00:00","captureStartedAt":"2024-03-01T12:34:55+00:00","captureCompletedAt":"2024-03-01T12:34:56+00:00","currency":"IDR","presentation":{"precision":3,"roundingMethod":"Commercial Rounding"},"delayed":true}'::jsonb,
  'AC-006 generation tuple and presentation come from one snapshot row');
select ok((public.get_financial_statement('month','2024-02-01','profit_and_loss')->'selection') =
  '{"periodKind":"month","periodStart":"2024-02-01","statement":"profit_and_loss","scopeKind":"company","projectId":null,"viewKind":"account_breakdown"}'::jsonb,
  'AC-006 company read returns the exact normalized selection');
select is((select array_agg(key order by key)::text from jsonb_object_keys(public.get_financial_statement('month','2024-02-01','profit_and_loss')) as keys(key)),
  '{companyLabel,generation,result,selection,state}',
  'AC-006 read envelope has exactly the five signed top-level keys');
select is((select array_agg(key order by key)::text from jsonb_object_keys(public.get_financial_statement('month','2024-02-01','profit_and_loss')->'result') as keys(key)),
  '{hasActivity,payload,period,provenance,viewKind}',
  'AC-006 detail result has exactly its five signed keys and no storage metadata');
select is((select array_agg(key order by key)::text
  from jsonb_object_keys(public.get_financial_statement('month','2024-02-01','profit_and_loss')->'result'->'payload') as keys(key)),
  '{current,prior}','AC-006 detail payload is the exact stored native pair with no accounts shadow or raw body');
select ok((public.get_financial_statement('month','2024-02-01','profit_and_loss')->'result'->'period') =
  '{"kind":"month","currentStart":"2024-02-01","currentEnd":"2024-02-29","priorStart":"2024-01-01","priorEnd":"2024-01-31"}'::jsonb,
  'AC-007 read returns both stored leap-year period columns');
select is(public.get_financial_statement('quarter','2023-10-01','profit_and_loss')->'result'->'period',
  '{"kind":"quarter","currentStart":"2023-10-01","currentEnd":"2023-12-31","priorStart":"2023-07-01","priorEnd":"2023-09-30"}'::jsonb,
  'AC-007 requested quarter selection preserves its stored current/prior pair');
select is(public.get_financial_statement('fiscal_year','2023-04-01','profit_and_loss')->'result'->'period',
  '{"kind":"fiscal_year","currentStart":"2023-04-01","currentEnd":"2024-03-31","priorStart":"2022-04-01","priorEnd":"2023-03-31"}'::jsonb,
  'AC-007 requested fiscal-year selection preserves its stored current/prior pair');
select ok((public.get_financial_statement('month','2024-02-01','profit_and_loss')->'result'->'provenance') ?& array['sourceReport','reportVersion','filters','settings']
  and not ((public.get_financial_statement('month','2024-02-01','profit_and_loss')->'result'->'provenance') ? 'org_id')
  and not ((public.get_financial_statement('month','2024-02-01','profit_and_loss')->'result') ? 'raw_reports')
  and not ((public.get_financial_statement('month','2024-02-01','profit_and_loss')->'result'->'payload') ? 'accounts'),
  'AC-003 Finance detail receives safe provenance without storage identity');
select ok((public.get_financial_statement('month','2024-02-01','trial_balance')->'result'->>'hasActivity')='false'
  and (public.get_financial_statement('month','2024-02-01','trial_balance')->'state')='"complete"'::jsonb,
  'AC-008 complete-empty remains complete with its stored activity flag');
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.get_financial_statement_catalogue()->>'state','complete',
  'AC-003 persisted Finance profile can read the company catalogue');
select is(public.get_financial_statement('month','2024-02-01','profit_and_loss')->>'state','complete',
  'AC-003 Finance can read company detail');
select throws_ok($$select public.get_financial_statement('month','2024-02-01','profit_and_loss',null,'account_breakdown',true)$$,
  '22023','Invalid statement selection','AC-003 native detail rejects the retired unassigned selection');
select is(public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d1','account_breakdown')->'result'->>'viewKind','account_breakdown',
  'AC-004 Finance can read visible project detail');
select ok(public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d1','project_totals')->'result'->'payload' =
    '{"current":{"income":"7.25","expense":"3","net":"4.25"},"prior":{"income":"0","expense":"0","net":"0"}}'::jsonb
  and not (public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d1','project_totals')->'result' ? 'provenance'),
  'AC-004 Finance can read exact project totals without detail provenance');
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(public.get_financial_statement_catalogue()->>'state','complete',
  'AC-003 persisted Executive profile can read the company catalogue');
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select ok((public.get_financial_statement('month','2024-04-01','profit_and_loss')->'state')='"unavailable"'::jsonb
  and (public.get_financial_statement('month','2024-04-01','profit_and_loss')->'result')='null'::jsonb
  and (public.get_financial_statement('month','2024-04-01','profit_and_loss')->'generation'->>'snapshotId')='03180000-0000-0000-0000-000000000101',
  'AC-008 removed requested period is unavailable, never fabricated as zero');
select throws_ok($$select public.get_financial_statement('month','2024-02-01','profit_and_loss',null,'account_breakdown',true)$$,
  '22023','Invalid statement selection','AC-003 no unassigned detail selection is exposed');
select ok((public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d1','project_totals')->'result'->'payload') =
  '{"current":{"income":"7.25","expense":"3","net":"4.25"},"prior":{"income":"0","expense":"0","net":"0"}}'::jsonb
  and not ((public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d1','project_totals')->'result') ? 'provenance'),
  'AC-004 project totals retain exact decimal strings and omit provenance entirely');
select throws_ok($$select public.get_financial_statement('month','2024-02-01','trial_balance','03180000-0000-0000-0000-0000000000d1','project_totals')$$,
  '22023','Invalid statement selection','AC-004 forged incompatible project statement/view is rejected');
select throws_ok($$select public.get_financial_statement('month','infinity','profit_and_loss')$$,
  '22023','Invalid statement selection','AC-006 non-finite period date is rejected with the neutral invalid-selection error');
select throws_ok($$select public.get_financial_statement('month','2024-02-01','profit_and_loss',p_admin_bypass=>true)$$,
  '42883',null,'AC-003 unknown named arguments cannot add an authorization bypass');
select throws_ok($$select public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d2','project_totals')$$,
  '42501',null,'AC-004 foreign project is denied by actual projects visibility before lookup');
select throws_ok($$select public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d9','project_totals')$$,
  '42501',null,'AC-004 nonexistent project is indistinguishable from foreign or RLS-hidden project');
select throws_ok($$select public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d1','project_totals',true)$$,
  '22023','Invalid statement selection','AC-004 contradictory unassigned and project scope is invalid');
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.get_financial_statement_catalogue()$$,
  '42501',null,'AC-004 null-project company catalogue is Finance-only');
select throws_ok($$select public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d1','account_breakdown')$$,
  '42501',null,'AC-004 Project Manager cannot read project account detail');
select throws_ok($$select public.get_financial_statement('month','2024-02-01','profit_and_loss',null,'account_breakdown',true)$$,
  '22023','Invalid statement selection','AC-004 Project Manager cannot request retired unassigned company scope');
select ok((select company_label is null and snapshot_id='03180000-0000-0000-0000-000000000101'::uuid
  from public.erp_financial_statement_availability),
  'AC-003 project staff availability never exposes the bound company label');
select ok((public.get_financial_statement_catalogue('03180000-0000-0000-0000-0000000000d1')->'scopes') =
  '[{"scopeKind":"project","projectId":"03180000-0000-0000-0000-0000000000d1","statements":["profit_and_loss"],"viewKinds":["project_totals"]}]'::jsonb,
  'AC-004 project staff catalogue is totals-only under snapshot RLS');
select is(public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d1','project_totals')->'result'->'payload'->'current'->>'income','7.25',
  'AC-004 PM receives authorized project totals');
select is((select count(*)::int from public.erp_financial_statement_snapshot),1,
  'AC-004 project staff direct snapshot RLS exposes only authorized project totals');
select ok(public.get_financial_statement_catalogue('03180000-0000-0000-0000-0000000000d3')->>'state'='unavailable'
  and public.get_financial_statement_catalogue('03180000-0000-0000-0000-0000000000d3')->'companyLabel'='null'::jsonb
  and public.get_financial_statement_catalogue('03180000-0000-0000-0000-0000000000d3')->'scopes'='[]'::jsonb,
  'AC-008 visible project without mapped publication remains unavailable without company fallback');
select throws_ok($$select public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d1','project_totals',true)$$,
  '22023','Invalid statement selection','AC-004 contradictory scope fails with neutral invalid-selection error');
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is(public.get_financial_statement('month','2024-02-01','profit_and_loss','03180000-0000-0000-0000-0000000000d1','project_totals')->'state',
  '"complete"'::jsonb,'AC-004 Engineer receives the same authorized project totals envelope');
select throws_ok($$select public.get_financial_statement('month','2024-02-01','profit_and_loss')$$,
  '42501',null,'AC-004 Engineer cannot request company scope');
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select throws_ok($$select public.get_financial_statement_catalogue('03180000-0000-0000-0000-0000000000d1')$$,
  '42501',null,'AC-003 caller without an active profile is not in the signed statement role set');
select is((select count(*)::int from public.erp_financial_statement_availability),0,
  'AC-003 caller without an active profile has no safe availability row');
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a9","role":"authenticated"}';
select throws_ok($$select public.get_financial_statement_catalogue()$$,
  '42501',null,'AC-003 banned active-profile member cannot execute statement reads');
select is((select count(*)::int from public.erp_financial_statement_availability),0,
  'AC-003 banned active-profile member receives no availability row');
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select is(public.get_financial_statement_catalogue()->>'state','unavailable',
  'AC-008 active bound company without a success has an unavailable catalogue');
select is(public.get_financial_statement_catalogue()->'companyLabel','"Synthetic No Run Co"'::jsonb,
  'AC-008 bound company label remains readable without a successful generation');
select is(public.get_financial_statement_catalogue()->'generation','null'::jsonb,
  'AC-008 no first publication has no fabricated generation');
select is(public.get_financial_statement_catalogue()->'periods','[]'::jsonb,
  'AC-008 early calendar is not advertised before a successful publication');
select is((select count(*)::int from public.erp_financial_statement_availability),1,
  'AC-003 no successful generation still has one safe active-binding availability row');
select is((select count(*)::int from public.erp_financial_statement_snapshot),0,
  'AC-004 an authorized Finance member without publication has no snapshot rows');
reset role;
set local role anon;
set local request.jwt.claims='{}';
select throws_ok($$select public.get_financial_statement_catalogue()$$,
  '42501',null,'AC-003 anonymous callers cannot execute authenticated read RPCs');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a8","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_availability),0,
  'AC-003 no active ERP binding yields no availability view row');
select is(public.get_financial_statement_catalogue()->>'state','unavailable',
  'AC-008 authorized caller without an active binding receives unavailable, not a company fallback');
select is(public.get_financial_statement_catalogue()->'companyLabel','null'::jsonb,
  'AC-003 no active binding has no company label');
reset role;

-- Current roles are read from the persisted profile, not from JWT metadata or a stale client claim.
set local role authenticated;
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a2","role":"authenticated","app_metadata":{"role":"Project Manager"}}';
select is(public.get_financial_statement_catalogue()->>'state','complete',
  'AC-003 persisted Finance role permits the finance catalogue despite forged JWT role metadata');
reset role;
update public.profiles set role='Project Manager' where id='03180000-0000-0000-0000-0000000000a2';
set local role authenticated;
select throws_ok($$select public.get_financial_statement_catalogue()$$,
  '42501',null,'AC-003 persisted role change immediately narrows finance catalogue access');
reset role;
update public.profiles set role='Finance' where id='03180000-0000-0000-0000-0000000000a2';
update public.profiles set status='disabled' where id='03180000-0000-0000-0000-0000000000a2';
set local role authenticated;
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_availability),0,
  'AC-003 inactive persisted member receives no availability row');
select throws_ok($$select public.get_financial_statement_catalogue()$$,
  '42501',null,'AC-003 inactive persisted member cannot execute statement reads');
reset role;
update public.profiles set status='active' where id='03180000-0000-0000-0000-0000000000a2';

-- Inconsistency must not be filtered away to select an arbitrary generation/presentation.
set local request.jwt.claims='{}';
set local role service_role;
update public.erp_financial_statement_snapshot
set source_generation='03180000-0000-0000-0000-000000000202'
where org_id='03180000-0000-0000-0000-000000000001' and statement='balance_sheet';
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.get_financial_statement_catalogue()$$,
  '22023','Invalid statement selection','AC-006 mixed source generation is rejected, not silently joined');
reset role;
set local request.jwt.claims='{}';
set local role service_role;
update public.erp_financial_statement_snapshot
set source_generation='03180000-0000-0000-0000-000000000201'
where org_id='03180000-0000-0000-0000-000000000001' and statement='balance_sheet';
update public.erp_financial_statement_snapshot
set prior_start='2024-01-02'
where org_id='03180000-0000-0000-0000-000000000001' and statement='balance_sheet';
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.get_financial_statement_catalogue()$$,
  '22023','Invalid statement selection','AC-007 inconsistent current/prior period pair is rejected, not filtered');
reset role;
set local request.jwt.claims='{}';
set local role service_role;
update public.erp_financial_statement_snapshot
set prior_start='2024-01-01'
where org_id='03180000-0000-0000-0000-000000000001' and statement='balance_sheet';
update public.erp_financial_statement_snapshot
set display_precision=4
where org_id='03180000-0000-0000-0000-000000000001' and statement='balance_sheet';
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"03180000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.get_financial_statement_catalogue()$$,
  '22023','Invalid statement selection','AC-006 mixed presentation within one generation is rejected');
reset role;
set local request.jwt.claims='{}';
set local role service_role;
update public.erp_financial_statement_snapshot
set display_precision=3
where org_id='03180000-0000-0000-0000-000000000001' and statement='balance_sheet';
reset role;

select * from finish();
rollback;
