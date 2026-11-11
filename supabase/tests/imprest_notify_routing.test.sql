-- imprest_notify_routing.test.sql — #1515 site imprest S3: notifications reach only people who can act (AC-IMP-062,
-- FR-IMP-064). A single-senior-approver org: the Executive is the whole senior set AND approved this month's plan, so
-- an out-of-plan item falls back to Admins; the custodian never hears "awaiting your approval" about their own float;
-- an item that a sibling approval pushes out of plan alerts the senior fallback; a replenishment whose only Finance
-- member is the custodian falls back to Admins; a rejected replenishment sends nothing.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15150000-0000-0000-0000-00000000000a', 'IMP Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('15150000-0000-0000-0000-0000000000a1', 'imp-admin@example.com'),
  ('15150000-0000-0000-0000-0000000000a2', 'imp-fin1@example.com'),   -- Finance, custodian of F, the only Finance member
  ('15150000-0000-0000-0000-0000000000a4', 'imp-pm1@example.com'),    -- PM, manages P1, authors the plan
  ('15150000-0000-0000-0000-0000000000a6', 'imp-eng1@example.com'),   -- Engineer, claimant
  ('15150000-0000-0000-0000-0000000000a7', 'imp-exec@example.com'),   -- Executive, the whole senior set + plan approver
  ('15150000-0000-0000-0000-0000000000a8', 'imp-admin2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15150000-0000-0000-0000-0000000000a1', '15150000-0000-0000-0000-00000000000a', 'IMP Admin',  'imp-admin@example.com',  'Admin', 'active'),
  ('15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-00000000000a', 'IMP Fin1',   'imp-fin1@example.com',   'Finance', 'active'),
  ('15150000-0000-0000-0000-0000000000a4', '15150000-0000-0000-0000-00000000000a', 'IMP PM1',    'imp-pm1@example.com',    'Project Manager', 'active'),
  ('15150000-0000-0000-0000-0000000000a6', '15150000-0000-0000-0000-00000000000a', 'IMP Eng1',   'imp-eng1@example.com',   'Engineer', 'active'),
  ('15150000-0000-0000-0000-0000000000a7', '15150000-0000-0000-0000-00000000000a', 'IMP Exec',   'imp-exec@example.com',   'Executive', 'active'),
  ('15150000-0000-0000-0000-0000000000a8', '15150000-0000-0000-0000-00000000000a', 'IMP Admin2', 'imp-admin2@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15150000-0000-0000-0000-0000000000c1', '15150000-0000-0000-0000-00000000000a', 'IMP Site One', 'Ongoing Project', '15150000-0000-0000-0000-0000000000a4');
insert into spend_approvers (org_id, project_id, profile_id) values
  ('15150000-0000-0000-0000-00000000000a', null, '15150000-0000-0000-0000-0000000000a7');
insert into org_imprest_settings (org_id, procurement_limit, updated_by) values
  ('15150000-0000-0000-0000-00000000000a', 2000000, '15150000-0000-0000-0000-0000000000a1');
-- P1's active budget with no project approver: in-plan items route `flat` (every approval-rank member).
insert into budget_versions (id, org_id, project_id, name, version, status) values
  ('15150000-0000-0000-0000-000000000f01', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1', 'v1', 1, 'Draft');
insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount) values
  ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-000000000f01', 'Vehicle', 100000000);
update budget_versions set status = 'Active' where id = '15150000-0000-0000-0000-000000000f01';
insert into imprest_floats (id, org_id, project_id, custodian_id, float_amount, currency, created_by) values
  ('15150000-0000-0000-0000-0000000000d1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000c1',
   '15150000-0000-0000-0000-0000000000a2', 10000000, 'IDR', '15150000-0000-0000-0000-0000000000a1');
insert into imprest_replenishments (id, org_id, float_id, kind, number, status, amount, requested_by, approved_by, paid_by,
                                    requested_at, approved_at, paid_at, paid_on) values
  ('15150000-0000-0000-0000-0000000000e1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   'funding', 'REP-FIXTURE-F', 'Paid', 10000000, '15150000-0000-0000-0000-0000000000a2', '15150000-0000-0000-0000-0000000000a1',
   '15150000-0000-0000-0000-0000000000a8', now(), now(), now(), current_date);
-- This month's plan on F, Vehicle 1,000,000, authored by PM1 and approved by the Executive.
insert into imprest_plans (id, org_id, float_id, month, number, author_id) values
  ('15150000-0000-0000-0000-000000000701', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   date_trunc('month', now() at time zone 'Asia/Jakarta')::date, 'IPL-FIXTURE-701', '15150000-0000-0000-0000-0000000000a4');
insert into imprest_plan_lines (org_id, plan_id, budget_category, planned_amount) values
  ('15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-000000000701', 'Vehicle', 1000000);
update imprest_plans set status = 'Approved', submitted_at = now(), approved_by = '15150000-0000-0000-0000-0000000000a7',
  approved_at = now() where id = '15150000-0000-0000-0000-000000000701';

-- Draft float claims by Eng1 on F (Vehicle): X out of plan (1,500,000); A and B in plan alone (600,000 each).
create or replace function pg_temp.draft(p_id uuid, p_title text, p_amount numeric) returns void language sql as $$
  insert into expense_claims (id, org_id, kind, claimant_id, project_id, budget_category, title, amount, status, imprest_float_id)
  values (p_id, '15150000-0000-0000-0000-00000000000a', 'claim', '15150000-0000-0000-0000-0000000000a6',
          '15150000-0000-0000-0000-0000000000c1', 'Vehicle', p_title, 0, 'Draft', '15150000-0000-0000-0000-0000000000d1');
  insert into expense_claim_lines (claim_id, expense_date, expense_type, description, amount)
  values (p_id, current_date, 'Local transport', 'Diesel', p_amount);
  insert into expense_claim_files (claim_id, org_id, file_path)
  values (p_id, '15150000-0000-0000-0000-00000000000a',
          '15150000-0000-0000-0000-00000000000a/' || p_id || '/' || gen_random_uuid() || '/r.pdf');
$$;
select pg_temp.draft('15150000-0000-0000-0000-000000000711', 'out of plan X', 1500000);
select pg_temp.draft('15150000-0000-0000-0000-000000000712', 'in plan A', 600000);
select pg_temp.draft('15150000-0000-0000-0000-000000000713', 'in plan B', 600000);
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.heard(p_claim uuid, p_title text) returns uuid[] language sql as $$
  select array_agg(owner_id order by owner_id) from notifications
   where metadata->'entity'->>'id' = p_claim::text and title = p_title;
$$;

set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a6');
select transition_expense_claim('15150000-0000-0000-0000-000000000711', 'Submitted');
select transition_expense_claim('15150000-0000-0000-0000-000000000712', 'Submitted');
select transition_expense_claim('15150000-0000-0000-0000-000000000713', 'Submitted');
reset role;
select is(pg_temp.heard('15150000-0000-0000-0000-000000000711', 'Out-of-plan site cash item awaiting your approval'),
  array['15150000-0000-0000-0000-0000000000a1', '15150000-0000-0000-0000-0000000000a8']::uuid[],
  'AC-IMP-062 with the senior set exhausted by the plan approver, an out-of-plan item goes to the Admins');
select ok(not ('15150000-0000-0000-0000-0000000000a6' = any (coalesce(pg_temp.heard('15150000-0000-0000-0000-000000000711',
            'Out-of-plan site cash item awaiting your approval'), '{}'))),
  'AC-IMP-062 an out-of-plan item never notifies its claimant');
select ok(not ('15150000-0000-0000-0000-0000000000a2' = any (coalesce(pg_temp.heard('15150000-0000-0000-0000-000000000712',
            'Expense claim awaiting your approval'), '{}'))),
  'AC-IMP-062 the float''s custodian is never asked to approve a record on their own float');
select ok('15150000-0000-0000-0000-0000000000a4' = any (pg_temp.heard('15150000-0000-0000-0000-000000000712',
            'Expense claim awaiting your approval')),
  'AC-IMP-062 (control) the in-plan item still reaches the flat route');

-- Admin approves A (600,000): B (600,000) no longer fits the 400,000 left, so it is now an exception.
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a1');
select transition_expense_claim('15150000-0000-0000-0000-000000000712', 'Approved');
reset role;
select is(pg_temp.heard('15150000-0000-0000-0000-000000000713', 'Out-of-plan site cash item awaiting your approval'),
  array['15150000-0000-0000-0000-0000000000a8']::uuid[],
  'AC-IMP-062 an item pushed out of plan by another approval alerts the people who may still approve it');
select is((select count(*)::int from notifications where metadata->'entity'->>'id' = '15150000-0000-0000-0000-000000000711'
             and title = 'Out-of-plan site cash item awaiting your approval'), 2,
  'AC-IMP-062 an item already out of plan is not alerted again');

select set_config('request.jwt.claims', '', true);  -- seed as superuser: no acting user to skip
-- Replenishments: Fin1 is the custodian and the only Finance member, so the request falls back to the Admins.
insert into imprest_replenishments (id, org_id, float_id, kind, number, amount, requested_by) values
  ('15150000-0000-0000-0000-0000000007a1', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   'replenishment', 'REP-FIXTURE-N1', 1, '15150000-0000-0000-0000-0000000000a2');
select is((select array_agg(owner_id order by owner_id) from notifications where metadata->'entity'->>'id' = '15150000-0000-0000-0000-0000000007a1'),
  array['15150000-0000-0000-0000-0000000000a1', '15150000-0000-0000-0000-0000000000a8']::uuid[],
  'AC-IMP-062 with no Finance member but the custodian, a replenishment request goes to the Admins');
insert into imprest_replenishments (id, org_id, float_id, kind, number, amount, requested_by) values
  ('15150000-0000-0000-0000-0000000007a2', '15150000-0000-0000-0000-00000000000a', '15150000-0000-0000-0000-0000000000d1',
   'replenishment', 'REP-FIXTURE-N2', 1, '15150000-0000-0000-0000-0000000000a1');
select is((select array_agg(owner_id) from notifications where metadata->'entity'->>'id' = '15150000-0000-0000-0000-0000000007a2'),
  array['15150000-0000-0000-0000-0000000000a8']::uuid[], 'AC-IMP-062 the Admin fallback never notifies the requester');
delete from notifications where metadata->'entity'->>'id' = '15150000-0000-0000-0000-0000000007a1';
set local role authenticated;
select pg_temp.act_as('15150000-0000-0000-0000-0000000000a8');
select transition_imprest_replenishment('15150000-0000-0000-0000-0000000007a1', 'Rejected');
reset role;
select is((select count(*)::int from notifications where metadata->'entity'->>'id' = '15150000-0000-0000-0000-0000000007a1'), 0,
  'AC-IMP-062 a rejected replenishment sends nothing');

select * from finish();
rollback;
