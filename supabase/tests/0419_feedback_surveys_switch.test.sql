-- 0419_feedback_surveys_switch.test.sql
-- AC-PHO-100 [pgTAP]: the feedback/surveys switch is writable by an active Admin of the caller's own org,
-- through admin_set_feedback_surveys only; every other role is denied; another org is untouched; every other
-- entitlement key stays Operator-only; a missing row reads as "on" (no row = included).
begin;
select plan(16);

insert into organizations (id, name) values
  ('04190000-0000-0000-0000-000000000001','AC-PHO-100 Org A'),
  ('04190000-0000-0000-0000-000000000002','AC-PHO-100 Org B');
insert into auth.users (id, email) values
  ('04190000-0000-0000-0000-0000000000a1','pho100-a-admin@example.com'),
  ('04190000-0000-0000-0000-0000000000a2','pho100-a-pm@example.com'),
  ('04190000-0000-0000-0000-0000000000a3','pho100-a-finance@example.com'),
  ('04190000-0000-0000-0000-0000000000a4','pho100-a-engineer@example.com'),
  ('04190000-0000-0000-0000-0000000000a5','pho100-a-disabled-admin@example.com'),
  ('04190000-0000-0000-0000-0000000000a6','pho100-a-operator@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('04190000-0000-0000-0000-0000000000a1','04190000-0000-0000-0000-000000000001','A Admin','pho100-a-admin@example.com','Admin','active'),
  ('04190000-0000-0000-0000-0000000000a2','04190000-0000-0000-0000-000000000001','A PM','pho100-a-pm@example.com','Project Manager','active'),
  ('04190000-0000-0000-0000-0000000000a3','04190000-0000-0000-0000-000000000001','A Finance','pho100-a-finance@example.com','Finance','active'),
  ('04190000-0000-0000-0000-0000000000a4','04190000-0000-0000-0000-000000000001','A Engineer','pho100-a-engineer@example.com','Engineer','active'),
  ('04190000-0000-0000-0000-0000000000a5','04190000-0000-0000-0000-000000000001','A Disabled Admin','pho100-a-disabled-admin@example.com','Admin','disabled'),
  ('04190000-0000-0000-0000-0000000000a6','04190000-0000-0000-0000-000000000001','A Operator','pho100-a-operator@example.com','Admin','active');
insert into platform_operators (user_id) values ('04190000-0000-0000-0000-0000000000a6');
insert into org_features (org_id, feature_key, enabled) values ('04190000-0000-0000-0000-000000000001','crm',true);

set local role authenticated;

-- (a) no row yet: nothing stored for the key (the app reads that as "on").
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from org_features where feature_key = 'feedback_surveys'), 0,
  'AC-PHO-100 no stored row until an Admin decides (absence = on)');

-- (b) the Admin switches it off, then on again.
select lives_ok($$ select public.admin_set_feedback_surveys(false) $$, 'AC-PHO-100 Admin of org A switches it off');
select is((select enabled from org_features where feature_key = 'feedback_surveys'), false,
  'AC-PHO-100 org A row stored as off');
select lives_ok($$ select public.admin_set_feedback_surveys(true) $$, 'AC-PHO-100 Admin switches it back on');
select is((select enabled from org_features where feature_key = 'feedback_surveys'), true,
  'AC-PHO-100 org A row stored as on (upsert, one row)');

-- (c) every other role is denied.
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.admin_set_feedback_surveys(false) $$, '42501', 'admin_only',
  'AC-PHO-100 Project Manager denied');
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select public.admin_set_feedback_surveys(false) $$, '42501', 'admin_only',
  'AC-PHO-100 Finance denied');
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.admin_set_feedback_surveys(false) $$, '42501', 'admin_only',
  'AC-PHO-100 Engineer denied');
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.admin_set_feedback_surveys(false) $$, '42501', 'inactive',
  'AC-PHO-100 a disabled Admin is denied');

-- (d) an Admin cannot write any other key directly: the new policy matches only feedback_surveys.
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into org_features (org_id, feature_key, enabled) values ('04190000-0000-0000-0000-000000000001','crm',false) $$,
  '42501', null, 'AC-PHO-100 Admin cannot write another entitlement key (Operator-only stays)');

-- (d2) update/delete of another key matches no policy for an Admin: zero rows touched, row intact.
update org_features set enabled = false where feature_key = 'crm';
select is((select enabled from org_features where feature_key = 'crm'), true,
  'AC-PHO-100 Admin update of another entitlement key changes nothing');
delete from org_features where feature_key = 'crm';
select is((select count(*)::int from org_features where feature_key = 'crm'), 1,
  'AC-PHO-100 Admin delete of another entitlement key removes nothing');

-- (d3) the Operator path (0070) is unchanged: an Operator still writes any key.
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select lives_ok($$ select public.operator_toggle_feature('04190000-0000-0000-0000-000000000001','crm',false) $$,
  'AC-PHO-100 Operator can still toggle another key');
select is((select enabled from org_features where feature_key = 'crm'), false,
  'AC-PHO-100 Operator toggle took effect');

-- (d4) listOwn read path: a missing feedback row is simply absent (app reads absence as on); the stored row shows once set.
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from org_features where feature_key = 'feedback_surveys'), 1,
  'AC-PHO-100 a member reads the org feedback row exactly as stored (listOwn)');

-- (e) the RPC writes the caller's own org only; org B has no row.
reset role;
select is((select count(*)::int from org_features where org_id = '04190000-0000-0000-0000-000000000002'), 0,
  'AC-PHO-100 org B untouched');

select * from finish();
rollback;
