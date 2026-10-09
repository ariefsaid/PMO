-- budget_second_activator.test.sql — OD-BUDGET-6 (#922): the person who drafted a budget version cannot
-- activate it; a second person activates. The drafter is recorded server-side on insert and on clone; a
-- version with no recorded drafter (older or seeded) can be activated by Admin or Finance only.
-- The drafter's profile itself cannot be deleted out from under the version (created_by is
-- ON DELETE RESTRICT): attribution is never silently lost and activation never widens.
-- Migration under test: 0271_budget_second_activator.sql.
begin;
create extension if not exists pgtap;
select plan(27);

-- Fixtures (inserted as table owner, no JWT: auth.uid() is null here).
insert into organizations (id, name) values
  ('f9220000-0000-0000-0000-000000000001','Second Activator Org');

insert into auth.users (id, email) values
  ('f9220000-0000-0000-0000-0000000000a1','pm1-sa@example.com'),
  ('f9220000-0000-0000-0000-0000000000a2','pm2-sa@example.com'),
  ('f9220000-0000-0000-0000-0000000000a3','fin-sa@example.com'),
  ('f9220000-0000-0000-0000-0000000000a4','admin-sa@example.com'),
  ('f9220000-0000-0000-0000-0000000000a5','exec-sa@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('f9220000-0000-0000-0000-0000000000a1','f9220000-0000-0000-0000-000000000001','PM One','pm1-sa@example.com','Project Manager'),
  ('f9220000-0000-0000-0000-0000000000a2','f9220000-0000-0000-0000-000000000001','PM Two','pm2-sa@example.com','Project Manager'),
  ('f9220000-0000-0000-0000-0000000000a3','f9220000-0000-0000-0000-000000000001','Fin SA','fin-sa@example.com','Finance'),
  ('f9220000-0000-0000-0000-0000000000a4','f9220000-0000-0000-0000-000000000001','Admin SA','admin-sa@example.com','Admin'),
  ('f9220000-0000-0000-0000-0000000000a5','f9220000-0000-0000-0000-000000000001','Exec SA','exec-sa@example.com','Executive');

insert into projects (id, org_id, name, status) values
  ('f9221111-0000-0000-0000-000000000001','f9220000-0000-0000-0000-000000000001','Second Activator Project','Ongoing Project');

-- A version with no recorded drafter (an older or seeded version): inserted by the table owner, no JWT.
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('f9222222-0000-0000-0000-000000000009','f9220000-0000-0000-0000-000000000001','f9221111-0000-0000-0000-000000000001',9,'No drafter','Draft'),
  ('f9222222-0000-0000-0000-000000000010','f9220000-0000-0000-0000-000000000001','f9221111-0000-0000-0000-000000000001',10,'No drafter 2','Draft');

select has_column('public', 'budget_versions', 'created_by',
  'OD-BUDGET-6: budget_versions records who drafted each version (created_by)');

select is(
  (select created_by from budget_versions where id = 'f9222222-0000-0000-0000-000000000009'),
  null::uuid,
  'OD-BUDGET-6: a version inserted server-side with no caller has no recorded drafter');

-- ── PM One drafts v1 ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9220000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ insert into budget_versions (id, org_id, project_id, version, name, status)
     values ('f9222222-0000-0000-0000-000000000001','f9220000-0000-0000-0000-000000000001',
             'f9221111-0000-0000-0000-000000000001',1,'PM One draft','Draft') $$,
  'OD-BUDGET-6: a PM drafts a version');

select is(
  (select created_by from budget_versions where id = 'f9222222-0000-0000-0000-000000000001'),
  'f9220000-0000-0000-0000-0000000000a1'::uuid,
  'OD-BUDGET-6: the drafter is stamped server-side from the caller on insert');

-- The drafter cannot be named by the client: not on insert, not by a later update.
select throws_ok(
  $$ insert into budget_versions (org_id, project_id, version, name, status, created_by)
     values ('f9220000-0000-0000-0000-000000000001','f9221111-0000-0000-0000-000000000001',
             2,'Forged drafter','Draft','f9220000-0000-0000-0000-0000000000a2') $$,
  '42501', null,
  'OD-BUDGET-6: a client cannot supply created_by on insert');

select throws_ok(
  $$ update budget_versions set created_by = 'f9220000-0000-0000-0000-0000000000a2'
      where id = 'f9222222-0000-0000-0000-000000000001' $$,
  '42501', null,
  'OD-BUDGET-6: a client cannot change created_by');

-- The drafter cannot activate their own version.
select throws_ok(
  $$ select activate_budget_version('f9222222-0000-0000-0000-000000000001') $$,
  '42501', 'separation of duties: You edited this version, so someone else must activate it.',
  'OD-BUDGET-6: the drafter is refused activation of their own version');

select is(
  (select status::text from budget_versions where id = 'f9222222-0000-0000-0000-000000000001'),
  'Draft',
  'OD-BUDGET-6: the refused version is still a Draft');

-- PM One cannot activate a version with no recorded drafter either (Admin or Finance only).
select throws_ok(
  $$ select activate_budget_version('f9222222-0000-0000-0000-000000000009') $$,
  '42501', 'a budget version with no recorded drafter can be activated by Admin or Finance only',
  'OD-BUDGET-6: a PM is refused a version with no recorded drafter');

-- ── PM Two (a second eligible person) activates v1 ───────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"f9220000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select activate_budget_version('f9222222-0000-0000-0000-000000000001') $$,
  'OD-BUDGET-6: a second eligible person activates the version');

select is(
  (select status::text from budget_versions where id = 'f9222222-0000-0000-0000-000000000001'),
  'Active',
  'OD-BUDGET-6: the version is Active after the second person activates it');

-- PM Two clones the Active v1: the cloner is the drafter of the copy, not v1's drafter.
create temp table _clone (id uuid) on commit drop;
grant all on _clone to authenticated;
insert into _clone select clone_budget_version('f9222222-0000-0000-0000-000000000001');

select is(
  (select created_by from budget_versions where id = (select id from _clone)),
  'f9220000-0000-0000-0000-0000000000a2'::uuid,
  'OD-BUDGET-6: a clone records the cloner as its drafter');

select throws_ok(
  format('select activate_budget_version(%L)', (select id from _clone)),
  '42501', 'separation of duties: You edited this version, so someone else must activate it.',
  'OD-BUDGET-6: the cloner is refused activation of their own copy');

-- Executive is not Admin/Finance: refused a version with no recorded drafter.
set local request.jwt.claims = '{"sub":"f9220000-0000-0000-0000-0000000000a5","role":"authenticated"}';

select throws_ok(
  $$ select activate_budget_version('f9222222-0000-0000-0000-000000000009') $$,
  '42501', 'a budget version with no recorded drafter can be activated by Admin or Finance only',
  'OD-BUDGET-6: an Executive is refused a version with no recorded drafter');

-- PM One (who drafted v1, not the copy) activates the copy.
set local request.jwt.claims = '{"sub":"f9220000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  format('select activate_budget_version(%L)', (select id from _clone)),
  'OD-BUDGET-6: a person other than the cloner activates the copy');

-- ── Admin: no break-glass over the rule (consistent with OD-PROC-8) ─────────────────────────────
set local request.jwt.claims = '{"sub":"f9220000-0000-0000-0000-0000000000a4","role":"authenticated"}';

select lives_ok(
  $$ insert into budget_versions (id, org_id, project_id, version, name, status)
     values ('f9222222-0000-0000-0000-000000000004','f9220000-0000-0000-0000-000000000001',
             'f9221111-0000-0000-0000-000000000001',4,'Admin draft','Draft') $$,
  'OD-BUDGET-6: an Admin drafts a version');

select throws_ok(
  $$ select activate_budget_version('f9222222-0000-0000-0000-000000000004') $$,
  '42501', 'separation of duties: You edited this version, so someone else must activate it.',
  'OD-BUDGET-6: an Admin is refused activation of their own version');

select lives_ok(
  $$ select activate_budget_version('f9222222-0000-0000-0000-000000000009') $$,
  'OD-BUDGET-6: an Admin activates a version with no recorded drafter');

-- ── Finance activates a version with no recorded drafter ─────────────────────────────────────────
set local request.jwt.claims = '{"sub":"f9220000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ select activate_budget_version('f9222222-0000-0000-0000-000000000010') $$,
  'OD-BUDGET-6: Finance activates a version with no recorded drafter');

-- Finance may activate the Admin's draft (a second person).
select lives_ok(
  $$ select activate_budget_version('f9222222-0000-0000-0000-000000000004') $$,
  'OD-BUDGET-6: Finance activates a version another person drafted');

-- ── The drafter's profile cannot be deleted out from under the version (created_by RESTRICT) ─────
-- 0179 makes profile DELETE Admin-reachable. created_by is ON DELETE RESTRICT, so the delete is
-- refused (23503) while any drafted version still cites the profile: attribution is never silently
-- nulled (which would ALSO widen activation to the no-drafter Admin/Finance-only rule). Offboarding,
-- not deletion, is how a drafter leaves. PM Two (who drafted the clone) is the target — a later
-- section of this file still acts as PM One, so the delete must not consume THAT profile.
set local request.jwt.claims = '{"sub":"f9220000-0000-0000-0000-0000000000a4","role":"authenticated"}';

select throws_ok(
  $$ delete from profiles where id = 'f9220000-0000-0000-0000-0000000000a2' $$,
  '23503', null,
  'OD-BUDGET-6: deleting a profile that drafted a budget version is refused');

select is(
  (select created_by from budget_versions where id = (select id from _clone)),
  'f9220000-0000-0000-0000-0000000000a2'::uuid,
  'OD-BUDGET-6: the refused delete leaves the drafter attribution unchanged');

-- RESTRICT bites only on the provenance edge: a profile that drafted nothing is not trapped.
select lives_ok(
  $$ delete from profiles where id = 'f9220000-0000-0000-0000-0000000000a5' $$,
  'OD-BUDGET-6: a profile that drafted no budget version can still be deleted');

reset role;

-- The column grants: created_by is neither client-insertable nor client-updatable.
select ok(
  not has_column_privilege('authenticated', 'public.budget_versions', 'created_by', 'INSERT')
  and not has_column_privilege('authenticated', 'public.budget_versions', 'created_by', 'UPDATE')
  and not has_column_privilege('anon', 'public.budget_versions', 'created_by', 'INSERT')
  and not has_column_privilege('anon', 'public.budget_versions', 'created_by', 'UPDATE'),
  'OD-BUDGET-6: created_by holds no client INSERT/UPDATE privilege');

-- Second layer: even with the column grant widened (rolled back with the test), the trigger stamps the
-- caller on insert and refuses a client change on update.
grant insert (created_by), update (created_by) on public.budget_versions to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f9220000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into budget_versions (id, org_id, project_id, version, name, status, created_by)
  values ('f9222222-0000-0000-0000-000000000005','f9220000-0000-0000-0000-000000000001',
          'f9221111-0000-0000-0000-000000000001',5,'Forged drafter, widened grant','Draft',
          'f9220000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$ update budget_versions set created_by = 'f9220000-0000-0000-0000-0000000000a2'
      where id = 'f9222222-0000-0000-0000-000000000005' $$,
  '42501', 'budget_versions.created_by cannot be changed: the drafter is recorded server-side',
  'OD-BUDGET-6: the trigger refuses a client change to created_by even behind a widened grant');
reset role;

select is(
  (select created_by from budget_versions where id = 'f9222222-0000-0000-0000-000000000005'),
  'f9220000-0000-0000-0000-0000000000a1'::uuid,
  'OD-BUDGET-6: the trigger stamps the caller over a client-supplied drafter even behind a widened grant');

select is(
  (select count(*)::int from budget_versions
    where project_id = 'f9221111-0000-0000-0000-000000000001' and status = 'Active'),
  1,
  'OD-BUDGET-6: the single-Active invariant still holds');

select * from finish();
rollback;
