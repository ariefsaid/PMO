-- 0113_ops_admin_disable_authority.test.sql
-- AC-INV-003 [pgTAP]: disable authority is Admin-in-target-org OR Operator; sole-/self-Admin lockout
-- is CALLER-AGNOSTIC (rejects even an Operator). Pins FR-INV-002: admin_set_user_status(p_profile_id,
-- p_status, p_org_id) security-definer RPC re-asserts authority + revokes the session (banned_until).
begin;
select plan(9);

-- ── Fixtures: org A (admin), org B (sole admin B-admin + member B-eng), and the Operator. ──
insert into organizations (id, name) values
  ('01130000-0000-0000-0000-000000000001','AC-INV-003 Org A'),
  ('01130000-0000-0000-0000-000000000002','AC-INV-003 Org B');
insert into auth.users (id, email) values
  ('01130000-0000-0000-0000-0000000000a1','inv003-a-admin@example.com'),
  ('01130000-0000-0000-0000-0000000000e1','inv003-a-eng@example.com'),
  ('01130000-0000-0000-0000-0000000000b1','inv003-b-admin@example.com'),
  ('01130000-0000-0000-0000-0000000000b2','inv003-b-eng@example.com'),
  ('01130000-0000-0000-0000-0000000000f1','inv003-operator@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01130000-0000-0000-0000-0000000000a1','01130000-0000-0000-0000-000000000001','A Admin','inv003-a-admin@example.com','Admin'),
  ('01130000-0000-0000-0000-0000000000e1','01130000-0000-0000-0000-000000000001','A Eng','inv003-a-eng@example.com','Engineer'),
  ('01130000-0000-0000-0000-0000000000b1','01130000-0000-0000-0000-000000000002','B Admin','inv003-b-admin@example.com','Admin'),
  ('01130000-0000-0000-0000-0000000000b2','01130000-0000-0000-0000-000000000002','B Eng','inv003-b-eng@example.com','Engineer'),
  ('01130000-0000-0000-0000-0000000000f1','01130000-0000-0000-0000-000000000001','Operator','inv003-operator@example.com','Admin');
-- Operator grant (table owner / seed SQL).
insert into platform_operators (user_id) values ('01130000-0000-0000-0000-0000000000f1');

-- ── (1) org-A Engineer cannot disable an org-B profile (cross-org + not Admin). ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01130000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok(
  $$ select admin_set_user_status('01130000-0000-0000-0000-0000000000b2','disabled','01130000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'AC-INV-003 org-A Engineer disable org-B member rejected (forbidden)');
reset role;

-- ── (2) org-A Admin cannot disable an org-B profile (cross-org). ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01130000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select admin_set_user_status('01130000-0000-0000-0000-0000000000b2','disabled','01130000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'AC-INV-003 org-A Admin disable org-B member rejected (cross-org)');
reset role;

-- ── (3) org-B Admin disables an org-B member → succeeds; status=disabled; banned_until set. ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01130000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select admin_set_user_status('01130000-0000-0000-0000-0000000000b2','disabled','01130000-0000-0000-0000-000000000002');
reset role;
select is((select status from profiles where id = '01130000-0000-0000-0000-0000000000b2'), 'disabled'::profile_status,
  'AC-INV-003 org-B Admin disable → target status=disabled');
select is((select banned_until is not null from auth.users where id = '01130000-0000-0000-0000-0000000000b2'), true,
  'AC-INV-003 disable revokes the session (auth.users.banned_until set)');

-- ── (4) org-B Admin re-enables → status=active; banned_until cleared. ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01130000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select admin_set_user_status('01130000-0000-0000-0000-0000000000b2','active','01130000-0000-0000-0000-000000000002');
reset role;
select is((select status from profiles where id = '01130000-0000-0000-0000-0000000000b2'), 'active'::profile_status,
  'AC-INV-003 re-enable → status=active');
select is((select banned_until is null from auth.users where id = '01130000-0000-0000-0000-0000000000b2'), true,
  'AC-INV-003 re-enable clears banned_until (session restored)');

-- ── (5) Operator disables an org-B member → succeeds (cross-org via Operator). ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01130000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select admin_set_user_status('01130000-0000-0000-0000-0000000000b2','disabled','01130000-0000-0000-0000-000000000002');
reset role;
select is((select status from profiles where id = '01130000-0000-0000-0000-0000000000b2'), 'disabled'::profile_status,
  'AC-INV-003 Operator disable → target status=disabled');

-- re-enable B-eng for the next assertion (Operator).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01130000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select admin_set_user_status('01130000-0000-0000-0000-0000000000b2','active','01130000-0000-0000-0000-000000000002');
reset role;

-- ── (6) Sole-Admin guard: Operator cannot disable org-B's ONLY Admin (caller-agnostic). ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01130000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok(
  $$ select admin_set_user_status('01130000-0000-0000-0000-0000000000b1','disabled','01130000-0000-0000-0000-000000000002') $$,
  'P0001', null,
  'AC-INV-003 Operator disable of org-B sole Admin rejected (lockout — caller-agnostic)');
reset role;

-- ── (7) Self-disable guard: an Admin cannot disable themselves. ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01130000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ select admin_set_user_status('01130000-0000-0000-0000-0000000000b1','disabled','01130000-0000-0000-0000-000000000002') $$,
  'P0001', null,
  'AC-INV-003 self-disable rejected (lockout)');
reset role;

select * from finish();
rollback;
