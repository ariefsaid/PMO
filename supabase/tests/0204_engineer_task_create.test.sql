-- 0204_engineer_task_create.test.sql — an Engineer may create and edit tasks (DD-TASK-8, #551).
-- Migration under test: supabase/migrations/0204_engineer_task_create.sql.
--
-- ⚑ REWRITTEN AFTER A 3-LENS REVIEW KILLED THE FIRST DRAFT (2026-08-24). What the review proved,
-- and what this file now exists to keep dead:
--   · created_by was client-writable on UPDATE — a creator could reassign authorship and mint an
--     edit right for an arbitrary colleague (AC-T8-013/014/015 pin it, for every actor class).
--   · the assignee disjunct the draft added to tasks_update was fully redundant with
--     tasks_update_own_status AND dropped that policy's external guard — an Engineer assignee could
--     tombstone a ClickUp-mirrored task (AC-T8-020/021 cover the external paths).
--   · the creator branch was an unconditional pass — a creator could tombstone/archive their own
--     task and rewrite provenance (AC-T8-016..019 pin the allowlist in both polarities).
-- ⚑ Fixtures are ASYMMETRIC on purpose (creator ≠ assignee everywhere): a fixture where they are
-- the same person cannot tell the two disjuncts apart — the first draft's dead oracle proved it.
-- ⚑ Row-modifying assertions COUNT ROWS via top-level CTEs: an RLS-denied UPDATE is a silent 0-row
-- no-op, not an error, so lives_ok passes whether the policy admits or refuses the caller.
-- ================================================================================================

begin;
select plan(21);

insert into organizations (id, name) values
  ('00d40000-0000-0000-0000-000000000001','DD-TASK-8 Org');

insert into auth.users (id, email) values
  ('00d40000-0000-0000-0000-0000000000e1','t8-engineer@example.com'),
  ('00d40000-0000-0000-0000-0000000000e2','t8-engineer2@example.com'),
  ('00d40000-0000-0000-0000-0000000000f1','t8-pm@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('00d40000-0000-0000-0000-0000000000e1','00d40000-0000-0000-0000-000000000001','Engineer One','t8-engineer@example.com','Engineer','active'),
  ('00d40000-0000-0000-0000-0000000000e2','00d40000-0000-0000-0000-000000000001','Engineer Two','t8-engineer2@example.com','Engineer','active'),
  ('00d40000-0000-0000-0000-0000000000f1','00d40000-0000-0000-0000-000000000001','The PM','t8-pm@example.com','Project Manager','active');

insert into projects (id, org_id, code, name, status) values
  ('00d40000-0000-0000-0000-000000000010','00d40000-0000-0000-0000-000000000001','T8','DD-TASK-8 Project','Ongoing Project'),
  ('00d40000-0000-0000-0000-000000000020','00d40000-0000-0000-0000-000000000001','T8X','DD-TASK-8 External Project','Ongoing Project');

-- Server-authority rows. 201: created by nobody (created_by NULL), assigned to e2 — the row e1 must
-- not touch. 301: lives in the soon-to-be-external project, authored by e1, assigned to e2 — the
-- external-path fixture (server authority may SUPPLY created_by; the stamp only fires for humans).
reset role;
insert into tasks (id, org_id, project_id, name, status, assignee_id, created_by) values
  ('00d40000-0000-0000-0000-000000000201','00d40000-0000-0000-0000-000000000001','00d40000-0000-0000-0000-000000000010','Someone Else''s Task','To Do','00d40000-0000-0000-0000-0000000000e2',null),
  ('00d40000-0000-0000-0000-000000000301','00d40000-0000-0000-0000-000000000001','00d40000-0000-0000-0000-000000000020','Mirrored Task','To Do','00d40000-0000-0000-0000-0000000000e2','00d40000-0000-0000-0000-0000000000e1');

-- ── §1 — the column, the stamp, the forgery guard ───────────────────────────────────────────────
select has_column('public','tasks','created_by',
  'AC-T8-001 tasks.created_by exists — "a task you created" is otherwise inexpressible');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00d40000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- Per the spec's stated fixture shape: an Engineer-created task assigned to SOMEONE ELSE.
select lives_ok($$
  insert into tasks (id, org_id, project_id, name, status, assignee_id)
  values ('00d40000-0000-0000-0000-000000000101','00d40000-0000-0000-0000-000000000001',
          '00d40000-0000-0000-0000-000000000010','Engineer-created task','To Do',
          '00d40000-0000-0000-0000-0000000000e2')
$$, 'AC-T8-002 an Engineer may INSERT a task (DD-TASK-8)');

select is(
  (select created_by from tasks where id = '00d40000-0000-0000-0000-000000000101'),
  '00d40000-0000-0000-0000-0000000000e1'::uuid,
  'AC-T8-003 created_by is stamped from auth.uid() by the trigger');

select lives_ok($$
  insert into tasks (org_id, project_id, name, status, created_by)
  values ('00d40000-0000-0000-0000-000000000001','00d40000-0000-0000-0000-000000000010','Forged authorship','To Do',
          '00d40000-0000-0000-0000-0000000000f1')
$$, 'AC-T8-004 a client-supplied created_by does not error…');

select is(
  (select created_by from tasks where name = 'Forged authorship'),
  '00d40000-0000-0000-0000-0000000000e1'::uuid,
  'AC-T8-005 …it is OVERWRITTEN with the real caller, not accepted');

-- ── §2 — UPDATE: the creator disjunct, both polarities ─────────────────────────────────────────
with u as (
  update tasks set name = 'Renamed by its creator'
   where id = '00d40000-0000-0000-0000-000000000101' returning 1)
select is((select count(*)::int from u), 1,
  'AC-T8-006 the creator (NOT the assignee) may rename their task — create-without-edit is incoherent');

with u as (
  update tasks set name = 'Should not happen'
   where id = '00d40000-0000-0000-0000-000000000201' returning 1)
select is((select count(*)::int from u), 0,
  'AC-T8-007 an Engineer may NOT update a task they neither created nor are assigned');

select is(
  (select name from tasks where id = '00d40000-0000-0000-0000-000000000201'),
  'Someone Else''s Task',
  'AC-T8-008 …and the row is genuinely unchanged (RLS filtered the UPDATE, not silently applied)');

-- ⚑ Honest label: this path is OWNED BY tasks_update_own_status (0199), untouched here. It is a
-- regression check that 0204 did not break the assignee, NOT proof of any 0204 disjunct — the first
-- draft claimed otherwise and a mutation run showed the claim false.
set local request.jwt.claims = '{"sub":"00d40000-0000-0000-0000-0000000000e2","role":"authenticated"}';
with u as (
  update tasks set status = 'In Progress'
   where id = '00d40000-0000-0000-0000-000000000201' returning 1)
select is((select count(*)::int from u), 1,
  'AC-T8-009 the assignee status path (tasks_update_own_status, 0199) still works under 0204');

-- ── §3 — the UPDATE pin: created_by is immutable for EVERY actor class ─────────────────────────
set local request.jwt.claims = '{"sub":"00d40000-0000-0000-0000-0000000000e1","role":"authenticated"}';
-- The exact two-column attack the review executed: hand authorship to f1 while keeping access via
-- another field. The UPDATE succeeds (assignee_id is a creator-allowlisted work field) but the
-- authorship must not move.
with u as (
  update tasks set created_by = '00d40000-0000-0000-0000-0000000000f1',
                   assignee_id = '00d40000-0000-0000-0000-0000000000e1'
   where id = '00d40000-0000-0000-0000-000000000101' returning 1)
select is((select count(*)::int from u), 1,
  'AC-T8-013 the creator''s two-column forgery attempt does not error…');

select is(
  (select created_by from tasks where id = '00d40000-0000-0000-0000-000000000101'),
  '00d40000-0000-0000-0000-0000000000e1'::uuid,
  'AC-T8-014 …and created_by did NOT move — pinned on UPDATE (an authz input, not a user field)');

-- ⚑ A REAL role switch, not just claims: service_role holds BYPASSRLS, so this exercises the pin
-- with every policy out of the way — the trigger is the only thing standing. (The first version set
-- service_role CLAIMS under the authenticated ROLE; the read-back then hit RLS with no identity and
-- returned NULL — the assertion was failing on its own fixture, not on the pin.)
reset role;
set local role service_role;
update tasks set created_by = '00d40000-0000-0000-0000-0000000000f1'
 where id = '00d40000-0000-0000-0000-000000000101';
select is(
  (select created_by from tasks where id = '00d40000-0000-0000-0000-000000000101'),
  '00d40000-0000-0000-0000-0000000000e1'::uuid,
  'AC-T8-015 even service_role (BYPASSRLS) cannot move created_by — the pin is unconditional');

-- ── §4 — the creator allowlist: work fields yes, lifecycle and provenance no ────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00d40000-0000-0000-0000-0000000000e1","role":"authenticated"}';

select throws_ok($$
  update tasks set tombstoned_at = now() where id = '00d40000-0000-0000-0000-000000000101'
$$, '42501', 'creator may edit task fields, not lifecycle or provenance columns',
  'AC-T8-016 the creator cannot tombstone their own task — a tombstone is a delete in every DAL read');

select throws_ok($$
  update tasks set archived_at = now() where id = '00d40000-0000-0000-0000-000000000101'
$$, '42501', 'creator may edit task fields, not lifecycle or provenance columns',
  'AC-T8-017 the creator cannot archive — task.archive stays with the write roles');

with u as (
  update tasks set description = 'scoped', priority = 'High',
                   start_date = '2026-09-01', end_date = '2026-09-05'
   where id = '00d40000-0000-0000-0000-000000000101' returning 1)
select is((select count(*)::int from u), 1,
  'AC-T8-018 the creator CAN edit the work fields (description/priority/dates) — the allowlist admits them');

select throws_ok($$
  update tasks set created_at = '2020-01-01T00:00:00Z' where id = '00d40000-0000-0000-0000-000000000101'
$$, '42501', 'creator may edit task fields, not lifecycle or provenance columns',
  'AC-T8-019 the creator cannot rewrite provenance (created_at)');

-- ── §5 — what must NOT widen ────────────────────────────────────────────────────────────────────
with d as (
  delete from tasks where id = '00d40000-0000-0000-0000-000000000101' returning 1)
select is((select count(*)::int from d), 0,
  'AC-T8-010 DELETE does NOT widen — destructive, ADR-0019, and nobody asked for it');

select is(
  (select count(*)::int from tasks where org_id <> '00d40000-0000-0000-0000-000000000001'),
  0,
  'AC-T8-011 the Engineer sees no task outside their org (the tenancy floor is untouched)');

reset role;
select is(
  (select created_by from tasks where id = '00d40000-0000-0000-0000-000000000201'),
  null::uuid,
  'AC-T8-012 a server-authority insert with no author stays NULL — no caller, no author');

-- ── §6 — the external paths the first draft opened; flipped LAST so earlier rows stay native ────
insert into external_domain_ownership (org_id, external_tier, domain)
values ('00d40000-0000-0000-0000-000000000001','clickup','tasks');
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id)
values ('00d40000-0000-0000-0000-000000000001','00d40000-0000-0000-0000-000000000020','clickup','t8-list-x');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00d40000-0000-0000-0000-0000000000e2","role":"authenticated"}';
with u as (
  update tasks set tombstoned_at = now()
   where id = '00d40000-0000-0000-0000-000000000301' returning 1)
select is((select count(*)::int from u), 0,
  'AC-T8-020 an ASSIGNEE cannot tombstone a ClickUp-mirrored task — the external guard held');

set local request.jwt.claims = '{"sub":"00d40000-0000-0000-0000-0000000000e1","role":"authenticated"}';
-- ⚑ tombstoned_at, NOT a rename, on purpose: a rename would ALSO be blocked by the trigger's
-- external allowlist, so this oracle would stay "red by abort" even if §3's guard vanished — while
-- tombstoned_at IS in that allowlist, so the policy guard is the ONLY thing standing. Mutation-
-- verified: dropping the external conjunct from the creator disjunct flips exactly this to 1 row.
with u as (
  update tasks set tombstoned_at = now()
   where id = '00d40000-0000-0000-0000-000000000301' returning 1)
select is((select count(*)::int from u), 0,
  'AC-T8-021 a CREATOR cannot tombstone a ClickUp-mirrored task — §3''s creator disjunct is guarded too');

select * from finish();
rollback;
