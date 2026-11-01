-- imprest_routing.test.sql — #1515 site imprest S2: charging rules and float-aware routing. AC-IMP-020..025 and the
-- float half of AC-IMP-014 (spec docs/specs/site-imprest.spec.md; plan S2.1 and S2.6). F1 + F2, then the S2.6 fixture:
-- P1 carries an active budget with PM1 as its project approver, float F an approved plan for this month (M).
begin;
create extension if not exists pgtap;
select plan(20);


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
-- M = this month in the org's timezone (OQ-IMP-8).
create or replace function pg_temp.m() returns date language sql stable as $$
  select date_trunc('month', now() at time zone 'Asia/Jakarta')::date
$$;

-- S2.1: Draft float records by Eng1 (claimant). 201 is above the limit, 202 has no receipt, 203 stays off-float.
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status) values
  ('15150000-0000-0000-0000-000000000201', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'Fuel over the limit', 0, 'Draft'),
  ('15150000-0000-0000-0000-000000000202', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'Fuel no receipt', 0, 'Draft'),
  ('15150000-0000-0000-0000-000000000203', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'Fuel off float', 0, 'Draft');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('15150000-0000-0000-0000-000000000201', current_date, 'Local transport', 'Diesel', 2500000),
  ('15150000-0000-0000-0000-000000000202', current_date, 'Local transport', 'Diesel', 100000),
  ('15150000-0000-0000-0000-000000000203', current_date, 'Local transport', 'Diesel', 2500000);
insert into expense_claim_files (claim_id, org_id, file_path) values
  ('15150000-0000-0000-0000-000000000201', '15150000-0000-0000-0000-00000000000a',
   '15150000-0000-0000-0000-00000000000a/15150000-0000-0000-0000-000000000201/15150000-0000-0000-0000-000000000901/r.pdf');

-- S2.6 fixture. (1) a second senior approver.
insert into auth.users (id, email) values ('15150000-0000-0000-0000-0000000000a8', 'imp-exec2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15150000-0000-0000-0000-0000000000a8', '15150000-0000-0000-0000-00000000000a', 'IMP Exec2', 'imp-exec2@example.com', 'Executive', 'active');
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15150000-0000-0000-0000-00000000000a', null, '15150000-0000-0000-0000-0000000000a8'),
  ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1', '15150000-0000-0000-0000-0000000000a4');
-- (2) P1's active budget: Vehicle 100,000,000, so in-plan items on P1 route `project` = PM1.
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('15150000-0000-0000-0000-000000000f01', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1', 'v1', 1, 'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-000000000f01', 'Vehicle', 100000000);
update budget_versions set status = 'Active' where id = '15150000-0000-0000-0000-000000000f01';
-- (3) plan 150 on F for M, approved by the Executive, one Vehicle line of 3,000,000.
insert into imprest_plans (id, org_id, float_id, month, author_id) values
  ('15150000-0000-0000-0000-000000000150', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   pg_temp.m(), '15150000-0000-0000-0000-0000000000a4');
insert into imprest_plan_lines (plan_id, budget_category, planned_amount) values
  ('15150000-0000-0000-0000-000000000150', 'Vehicle', 3000000);
update imprest_plans set status = 'Approved', number = 'IMP-2611010150', submitted_at = now(),
       approved_by = '15150000-0000-0000-0000-0000000000a7', approved_at = now()
 where id = '15150000-0000-0000-0000-000000000150';
-- (4) a Paid advance on F, (5) a claim settling it, Approved but not yet Paid.
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, claim_number,
                            submitted_at, approved_by_id, approved_at, paid_by_id, paid_at, paid_on, imprest_float_id, imprest_month) values
  ('15150000-0000-0000-0000-000000000204', '15150000-0000-0000-0000-00000000000a', 'advance', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'Site fuel advance', 1000000, 'Paid', 'ADV-2611010204', now(),
   '15150000-0000-0000-0000-0000000000a4', now(), '15150000-0000-0000-0000-0000000000a2', now(), current_date,
   '15150000-0000-0000-0000-0000000000d1', pg_temp.m());
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status,
                            imprest_float_id, advance_id) values
  ('15150000-0000-0000-0000-000000000205', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'Fuel receipts', 0, 'Draft',
   '15150000-0000-0000-0000-0000000000d1', '15150000-0000-0000-0000-000000000204');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('15150000-0000-0000-0000-000000000205', current_date, 'Local transport', 'Diesel', 1500000);
update expense_claims set status = 'Approved', approved_by_id = '15150000-0000-0000-0000-0000000000a4', approved_at = now(),
       claim_number = 'EXP-2611010205', submitted_at = now(), imprest_month = pg_temp.m()
 where id = '15150000-0000-0000-0000-000000000205';
-- (6) Submitted float claims: 211 (400,000) and 212 (700,000) on F, 213 (300,000) on G.
insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, imprest_float_id) values
  ('15150000-0000-0000-0000-000000000211', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'In plan', 0, 'Draft', '15150000-0000-0000-0000-0000000000d1'),
  ('15150000-0000-0000-0000-000000000212', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c1', 'Vehicle', 'Out of plan', 0, 'Draft', '15150000-0000-0000-0000-0000000000d1'),
  ('15150000-0000-0000-0000-000000000213', '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
   '15150000-0000-0000-0000-0000000000c2', 'Vehicle', 'No plan', 0, 'Draft', '15150000-0000-0000-0000-0000000000d2');
insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount) values
  ('15150000-0000-0000-0000-000000000211', current_date, 'Local transport', 'Diesel', 400000),
  ('15150000-0000-0000-0000-000000000212', current_date, 'Local transport', 'Diesel', 700000),
  ('15150000-0000-0000-0000-000000000213', current_date, 'Local transport', 'Diesel', 300000);
insert into expense_claim_files (claim_id, org_id, file_path)
select c, '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-00000000000a/' || c || '/' || gen_random_uuid() || '/r.pdf'
  from unnest(array['15150000-0000-0000-0000-000000000211', '15150000-0000-0000-0000-000000000212',
                    '15150000-0000-0000-0000-000000000213']::uuid[]) c;
update expense_claims set status = 'Submitted', submitted_at = now() + interval '1 hour', imprest_month = pg_temp.m(),
       claim_number = 'EXP-26110102' || right(id::text, 2)
 where id in ('15150000-0000-0000-0000-000000000211', '15150000-0000-0000-0000-000000000212',
              '15150000-0000-0000-0000-000000000213');

-- A float of the other org on P1 (a forged cross-org reference: nothing else would match).
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000db', '15150000-0000-0000-0000-00000000000b', '15150000-0000-0000-0000-0000000000c1',
   '15150000-0000-0000-0000-0000000000b1', 1000000, 'IDR', '15150000-0000-0000-0000-0000000000b1');

-- ── S2.1 charging rules (AC-IMP-020, 021) ──────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select throws_ok($$ update expense_claims set imprest_float_id = '15150000-0000-0000-0000-0000000000d2'
                    where id = '15150000-0000-0000-0000-000000000201' $$,
  '23514', null, 'AC-IMP-020 a float on another project is refused');
select throws_ok($$ update expense_claims set budget_category = null, imprest_float_id = '15150000-0000-0000-0000-0000000000d1'
                    where id = '15150000-0000-0000-0000-000000000202' $$,
  '23514', null, 'AC-IMP-020 a float claim without a budget category is refused');
select throws_ok($$ update expense_claims set imprest_float_id = '15150000-0000-0000-0000-0000000000db'
                    where id = '15150000-0000-0000-0000-000000000201' $$,
  '23514', null, 'AC-IMP-020 a float of another organization is refused');
select throws_ok($$ insert into expense_claims (kind, title, project_id, budget_category, advance_id)
  values ('claim', 'settles a float advance off-float', '15150000-0000-0000-0000-0000000000c1', 'Vehicle',
          '15150000-0000-0000-0000-000000000204') $$,
  '23514', null, 'AC-IMP-020 PQ-7 a claim settling a float advance must be charged to the same float');
update expense_claims set imprest_float_id = '15150000-0000-0000-0000-0000000000d1'
 where id in ('15150000-0000-0000-0000-000000000201', '15150000-0000-0000-0000-000000000202');
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000201', 'Submitted') $$,
  '%procurement%', 'AC-IMP-021 a float claim above the procurement limit is refused naming procurement');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000203', 'Submitted') $$,
  'AC-IMP-021 the same amount with no float submits as today');
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000202', 'Submitted') $$,
  '%receipt%', 'AC-IMP-021 a float claim with no receipt is refused');

-- ── S2.6 drawn, remaining and routing (AC-IMP-022..025, AC-IMP-014) ────────────────────────────────────────────────
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select is(imprest_drawn('15150000-0000-0000-0000-0000000000d1', pg_temp.m(), 'Vehicle'),
  2500000::numeric, 'AC-IMP-022 drawn = approved claim 1,500,000 + advance outstanding 1,000,000');
select is(imprest_remaining('15150000-0000-0000-0000-0000000000d1', pg_temp.m(), 'Vehicle'),
  500000::numeric, 'AC-IMP-023 remaining = planned − drawn');
reset role;  -- settle the advance in full (the transition path itself is AC-IMP-031's)
update expense_claims set status = 'Paid', advance_applied = 1000000, paid_by_id = '15150000-0000-0000-0000-0000000000a2',
       paid_at = now(), paid_on = current_date where id = '15150000-0000-0000-0000-000000000205';
update imprest_plan_lines set planned_amount = 2000000 where plan_id = '15150000-0000-0000-0000-000000000150'; -- remaining back to 500,000
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select is(imprest_drawn('15150000-0000-0000-0000-0000000000d1', pg_temp.m(), 'Vehicle'),
  1500000::numeric, 'AC-IMP-022 once the claim settles the advance in full, drawn is 1,500,000: nothing counts twice');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000211', 'Approved') $$,
  'AC-IMP-023 an in-plan 400,000 claim is approved by the routed project approver');
select ok(not (select is_plan_exception from expense_claims where id = '15150000-0000-0000-0000-000000000211'),
  'AC-IMP-023 an in-plan item is not an exception');
select is((select line_used from spend_approval_route('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1',
             'Vehicle', 1, 'IDR', '15150000-0000-0000-0000-0000000000a6', null, null)), 1900000::numeric,
  'AC-IMP-014 float claims count in the line used amount once approved (1,500,000 + 400,000); the plan does not');
reset role;
update imprest_plan_lines set planned_amount = 2400000 where plan_id = '15150000-0000-0000-0000-000000000150'; -- remaining 500,000 again
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select throws_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000212', 'Approved') $$,
  '42501', null, 'AC-IMP-023 an out-of-plan 700,000 claim cannot be approved by the project approver');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');
select throws_like($$ select transition_expense_claim('15150000-0000-0000-0000-000000000212', 'Approved') $$,
  '%approver of this month''s plan%', 'AC-IMP-024 the approver of the month''s plan cannot approve an exception');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a8');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000212', 'Approved') $$,
  'AC-IMP-023 a senior approver who did not approve the plan approves the exception');
select ok((select is_plan_exception from expense_claims where id = '15150000-0000-0000-0000-000000000212'),
  'AC-IMP-023 the item is stamped as a plan exception');
reset role;
select is((select (detail->>'plan_shortfall')::numeric from audit_events
            where entity_id = '15150000-0000-0000-0000-000000000212' and action = 'expense_claim.approval_route'
              and (detail->>'plan_exception')::boolean), 200000::numeric,
  'AC-IMP-023 the audit row carries plan_exception = true and the shortfall 200,000');
delete from spend_approvers where org_id = '15150000-0000-0000-0000-00000000000a' and project_id is null;  -- no senior set
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select lives_ok($$ select transition_expense_claim('15150000-0000-0000-0000-000000000213', 'Approved') $$,
  'AC-IMP-024 with no senior set, an Admin who did not approve the plan approves the exception');
select ok((select is_plan_exception from expense_claims where id = '15150000-0000-0000-0000-000000000213'),
  'AC-IMP-025 a float record in a month with no approved plan is an exception (remaining 0)');
reset role;

select * from finish();
rollback;
