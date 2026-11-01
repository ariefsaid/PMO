-- imprest_cash.test.sql — #1515 site imprest S2: paying from a float. AC-IMP-030..034 (spec docs/specs/site-imprest.spec.md;
-- plan S2.7). F1 + F2 + the S2.6 project-approver fixture, then Approved float records waiting to be paid.
-- Also: the pay path waits for the float lock, an archived float is never approved or paid from, and (PQ-11) a float
-- with no cash account posts nothing to the ERP even in an org that employs expense postings.
-- password=postgres is the Supabase LOCAL default (the lock test's dblink session); runs only under `supabase test db`.
begin;
create extension if not exists pgtap;
select plan(31);
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
   'funding', 'REP-2611010001', 'Paid', 10000000, '15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-0000000000a3',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date),
  ('15150000-0000-0000-0000-0000000000e2', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2',
   'funding', 'REP-2611010002', 'Paid', 5000000, '15150000-0000-0000-0000-0000000000a5', '15150000-0000-0000-0000-0000000000a3',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date);
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1', '15150000-0000-0000-0000-0000000000a4');
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('15150000-0000-0000-0000-000000000f01', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1', 'v1', 1, 'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-000000000f01', 'Vehicle', 100000000);
update budget_versions set status = 'Active' where id = '15150000-0000-0000-0000-000000000f01';

-- Approved records waiting to be paid (approved by PM1), this month, Vehicle. 300 is Paid: F's cash falls to 800,000.
-- 310 / 311 are Paid on G: an advance and a claim that settled 200,000 of it.
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, imprest_float_id, imprest_month) values
  ('15150000-0000-0000-0000-000000000300', '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'big advance', 9200000, 'Approved', 'ADV-2611010300', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date),
  ('15150000-0000-0000-0000-000000000301', '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'adv 1m', 1000000, 'Approved', 'ADV-2611010301', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date),
  ('15150000-0000-0000-0000-000000000302', '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'adv 800k', 800000, 'Approved', 'ADV-2611010302', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date),
  ('15150000-0000-0000-0000-000000000303', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'claim 500k', 500000, 'Approved', 'EXP-2611010303', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date),
  ('15150000-0000-0000-0000-000000000304', '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c2', 'Vehicle', 'adv on G', 600000, 'Approved', 'ADV-2611010304', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d2', date_trunc('month', now() at time zone 'Asia/Jakarta')::date),
  ('15150000-0000-0000-0000-000000000307', '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c2', 'Vehicle', 'adv on G 2', 100000, 'Approved', 'ADV-2611010307', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d2', date_trunc('month', now() at time zone 'Asia/Jakarta')::date),
  ('15150000-0000-0000-0000-000000000305', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'off float', 100000, 'Approved', 'EXP-2611010305', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), null, null);
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, imprest_float_id, imprest_month) values
  ('15150000-0000-0000-0000-000000000306', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'submitted', 200000, 'Submitted', 'EXP-2611010306', now() + interval '1 hour',
   '15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date);
update expense_claims set status = 'Paid', paid_by_id = '15150000-0000-0000-0000-0000000000a2', paid_at = now(), paid_on = current_date
 where id = '15150000-0000-0000-0000-000000000300';
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, paid_by_id, paid_at, paid_on, imprest_float_id, imprest_month) values
  ('15150000-0000-0000-0000-000000000310', '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c2', 'Vehicle', 'adv G paid', 1000000, 'Paid', 'ADV-2611010310', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000a5', now(), current_date,
   '15150000-0000-0000-0000-0000000000d2', date_trunc('month', now() at time zone 'Asia/Jakarta')::date);
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, paid_by_id, paid_at, paid_on, imprest_float_id, imprest_month,
                            advance_id, advance_applied) values
  ('15150000-0000-0000-0000-000000000311', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c2', 'Vehicle', 'claim G paid', 500000, 'Paid', 'EXP-2611010311', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000a5', now(), current_date,
   '15150000-0000-0000-0000-0000000000d2', date_trunc('month', now() at time zone 'Asia/Jakarta')::date,
   '15150000-0000-0000-0000-000000000310', 200000);

-- The org employs expense postings on an activated ERPNext binding (0270 fixture shape). No float has a cash account.
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at) values
  ('15150000-0000-0000-0000-00000000000a', 'erpnext', 'https://erp.example.test', 'test-ref-imp', '{"company":"Example Co"}'::jsonb, now());
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('15150000-0000-0000-0000-00000000000a', 'erpnext', 'expenses');
-- Float K: P1, custodian Fin2, funded 1,000,000, with an Approved and a Submitted claim and a Requested replenishment;
-- then archived.
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000d6', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1',
   '15150000-0000-0000-0000-0000000000a3', 1000000, 'IDR', '15150000-0000-0000-0000-0000000000a1');
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, paid_by,
                                    requested_at, approved_at, paid_at, paid_on) values
  ('15150000-0000-0000-0000-0000000000e6', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d6',
   'funding', 'REP-FIXTURE-K1', 'Paid', 1000000, '15150000-0000-0000-0000-0000000000a3', '15150000-0000-0000-0000-0000000000a2',
   '15150000-0000-0000-0000-0000000000a1', now(), now(), now(), current_date);
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by) values
  ('15150000-0000-0000-0000-0000000000e7', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d6',
   'replenishment', 'REP-FIXTURE-K2', 'Requested', 50000, '15150000-0000-0000-0000-0000000000a3');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, imprest_float_id, imprest_month) values
  ('15150000-0000-0000-0000-000000000320', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'on K approved', 100000, 'Approved', 'EXP-2611010320', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d6', date_trunc('month', now() at time zone 'Asia/Jakarta')::date);
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, imprest_float_id, imprest_month) values
  ('15150000-0000-0000-0000-000000000321', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'on K submitted', 100000, 'Submitted', 'EXP-2611010321', now(),
   '15150000-0000-0000-0000-0000000000d6', date_trunc('month', now() at time zone 'Asia/Jakarta')::date);
update imprest_floats set archived_at = now() where id = '15150000-0000-0000-0000-0000000000d6';

-- NFR-IMP-004 / DD-IMP-3: a second session holds float F's lock; the custodian's payment from F must wait for it.
select dblink_connect('imp_pay', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_exec('imp_pay', 'begin');
select ok(
  (select count(*)::int from dblink('imp_pay', format($q$select pg_advisory_xact_lock(%s)$q$,
     hashtextextended('imprest-float:15150000-0000-0000-0000-0000000000d1', 0))) as t(a text)) = 1,
  'NFR-IMP-004 a second session holds float F''s lock');
set local lock_timeout = '200ms';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');  -- Fin1 = F's custodian
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000303', 'Paid') $$,
  '55P03', 'canceling statement due to lock timeout',
  'NFR-IMP-004 a payment from a float waits for the float lock, so two payments cannot both draw the same cash');
reset role;
select dblink_exec('imp_pay', 'commit');
select dblink_disconnect('imp_pay');
set local lock_timeout = 0;

-- An archived float is never decided or paid from.
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');  -- Exec, senior approver
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000321', 'Approved') $$,
  '%archived%', 'an expense claim on an archived float cannot be approved');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2 = K's custodian
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000320', 'Paid') $$,
  '%archived%', 'an expense claim on an archived float cannot be paid');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');  -- Fin1, neither custodian nor requester of K's request
select throws_like($$ select transition_imprest_replenishment('15150000-0000-0000-0000-0000000000e7', 'Approved') $$,
  '%archived%', 'a replenishment of an archived float cannot be approved');
select lives_ok($$ select transition_imprest_replenishment('15150000-0000-0000-0000-0000000000e7', 'Cancelled') $$,
  'a replenishment of an archived float may still be cancelled');
reset role;

set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');  -- Fin1 = F's custodian
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d1'), 800000::numeric, 'AC-IMP-030 (setup) cash on hand is 800,000');
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000301', 'Paid') $$,
  '%overdraw%', 'AC-IMP-030 paying 1,000,000 from 800,000 is refused');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000302', 'Paid') $$,
  'AC-IMP-030 paying 800,000 succeeds');
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d1'), 0::numeric, 'AC-IMP-030 cash on hand is 0, never negative');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2, not the custodian
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000303', 'Paid') $$,
  '42501', null, 'AC-IMP-032 a Finance user who is not the custodian cannot pay a float record');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000303', 'Paid') $$,
  '42501', null, 'AC-IMP-032 nor can an Admin who is not the custodian');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000306', 'Approved') $$,
  '%custodian pays this record%', 'AC-IMP-032 the custodian cannot approve a record charged to their float');

select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');  -- PM2 = G's custodian
select lives_ok($$ select record_expense_advance_return('15150000-0000-0000-0000-000000000310', 300000, 'cash back') $$,
  'AC-IMP-033 the PM custodian records a return on a float advance');
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d2'), (5000000 - 1000000 + 300000 - 300000)::numeric,
  'AC-IMP-031 cash_book = funding − advance + return − the claim''s cash part');
select is(imprest_advances_out('15150000-0000-0000-0000-0000000000d2'), 500000::numeric, 'AC-IMP-031 advances out = 500,000');
select is(imprest_receipts_waiting('15150000-0000-0000-0000-0000000000d2'), 500000::numeric, 'AC-IMP-031 receipts waiting = 500,000');
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d2') + imprest_advances_out('15150000-0000-0000-0000-0000000000d2')
          + imprest_receipts_waiting('15150000-0000-0000-0000-0000000000d2'), imprest_funded('15150000-0000-0000-0000-0000000000d2'),
  'AC-IMP-031 DD-IMP-2 identity holds');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000304', 'Paid') $$,
  'AC-IMP-033 the PM custodian pays an advance from their own float');
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d2'), (4000000 - 600000)::numeric,
  'AC-IMP-033 cash_book falls by the advance');
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000303', 'Paid') $$,
  '42501', null, 'AC-IMP-033 the PM custodian cannot pay a record on another float');
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000305', 'Paid') $$,
  '42501', null, 'AC-IMP-034 FR-EXP-024 unchanged off-float: a PM cannot pay a record with no float');
select throws_ok($$ insert into expense_claims (kind, title, project_id, budget_category, imprest_float_id)
  values ('advance', 'own float', '15150000-0000-0000-0000-0000000000c2', 'Vehicle', '15150000-0000-0000-0000-0000000000d2') $$,
  '23514', null, 'AC-IMP-034 a custodian cannot charge their own record to their own float');
reset role;
update projects set project_manager_id = '15150000-0000-0000-0000-0000000000a4' where id = '15150000-0000-0000-0000-0000000000c2';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');  -- PM2 no longer manages P2
select throws_ok($$ select record_expense_advance_return('15150000-0000-0000-0000-000000000310', 1, null) $$,
  '42501', null, 'AC-IMP-033 a custodian who stopped managing the project cannot record a return');
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000307', 'Paid') $$,
  '42501', null, 'AC-IMP-033 a custodian who stopped managing the project cannot pay from the float');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');  -- PM1 now manages P2 but is not G's custodian
select throws_ok($$ select record_expense_advance_return('15150000-0000-0000-0000-000000000310', 1, null) $$,
  '42501', null, 'AC-IMP-033 the project''s new PM who is not the custodian cannot record a return on a float advance');
reset role;

-- PQ-11: a float with no cash account posts nothing to the ERP; off-float records keep their postings.
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2 pays the off-float claim (FR-EXP-024)
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000305', 'Paid') $$,
  'PQ-11 (control) Finance pays an off-float claim in the posting org');
reset role;
select is((select count(*)::int from expense_posting_erp_mirror where claim_id = '15150000-0000-0000-0000-000000000305'
             and posting = 'claim-payment'),
  1, 'PQ-11 (control) the off-float payment writes its claim-payment intent');
select is((select count(*)::int from expense_posting_erp_mirror where claim_id = '15150000-0000-0000-0000-000000000302'),
  0, 'PQ-11 a Finance custodian''s payment from a float with no cash account writes no posting intent');
select is((select count(*)::int from expense_posting_erp_mirror where claim_id = '15150000-0000-0000-0000-000000000304'),
  0, 'PQ-11 a PM custodian''s payment from a float with no cash account writes no posting intent');
select is((select count(*)::int from expense_posting_erp_mirror where claim_id = '15150000-0000-0000-0000-000000000310'),
  0, 'PQ-11 an advance return into a float with no cash account writes no posting intent');

select * from finish();
rollback;
