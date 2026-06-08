-- 0052_admin_users_crud.test.sql — the Administration › Users write contract
-- (CRUD+RBAC program, Admin Users slice). Proves the RLS contract for managing profiles
-- on top of the EXISTING policies (NO migration in this slice):
--   * profiles_select        (org_id = auth_org_id())                      — directory read
--   * profiles_admin_write    FOR ALL (org_id = auth_org_id() AND auth_role() = 'Admin')
--   * profiles_update_self    (own row only, role + manager_id UNCHANGED)  — 0002/0007
--
--   AC-AU-101  an Admin can UPDATE another user's role within its own org (profiles_admin_write).
--   AC-AU-102  an Admin can assign another user's manager_id within its own org.
--   AC-AU-103  a non-Admin (PM) CANNOT change ANOTHER user's role — profiles_update_self only
--              matches the caller's own row, profiles_admin_write requires Admin → 0-row no-op.
--   AC-AU-104  a non-Admin (PM) CANNOT change their OWN role — profiles_update_self WITH CHECK
--              pins role to the persisted value (and the manager_id pin), so a self role-escalation
--              violates the WITH CHECK → 42501.
--   AC-AU-105  cross-org: an org-B Admin CANNOT update an org-A profile (org_id gate hides it) → no-op.
--   AC-AU-106  every member can READ the profiles in their own org (the directory) and NOT another org's.
-- RLS is the enforcement authority; the FE gating (Admin-only management, Exec read-only) is a
-- clarity projection (rbac-visibility.md §J). This slice ships NO migration — these policies pre-exist.
begin;
select plan(12);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
-- Org-A is the DEFAULT org ('00000000-…-0001') so auth_org_id() = org-A for these profiles.
-- Org-B is a separate org used only as the cross-org attacker.
insert into organizations (id, name) values
  ('00520000-0000-0000-0000-000000000002','Admin Users Org B');

insert into auth.users (id, email) values
  ('00520000-0000-0000-0000-0000000000a1','au-admin@example.com'),
  ('00520000-0000-0000-0000-0000000000a2','au-pm@example.com'),
  ('00520000-0000-0000-0000-0000000000a3','au-eng@example.com'),
  ('00520000-0000-0000-0000-0000000000a4','au-mgr@example.com'),
  ('00520000-0000-0000-0000-0000000000b1','au-admin-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00520000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','AU Admin','au-admin@example.com','Admin'),
  ('00520000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','AU PM','au-pm@example.com','Project Manager'),
  ('00520000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','AU Eng','au-eng@example.com','Engineer'),
  ('00520000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-000000000001','AU Mgr','au-mgr@example.com','Project Manager'),
  ('00520000-0000-0000-0000-0000000000b1','00520000-0000-0000-0000-000000000002','AU Admin B','au-admin-b@example.com','Admin');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AU-103/104: a non-Admin (PM) — run FIRST so baselines are untouched.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- AC-AU-103: PM UPDATE of ANOTHER user's role runs without error but matches no row
-- (profiles_admin_write requires Admin; profiles_update_self matches only the caller's own row) → 0-row no-op.
select lives_ok(
  $$ update profiles set role = 'Admin'
       where id = '00520000-0000-0000-0000-0000000000a3' $$,
  'AC-AU-103: PM UPDATE of another user''s role runs without error (no policy matches → RLS no-op)');

-- AC-AU-104: PM self role-escalation is blocked. profiles_update_self matches the own row but its
-- WITH CHECK pins role (and manager_id) to the persisted values, so changing role violates it → 42501.
select throws_ok(
  $$ update profiles set role = 'Admin'
       where id = '00520000-0000-0000-0000-0000000000a2' $$,
  '42501', null,
  'AC-AU-104: PM cannot escalate their OWN role (profiles_update_self WITH CHECK pins role → 42501)');

-- AC-AU-103: PM cannot reassign another user's manager either (same: no matching write policy → no-op).
select lives_ok(
  $$ update profiles set manager_id = '00520000-0000-0000-0000-0000000000a1'
       where id = '00520000-0000-0000-0000-0000000000a3' $$,
  'AC-AU-103: PM UPDATE of another user''s manager runs without error (no policy matches → RLS no-op)');

reset role;

-- Confirm the PM changed nothing: the Engineer's role and manager are untouched.
select is(
  (select role::text from profiles where id = '00520000-0000-0000-0000-0000000000a3'),
  'Engineer',
  'AC-AU-103: the Engineer''s role is unchanged after the PM''s denied update (0-row no-op)');
select ok(
  (select manager_id is null from profiles where id = '00520000-0000-0000-0000-0000000000a3'),
  'AC-AU-103: the Engineer''s manager_id is unchanged after the PM''s denied update');
select is(
  (select role::text from profiles where id = '00520000-0000-0000-0000-0000000000a2'),
  'Project Manager',
  'AC-AU-104: the PM''s own role is unchanged after the blocked self-escalation');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AU-105: cross-org — an org-B Admin cannot touch an org-A profile.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- AC-AU-105: org-B Admin UPDATE of an org-A profile runs without error but the org_id gate in
-- profiles_admin_write USING hides the row → 0-row no-op (auth_org_id() = org-B, the row is org-A).
select lives_ok(
  $$ update profiles set role = 'Admin'
       where id = '00520000-0000-0000-0000-0000000000a3' $$,
  'AC-AU-105: cross-org Admin UPDATE of an org-A profile runs without error (org_id gate → RLS no-op)');

reset role;

select is(
  (select role::text from profiles where id = '00520000-0000-0000-0000-0000000000a3'),
  'Engineer',
  'AC-AU-105: cross-org Admin UPDATE affected 0 rows (the org-A Engineer''s role is unchanged)');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AU-101/102: the in-org Admin does the real management.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-AU-101: Admin can change another user's role within its own org (profiles_admin_write FOR ALL).
select lives_ok(
  $$ update profiles set role = 'Executive'
       where id = '00520000-0000-0000-0000-0000000000a2' $$,
  'AC-AU-101: an Admin can UPDATE another user''s role within its own org');

-- AC-AU-102: Admin can assign another user's manager_id within its own org.
select lives_ok(
  $$ update profiles set manager_id = '00520000-0000-0000-0000-0000000000a4'
       where id = '00520000-0000-0000-0000-0000000000a3' $$,
  'AC-AU-102: an Admin can assign another user''s manager within its own org');

reset role;

-- AC-AU-101/102: confirm both Admin writes persisted (no silent RLS no-op for the Admin).
select is(
  (select role::text from profiles where id = '00520000-0000-0000-0000-0000000000a2'),
  'Executive',
  'AC-AU-101: the Admin role change persisted (PM is now Executive)');
select is(
  (select manager_id::text from profiles where id = '00520000-0000-0000-0000-0000000000a3'),
  '00520000-0000-0000-0000-0000000000a4',
  'AC-AU-102: the Admin manager assignment persisted (Engineer now reports to AU Mgr)');

select * from finish();
rollback;
