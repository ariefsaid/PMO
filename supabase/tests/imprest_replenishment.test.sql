-- imprest_replenishment.test.sql — #1515 site imprest S2: funding and replenishment. AC-IMP-003, 040-046 and the
-- request half of AC-IMP-033 (spec docs/specs/site-imprest.spec.md; plan S2.9, S2.10). F1 + F2, then three Paid float
-- claims on F, one Approved, and float H (P3, custodian Fin2) with no funding. F2's numbers are renamed REP-FIXTURE-*:
-- the plan's REP-<yymmdd>0001 collides with the first number the server mints on that date.
-- password=postgres is the Supabase LOCAL default (AC-IMP-045's dblink session); runs only under `supabase test db`.
begin;
create extension if not exists pgtap;
select plan(39);
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
create or replace function pg_temp.paid_claim(p_id uuid, p_amount numeric) returns void language sql as $$
  insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                              submitted_at, approved_by_id, approved_at, paid_by_id, paid_at, paid_on, imprest_float_id, imprest_month)
  values (p_id, '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
          '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'receipts', p_amount, 'Paid', 'EXP-26110104' || right(p_id::text, 2),
          now(), '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000a2', now(), current_date,
          '15150000-0000-0000-0000-0000000000d1', date_trunc('month', now() at time zone 'Asia/Jakarta')::date)
$$;
select pg_temp.paid_claim('15150000-0000-0000-0000-000000000401', 400000);
select pg_temp.paid_claim('15150000-0000-0000-0000-000000000402', 250000);
select pg_temp.paid_claim('15150000-0000-0000-0000-000000000403', 150000);
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, imprest_float_id, imprest_month) values
  ('15150000-0000-0000-0000-000000000404', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'approved, unpaid', 90000, 'Approved', 'EXP-2611010404', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000d1',
   date_trunc('month', now() at time zone 'Asia/Jakarta')::date);
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000d3', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c3',
   '15150000-0000-0000-0000-0000000000a3', 10000000, 'IDR', '15150000-0000-0000-0000-0000000000a1');

-- A funding on F recorded by someone other than its custodian (an imported or pre-existing row): the custodian is
-- refused as decider on their own float whoever requested it.
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by) values
  ('15150000-0000-0000-0000-0000000000e9', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   'funding', 'REP-FIXTURE-X', 'Requested', 1, '15150000-0000-0000-0000-0000000000a1');

-- ── AC-IMP-003 funding ─────────────────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2 = H's custodian
select is((select float_amount - (imprest_cash_book(id) + imprest_advances_out(id) + imprest_receipts_waiting(id))
             from imprest_floats where id = '15150000-0000-0000-0000-0000000000d3'), 10000000::numeric,
  'AC-IMP-003 an unfunded float''s gap is its amount');
select lives_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d3', 'funding') $$,
  'AC-IMP-003 the custodian requests the funding, sending no amount');
select is((select amount from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d3' and kind = 'funding'),
  10000000::numeric, 'AC-IMP-003 the funding amount is the gap, set by the server');
select throws_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d3', 'funding') $$,
  'P0001', null, 'AC-IMP-003 a second open funding is refused');

-- ── AC-IMP-040..043 replenishment ──────────────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2: Finance, but not F's custodian
select throws_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d1') $$,
  '42501', null, 'AC-IMP-040 only the float''s custodian requests its replenishment');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');  -- the other org's Admin
select throws_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d1') $$,
  'P0002', null, 'AC-IMP-040 another organization''s float is not found');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');  -- Fin1 = F's custodian
select lives_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d1') $$,
  'AC-IMP-040 the custodian requests a replenishment, sending no amount or claims');
select is((select amount from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and kind = 'replenishment'),
  800000::numeric, 'AC-IMP-040 the replenishment amount is the sum of the Paid claims');
select is((select count(*)::int from expense_claims where imprest_replenishment_id is not null
             and id in ('15150000-0000-0000-0000-000000000401', '15150000-0000-0000-0000-000000000402', '15150000-0000-0000-0000-000000000403')),
  3, 'AC-IMP-040 exactly the three Paid claims carry its id');
select ok((select imprest_replenishment_id is null from expense_claims where id = '15150000-0000-0000-0000-000000000404'),
  'AC-IMP-040 the unpaid claim does not');
select throws_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Requested'), 'Approved') $$,
  '42501', null, 'AC-IMP-041 the custodian (and requester) cannot approve');
select throws_ok($$ select transition_imprest_replenishment('15150000-0000-0000-0000-0000000000e9', 'Approved') $$,
  '42501', null, 'AC-IMP-041 the custodian cannot approve a request on their float that someone else raised');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');  -- PM1: approval rank, but not Finance
select throws_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Requested'), 'Approved') $$,
  '42501', null, 'AC-IMP-041 only Finance or an Admin approves a replenishment');
select throws_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Requested'), 'Cancelled') $$,
  '42501', null, 'AC-IMP-043 PQ-8 someone other than the requester, Finance or an Admin cannot cancel');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');  -- names F's Paid funding e1 by id
select throws_ok($$ select transition_imprest_replenishment('15150000-0000-0000-0000-0000000000e1', 'Cancelled') $$,
  'P0002', null, 'AC-IMP-041 another organization''s request is not found');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select lives_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Requested'), 'Approved') $$,
  'AC-IMP-041 a Finance user other than the custodian approves');
select throws_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Approved'), 'Paid', null, 'TRF-7') $$,
  '42501', null, 'AC-IMP-042 the approver cannot pay');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');
select throws_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Approved'), 'Paid', null, 'TRF-7') $$,
  '42501', null, 'AC-IMP-042 the custodian cannot pay');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');  -- Admin = "F2" of the spec's example
select lives_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Approved'), 'Paid', null, 'TRF-7') $$,
  'AC-IMP-042 a third Finance-or-Admin user pays with a reference');
select is((select payment_reference from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Paid'
             and kind = 'replenishment'), 'TRF-7', 'AC-IMP-042 the reference is stamped');
select is(imprest_receipts_waiting('15150000-0000-0000-0000-0000000000d1'), 0::numeric, 'AC-IMP-042 receipts waiting fell by 800,000');
select is(imprest_cash_book('15150000-0000-0000-0000-0000000000d1'), (10000000 - 800000 + 800000)::numeric,
  'AC-IMP-042 cash on hand rose by 800,000');
select throws_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and kind = 'replenishment'), 'Cancelled') $$,
  'P0001', null, 'AC-IMP-043 a Paid replenishment cannot move');
reset role;
select pg_temp.paid_claim('15150000-0000-0000-0000-000000000405', 100000);
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');
select lives_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d1') $$,
  'AC-IMP-043 (setup) a new receipt is requested');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select lives_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Requested'), 'Rejected', 'not yet') $$,
  'AC-IMP-043 (setup) Finance rejects it');
select ok((select imprest_replenishment_id is null from expense_claims where id = '15150000-0000-0000-0000-000000000405'),
  'AC-IMP-043 a rejected request releases its claims');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');
select lives_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d1') $$,
  'AC-IMP-043 (setup) the custodian requests again');
select is((select imprest_replenishment_id from expense_claims where id = '15150000-0000-0000-0000-000000000405'),
  (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d1' and status = 'Requested'),
  'AC-IMP-043 a released claim joins the new request');

-- ── AC-IMP-046 a funding is checked against the float amount at pay time ───────────────────────────────────────────
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');  -- Fin1: neither H's custodian nor its requester
select lives_ok($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d3' and kind = 'funding'), 'Approved') $$,
  'AC-IMP-046 (setup) the funding is approved by a third Finance user');
reset role;
update imprest_floats set float_amount = 9000000 where id = '15150000-0000-0000-0000-0000000000d3';  -- a change lands after the request
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select throws_like($$ select transition_imprest_replenishment(
    (select id from imprest_replenishments where float_id = '15150000-0000-0000-0000-0000000000d3' and kind = 'funding'), 'Paid', null, 'TRF-9') $$,
  '%above its fixed amount%', 'AC-IMP-046 a funding that would take the float above its amount is refused');

reset role;
update imprest_floats set archived_at = now() where id = '15150000-0000-0000-0000-0000000000d3';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2 = H's custodian
select throws_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d3', 'funding') $$,
  'P0002', null, 'AC-IMP-003 no cash is requested into an archived float');

-- ── AC-IMP-033 request half ────────────────────────────────────────────────────────────────────────────────────────
reset role;
update projects set project_manager_id = '15150000-0000-0000-0000-0000000000a4' where id = '15150000-0000-0000-0000-0000000000c2';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');  -- PM2 no longer manages P2
select throws_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d2') $$,
  '42501', null, 'AC-IMP-033 a custodian who stopped managing the project cannot request a replenishment');
reset role;

-- ── AC-IMP-045 concurrent requests serialize on the float lock ─────────────────────────────────────────────────────
-- A fresh float J (P1, custodian Fin2): this transaction already holds F's lock (xact-scoped), so a second session
-- waiting on F would wait for this one forever.
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000d5', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1',
   '15150000-0000-0000-0000-0000000000a3', 1000000, 'IDR', '15150000-0000-0000-0000-0000000000a1');
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, paid_by_id, paid_at, paid_on, imprest_float_id, imprest_month)
values ('15150000-0000-0000-0000-000000000406', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
        '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'receipts on J', 60000, 'Paid', 'EXP-2611010406', now(),
        '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000a3', now(), current_date,
        '15150000-0000-0000-0000-0000000000d5', date_trunc('month', now() at time zone 'Asia/Jakarta')::date);
select dblink_connect('imp_float', format(
  'dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'),
  coalesce(inet_server_port(), 5432)));
select dblink_exec('imp_float', 'begin');
select ok(
  (select count(*)::int from dblink('imp_float', format($q$select pg_advisory_xact_lock(%s)$q$,
     hashtextextended('imprest-float:15150000-0000-0000-0000-0000000000d5', 0))) as t(a text)) = 1,
  'AC-IMP-045 a second session holds float J''s lock');
set local lock_timeout = '200ms';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2 = J's custodian
select throws_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d5') $$,
  '55P03', 'canceling statement due to lock timeout',
  'AC-IMP-045 a replenishment request waits for the float lock, so two requests cannot both select a receipt');
reset role;
select dblink_exec('imp_float', 'commit');
select dblink_disconnect('imp_float');
set local lock_timeout = 0;
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');  -- Fin2 = J's custodian
select lives_ok($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d5') $$,
  'AC-IMP-045 once released, the first request takes the waiting receipt');
select throws_like($$ select request_imprest_replenishment('15150000-0000-0000-0000-0000000000d5') $$,
  '%no settled receipts waiting%', 'AC-IMP-045 the second request finds nothing left to take');
reset role;
select is((select count(*)::int from expense_claims where imprest_float_id in ('15150000-0000-0000-0000-0000000000d1', '15150000-0000-0000-0000-0000000000d5')
             and kind = 'claim' and status = 'Paid' and imprest_replenishment_id is null), 0,
  'AC-IMP-045 each Paid claim joins exactly one request');

-- ── AC-IMP-044 property: over random movements the identity holds and cash never goes negative ────────────────────
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000d4', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c3',
   '15150000-0000-0000-0000-0000000000a2', 10000000, 'IDR', '15150000-0000-0000-0000-0000000000a1');
insert into imprest_replenishments (org_id, float_id, kind, number, status, amount, requested_by, approved_by, paid_by,
                                    requested_at, approved_at, paid_at, paid_on) values
  ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d4', 'funding', 'REP-FIXTURE-K', 'Paid', 10000000,
   '15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-0000000000a3', '15150000-0000-0000-0000-0000000000a1',
   now(), now(), now(), current_date);
create temp table imp_steps (step int, ok boolean) on commit drop;
do $$
declare i int; v_op int; v_id uuid; v_adv uuid; v_amt numeric; v_k uuid := '15150000-0000-0000-0000-0000000000d4';
begin
  perform setseed(0.1515);
  for i in 1..60 loop
    v_op := floor(random() * 5)::int;
    v_amt := (floor(random() * 40) + 1) * 10000;       -- 10,000 .. 400,000, whole cents
    v_adv := null;
    begin
      if v_op = 0 then                                 -- advance: create, submit, approve (Admin), pay (custodian)
        v_id := gen_random_uuid();
        insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, imprest_float_id)
        values (v_id, '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
                '15150000-0000-0000-0000-0000000000c3', 'Vehicle', 'prop adv', v_amt, 'Draft', v_k);
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a6","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Submitted');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Approved');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Paid');
      elsif v_op = 1 then                              -- return part of a random outstanding advance (custodian)
        select a.id into v_adv from expense_claims a where a.imprest_float_id = v_k and a.kind = 'advance' and a.status = 'Paid'
           and expense_advance_outstanding(a.id) > 0 order by random() limit 1;
        if v_adv is not null then
          perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
          perform record_expense_advance_return(v_adv, least(v_amt, expense_advance_outstanding(v_adv)), null);
        end if;
      elsif v_op in (2, 3) then                        -- claim, settling a random advance half the time
        select a.id into v_adv from expense_claims a where a.imprest_float_id = v_k and a.kind = 'advance' and a.status = 'Paid'
           and expense_advance_outstanding(a.id) > 0 and v_op = 3 order by random() limit 1;
        v_id := gen_random_uuid();
        insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, status, imprest_float_id, advance_id)
        values (v_id, '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
                '15150000-0000-0000-0000-0000000000c3', 'Vehicle', 'prop claim', 'Draft', v_k, v_adv);
        insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount)
        values (v_id, current_date, 'Other', 'prop', v_amt);
        insert into expense_claim_files (claim_id, org_id, file_path)
        values (v_id, '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-00000000000a/' || v_id || '/' || gen_random_uuid() || '/r.pdf');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a6","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Submitted');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Approved');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
        perform transition_expense_claim(v_id, 'Paid');
      else                                             -- replenish: request (custodian), approve (Fin2), pay (Admin)
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
        v_id := request_imprest_replenishment(v_k);
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
        perform transition_imprest_replenishment(v_id, 'Approved');
        perform set_config('request.jwt.claims', '{"sub":"15150000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
        perform transition_imprest_replenishment(v_id, 'Paid', null, 'P-' || i);
      end if;
    exception when sqlstate 'P0001' then
      null;  -- a refused step (overdraw, nothing to replenish) is a legal outcome; the identity must still hold
    end;
    insert into imp_steps values (i, imprest_cash_book(v_k) + imprest_advances_out(v_k) + imprest_receipts_waiting(v_k)
                                     = imprest_funded(v_k) and imprest_cash_book(v_k) >= 0);
  end loop;
end $$;
select is((select count(*)::int from imp_steps where not ok), 0,
  'AC-IMP-044 over 60 random movements the identity holds at every step and cash never goes negative');
select ok((select count(*) from imp_steps) = 60, 'AC-IMP-044 the property ran all 60 steps');

select * from finish();
rollback;
