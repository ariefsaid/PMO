-- AC-004: project staff can directly read only the exact whitelisted totals payload for visible projects.
begin;
create extension if not exists pgtap;
select no_plan();

select has_table('public', 'erp_financial_statement_snapshot',
  'AC-004 statement snapshot table exists');

insert into public.organizations (id, name, default_currency, default_timezone) values
  ('03161000-0000-0000-0000-000000000001', 'Statement totals org A', 'IDR', 'UTC'),
  ('03161000-0000-0000-0000-000000000002', 'Statement totals org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('03161000-0000-0000-0000-0000000000a1', 'totals-pm@example.test'),
  ('03161000-0000-0000-0000-0000000000a2', 'totals-engineer@example.test'),
  ('03161000-0000-0000-0000-0000000000a3', 'totals-finance@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('03161000-0000-0000-0000-0000000000a1', '03161000-0000-0000-0000-000000000001', 'Synthetic PM', 'totals-pm@example.test', 'Project Manager', 'active'),
  ('03161000-0000-0000-0000-0000000000a2', '03161000-0000-0000-0000-000000000001', 'Synthetic Engineer', 'totals-engineer@example.test', 'Engineer', 'active'),
  ('03161000-0000-0000-0000-0000000000a3', '03161000-0000-0000-0000-000000000001', 'Synthetic Finance', 'totals-finance@example.test', 'Finance', 'active');
insert into public.projects
  (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
   tax_base_numerator, tax_base_denominator, subject_to_vat, project_manager_id)
values
  ('03161000-0000-0000-0000-0000000000d1', '03161000-0000-0000-0000-000000000001', 'Visible synthetic project', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0, 0, 1, 1, false, '03161000-0000-0000-0000-0000000000a1'),
  ('03161000-0000-0000-0000-0000000000d2', '03161000-0000-0000-0000-000000000002', 'Foreign synthetic project', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0, 0, 1, 1, false, null);

reset role;
set local request.jwt.claims = '{}';
set local role service_role;
insert into public.erp_financial_statement_snapshot
  (org_id, company, snapshot_id, source_generation, statement, scope_kind, project_id, view_kind,
   period_kind, current_start, current_end, prior_start, prior_end, currency, as_of,
   source_report, report_version, filters, settings, payload, has_activity,
   display_precision, display_rounding_method)
values
  ('03161000-0000-0000-0000-000000000001', 'Synthetic Co', '03161000-0000-0000-0000-000000000101', '03161000-0000-0000-0000-000000000201', 'profit_and_loss', 'project', '03161000-0000-0000-0000-0000000000d1', 'project_totals', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31', 'IDR', '2026-02-01 00:00:00+00', null, null, null, null, '{"current":{"income":"120.00","expense":"30.00","net":"90.00"},"prior":{"income":"80.00","expense":"20.00","net":"60.00"}}', true, 2, 'Commercial Rounding'),
  ('03161000-0000-0000-0000-000000000001', 'Synthetic Co', '03161000-0000-0000-0000-000000000102', '03161000-0000-0000-0000-000000000202', 'profit_and_loss', 'project', '03161000-0000-0000-0000-0000000000d1', 'project_totals', 'month', '2026-02-01', '2026-02-28', '2026-01-01', '2026-01-31', 'IDR', '2026-03-01 00:00:00+00', null, null, null, null, '{"current":{"income":"0","expense":"0","net":"0"},"prior":{"income":"0","expense":"0","net":"0"}}', false, 0, 'Banker''s Rounding'),
  ('03161000-0000-0000-0000-000000000001', 'Synthetic Co', '03161000-0000-0000-0000-000000000103', '03161000-0000-0000-0000-000000000203', 'profit_and_loss', 'project', '03161000-0000-0000-0000-0000000000d1', 'project_totals', 'month', '2026-03-01', '2026-03-31', '2026-02-01', '2026-02-28', 'IDR', '2026-04-01 00:00:00+00', null, null, null, null, '{"current":{"income":"1.000000000e+0","expense":"-0.0","net":"0E-3"},"prior":{"income":"-0","expense":"0.0","net":"-0.0"}}', true, 9, 'Banker''s Rounding (legacy)'),
  ('03161000-0000-0000-0000-000000000001', 'Synthetic Co', '03161000-0000-0000-0000-000000000104', '03161000-0000-0000-0000-000000000204', 'profit_and_loss', 'project', '03161000-0000-0000-0000-0000000000d2', 'project_totals', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31', 'IDR', '2026-02-01 00:00:00+00', null, null, null, null, '{"current":{"income":"999.00","expense":"0","net":"999.00"},"prior":{"income":"0","expense":"0","net":"0"}}', true, 2, 'Commercial Rounding'),
  ('03161000-0000-0000-0000-000000000001', 'Synthetic Co', '03161000-0000-0000-0000-000000000105', '03161000-0000-0000-0000-000000000205', 'profit_and_loss', 'project', '03161000-0000-0000-0000-0000000000d1', 'account_breakdown', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31', 'IDR', '2026-02-01 00:00:00+00', 'Profit and Loss', '16.33.0/16.31.0', '{"current":{},"prior":{}}', '{"precision":2}', '{"rows":[{"key":"synthetic-account","accountName":"Synthetic account"}]}', true, 2, 'Commercial Rounding'),
  ('03161000-0000-0000-0000-000000000001', 'Synthetic Co', '03161000-0000-0000-0000-000000000106', '03161000-0000-0000-0000-000000000206', 'profit_and_loss', 'company', null, 'account_breakdown', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31', 'IDR', '2026-02-01 00:00:00+00', 'Profit and Loss', '16.33.0/16.31.0', '{"current":{},"prior":{}}', '{"precision":2}', '{"rows":[]}', true, 2, 'Commercial Rounding');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"03161000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 3,
  'AC-004 PM sees only totals for the one project visible under projects RLS');
select is((select count(*)::int from public.erp_financial_statement_snapshot where current_start = '2026-01-01'), 1,
  'AC-004 PM cannot read a foreign project total, project detail or company statement');
select ok((select scope_kind = 'project' and view_kind = 'project_totals'
                  and statement = 'profit_and_loss' and project_id = '03161000-0000-0000-0000-0000000000d1'
                  and currency = 'IDR' and display_precision = 2
                  and display_rounding_method = 'Commercial Rounding'
                  and source_report is null and report_version is null and filters is null and settings is null
                  and payload = '{"current":{"income":"120.00","expense":"30.00","net":"90.00"},"prior":{"income":"80.00","expense":"20.00","net":"60.00"}}'::jsonb
           from public.erp_financial_statement_snapshot where snapshot_id = '03161000-0000-0000-0000-000000000101'),
  'AC-004 directly readable totals row has only the signed monetary and structural fields');
select ok((select payload - array['current','prior'] = '{}'::jsonb
                  and payload ?& array['current','prior']
                  and (payload->'current') - array['income','expense','net'] = '{}'::jsonb
                  and (payload->'current') ?& array['income','expense','net']
                  and (payload->'prior') - array['income','expense','net'] = '{}'::jsonb
                  and (payload->'prior') ?& array['income','expense','net']
                  and jsonb_typeof(payload->'current'->'income') = 'string'
                  and jsonb_typeof(payload->'current'->'expense') = 'string'
                  and jsonb_typeof(payload->'current'->'net') = 'string'
                  and jsonb_typeof(payload->'prior'->'income') = 'string'
                  and jsonb_typeof(payload->'prior'->'expense') = 'string'
                  and jsonb_typeof(payload->'prior'->'net') = 'string'
           from public.erp_financial_statement_snapshot where snapshot_id = '03161000-0000-0000-0000-000000000101'),
  'AC-004 totals JSON has exactly current/prior income/expense/net as decimal strings');
select ok(not jsonb_path_exists(to_jsonb((select payload from public.erp_financial_statement_snapshot where snapshot_id = '03161000-0000-0000-0000-000000000101')),
                  '$.**.account')
          and not jsonb_path_exists(to_jsonb((select payload from public.erp_financial_statement_snapshot where snapshot_id = '03161000-0000-0000-0000-000000000101')),
                  '$.**.party')
          and not jsonb_path_exists(to_jsonb((select payload from public.erp_financial_statement_snapshot where snapshot_id = '03161000-0000-0000-0000-000000000101')),
                  '$.**.voucher'),
  'AC-004 direct totals payload contains no account, party or voucher detail');
set local request.jwt.claims = '{"sub":"03161000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 3,
  'AC-004 Engineer sees only the same visible-project totals');
select is((select count(*)::int from public.erp_financial_statement_snapshot where view_kind <> 'project_totals'), 0,
  'AC-004 Engineer sees neither detail nor company-wide statement rows');
set local request.jwt.claims = '{"sub":"03161000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 6,
  'AC-004 Finance retains company and account-detail access alongside project totals');
reset role;
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','company','account_breakdown','month','2026-01-01','2026-01-31','2025-12-01','2025-12-31','IDR',now(),'{"rows":[]}',false,2,'Commercial Rounding')$$,
  '23505', null, 'AC-004 full scope key treats NULL project scope identities as duplicates');

-- Exact totals whitelist: all malformed cases must fail at the owning row CHECK, not be hidden by a client projection.
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2026-04-01','2026-04-30','2026-03-01','2026-03-31','IDR',now(),'{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"},"company_total":"1"}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 totals CHECK rejects an extra top-level payload key');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2026-05-01','2026-05-31','2026-04-01','2026-04-30','IDR',now(),'{"current":{"expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 totals CHECK rejects a missing income key');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2026-06-01','2026-06-30','2026-05-01','2026-05-31','IDR',now(),'{"current":{"income":1,"expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 totals CHECK rejects JSON-number money');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2026-07-01','2026-07-31','2026-06-01','2026-06-30','IDR',now(),'{"current":{"income":"1","expense":"0","net":"1","rows":[{"account":"secret","party":"secret","voucher":"secret"}]},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 totals CHECK rejects nested account/party/voucher detail');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,source_report,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2026-08-01','2026-08-31','2026-07-01','2026-07-31','IDR',now(),'Profit and Loss','{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 totals CHECK requires SQL NULL detail provenance');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,filters,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2026-09-01','2026-09-30','2026-08-01','2026-08-31','IDR',now(),'{}','{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 totals CHECK requires SQL NULL filters');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,settings,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2026-10-01','2026-10-31','2026-09-01','2026-09-30','IDR',now(),'{}','{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 totals CHECK requires SQL NULL settings');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2026-11-01','2026-11-30','2026-10-01','2026-10-31','IDR',now(),'{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,-1,'Commercial Rounding')$$,
  '23514', null, 'AC-004 display precision lower bound is enforced');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2026-12-01','2026-12-31','2026-11-01','2026-11-30','IDR',now(),'{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,10,'Commercial Rounding')$$,
  '23514', null, 'AC-004 display precision upper bound is enforced');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2027-01-01','2027-01-31','2026-12-01','2026-12-31','IDR',now(),'{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'Unknown Rounding')$$,
  '23514', null, 'AC-004 only the three signed display rounding modes are accepted');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2027-01-01','2027-01-31','2026-12-01','2026-12-31','IDR',now(),'{"current":{"income":"NaN","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 totals CHECK rejects non-decimal special-value text');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2027-01-01','2027-01-31','2026-12-01','2026-12-31','IDR',now(),'{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,null,'Commercial Rounding')$$,
  '23502', null, 'AC-004 display precision cannot be null');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2027-01-01','2027-01-31','2026-12-01','2026-12-31','IDR',now(),'{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,null)$$,
  '23502', null, 'AC-004 display rounding method cannot be null');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2027-01-01','2027-01-31','2026-12-01','2026-12-31','IDR',now(),'{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'')$$,
  '23514', null, 'AC-004 blank display rounding method is rejected');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'trial_balance','project','03161000-0000-0000-0000-0000000000d1','account_breakdown','month','2027-02-01','2027-02-28','2027-01-01','2027-01-31','IDR',now(),'{"rows":[]}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 project scope is restricted to project P&L');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','company','project_totals','month','2027-03-01','2027-03-31','2027-02-01','2027-02-28','IDR',now(),'{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 company scope cannot use the project-totals view');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','unassigned','project_totals','month','2027-04-01','2027-04-30','2027-03-01','2027-03-31','IDR',now(),'{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 unassigned scope cannot use the project-totals view');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project',null,'account_breakdown','month','2027-05-01','2027-05-31','2027-04-01','2027-04-30','IDR',now(),'{"rows":[]}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 project scope requires a project identity');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','company','03161000-0000-0000-0000-0000000000d1','account_breakdown','month','2027-06-01','2027-06-30','2027-05-01','2027-05-31','IDR',now(),'{"rows":[]}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 company scope cannot carry a project identity');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','company','account_breakdown','month','2027-07-01','2027-07-31','2027-06-01','2027-06-30','USD',now(),'{"rows":[]}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 only IDR currency is accepted');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','account_breakdown','month','2027-08-31','2027-08-01','2027-07-01','2027-07-31','IDR',now(),'{"rows":[]}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 each period range must be ordered');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','account_breakdown','week','2027-09-01','2027-09-30','2027-08-01','2027-08-31','IDR',now(),'{"rows":[]}',false,2,'Commercial Rounding')$$,
  '23514', null, 'AC-004 period_kind is constrained to the signed set');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,project_id,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03161000-0000-0000-0000-000000000001','Synthetic Co',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','project','03161000-0000-0000-0000-0000000000d1','project_totals','month','2026-01-01','2026-01-31','2025-12-01','2025-12-31','IDR',now(),'{"current":{"income":"1","expense":"0","net":"1"},"prior":{"income":"0","expense":"0","net":"0"}}',false,2,'Commercial Rounding')$$,
  '23505', null, 'AC-004 full signed scope and paired-period key is unique with NULL-safe scope identity');

select has_column('public', 'erp_financial_statement_snapshot', 'display_precision',
  'AC-004 native display precision is carried in its dedicated scalar column');
select has_column('public', 'erp_financial_statement_snapshot', 'display_rounding_method',
  'AC-004 native display rounding method is carried in its dedicated scalar column');
select is((select count(*)::int from public.erp_financial_statement_snapshot where view_kind = 'project_totals'), 4,
  'AC-004 valid payloads at display precisions 0, 2 and 9 and all three modes persist');
select ok((select payload->'current'->>'income'='1.000000000e+0'
  and payload->'current'->>'expense'='-0.0' and payload->'current'->>'net'='0E-3'
  and payload->'prior'->>'income'='-0' and payload->'prior'->>'expense'='0.0'
  and payload->'prior'->>'net'='-0.0'
  from public.erp_financial_statement_snapshot where snapshot_id='03161000-0000-0000-0000-000000000103'),
  'AC-004 native lexical exponent and signed-zero totals tokens remain unchanged');

select * from finish();
rollback;
