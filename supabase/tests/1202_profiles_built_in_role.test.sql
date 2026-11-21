-- 1202_profiles_built_in_role.test.sql — #2709 assigning a built-in role: the setting gate, the base-level sync, the existing
-- profile-administration rule on the resulting level, no self-assignment, legacy people unchanged, actor helpers.
-- Migrations under test: 1201_built_in_roles_setting, 1202_profiles_built_in_role, 1203_role_capability_actor_helpers.
begin;
select plan(40);

insert into organizations (id, name) values
  ('12020000-0000-0000-0000-000000000001','BIR Org A'),
  ('12020000-0000-0000-0000-000000000002','BIR Org B (setting stays off)');
insert into auth.users (id, email) values
  ('12020000-0000-0000-0000-0000000000a1','bir-admin@example.com'),
  ('12020000-0000-0000-0000-0000000000e1','bir-exec@example.com'),
  ('12020000-0000-0000-0000-0000000000c1','bir-pm@example.com'),
  ('12020000-0000-0000-0000-0000000000d1','bir-eng@example.com'),
  ('12020000-0000-0000-0000-0000000000d2','bir-eng2@example.com'),
  ('12020000-0000-0000-0000-0000000000d3','bir-inactive@example.com'),
  ('12020000-0000-0000-0000-0000000000b1','bir-admin-b@example.com'),
  ('12020000-0000-0000-0000-0000000000b2','bir-eng-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('12020000-0000-0000-0000-0000000000a1','12020000-0000-0000-0000-000000000001','BIR Admin','bir-admin@example.com','Admin','active'),
  ('12020000-0000-0000-0000-0000000000e1','12020000-0000-0000-0000-000000000001','BIR Exec','bir-exec@example.com','Executive','active'),
  ('12020000-0000-0000-0000-0000000000c1','12020000-0000-0000-0000-000000000001','BIR PM','bir-pm@example.com','Project Manager','active'),
  ('12020000-0000-0000-0000-0000000000d1','12020000-0000-0000-0000-000000000001','BIR Eng','bir-eng@example.com','Engineer','active'),
  ('12020000-0000-0000-0000-0000000000d2','12020000-0000-0000-0000-000000000001','BIR Eng2','bir-eng2@example.com','Engineer','active'),
  ('12020000-0000-0000-0000-0000000000d3','12020000-0000-0000-0000-000000000001','BIR Inactive','bir-inactive@example.com','Engineer','disabled'),
  ('12020000-0000-0000-0000-0000000000b1','12020000-0000-0000-0000-000000000002','BIR Admin B','bir-admin-b@example.com','Admin','active'),
  ('12020000-0000-0000-0000-0000000000b2','12020000-0000-0000-0000-000000000002','BIR Eng B','bir-eng-b@example.com','Engineer','active');

-- AC-005 legacy: no key anywhere, the setting defaults off, ordinary edits are untouched.
select is((select built_in_roles_enabled from organizations where id = '12020000-0000-0000-0000-000000000001'), false,
  'AC-005 the setting defaults to off');
select is((select count(*)::int from profiles where built_in_role is not null), 0, 'AC-005 nobody holds a key');
update profiles set role = 'Finance' where id = '12020000-0000-0000-0000-0000000000d2';
select is((select role::text from profiles where id = '12020000-0000-0000-0000-0000000000d2'), 'Finance',
  'AC-005 a role change on a person with no key works as before');
update profiles set role = 'Engineer' where id = '12020000-0000-0000-0000-0000000000d2';

-- Setting off: the database refuses to set a key (service path, no JWT).
select throws_ok($$ update profiles set built_in_role = 'planner' where id = '12020000-0000-0000-0000-0000000000d1' $$,
  'P0001', null, 'AC-013 a key cannot be set while the setting is off');
select is((select built_in_role from profiles where id = '12020000-0000-0000-0000-0000000000d1'), null,
  'AC-013 and the persisted key is still NULL');
select throws_ok($$ insert into profiles (id, org_id, full_name, email, role, status, built_in_role)
  values ('12020000-0000-0000-0000-0000000000d1','12020000-0000-0000-0000-000000000001','x','x@example.com','Engineer','active','planner') $$,
  null, null, 'AC-013 an insert carrying a key is refused while the setting is off (any error, here a duplicate id or the gate)');

-- Setting RPC: Admin only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ok($$ select set_built_in_roles_enabled(true) $$, '42501', null, 'AC-013 an Executive cannot turn the setting on');
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(get_built_in_roles_enabled(), false, 'AC-013 an Admin reads the setting off');
select is(set_built_in_roles_enabled(true), true, 'AC-013 an Admin turns the setting on');
reset role;
select is((select built_in_roles_enabled from organizations where id = '12020000-0000-0000-0000-000000000001'), true, 'AC-013 the setting persisted');
select is((select built_in_roles_enabled from organizations where id = '12020000-0000-0000-0000-000000000002'), false, 'AC-013 the other organization is unchanged');

-- AC-004 sync: setting a key sets the base level; a role-only change while held is refused.
set local role authenticated;
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update profiles set built_in_role = 'billing_officer' where id = '12020000-0000-0000-0000-0000000000d1';
reset role;
select is((select built_in_role from profiles where id = '12020000-0000-0000-0000-0000000000d1'), 'billing_officer', 'AC-004 the key persisted');
select is((select role::text from profiles where id = '12020000-0000-0000-0000-0000000000d1'), 'Finance', 'AC-004 role followed the base level (Finance)');
select throws_ok($$ update profiles set role = 'Engineer' where id = '12020000-0000-0000-0000-0000000000d1' $$,
  '23514', null, 'AC-004 a role-only change while a key is held is refused');
select is((select role::text from profiles where id = '12020000-0000-0000-0000-0000000000d1'), 'Finance', 'AC-004 role unchanged after the refusal');
update profiles set built_in_role = 'planner' where id = '12020000-0000-0000-0000-0000000000d1';
select is((select role::text from profiles where id = '12020000-0000-0000-0000-0000000000d1'), 'Engineer', 'AC-004 changing the key moves the level (Planner = Engineer)');
update profiles set built_in_role = null where id = '12020000-0000-0000-0000-0000000000d1';
select is((select role::text from profiles where id = '12020000-0000-0000-0000-0000000000d1'), 'Engineer', 'AC-004 clearing the key keeps the level');
update profiles set role = 'Finance' where id = '12020000-0000-0000-0000-0000000000d1';
select is((select role::text from profiles where id = '12020000-0000-0000-0000-0000000000d1'), 'Finance', 'AC-004 with no key a role change is allowed again');
update profiles set role = 'Engineer' where id = '12020000-0000-0000-0000-0000000000d1';

-- AC-006 who may assign: the existing profile-administration rule on the resulting base level.
set local role authenticated;
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000e1","role":"authenticated"}';
update profiles set built_in_role = 'administrator' where id = '12020000-0000-0000-0000-0000000000d1';
reset role;
select is((select built_in_role from profiles where id = '12020000-0000-0000-0000-0000000000d1'), null,
  'AC-006 an Executive cannot give the Administrator role (result would be Admin); persisted key still NULL');
select is((select role::text from profiles where id = '12020000-0000-0000-0000-0000000000d1'), 'Engineer', 'AC-006 and the level is unchanged');
set local role authenticated;
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000e1","role":"authenticated"}';
update profiles set built_in_role = 'site_supervisor' where id = '12020000-0000-0000-0000-0000000000d1';
update profiles set built_in_role = 'finance_manager' where id = '12020000-0000-0000-0000-0000000000d2';
reset role;
select is((select built_in_role from profiles where id = '12020000-0000-0000-0000-0000000000d1'), 'site_supervisor', 'AC-006 an Executive may give Site Supervisor (Engineer level)');
select is((select built_in_role from profiles where id = '12020000-0000-0000-0000-0000000000d2'), 'finance_manager', 'AC-006 an Executive may give Finance Manager (Finance level)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000c1","role":"authenticated"}';
update profiles set built_in_role = 'planner' where id = '12020000-0000-0000-0000-0000000000d1';
reset role;
select is((select built_in_role from profiles where id = '12020000-0000-0000-0000-0000000000d1'), 'site_supervisor', 'AC-006 a Project Manager cannot assign any built-in role');
-- Self assignment: a person cannot give themselves a role, whoever they are.
set local role authenticated;
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select throws_ok($$ update profiles set built_in_role = 'planner' where id = '12020000-0000-0000-0000-0000000000d1' $$,
  '42501', null, 'AC-006 a person cannot change their own built-in role');
select throws_ok($$ update profiles set built_in_role = null where id = '12020000-0000-0000-0000-0000000000d1' $$,
  '42501', null, 'AC-006 nor clear it');
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ update profiles set built_in_role = 'planner' where id = '12020000-0000-0000-0000-0000000000a1' $$,
  '42501', null, 'AC-006 an Admin cannot give themselves a role either');
-- Cross-org: an Admin of organization A cannot reach organization B.
update profiles set built_in_role = 'planner' where id = '12020000-0000-0000-0000-0000000000b2';
reset role;
select is((select built_in_role from profiles where id = '12020000-0000-0000-0000-0000000000b2'), null, 'AC-006 no cross-organization assignment');
-- Organization B keeps the setting off even for its own Admin.
set local role authenticated;
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ update profiles set built_in_role = 'planner' where id = '12020000-0000-0000-0000-0000000000b2' $$,
  'P0001', null, 'AC-013 an Admin of an organization with the setting off cannot assign');
reset role;

-- AC-009 actor helpers.
set local role authenticated;
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select ok(actor_has_role_capability('daily_report_validate') and not actor_has_role_capability('stock_post'),
  'AC-009 a Site Supervisor holds daily_report_validate, not stock_post');
select ok(actor_holds_built_in_role('site_supervisor') and not actor_holds_built_in_role('planner'), 'AC-009 actor_holds_built_in_role');
select ok(not actor_sees_prices(), 'AC-009 a Site Supervisor does not see prices');
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select ok(actor_sees_prices() and not actor_has_role_capability('stock_post') and not actor_holds_built_in_role('project_manager'),
  'AC-009 a person with no key sees prices and holds no capability');
set local request.jwt.claims = '{"sub":"12020000-0000-0000-0000-0000000000d3","role":"authenticated"}';
select ok(not actor_sees_prices() and not actor_has_role_capability('stock_post'), 'AC-009 an inactive member holds nothing and sees nothing');
reset role;

select * from finish();
rollback;
