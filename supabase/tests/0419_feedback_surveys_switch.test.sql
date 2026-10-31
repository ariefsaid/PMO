-- 0419_feedback_surveys_switch.test.sql
-- AC-PHO-090 [pgTAP]: the feedback/surveys switch is writable by an active Admin of the caller's own org,
-- through admin_set_feedback_surveys only; every other role is denied; another org is untouched; every other
-- entitlement key stays Operator-only; a missing row reads as "on" (no row = included).
begin;
select plan(11);

insert into organizations (id, name) values
  ('04190000-0000-0000-0000-000000000001','AC-PHO-090 Org A'),
  ('04190000-0000-0000-0000-000000000002','AC-PHO-090 Org B');
insert into auth.users (id, email) values
  ('04190000-0000-0000-0000-0000000000a1','pho090-a-admin@example.com'),
  ('04190000-0000-0000-0000-0000000000a2','pho090-a-pm@example.com'),
  ('04190000-0000-0000-0000-0000000000a3','pho090-a-finance@example.com'),
  ('04190000-0000-0000-0000-0000000000a4','pho090-a-engineer@example.com'),
  ('04190000-0000-0000-0000-0000000000a5','pho090-a-disabled-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('04190000-0000-0000-0000-0000000000a1','04190000-0000-0000-0000-000000000001','A Admin','pho090-a-admin@example.com','Admin','active'),
  ('04190000-0000-0000-0000-0000000000a2','04190000-0000-0000-0000-000000000001','A PM','pho090-a-pm@example.com','Project Manager','active'),
  ('04190000-0000-0000-0000-0000000000a3','04190000-0000-0000-0000-000000000001','A Finance','pho090-a-finance@example.com','Finance','active'),
  ('04190000-0000-0000-0000-0000000000a4','04190000-0000-0000-0000-000000000001','A Engineer','pho090-a-engineer@example.com','Engineer','active'),
  ('04190000-0000-0000-0000-0000000000a5','04190000-0000-0000-0000-000000000001','A Disabled Admin','pho090-a-disabled-admin@example.com','Admin','disabled');

set local role authenticated;

-- (a) no row yet: nothing stored for the key (the app reads that as "on").
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from org_features where feature_key = 'feedback_surveys'), 0,
  'AC-PHO-090 no stored row until an Admin decides (absence = on)');

-- (b) the Admin switches it off, then on again.
select lives_ok($$ select public.admin_set_feedback_surveys(false) $$, 'AC-PHO-090 Admin of org A switches it off');
select is((select enabled from org_features where feature_key = 'feedback_surveys'), false,
  'AC-PHO-090 org A row stored as off');
select lives_ok($$ select public.admin_set_feedback_surveys(true) $$, 'AC-PHO-090 Admin switches it back on');
select is((select enabled from org_features where feature_key = 'feedback_surveys'), true,
  'AC-PHO-090 org A row stored as on (upsert, one row)');

-- (c) every other role is denied.
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.admin_set_feedback_surveys(false) $$, '42501', 'admin_only',
  'AC-PHO-090 Project Manager denied');
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select public.admin_set_feedback_surveys(false) $$, '42501', 'admin_only',
  'AC-PHO-090 Finance denied');
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select public.admin_set_feedback_surveys(false) $$, '42501', 'admin_only',
  'AC-PHO-090 Engineer denied');
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.admin_set_feedback_surveys(false) $$, '42501', 'inactive',
  'AC-PHO-090 a disabled Admin is denied');

-- (d) an Admin cannot write any other key directly: the new policy matches only feedback_surveys.
set local request.jwt.claims = '{"sub":"04190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into org_features (org_id, feature_key, enabled) values ('04190000-0000-0000-0000-000000000001','crm',false) $$,
  '42501', null, 'AC-PHO-090 Admin cannot write another entitlement key (Operator-only stays)');

-- (e) the RPC writes the caller's own org only; org B has no row.
reset role;
select is((select count(*)::int from org_features where org_id = '04190000-0000-0000-0000-000000000002'), 0,
  'AC-PHO-090 org B untouched');

select * from finish();
rollback;
