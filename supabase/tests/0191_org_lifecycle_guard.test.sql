-- 0191_org_lifecycle_guard.test.sql — DD-ORG-3 default-deny org wholesale protection.
begin;
select plan(16);

insert into organizations (id, name, lifecycle_state) values
  ('01910000-0000-0000-0000-000000000001', 'Lifecycle Demo', 'demo'),
  ('01910000-0000-0000-0000-000000000002', 'Lifecycle Test', 'test'),
  ('01910000-0000-0000-0000-000000000003', 'Lifecycle Live', 'live'),
  ('01910000-0000-0000-0000-000000000004', 'Lifecycle Null', null),
  ('01910000-0000-0000-0000-000000000005', 'Lifecycle Unknown', 'archived');

select is((select lifecycle_state from organizations where id = '01910000-0000-0000-0000-000000000001'), 'demo', 'AC-ORG-LIFE-001 demo state is stored');
select is((select lifecycle_state from organizations where id = '01910000-0000-0000-0000-000000000002'), 'test', 'AC-ORG-LIFE-002 test state is stored');
select lives_ok($$select assert_org_destroyable('01910000-0000-0000-0000-000000000001')$$, 'AC-ORG-LIFE-003 demo is destroyable');
select lives_ok($$select assert_org_destroyable('01910000-0000-0000-0000-000000000002')$$, 'AC-ORG-LIFE-004 test is destroyable');
select throws_ok($$select assert_org_destroyable('01910000-0000-0000-0000-000000000003')$$, '42501', null, 'AC-ORG-LIFE-005 live is protected');
select throws_ok($$select assert_org_destroyable('01910000-0000-0000-0000-000000000004')$$, '42501', null, 'AC-ORG-LIFE-006 NULL is protected');
select throws_ok($$select assert_org_destroyable('01910000-0000-0000-0000-000000000005')$$, '42501', null, 'AC-ORG-LIFE-007 unknown state is protected');

insert into auth.users (id, email) values
 ('01910000-0000-0000-0000-0000000000a1','lifecycle-nonop@example.com'),
 ('01910000-0000-0000-0000-0000000000ff','lifecycle-operator@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('01910000-0000-0000-0000-0000000000a1','01910000-0000-0000-0000-000000000001','Lifecycle Nonop','lifecycle-nonop@example.com','Engineer','active'),
 ('01910000-0000-0000-0000-0000000000ff','01910000-0000-0000-0000-000000000001','Lifecycle Operator','lifecycle-operator@example.com','Admin','active');
insert into platform_operators (user_id) values ('01910000-0000-0000-0000-0000000000ff');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01910000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select operator_set_org_lifecycle_state('01910000-0000-0000-0000-000000000001','test')$$, '42501', null, 'AC-ORG-LIFE-008 non-Operator cannot change lifecycle state');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01910000-0000-0000-0000-0000000000ff","role":"authenticated"}';
select lives_ok($$select operator_set_org_lifecycle_state('01910000-0000-0000-0000-000000000001','test')$$, 'AC-ORG-LIFE-009 Operator can transition destroyable state');
select throws_ok($$select operator_set_org_lifecycle_state('01910000-0000-0000-0000-000000000003','demo')$$, '42501', null, 'AC-ORG-LIFE-010 live cannot be demoted');
reset role;
select is((select count(*)::int from audit_events where action = 'org.lifecycle_state.change' and entity_id = '01910000-0000-0000-0000-000000000001'), 1, 'AC-ORG-LIFE-011 lifecycle transition is audited');

insert into companies (id, org_id, name, type) values ('01910000-0000-0000-0000-000000000011','01910000-0000-0000-0000-000000000001','Delete Probe','Client');
select lives_ok($$delete from companies where id = '01910000-0000-0000-0000-000000000011'$$, 'AC-ORG-LIFE-012 per-record delete is not blocked by wholesale guard');
select is((select lifecycle_state from organizations where id = '00000000-0000-0000-0000-000000000001'), 'demo', 'AC-ORG-LIFE-013 existing demo organization is explicitly backfilled');
select is((select count(*)::int from pg_proc where proname = 'assert_org_destroyable'), 1, 'AC-ORG-LIFE-014 authority function exists');
select is((select count(*)::int from pg_proc where proname = 'operator_set_org_lifecycle_state'), 1, 'AC-ORG-LIFE-015 transition function exists');
select ok((select prosecdef from pg_proc where proname = 'operator_set_org_lifecycle_state'), 'AC-ORG-LIFE-016 transition is security definer');
select * from finish();
rollback;
