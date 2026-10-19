-- AC-003: direct statement snapshot access follows the signed real-role, active-member and project visibility contract.
begin;
create extension if not exists pgtap;
select no_plan();

select has_table('public', 'erp_financial_statement_snapshot',
  'AC-003 statement snapshot table exists');
select has_column('public','erp_financial_statement_snapshot','raw_reports','AC-003 raw report pair has a dedicated private detail column');
select has_column('public','erp_financial_statement_snapshot','capture_started_at','AC-006 capture window start is stored');
select has_column('public','erp_financial_statement_snapshot','capture_completed_at','AC-006 capture window completion is stored');

insert into public.organizations (id, name, default_currency, default_timezone) values
  ('03160000-0000-0000-0000-000000000001', 'Statement privacy org A', 'IDR', 'UTC'),
  ('03160000-0000-0000-0000-000000000002', 'Statement privacy org B', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('03160000-0000-0000-0000-0000000000a1', 'privacy-admin@example.test'),
  ('03160000-0000-0000-0000-0000000000a2', 'privacy-finance@example.test'),
  ('03160000-0000-0000-0000-0000000000a3', 'privacy-executive@example.test'),
  ('03160000-0000-0000-0000-0000000000a4', 'privacy-pm@example.test'),
  ('03160000-0000-0000-0000-0000000000a5', 'privacy-engineer@example.test'),
  ('03160000-0000-0000-0000-0000000000a6', 'privacy-foreign@example.test'),
  ('03160000-0000-0000-0000-0000000000a7', 'privacy-disabled@example.test'),
  ('03160000-0000-0000-0000-0000000000a8', 'privacy-banned@example.test'),
  ('03160000-0000-0000-0000-0000000000a9', 'privacy-role-change@example.test'),
  ('03160000-0000-0000-0000-0000000000aa', 'privacy-expired-ban@example.test'),
  ('03160000-0000-0000-0000-0000000000ab', 'privacy-no-profile@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('03160000-0000-0000-0000-0000000000a1', '03160000-0000-0000-0000-000000000001', 'Synthetic Admin', 'privacy-admin@example.test', 'Admin', 'active'),
  ('03160000-0000-0000-0000-0000000000a2', '03160000-0000-0000-0000-000000000001', 'Synthetic Finance', 'privacy-finance@example.test', 'Finance', 'active'),
  ('03160000-0000-0000-0000-0000000000a3', '03160000-0000-0000-0000-000000000001', 'Synthetic Executive', 'privacy-executive@example.test', 'Executive', 'active'),
  ('03160000-0000-0000-0000-0000000000a4', '03160000-0000-0000-0000-000000000001', 'Synthetic PM', 'privacy-pm@example.test', 'Project Manager', 'active'),
  ('03160000-0000-0000-0000-0000000000a5', '03160000-0000-0000-0000-000000000001', 'Synthetic Engineer', 'privacy-engineer@example.test', 'Engineer', 'active'),
  ('03160000-0000-0000-0000-0000000000a6', '03160000-0000-0000-0000-000000000002', 'Synthetic Foreign Finance', 'privacy-foreign@example.test', 'Finance', 'active'),
  ('03160000-0000-0000-0000-0000000000a7', '03160000-0000-0000-0000-000000000001', 'Synthetic Disabled Finance', 'privacy-disabled@example.test', 'Finance', 'disabled'),
  ('03160000-0000-0000-0000-0000000000a8', '03160000-0000-0000-0000-000000000001', 'Synthetic Banned Finance', 'privacy-banned@example.test', 'Finance', 'active'),
  ('03160000-0000-0000-0000-0000000000a9', '03160000-0000-0000-0000-000000000001', 'Synthetic Role Change', 'privacy-role-change@example.test', 'Finance', 'active'),
  ('03160000-0000-0000-0000-0000000000aa', '03160000-0000-0000-0000-000000000001', 'Synthetic Expired Ban', 'privacy-expired-ban@example.test', 'Finance', 'active');
insert into public.projects
  (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, tax_rate,
   tax_base_numerator, tax_base_denominator, subject_to_vat, project_manager_id)
values
  ('03160000-0000-0000-0000-0000000000d1', '03160000-0000-0000-0000-000000000001', 'Visible synthetic project', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0, 0, 1, 1, false, '03160000-0000-0000-0000-0000000000a4'),
  ('03160000-0000-0000-0000-0000000000d2', '03160000-0000-0000-0000-000000000002', 'Foreign synthetic project', 'Ongoing Project', 'IDR', 1000, 'exclusive', 0, 0, 1, 1, false, null);
update auth.users set banned_until = now() + interval '1 hour'
 where id = '03160000-0000-0000-0000-0000000000a8';
update auth.users set banned_until = now() - interval '1 hour'
 where id = '03160000-0000-0000-0000-0000000000aa';

reset role;
set local request.jwt.claims = '{}';
set local role service_role;
insert into public.erp_financial_statement_snapshot
  (org_id, company, snapshot_id, source_generation, statement, scope_kind, project_id, view_kind,
   period_kind, current_start, current_end, prior_start, prior_end, currency, as_of,
   source_report, report_version, filters, settings, payload, has_activity,
   display_precision, display_rounding_method)
values
  ('03160000-0000-0000-0000-000000000001', 'Synthetic Co A', '03160000-0000-0000-0000-000000000101', '03160000-0000-0000-0000-000000000201', 'trial_balance', 'company', null, 'account_breakdown', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31', 'IDR', '2026-02-01 00:00:00+00', 'Trial Balance', '16.33.0/16.31.0', '{"current":{},"prior":{}}', '{"precision":2}', '{"rows":[]}', true, 2, 'Commercial Rounding'),
  ('03160000-0000-0000-0000-000000000001', 'Synthetic Co A', '03160000-0000-0000-0000-000000000102', '03160000-0000-0000-0000-000000000202', 'profit_and_loss', 'unassigned', null, 'account_breakdown', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31', 'IDR', '2026-02-01 00:00:00+00', 'Profit and Loss', '16.33.0/16.31.0', '{"current":{},"prior":{}}', '{"precision":2}', '{"rows":[]}', true, 2, 'Commercial Rounding'),
  ('03160000-0000-0000-0000-000000000001', 'Synthetic Co A', '03160000-0000-0000-0000-000000000103', '03160000-0000-0000-0000-000000000203', 'profit_and_loss', 'project', '03160000-0000-0000-0000-0000000000d1', 'account_breakdown', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31', 'IDR', '2026-02-01 00:00:00+00', 'Profit and Loss', '16.33.0/16.31.0', '{"current":{},"prior":{}}', '{"precision":2}', '{"rows":[]}', true, 2, 'Commercial Rounding'),
  ('03160000-0000-0000-0000-000000000001', 'Synthetic Co A', '03160000-0000-0000-0000-000000000104', '03160000-0000-0000-0000-000000000204', 'profit_and_loss', 'project', '03160000-0000-0000-0000-0000000000d1', 'project_totals', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31', 'IDR', '2026-02-01 00:00:00+00', null, null, null, null,
   '{"current":{"income":"120.00","expense":"30.00","net":"90.00"},"prior":{"income":"80.00","expense":"20.00","net":"60.00"}}', true, 2, 'Commercial Rounding'),
  ('03160000-0000-0000-0000-000000000001', 'Synthetic Co A', '03160000-0000-0000-0000-000000000105', '03160000-0000-0000-0000-000000000205', 'profit_and_loss', 'project', '03160000-0000-0000-0000-0000000000d2', 'project_totals', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31', 'IDR', '2026-02-01 00:00:00+00', null, null, null, null,
   '{"current":{"income":"999.00","expense":"0","net":"999.00"},"prior":{"income":"0","expense":"0","net":"0"}}', true, 2, 'Commercial Rounding'),
  ('03160000-0000-0000-0000-000000000002', 'Synthetic Co B', '03160000-0000-0000-0000-000000000106', '03160000-0000-0000-0000-000000000206', 'balance_sheet', 'company', null, 'account_breakdown', 'month', '2026-01-01', '2026-01-31', '2025-12-01', '2025-12-31', 'IDR', '2026-02-01 00:00:00+00', 'Balance Sheet', '16.33.0/16.31.0', '{"current":{},"prior":{}}', '{"precision":2}', '{"rows":[]}', true, 2, 'Commercial Rounding');
update public.erp_financial_statement_snapshot
set payload='{"current":{"reportName":"Trial Balance","side":"current","rows":[]},"prior":{"reportName":"Trial Balance","side":"prior","rows":[]}}'::jsonb,
    raw_reports='{"current":"{}","prior":"{}"}'::jsonb,
    capture_started_at=as_of-interval '1 second',capture_completed_at=as_of
where snapshot_id='03160000-0000-0000-0000-000000000101';
reset role;

select ok((select count(*) = 5 and bool_and(
                    case attname
                      when 'id' then atttypid = 'uuid'::regtype
                      when 'org_id' then atttypid = 'uuid'::regtype
                      when 'snapshot_id' then atttypid = 'uuid'::regtype
                      when 'source_generation' then atttypid = 'uuid'::regtype
                      when 'display_precision' then atttypid = 'integer'::regtype
                    end)
             from pg_attribute
            where attrelid = 'public.erp_financial_statement_snapshot'::regclass
              and attname = any (array['id', 'org_id', 'snapshot_id', 'source_generation', 'display_precision']::name[])
              and not attisdropped),
  'AC-003 snapshot and source-generation identity columns have their required SQL types');
select ok((select column_default like '%auth_org_id%'
             from information_schema.columns
            where table_schema = 'public' and table_name = 'erp_financial_statement_snapshot' and column_name = 'org_id'),
  'AC-003 org identity defaults through the existing auth_org_id helper');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.erp_financial_statement_snapshot'::regclass
                   and tgname = 'erp_financial_statement_snapshot_stamp_org_id' and not tgisinternal
                   and pg_get_triggerdef(oid) like '%stamp_org_id%'),
  'AC-003 snapshot insert uses the existing org stamp trigger');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.erp_financial_statement_snapshot'::regclass
                   and contype = 'f' and conname = 'erp_financial_statement_snapshot_org_id_fkey'),
  'AC-003 snapshot org is protected by the organizations foreign key');
select ok(not exists (
  select 1 from pg_constraint c
  cross join lateral unnest(c.conkey) as key_column(attnum)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_column.attnum
  where c.conrelid = 'public.erp_financial_statement_snapshot'::regclass
    and c.contype = 'f' and a.attname = 'source_generation'
), 'AC-003 source generation remains a UUID identity, not a foreign-key relation');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.erp_financial_statement_snapshot'::regclass),
  'AC-003 snapshot table enables and forces row-level security');
select ok(has_table_privilege('authenticated', 'public.erp_financial_statement_snapshot', 'SELECT')
          and not has_table_privilege('authenticated', 'public.erp_financial_statement_snapshot', 'INSERT')
          and not has_table_privilege('authenticated', 'public.erp_financial_statement_snapshot', 'UPDATE')
          and not has_table_privilege('authenticated', 'public.erp_financial_statement_snapshot', 'DELETE'),
  'AC-003 authenticated receives SELECT only');
select ok(not has_table_privilege('anon', 'public.erp_financial_statement_snapshot', 'SELECT'),
  'AC-003 anonymous role has no direct table grant');
select ok(has_table_privilege('service_role', 'public.erp_financial_statement_snapshot', 'SELECT,INSERT,UPDATE,DELETE')
          and not has_table_privilege('service_role', 'public.erp_financial_statement_snapshot', 'TRUNCATE')
          and not has_table_privilege('service_role', 'public.erp_financial_statement_snapshot', 'REFERENCES')
          and not has_table_privilege('service_role', 'public.erp_financial_statement_snapshot', 'TRIGGER'),
  'AC-003 service role can maintain rows without table-wide structural privileges');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03160000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 5,
  'AC-003 active Admin reads all same-org detail and totals rows, not the foreign organization');
select throws_ok($$insert into public.erp_financial_statement_snapshot
  (org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,payload,has_activity,display_precision,display_rounding_method)
  values ('03160000-0000-0000-0000-000000000001','Synthetic Co A',gen_random_uuid(),gen_random_uuid(),'profit_and_loss','company','account_breakdown','month','2026-02-01','2026-02-28','2026-01-01','2026-01-31','IDR',now(),'{"rows":[]}',false,2,'Commercial Rounding')$$,
  '42501', null, 'AC-003 authenticated insert is denied');
select throws_ok($$update public.erp_financial_statement_snapshot set has_activity = false$$,
  '42501', null, 'AC-003 authenticated update is denied');
select throws_ok($$delete from public.erp_financial_statement_snapshot$$,
  '42501', null, 'AC-003 authenticated delete is denied');

set local request.jwt.claims = '{"sub":"03160000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 5,
  'AC-003 active Finance reads company, unassigned, project detail and totals');
select ok((select raw_reports='{"current":"{}","prior":"{}"}'::jsonb
  and capture_started_at< capture_completed_at and as_of=capture_completed_at
  from public.erp_financial_statement_snapshot where snapshot_id='03160000-0000-0000-0000-000000000101'),
  'AC-003 Finance detail retains raw pair privately with the server capture window');
set local request.jwt.claims = '{"sub":"03160000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 5,
  'AC-003 active Executive reads company, unassigned, project detail and totals');

set local request.jwt.claims = '{"sub":"03160000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 1,
  'AC-003 Project Manager reads only totals for a project visible through projects RLS');
select is((select count(*)::int from public.erp_financial_statement_snapshot where view_kind = 'account_breakdown'), 0,
  'AC-003 Project Manager reads no company, unassigned or project account-detail snapshot');
select is((select count(*)::int from public.erp_financial_statement_snapshot where scope_kind in ('company', 'unassigned')), 0,
  'AC-003 Project Manager reads neither company nor unassigned scope');
select is((select count(*)::int from public.erp_financial_statement_snapshot where scope_kind = 'project' and view_kind = 'account_breakdown'), 0,
  'AC-003 Project Manager reads no project account breakdown');
select is((select count(*)::int from public.erp_financial_statement_snapshot where project_id = '03160000-0000-0000-0000-0000000000d2'), 0,
  'AC-003 Project Manager cannot read totals for a foreign project');
select ok((select raw_reports is null from public.erp_financial_statement_snapshot
  where snapshot_id='03160000-0000-0000-0000-000000000104'),
  'AC-003 project staff totals never retain native raw report bodies');
select ok((select source_report is null and report_version is null and filters is null and settings is null
                  and raw_reports is null and payload ?& array['current','prior']
                  and not (payload ? 'rows')
           from public.erp_financial_statement_snapshot where snapshot_id = '03160000-0000-0000-0000-000000000104'),
  'AC-003 direct totals read has no detail provenance, filters, settings or row payload');
set local request.jwt.claims = '{"sub":"03160000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 1,
  'AC-003 Engineer receives the same visible-project totals-only scope');
select is((select count(*)::int from public.erp_financial_statement_snapshot where view_kind = 'account_breakdown'), 0,
  'AC-003 Engineer reads no detail snapshots');
select is((select count(*)::int from public.erp_financial_statement_snapshot where scope_kind in ('company', 'unassigned')), 0,
  'AC-003 Engineer reads neither company nor unassigned scope');
select is((select count(*)::int from public.erp_financial_statement_snapshot where scope_kind = 'project' and view_kind = 'account_breakdown'), 0,
  'AC-003 Engineer reads no project account breakdown');

set local request.jwt.claims = '{"sub":"03160000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 1,
  'AC-003 another organization reads only its own snapshot');
set local request.jwt.claims = '{"sub":"03160000-0000-0000-0000-0000000000a7","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 0,
  'AC-003 inactive member reads no statement rows');
set local request.jwt.claims = '{"sub":"03160000-0000-0000-0000-0000000000a8","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 0,
  'AC-003 currently banned member reads no statement rows');
set local request.jwt.claims = '{"sub":"03160000-0000-0000-0000-0000000000aa","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 5,
  'AC-003 active member with an expired ban reads authorized same-org rows');
set local request.jwt.claims = '{"sub":"03160000-0000-0000-0000-0000000000ab","role":"authenticated"}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 0,
  'AC-003 authenticated caller without a profile reads no statement rows');

set local request.jwt.claims = '{"sub":"03160000-0000-0000-0000-0000000000a9","role":"authenticated","app_metadata":{"role":"Admin"}}';
select is((select count(*)::int from public.erp_financial_statement_snapshot), 5,
  'AC-003 initial persisted Finance role controls the same JWT subject');
reset role;
update public.profiles set role = 'Project Manager' where id = '03160000-0000-0000-0000-0000000000a9';
set local role authenticated;
select is((select count(*)::int from public.erp_financial_statement_snapshot), 1,
  'AC-003 persisted Finance-to-PM role change immediately narrows access despite forged metadata');
reset role;
update public.profiles set role = 'Finance' where id = '03160000-0000-0000-0000-0000000000a9';
set local role anon;
set local request.jwt.claims = '{}';
select throws_ok($$select count(*) from public.erp_financial_statement_snapshot$$,
  '42501', null, 'AC-003 anonymous direct SELECT is denied');
reset role;

select * from finish();
rollback;
