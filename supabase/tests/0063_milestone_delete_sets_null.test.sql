-- 0063_milestone_delete_sets_null.test.sql — tasks.milestone_id ON DELETE SET NULL.
-- AC-DEL-021: when a PM hard-deletes a milestone, dependent tasks survive with milestone_id = null.
-- Fixture namespace: 00630000-… (unique to this test).
begin;
select plan(5);

-- ── Fixtures (table owner, bypassing RLS) ───────────────────────────────────
insert into auth.users (id, email) values
  ('00630000-0000-0000-0000-0000000000a1','del-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00630000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001',
   'Del PM','del-pm@example.com','Project Manager');

insert into companies (id, org_id, name, type) values
  ('00630000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Del Client','Client');

insert into projects (id, org_id, code, name, status, client_id, project_manager_id, contract_value) values
  ('00630000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'DEL-001','Del Test Project','Ongoing Project',
   '00630000-0000-0000-0000-000000000010',
   '00630000-0000-0000-0000-0000000000a1',100000);

insert into project_milestones (id, org_id, project_id, name) values
  ('00630000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001',
   '00630000-0000-0000-0000-000000000020','Milestone M1');

insert into tasks (id, org_id, project_id, milestone_id, name, status) values
  ('00630000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000001',
   '00630000-0000-0000-0000-000000000020','00630000-0000-0000-0000-000000000030','Task T1','To Do'),
  ('00630000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000001',
   '00630000-0000-0000-0000-000000000020','00630000-0000-0000-0000-000000000030','Task T2','To Do');

-- PM deletes the milestone (RLS gated).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00630000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ delete from project_milestones
       where id = '00630000-0000-0000-0000-000000000030' $$,
  'AC-DEL-021: PM hard-delete of milestone M1 succeeds');

reset role;

-- Tasks still exist, milestone_id nulled by FK ON DELETE SET NULL.
select ok(
  (select exists (select 1 from tasks where id = '00630000-0000-0000-0000-000000000041')),
  'AC-DEL-021: T1 still exists after milestone delete');

select ok(
  (select milestone_id is null from tasks where id = '00630000-0000-0000-0000-000000000041'),
  'AC-DEL-021: T1.milestone_id is null after milestone delete');

select ok(
  (select exists (select 1 from tasks where id = '00630000-0000-0000-0000-000000000042')),
  'AC-DEL-021: T2 still exists after milestone delete');

select ok(
  (select milestone_id is null from tasks where id = '00630000-0000-0000-0000-000000000042'),
  'AC-DEL-021: T2.milestone_id is null after milestone delete');

select * from finish();
rollback;
