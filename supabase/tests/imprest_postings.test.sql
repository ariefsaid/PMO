-- imprest_postings.test.sql — #1515 site imprest S6: ERP posting intents and the gate (spec §9, DD-IMP-6; plan S6.4).
-- AC-IMP-070 (a paid replenishment writes one intent, only while the org employs postings and the float has a cash
-- account), AC-IMP-071 (a float record posts through the float's own cash account; the gate lets the custodian pay).
-- F1 + F2 + an activated ERPNext binding with `expenses` owned. Migration under test: 0425_imprest_postings.sql.
begin;
create extension if not exists pgtap;
select plan(24);

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

insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at) values
  ('15150000-0000-0000-0000-00000000000a', 'erpnext', 'https://erp.example.test', 'test-ref-imp', '{"company":"Example Co"}'::jsonb, now());
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('15150000-0000-0000-0000-00000000000a', 'erpnext', 'expenses');
-- Float F carries a cash account; float G has none yet.
update imprest_floats set erp_cash_account_ref = 'Site Cash F - IMP' where id = '15150000-0000-0000-0000-0000000000d1';

-- Requested replenishments (requested by each float's custodian), a funding is not needed: both floats are fully funded.
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by) values
  ('15150000-0000-0000-0000-0000000000e3', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   'replenishment', 'REP-FIXTURE-S6A', 'Requested', 800000, '15150000-0000-0000-0000-0000000000a2'),
  ('15150000-0000-0000-0000-0000000000e4', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2',
   'replenishment', 'REP-FIXTURE-S6B', 'Requested', 300000, '15150000-0000-0000-0000-0000000000a5'),
  ('15150000-0000-0000-0000-0000000000e5', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   'replenishment', 'REP-FIXTURE-S6C', 'Requested', 100000, '15150000-0000-0000-0000-0000000000a2');
-- Approved float advances waiting for their custodian: 400 on F (Fin1 pays), 410 on G (PM2 pays), 411 on G (later).
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, imprest_float_id, imprest_month) values
  ('15150000-0000-0000-0000-000000000400', '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'adv F', 500000, 'Approved', 'ADV-2611010400', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date),
  ('15150000-0000-0000-0000-000000000410', '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c2', 'Vehicle', 'adv G one', 200000, 'Approved', 'ADV-2611010410', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d2', date_trunc('month', now() at time zone 'Asia/Jakarta')::date),
  ('15150000-0000-0000-0000-000000000411', '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c2', 'Vehicle', 'adv G two', 150000, 'Approved', 'ADV-2611010411', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d2', date_trunc('month', now() at time zone 'Asia/Jakarta')::date);

-- AC-IMP-070: Fin2 (not the custodian, not the requester) approves, the Admin pays.
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select lives_ok($$ select transition_imprest_replenishment('15150000-0000-0000-0000-0000000000e3', 'Approved') $$,
  'AC-IMP-070 (setup) Fin2 approves the replenishment on F');
select lives_ok($$ select transition_imprest_replenishment('15150000-0000-0000-0000-0000000000e4', 'Approved') $$,
  'AC-IMP-070 (setup) Fin2 approves the replenishment on G');
select lives_ok($$ select transition_imprest_replenishment('15150000-0000-0000-0000-0000000000e5', 'Approved') $$,
  'AC-IMP-070 (setup) Fin2 approves a second replenishment on F');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select lives_ok($$ select transition_imprest_replenishment('15150000-0000-0000-0000-0000000000e3', 'Paid', null, 'BANK-1') $$,
  'AC-IMP-070 (setup) the Admin pays the replenishment on F');
select lives_ok($$ select transition_imprest_replenishment('15150000-0000-0000-0000-0000000000e4', 'Paid', null, 'BANK-2') $$,
  'AC-IMP-070 (setup) the Admin pays the replenishment on G');
reset role;

select is((select count(*)::int from imprest_posting_erp_mirror where replenishment_id = '15150000-0000-0000-0000-0000000000e3'),
  1, 'AC-IMP-070 a paid replenishment on a float with a cash account writes exactly one intent');
select is((select m.posting_identity || '/' || (m.state_stamp = r.paid_at)::text || '/' || m.push_state || '/' || m.actor_id::text
             from imprest_posting_erp_mirror m join imprest_replenishments r on r.id = m.replenishment_id
            where m.replenishment_id = '15150000-0000-0000-0000-0000000000e3'),
  '15150000-0000-0000-0000-0000000000e3:replenishment/true/pending/15150000-0000-0000-0000-0000000000a1',
  'AC-IMP-070 the intent is keyed by the replenishment, stamped with paid_at, pending, attributed to the payer');
select is((select count(*)::int from imprest_posting_erp_mirror where replenishment_id = '15150000-0000-0000-0000-0000000000e4'),
  0, 'AC-IMP-070 no cash account: no intent');

-- AC-IMP-071: the float advance on F (Fin1 pays) freezes the float's cash account in its gate truth.
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000400', 'Paid') $$,
  'AC-IMP-071 (setup) the Finance custodian pays the advance from float F');
reset role;
set local role service_role;
select is((expense_posting_for_push('15150000-0000-0000-0000-00000000000a',
             (select id from expense_posting_erp_mirror where posting_identity = '15150000-0000-0000-0000-000000000400:advance-payment'))
           ->> 'float_cash_account'),
  'Site Cash F - IMP', 'AC-IMP-071 a paid float advance freezes the float''s cash account in its gate truth');
reset role;

-- PQ-11: PM2 pays an advance from G while G has no cash account: no intent. Then G gets one.
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000410', 'Paid') $$,
  'AC-IMP-071 (setup) the PM custodian pays an advance from float G');
reset role;
select is((select count(*)::int from expense_posting_erp_mirror where claim_id = '15150000-0000-0000-0000-000000000410'),
  0, 'AC-IMP-071 a float record whose float has no cash account enqueues nothing');
update imprest_floats set erp_cash_account_ref = 'Site Cash G - IMP' where id = '15150000-0000-0000-0000-0000000000d2';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000411', 'Paid') $$,
  'AC-IMP-071 (setup) the PM custodian pays a second advance, now that G has a cash account');
reset role;

set local role service_role;
select lives_ok($$ select expense_posting_actor_check('15150000-0000-0000-0000-00000000000a',
    (select id from expense_posting_erp_mirror where posting_identity = '15150000-0000-0000-0000-000000000411:advance-payment')) $$,
  'AC-IMP-071 the gate accepts a PM custodian as the recorded payer');
reset role;
-- a PM who is not the custodian is refused as the recorded payer of a float posting
update expense_posting_erp_mirror set actor_id = '15150000-0000-0000-0000-0000000000a4'
 where posting_identity = '15150000-0000-0000-0000-000000000411:advance-payment';
set local role service_role;
select throws_ok($$ select expense_posting_actor_check('15150000-0000-0000-0000-00000000000a',
    (select id from expense_posting_erp_mirror where posting_identity = '15150000-0000-0000-0000-000000000411:advance-payment')) $$,
  '42501', 'expense-posting-actor-not-authorized', 'AC-IMP-071 a PM who is not the float''s custodian is refused as the payer');
reset role;
update expense_posting_erp_mirror set actor_id = '15150000-0000-0000-0000-0000000000a5'
 where posting_identity = '15150000-0000-0000-0000-000000000411:advance-payment';
-- the custodian stops qualifying (no longer manages the project): refused
update projects set project_manager_id = '15150000-0000-0000-0000-0000000000a4' where id = '15150000-0000-0000-0000-0000000000c2';
set local role service_role;
select throws_ok($$ select expense_posting_actor_check('15150000-0000-0000-0000-00000000000a',
    (select id from expense_posting_erp_mirror where posting_identity = '15150000-0000-0000-0000-000000000411:advance-payment')) $$,
  '42501', 'expense-posting-actor-not-authorized', 'AC-IMP-071 a custodian who no longer qualifies is refused');
reset role;

-- imprest_posting_for_push (the replenishment gate)
set local role service_role;
select is((imprest_posting_for_push('15150000-0000-0000-0000-00000000000a',
             (select id from imprest_posting_erp_mirror where replenishment_id = '15150000-0000-0000-0000-0000000000e3'))
           ->> 'float_cash_account') || '/' || (imprest_posting_for_push('15150000-0000-0000-0000-00000000000a',
             (select id from imprest_posting_erp_mirror where replenishment_id = '15150000-0000-0000-0000-0000000000e3')) ->> 'amount'),
  'Site Cash F - IMP/800000.00', 'AC-IMP-070 the gate returns the float''s cash account and the replenishment amount');
select throws_ok($$ select imprest_posting_for_push('15150000-0000-0000-0000-00000000000b',
    (select id from imprest_posting_erp_mirror where replenishment_id = '15150000-0000-0000-0000-0000000000e3')) $$,
  'P0002', null, 'AC-IMP-070 the gate never reads another org''s intent');
reset role;
update imprest_replenishments set paid_at = paid_at + interval '1 second' where id = '15150000-0000-0000-0000-0000000000e3';
set local role service_role;
select throws_ok($$ select imprest_posting_for_push('15150000-0000-0000-0000-00000000000a',
    (select id from imprest_posting_erp_mirror where replenishment_id = '15150000-0000-0000-0000-0000000000e3')) $$,
  'P0001', 'imprest-posting-precondition-failed', 'AC-IMP-070 a stamp that no longer matches is refused');
reset role;
update imprest_replenishments set paid_at = paid_at - interval '1 second' where id = '15150000-0000-0000-0000-0000000000e3';
update imprest_floats set erp_cash_account_ref = null where id = '15150000-0000-0000-0000-0000000000d1';
set local role service_role;
select throws_ok($$ select imprest_posting_for_push('15150000-0000-0000-0000-00000000000a',
    (select id from imprest_posting_erp_mirror where replenishment_id = '15150000-0000-0000-0000-0000000000e3')) $$,
  'P0001', 'imprest-posting-precondition-failed', 'AC-IMP-070 a float whose cash account was cleared is refused');
reset role;
update imprest_floats set erp_cash_account_ref = 'Site Cash F - IMP' where id = '15150000-0000-0000-0000-0000000000d1';
-- SoD: the custodian is never the recorded payer of their own top-up; a demoted payer is refused
update imprest_posting_erp_mirror set actor_id = '15150000-0000-0000-0000-0000000000a2'
 where replenishment_id = '15150000-0000-0000-0000-0000000000e3';
set local role service_role;
select throws_ok($$ select imprest_posting_for_push('15150000-0000-0000-0000-00000000000a',
    (select id from imprest_posting_erp_mirror where replenishment_id = '15150000-0000-0000-0000-0000000000e3')) $$,
  '42501', 'imprest-posting-actor-not-authorized', 'AC-IMP-070 the custodian as recorded payer of their own top-up is refused');
reset role;
update imprest_posting_erp_mirror set actor_id = '15150000-0000-0000-0000-0000000000a6'
 where replenishment_id = '15150000-0000-0000-0000-0000000000e3';
set local role service_role;
select throws_ok($$ select imprest_posting_for_push('15150000-0000-0000-0000-00000000000a',
    (select id from imprest_posting_erp_mirror where replenishment_id = '15150000-0000-0000-0000-0000000000e3')) $$,
  '42501', 'imprest-posting-actor-not-authorized', 'AC-IMP-070 a recorded payer without Finance or Admin standing is refused');
reset role;

-- no ownership row: the org does not employ postings, so no intent
delete from external_domain_ownership where org_id = '15150000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select lives_ok($$ select transition_imprest_replenishment('15150000-0000-0000-0000-0000000000e5', 'Paid') $$,
  'AC-IMP-070 (setup) the Admin pays a replenishment after the org stopped owning expenses');
reset role;
select is((select count(*)::int from imprest_posting_erp_mirror where replenishment_id = '15150000-0000-0000-0000-0000000000e5'),
  0, 'AC-IMP-070 no ownership row: no intent');

select * from finish();
rollback;
