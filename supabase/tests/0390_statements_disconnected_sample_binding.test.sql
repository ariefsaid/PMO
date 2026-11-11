-- 0390: a disconnected binding that keeps its Company still shows its last published statements, while
-- the org stays PMO-only for budget pushes; a really-disconnected binding (Company stripped) stays hidden.
begin;
create extension if not exists pgtap;
select no_plan();

insert into public.organizations(id,name,default_currency,default_timezone) values
 ('03900000-0000-0000-0000-000000000001','Synthetic sample org','IDR','UTC'),
 ('03900000-0000-0000-0000-000000000002','Synthetic disconnected org','IDR','UTC');
insert into auth.users(id,email) values
 ('03900000-0000-0000-0000-0000000000a1','sample-finance@example.test'),
 ('03900000-0000-0000-0000-0000000000a2','gone-finance@example.test');
insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('03900000-0000-0000-0000-0000000000a1','03900000-0000-0000-0000-000000000001','Sample Finance','sample-finance@example.test','Finance','active'),
 ('03900000-0000-0000-0000-0000000000a2','03900000-0000-0000-0000-000000000002','Gone Finance','gone-finance@example.test','Finance','active');
set local role service_role;
insert into public.external_org_bindings
 (id,org_id,external_tier,site_url,secret_ref,version_major,config,status,activated_at,
  statement_full_ledger_replay_needed,statement_update_delayed,statement_calendar)
values
 ('03900000-0000-0000-0000-000000000011','03900000-0000-0000-0000-000000000001','erpnext',
  'https://synthetic.invalid','fixture',16,'{"company":"Sample Co","project_map":{}}','disconnected',null,
  false,false,'[{"start":"2024-01-01","end":"2024-12-31"}]'),
 ('03900000-0000-0000-0000-000000000012','03900000-0000-0000-0000-000000000002','erpnext',
  'https://synthetic.invalid','fixture',null,'{"project_map":{}}','disconnected',null,
  false,false,'[{"start":"2024-01-01","end":"2024-12-31"}]');
insert into public.erp_financial_statement_snapshot
 (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,
  current_start,current_end,prior_start,prior_end,currency,as_of,source_report,report_version,filters,settings,
  payload,has_activity,display_precision,display_rounding_method,raw_reports,capture_started_at,capture_completed_at)
select o.org_id,o.company,o.snap,o.gen,'profit_and_loss','company',null,'account_breakdown','month',
 '2024-02-01','2024-02-29','2024-01-01','2024-01-31','IDR','2026-10-18T07:00:02Z','Profit and Loss Statement','16.33.0',
 '{"current":{},"prior":{}}','{"currencyPrecision":2}',
 '{"current":{"reportName":"Profit and Loss Statement","side":"current","source":{"rows":[]}},
   "prior":{"reportName":"Profit and Loss Statement","side":"prior","source":{"rows":[]}}}',
 true,2,'Commercial Rounding','{"current":"raw-current","prior":"raw-prior"}','2026-10-18T07:00:00Z','2026-10-18T07:00:02Z'
from (values
 ('03900000-0000-0000-0000-000000000001'::uuid,'Sample Co','03900000-0000-0000-0000-000000000031'::uuid,'03900000-0000-0000-0000-000000000032'::uuid),
 ('03900000-0000-0000-0000-000000000002'::uuid,'Gone Co','03900000-0000-0000-0000-000000000033'::uuid,'03900000-0000-0000-0000-000000000034'::uuid)
) o(org_id,company,snap,gen);
reset role;

select is(public.org_has_active_erpnext_binding('03900000-0000-0000-0000-000000000001'), false,
  '0390 a disconnected sample binding does not employ ERPNext, so budget activation stays PMO-only');

set local role authenticated;
set local request.jwt.claims='{"sub":"03900000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select company_label from public.erp_financial_statement_availability), 'Sample Co',
  '0390 a disconnected binding that keeps its Company exposes its availability row');
select is(public.get_financial_statement_catalogue()->>'state', 'complete',
  '0390 its last published statements stay readable');
select is(jsonb_typeof(public.get_financial_statement('month','2024-02-01','profit_and_loss')->'result'), 'object',
  '0390 its statement detail stays readable');

set local request.jwt.claims='{"sub":"03900000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*) from public.erp_financial_statement_availability), 0::bigint,
  '0390 a really-disconnected binding (Company stripped) stays hidden');
select is(public.get_financial_statement_catalogue()->>'state', 'unavailable',
  '0390 a really-disconnected org has no readable statements');
reset role;

select * from finish();
rollback;
