-- 0034_task_completed_at.test.sql — trigger stamp_task_completed_at behaviour (FR-SCA-002..006).
-- AC-SCA-007: into-Done stamps completed_at ≈ now().
-- AC-SCA-008: leaving-Done clears completed_at → null.
-- AC-SCA-009: non-status UPDATE (as PM write-role) preserves completed_at (still non-null, still = captured value).
-- AC-SCA-010: INSERT-as-Done stamps completed_at ≈ now().
-- AC-SCA-011: re-entering Done re-stamps a fresh completed_at (non-null after re-Done).
-- Fixture namespace: 00340000-… (unique to this file).
-- All assertions run after reset role so reads use table-owner privileges (bypass RLS).
begin;
select plan(8);

-- ── Fixtures (table owner, bypassing RLS) ───────────────────────────────────
insert into auth.users (id, email) values
  ('00340000-0000-0000-0000-0000000000a1','sca-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00340000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001',
   'SCA PM','sca-pm@example.com','Project Manager');

insert into companies (id, org_id, name, type) values
  ('00340000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','SCA Client','Client');

insert into projects (id, org_id, code, name, status, client_id, project_manager_id, contract_value) values
  ('00340000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'SCA-001','SCA Test Project','Ongoing Project',
   '00340000-0000-0000-0000-000000000010',
   '00340000-0000-0000-0000-0000000000a1', 1000000);

insert into project_milestones (id, org_id, project_id, name, sort_order) values
  ('00340000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001',
   '00340000-0000-0000-0000-000000000020','Phase One', 0);

-- Seed a To Do task used in AC-SCA-007/008/009/011.
insert into tasks (id, org_id, project_id, name, status, milestone_id) values
  ('00340000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000001',
   '00340000-0000-0000-0000-000000000020','Task Alpha','To Do',
   '00340000-0000-0000-0000-000000000030');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-SCA-007: status → Done stamps completed_at ≈ now()
-- Run as PM (write-role) so the column-pin trigger allows the status change.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00340000-0000-0000-0000-0000000000a1","role":"authenticated"}';

update tasks set status = 'Done' where id = '00340000-0000-0000-0000-000000000041';

reset role;

select isnt(
  (select completed_at from tasks where id = '00340000-0000-0000-0000-000000000041'),
  null::timestamptz,
  'AC-SCA-007: completed_at is NOT null after status → Done');

select ok(
  (select completed_at from tasks where id = '00340000-0000-0000-0000-000000000041')
    >= now() - interval '5 seconds',
  'AC-SCA-007: completed_at is approximately now() (within 5 s)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-SCA-008: leaving Done → completed_at cleared to null
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00340000-0000-0000-0000-0000000000a1","role":"authenticated"}';

update tasks set status = 'In Progress' where id = '00340000-0000-0000-0000-000000000041';

reset role;

select is(
  (select completed_at from tasks where id = '00340000-0000-0000-0000-000000000041'),
  null::timestamptz,
  'AC-SCA-008: completed_at is null after leaving Done → In Progress');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-SCA-009: non-status UPDATE (as PM write-role) preserves completed_at
-- Strategy: capture completed_at into a temp table before the name update, then compare after.
-- ════════════════════════════════════════════════════════════════════════════
-- First put it back to Done so completed_at is set.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00340000-0000-0000-0000-0000000000a1","role":"authenticated"}';

update tasks set status = 'Done' where id = '00340000-0000-0000-0000-000000000041';

reset role;

-- Capture completed_at before the non-status update.
create temp table sca_snap (completed_at_before timestamptz) on commit drop;
insert into sca_snap select completed_at from tasks where id = '00340000-0000-0000-0000-000000000041';

-- Non-status update as PM write-role (column-pin trigger allows structure edits for write-roles).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00340000-0000-0000-0000-0000000000a1","role":"authenticated"}';

update tasks set name = 'Task Alpha Renamed' where id = '00340000-0000-0000-0000-000000000041';

reset role;

-- Assert completed_at equals the captured value.
select is(
  (select completed_at from tasks where id = '00340000-0000-0000-0000-000000000041'),
  (select completed_at_before from sca_snap),
  'AC-SCA-009: non-status UPDATE (PM write-role) does NOT change completed_at');

select isnt(
  (select completed_at from tasks where id = '00340000-0000-0000-0000-000000000041'),
  null::timestamptz,
  'AC-SCA-009: completed_at remains non-null after non-status name update');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-SCA-010: INSERT-as-Done stamps completed_at ≈ now()
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00340000-0000-0000-0000-0000000000a1","role":"authenticated"}';

insert into tasks (id, project_id, name, status, milestone_id) values
  ('00340000-0000-0000-0000-000000000042',
   '00340000-0000-0000-0000-000000000020','Task Beta Done on Insert','Done',
   '00340000-0000-0000-0000-000000000030');

reset role;

select isnt(
  (select completed_at from tasks where id = '00340000-0000-0000-0000-000000000042'),
  null::timestamptz,
  'AC-SCA-010: INSERT-as-Done stamps completed_at (non-null)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-SCA-011: re-entering Done re-stamps a fresh completed_at ≥ T1
-- Strategy: capture T1 in the snap table, cycle In Progress → Done, compare T2 ≥ T1.
-- ════════════════════════════════════════════════════════════════════════════
-- Task Alpha is currently Done (from AC-SCA-009 setup). Capture T1.
create temp table sca_snap2 (t1 timestamptz) on commit drop;
insert into sca_snap2 select completed_at from tasks where id = '00340000-0000-0000-0000-000000000041';

-- Move to In Progress (clears completed_at).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00340000-0000-0000-0000-0000000000a1","role":"authenticated"}';

update tasks set status = 'In Progress' where id = '00340000-0000-0000-0000-000000000041';

-- Re-enter Done (should re-stamp with a fresh now()).
update tasks set status = 'Done' where id = '00340000-0000-0000-0000-000000000041';

reset role;

select isnt(
  (select completed_at from tasks where id = '00340000-0000-0000-0000-000000000041'),
  null::timestamptz,
  'AC-SCA-011: re-entering Done stamps a non-null completed_at');

select ok(
  (select completed_at from tasks where id = '00340000-0000-0000-0000-000000000041')
    >= (select t1 from sca_snap2),
  'AC-SCA-011: re-entering Done re-stamps completed_at ≥ T1');

select * from finish();
rollback;
