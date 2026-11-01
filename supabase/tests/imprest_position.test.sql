-- imprest_position.test.sql — #1515 site imprest S3: the float position, cash counts and plan usage. AC-IMP-050..052
-- (spec docs/specs/site-imprest.spec.md; plan S3.1, S3.3). F1 + F2 + AC-IMP-031's float-G setup (an advance paid
-- 1,000,000, 300,000 returned, a claim paid 500,000 settling 200,000 of it) + an Approved replenishment of 500,000 on G,
-- then an Approved plan on G with one exception item. Plan delta 8: AC-IMP-050's 800,000 is 500,000 here.
begin;
create extension if not exists pgtap;
select plan(18);
create extension if not exists dblink;


insert into organizations (id, name, default_currency, default_timezone) values
  ('15150000-0000-0000-0000-00000000000a', 'IMP Org',       'IDR', 'Asia/Jakarta'),
  ('15150000-0000-0000-0000-00000000000b', 'IMP Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15150000-0000-0000-0000-0000000000a1', 'imp-admin@example.com'),
  ('15150000-0000-0000-0000-0000000000a2', 'imp-fin1@example.com'),   -- Finance, custodian of float F (project P1)
  ('15150000-0000-0000-0000-0000000000a3', 'imp-fin2@example.com'),   -- Finance, not a custodian
  ('15150000-0000-0000-0000-0000000000a4', 'imp-pm1@example.com'),    -- PM, manages P1
  ('15150000-0000-0000-0000-0000000000a5', 'imp-pm2@example.com'),    -- PM, manages P2; custodian of float G
  ('15150000-0000-0000-0000-0000000000a6', 'imp-eng1@example.com'),   -- Engineer, claimant
  ('15150000-0000-0000-0000-0000000000a7', 'imp-exec@example.com'),   -- Executive, senior approver
  ('15150000-0000-0000-0000-0000000000b1', 'imp-xorg@example.com');   -- other-org Admin
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15150000-0000-0000-0000-0000000000a1', '15150000-0000-0000-0000-00000000000a', 'IMP Admin', 'imp-admin@example.com', 'Admin', 'active'),
  ('15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-00000000000a', 'IMP Fin1',  'imp-fin1@example.com',  'Finance', 'active'),
  ('15150000-0000-0000-0000-0000000000a3', '15150000-0000-0000-0000-00000000000a', 'IMP Fin2',  'imp-fin2@example.com',  'Finance', 'active'),
  ('15150000-0000-0000-0000-0000000000a4', '15150000-0000-0000-0000-00000000000a', 'IMP PM1',   'imp-pm1@example.com',   'Project Manager', 'active'),
  ('15150000-0000-0000-0000-0000000000a5', '15150000-0000-0000-0000-00000000000a', 'IMP PM2',   'imp-pm2@example.com',   'Project Manager', 'active'),
  ('15150000-0000-0000-0000-0000000000a6', '15150000-0000-0000-0000-00000000000a', 'IMP Eng1',  'imp-eng1@example.com',  'Engineer', 'active'),
  ('15150000-0000-0000-0000-0000000000a7', '15150000-0000-0000-0000-00000000000a', 'IMP Exec',  'imp-exec@example.com',  'Executive', 'active'),
  ('15150000-0000-0000-0000-0000000000b1', '15150000-0000-0000-0000-00000000000b', 'IMP XOrg',  'imp-xorg@example.com',  'Admin', 'active');
-- P1 managed by PM1 (float F), P2 managed by PM2 (float G), P3 managed by PM1 (no float; establishment tests)
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15150000-0000-0000-0000-0000000000c1', '15150000-0000-0000-0000-00000000000a', 'IMP Site One',   'Ongoing Project', '15150000-0000-0000-0000-0000000000a4'),
  ('15150000-0000-0000-0000-0000000000c2', '15150000-0000-0000-0000-00000000000a', 'IMP Site Two',   'Ongoing Project', '15150000-0000-0000-0000-0000000000a5'),
  ('15150000-0000-0000-0000-0000000000c3', '15150000-0000-0000-0000-00000000000a', 'IMP Site Three', 'Ongoing Project', '15150000-0000-0000-0000-0000000000a4');
-- senior approver set: the Executive only (PQ-5 route 'org')
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15150000-0000-0000-0000-00000000000a', null, '15150000-0000-0000-0000-0000000000a7');
insert into org_imprest_settings (org_id, procurement_limit, updated_by) values
  ('15150000-0000-0000-0000-00000000000a', 2000000, '15150000-0000-0000-0000-0000000000a1');
-- Float F: P1, custodian Fin1, 10,000,000. Float G: P2, custodian PM2 (the project's own PM), 5,000,000.
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000d1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1',
   '15150000-0000-0000-0000-0000000000a2', 10000000, 'IDR', '15150000-0000-0000-0000-0000000000a1'),
  ('15150000-0000-0000-0000-0000000000d2', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c2',
   '15150000-0000-0000-0000-0000000000a5', 5000000, 'IDR', '15150000-0000-0000-0000-0000000000a1');

-- helper: act as a member (jwt claims are transaction-local)
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, paid_by,
                                    requested_at, approved_at, paid_at, paid_on) values
  ('15150000-0000-0000-0000-0000000000e1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   'funding', 'REP-FIXTURE-F', 'Paid', 10000000, '15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-0000000000a3',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date),
  ('15150000-0000-0000-0000-0000000000e2', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2',
   'funding', 'REP-FIXTURE-G', 'Paid', 5000000, '15150000-0000-0000-0000-0000000000a5', '15150000-0000-0000-0000-0000000000a3',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date);

insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, paid_by_id, paid_at, paid_on, imprest_float_id, imprest_month,
                            returned_amount) values
  ('15150000-0000-0000-0000-000000000310', '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c2', 'Vehicle', 'adv G paid', 1000000, 'Paid', 'ADV-2611010310', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000a5', now(), current_date,
   '15150000-0000-0000-0000-0000000000d2', date_trunc('month', now() at time zone 'Asia/Jakarta')::date, 300000);
insert into expense_advance_returns (org_id, advance_id, amount, recorded_by, returned_on) values
  ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-000000000310', 300000, '15150000-0000-0000-0000-0000000000a5', current_date);
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, approved_at) values
  ('15150000-0000-0000-0000-0000000000e9', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2',
   'replenishment', 'REP-FIXTURE-G9', 'Approved', 500000, '15150000-0000-0000-0000-0000000000a5', '15150000-0000-0000-0000-0000000000a3', now());
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, paid_by_id, paid_at, paid_on, imprest_float_id, imprest_month,
                            advance_id, advance_applied, imprest_replenishment_id) values
  ('15150000-0000-0000-0000-000000000311', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c2', 'Vehicle', 'claim G paid', 500000, 'Paid', 'EXP-2611010311', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000a5', now(), current_date,
   '15150000-0000-0000-0000-0000000000d2', date_trunc('month', now() at time zone 'Asia/Jakarta')::date,
   '15150000-0000-0000-0000-000000000310', 200000, '15150000-0000-0000-0000-0000000000e9');

set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select is((select row(float_amount, cash_book, advances_out, receipts_waiting, replenishment_in_flight, gap)::text
             from get_imprest_position('15150000-0000-0000-0000-0000000000d2')),
  row(5000000.00, 4000000.00, 500000.00, 500000.00, 500000.00, 0.00)::text,
  'AC-IMP-050 the position returns float, cash, advances out, receipts waiting, in flight and gap 0');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from get_imprest_position('15150000-0000-0000-0000-0000000000d2')), 0,
  'AC-IMP-050 another org gets no rows');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from get_imprest_position('15150000-0000-0000-0000-0000000000d2')), 0,
  'AC-IMP-050 an Engineer, who sees no float, gets no rows');

-- counts: who may record one (custodian while eligible, Finance, Admin), and the note rule
select throws_ok($$ select record_imprest_count('15150000-0000-0000-0000-0000000000d2', 4000000, null) $$,
  '42501', null, 'AC-IMP-051 an Engineer cannot record a cash count');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select throws_ok($$ select record_imprest_count('15150000-0000-0000-0000-0000000000d2', 4000000, null) $$,
  '42501', null, 'AC-IMP-051 a Project Manager who is not the custodian cannot record a cash count');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');
select throws_ok($$ select record_imprest_count('15150000-0000-0000-0000-0000000000d2', 4000000, null) $$,
  'P0002', null, 'AC-IMP-051 another org''s Admin cannot record a count on this float');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');  -- PM2, G's custodian; book is 4,000,000
select throws_ok($$ select record_imprest_count('15150000-0000-0000-0000-0000000000d2', -1, 'x') $$,
  'P0001', null, 'AC-IMP-051 a negative count is refused');
select throws_like($$ select record_imprest_count('15150000-0000-0000-0000-0000000000d2', 3950000, null) $$,
  '%note%', 'AC-IMP-051 a count with a variance and no note is refused');
select lives_ok($$ select record_imprest_count('15150000-0000-0000-0000-0000000000d2', 3950000, 'one receipt missing') $$,
  'AC-IMP-051 with a note it is recorded');
select is((select row(book_amount, variance)::text from imprest_cash_counts where float_id = '15150000-0000-0000-0000-0000000000d2'),
  row(4000000.00, -50000.00)::text, 'AC-IMP-051 the book figure is frozen and the variance is counted − book');
select is((select last_count_variance from get_imprest_position('15150000-0000-0000-0000-0000000000d2')), -50000.00,
  'AC-IMP-051 the position shows the last count''s variance');
select throws_ok($$ update imprest_cash_counts set counted_amount = 1 $$, '42501', null, 'AC-IMP-051 a count cannot be updated');
select throws_ok($$ delete from imprest_cash_counts $$, '42501', null, 'AC-IMP-051 a count cannot be deleted');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2, Finance, not a custodian
select lives_ok($$ select record_imprest_count('15150000-0000-0000-0000-0000000000d2', 4000000, null) $$,
  'AC-IMP-051 Finance records a count that matches the book without a note');
reset role;
select ok(exists (select 1 from audit_events where action = 'imprest_count.recorded'), 'AC-IMP-051 an audit row exists');
update projects set project_manager_id = '15150000-0000-0000-0000-0000000000a4' where id = '15150000-0000-0000-0000-0000000000c2';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');  -- PM2 no longer manages P2
select throws_ok($$ select record_imprest_count('15150000-0000-0000-0000-0000000000d2', 4000000, null) $$,
  '42501', null, 'AC-IMP-051 a custodian who stopped managing the project cannot record a count');
reset role;
update projects set project_manager_id = '15150000-0000-0000-0000-0000000000a5' where id = '15150000-0000-0000-0000-0000000000c2';

-- AC-IMP-052: an Approved plan on G for this month (Vehicle 3,000,000) and one Approved exception item in Vehicle.
insert into imprest_plans (id, org_id, float_id, month, number, author_id) values
  ('15150000-0000-0000-0000-000000000501', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2',
   date_trunc('month', now() at time zone 'Asia/Jakarta')::date, 'IPL-2611010501', '15150000-0000-0000-0000-0000000000a5');
insert into imprest_plan_lines (org_id, plan_id, budget_category, planned_amount) values
  ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-000000000501', 'Vehicle', 3000000);
update imprest_plans set status = 'Approved', submitted_at = now(), approved_by = '15150000-0000-0000-0000-0000000000a7',
  approved_at = now() where id = '15150000-0000-0000-0000-000000000501';
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, imprest_float_id, imprest_month, is_plan_exception) values
  ('15150000-0000-0000-0000-000000000312', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c2', 'Vehicle', 'exception G', 100000, 'Approved', 'EXP-2611010312', now(),
   '15150000-0000-0000-0000-0000000000a7', now(), '15150000-0000-0000-0000-0000000000d2',
   date_trunc('month', now() at time zone 'Asia/Jakarta')::date, true);
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select is((select planned from get_imprest_plan_usage('15150000-0000-0000-0000-0000000000d2',
             date_trunc('month', now() at time zone 'Asia/Jakarta')::date) where budget_category = 'Vehicle'), 3000000::numeric,
  'AC-IMP-052 plan usage lists the category''s planned amount');
select is((select jsonb_array_length(exceptions) from get_imprest_plan_usage('15150000-0000-0000-0000-0000000000d2',
             date_trunc('month', now() at time zone 'Asia/Jakarta')::date) where budget_category = 'Vehicle'), 1,
  'AC-IMP-052 and the exception item, with drawn and remaining beside it');
reset role;

select * from finish();
rollback;
