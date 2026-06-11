-- 0064_milestone_checks_and_input_clear.test.sql — weight/input_pct CHECK constraints +
-- clearing input_pct reverts effective % to calculated (AC-DEL-020).
-- Fixture namespace: 00640000-… (unique to this test).
begin;
select plan(5);

-- ── Fixtures (table owner, bypassing RLS) ───────────────────────────────────
insert into auth.users (id, email) values
  ('00640000-0000-0000-0000-0000000000a1','chk-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00640000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001',
   'CHK PM','chk-pm@example.com','Project Manager');

insert into companies (id, org_id, name, type) values
  ('00640000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','CHK Client','Client');

insert into projects (id, org_id, code, name, status, client_id, project_manager_id, contract_value) values
  ('00640000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'CHK-001','CHK Test Project','Ongoing Project',
   '00640000-0000-0000-0000-000000000010',
   '00640000-0000-0000-0000-0000000000a1',100000);

-- Milestone M with 5 tasks (2 Done → calculated_pct = 40), input_pct = 75 initially.
insert into project_milestones (id, org_id, project_id, name, input_pct) values
  ('00640000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001',
   '00640000-0000-0000-0000-000000000020','Checks Milestone',75);

insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('00640000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000001',
   '00640000-0000-0000-0000-000000000020','00640000-0000-0000-0000-000000000030','CHK T1','Done'),
  ('00640000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000001',
   '00640000-0000-0000-0000-000000000020','00640000-0000-0000-0000-000000000030','CHK T2','Done'),
  ('00640000-0000-0000-0000-000000000043','00000000-0000-0000-0000-000000000001',
   '00640000-0000-0000-0000-000000000020','00640000-0000-0000-0000-000000000030','CHK T3','To Do'),
  ('00640000-0000-0000-0000-000000000044','00000000-0000-0000-0000-000000000001',
   '00640000-0000-0000-0000-000000000020','00640000-0000-0000-0000-000000000030','CHK T4','To Do'),
  ('00640000-0000-0000-0000-000000000045','00000000-0000-0000-0000-000000000001',
   '00640000-0000-0000-0000-000000000020','00640000-0000-0000-0000-000000000030','CHK T5','To Do');

-- ── As PM: clear input_pct → effective % should revert to calculated (40). ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00640000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ update project_milestones set input_pct = null
       where id = '00640000-0000-0000-0000-000000000030' $$,
  'AC-DEL-020: PM UPDATE input_pct = null clears it');

reset role;

-- AC-DEL-020: after clearing input_pct, effective % = calculated (2/5 = 40).
select is(
  (select effective_pct from get_project_milestones('00640000-0000-0000-0000-000000000020')
    where id = '00640000-0000-0000-0000-000000000030'),
  40::numeric,
  'AC-DEL-020: effective % reverts to calculated (40) after input_pct cleared');

-- ── CHECK constraint: input_pct > 100 rejected. ─────────────────────────────
-- (Must set input_pct back via owner path for the update target to exist)
update project_milestones set input_pct = 50 where id = '00640000-0000-0000-0000-000000000030';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00640000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update project_milestones set input_pct = 150
       where id = '00640000-0000-0000-0000-000000000030' $$,
  '23514', null,
  'AC-DEL-020: input_pct > 100 rejected (23514 check_violation)');

-- ── CHECK constraint: negative weight rejected. ───────────────────────────────
select throws_ok(
  $$ update project_milestones set weight = -1
       where id = '00640000-0000-0000-0000-000000000030' $$,
  '23514', null,
  'AC-DEL-020: negative weight rejected (23514 check_violation)');

reset role;

-- AC-DEL-020: input_pct < 0 rejected.
update project_milestones set weight = 1 where id = '00640000-0000-0000-0000-000000000030';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00640000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update project_milestones set input_pct = -5
       where id = '00640000-0000-0000-0000-000000000030' $$,
  '23514', null,
  'AC-DEL-020: input_pct < 0 rejected (23514 check_violation)');

reset role;

select * from finish();
rollback;
