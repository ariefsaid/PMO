-- imprest_plans.test.sql — #1515 site imprest S1: monthly plans. AC-IMP-010..014 (spec docs/specs/site-imprest.spec.md;
-- plan S1.10). F1 + F2, then plans by PM1; P2 carries an active budget so plan 104 routes `flat` (AC-IMP-014).
begin;
create extension if not exists pgtap;
select plan(29);

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
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('15150000-0000-0000-0000-000000000201', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c2', 'v1', 1, 'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-000000000201', 'Vehicle', 50000000);
update budget_versions set status = 'Active' where id = '15150000-0000-0000-0000-000000000201';
-- plans authored by PM1 on float F (custodian Fin1), next month (never late, never ended)
insert into imprest_plans (id, org_id, float_id, month, author_id) values
  ('15150000-0000-0000-0000-000000000101', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   (date_trunc('month', now() at time zone 'Asia/Jakarta') + interval '1 month')::date, '15150000-0000-0000-0000-0000000000a4'),
  ('15150000-0000-0000-0000-000000000102', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   (date_trunc('month', now() at time zone 'Asia/Jakarta') + interval '1 month')::date, '15150000-0000-0000-0000-0000000000a4'),
  ('15150000-0000-0000-0000-000000000103', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   (date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '1 month')::date, '15150000-0000-0000-0000-0000000000a4'),
  ('15150000-0000-0000-0000-000000000104', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d2',
   date_trunc('month', now() at time zone 'Asia/Jakarta')::date, '15150000-0000-0000-0000-0000000000a4');
insert into imprest_plan_lines (plan_id, budget_category, planned_amount) values
  ('15150000-0000-0000-0000-000000000101', 'Vehicle', 6000000), ('15150000-0000-0000-0000-000000000101', 'Materials', 5000000),
  ('15150000-0000-0000-0000-000000000103', 'Vehicle', 1000000),
  ('15150000-0000-0000-0000-000000000104', 'Vehicle', 3000000);
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select throws_like($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Submitted') $$,
  '%above the float amount%', 'AC-IMP-010 a plan total above the float is refused at submit');
update imprest_plan_lines set planned_amount = 3000000
 where plan_id = '15150000-0000-0000-0000-000000000101' and budget_category = 'Materials';
select is((select total from imprest_plans where id = '15150000-0000-0000-0000-000000000101'), 9000000::numeric,
  'AC-IMP-010 the total is server-maintained from the lines');
select lives_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Submitted') $$,
  'AC-IMP-010 a plan within the float submits');
select is((select count(*)::int from imprest_plan_lines where plan_id = '15150000-0000-0000-0000-000000000101'
             and budget_category = 'Vehicle'), 1, 'AC-IMP-011 (setup) the line exists');
select throws_ok($$ update imprest_plan_lines set planned_amount = 1 where plan_id = '15150000-0000-0000-0000-000000000101' $$,
  '42501', null, 'AC-IMP-011 the author cannot change lines once the plan is submitted');
insert into imprest_plan_lines (plan_id, budget_category, planned_amount)
  values ('15150000-0000-0000-0000-000000000102', 'Vehicle', 100);
select throws_like($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000102', 'Submitted') $$,
  '%already has a plan for that month%', 'AC-IMP-011 a second plan for the same float and month is refused at submit');
select throws_like($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Approved') $$,
  '%author cannot decide%', 'AC-IMP-012 the author cannot approve their own plan');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a2');
select throws_like($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Approved') $$,
  '%custodian cannot decide%', 'AC-IMP-012 the custodian cannot approve a plan for their own float');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a5');  -- PM2: not the routed approver (route org = the Executive)
select throws_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Approved') $$,
  '42501', null, 'AC-IMP-012 an approver the route excludes is refused');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');
select lives_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Approved') $$,
  'AC-IMP-012 the routed approver approves');
reset role;  -- audit_events is Admin/Operator-readable only; read it as the superuser
select ok(exists (select 1 from audit_events where entity_id = '15150000-0000-0000-0000-000000000101'
                    and action = 'imprest_plan.approval_route'), 'AC-IMP-012 an imprest_plan.approval_route audit row exists');
set local role authenticated;
-- AC-IMP-013 month ended / current month late (plan 103 is last month; plan 104 is this month on float G)
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select transition_imprest_plan('15150000-0000-0000-0000-000000000103', 'Submitted');
select transition_imprest_plan('15150000-0000-0000-0000-000000000104', 'Submitted');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select throws_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000104', 'Approved') $$,
  '42501', null, 'AC-IMP-012 a flat route still needs approval rank');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a7');
select throws_like($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000103', 'Approved') $$,
  '%month has ended%', 'AC-IMP-013 a plan whose month has ended cannot be approved');
select lives_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000104', 'Approved') $$,
  'AC-IMP-013 a plan for the current month is approved');
select ok((select is_late from imprest_plans where id = '15150000-0000-0000-0000-000000000104'),
  'AC-IMP-013 the current-month approval is audited late');
select ok(not (select is_late from imprest_plans where id = '15150000-0000-0000-0000-000000000101'),
  'AC-IMP-013 a next-month approval is not late');
select is((select line_used from spend_approval_route('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c2',
             'Vehicle', 1, 'IDR', '15150000-0000-0000-0000-0000000000a6', null, null)), 0::numeric,
  'AC-IMP-014 an approved plan adds nothing to the budget line used amount');

-- the remaining gates of transition_imprest_plan, one each
select throws_like($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000101', 'Draft') $$,
  '%illegal transition%', 'AC-IMP-012 an approved plan is terminal');
select lives_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000103', 'Rejected', 'month over') $$,
  'AC-IMP-013 a plan whose month has ended can still be rejected');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select throws_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000103', 'Draft') $$,
  '42501', null, 'AC-IMP-012 only the author reopens a rejected plan');
select throws_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000102', 'Submitted') $$,
  '42501', null, 'AC-IMP-011 only the author submits a plan');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select throws_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000102', 'Cancelled') $$,
  '42501', null, 'AC-IMP-011 an Engineer cannot cancel a plan');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');
select throws_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000102', 'Cancelled') $$,
  'P0002', null, 'AC-IMP-011 another org cannot move this plan');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select lives_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000103', 'Draft') $$,
  'AC-IMP-012 the author reopens a rejected plan');
select ok((select number is not null and status = 'Draft' and approved_by is null
             from imprest_plans where id = '15150000-0000-0000-0000-000000000103'),
  'AC-IMP-012 a reopened plan keeps its number and is Draft again');
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a3');
select lives_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000102', 'Cancelled') $$,
  'AC-IMP-011 Finance cancels a draft plan');

-- a non-author's line write learns nothing of the plan's status (the definer check runs before RLS WITH CHECK)
select pg_temp.act_as('15150000-0000-0000-0000-0000000000b1');
select throws_ok($$ insert into imprest_plan_lines (plan_id, budget_category, planned_amount)
  values ('15150000-0000-0000-0000-000000000101', 'Labor', 1) $$,
  '42501', 'this plan is missing and its lines can no longer be changed (FR-IMP-012)',
  'AC-IMP-061 another org cannot read a plan''s status through a line write');
-- an archived float's plans move only to Cancelled
reset role;
update imprest_floats set archived_at = now() where id = '15150000-0000-0000-0000-0000000000d1';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a4');
select throws_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000103', 'Submitted') $$,
  'P0002', null, 'AC-IMP-011 a plan on an archived float cannot be submitted');
select lives_ok($$ select transition_imprest_plan('15150000-0000-0000-0000-000000000103', 'Cancelled') $$,
  'AC-IMP-011 a plan on an archived float can still be cancelled');

select * from finish();
rollback;
