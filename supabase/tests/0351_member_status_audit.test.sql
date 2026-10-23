-- 0351_member_status_audit.test.sql — AC-AUD-301..: profile status/role changes are audited.
begin;
select plan(13);

insert into public.organizations (id, name) values
  ('35100000-0000-0000-0000-000000000001', 'Audit Test Org');
insert into auth.users (id, email) values
  ('35100000-0000-0000-0000-0000000000a1', '351-admin@example.test'),
  ('35100000-0000-0000-0000-0000000000a2', '351-member@example.test');
insert into public.profiles (id, org_id, full_name, email, role, status) values
  ('35100000-0000-0000-0000-0000000000a1', '35100000-0000-0000-0000-000000000001', 'Audit Admin', '351-admin@example.test', 'Admin', 'active'),
  ('35100000-0000-0000-0000-0000000000a2', '35100000-0000-0000-0000-000000000001', 'Audit Member', '351-member@example.test', 'Engineer', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"35100000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select public.admin_set_user_status('35100000-0000-0000-0000-0000000000a2', 'disabled', '35100000-0000-0000-0000-000000000001') $$,
  'AC-AUD-301 Admin can disable a member');
select lives_ok(
  $$ select public.admin_set_user_status('35100000-0000-0000-0000-0000000000a2', 'active', '35100000-0000-0000-0000-000000000001') $$,
  'AC-AUD-302 Admin can re-enable a member');
update public.profiles set role = 'Project Manager'
 where id = '35100000-0000-0000-0000-0000000000a2';
update public.profiles set full_name = 'Renamed Member'
 where id = '35100000-0000-0000-0000-0000000000a2';
reset role;

select is((select count(*)::int from public.audit_events
  where entity_id = '35100000-0000-0000-0000-0000000000a2' and action = 'member.status_changed'), 2,
  'AC-AUD-303 disable and re-enable each produce one status event');
select is((select actor_id from public.audit_events where action = 'member.status_changed'
  and detail->>'to' = 'disabled'), '35100000-0000-0000-0000-0000000000a1'::uuid,
  'AC-AUD-304 status event records the Admin actor');
select is((select entity_id from public.audit_events where action = 'member.status_changed'
  and detail->>'to' = 'disabled'), '35100000-0000-0000-0000-0000000000a2'::uuid,
  'AC-AUD-305 status event identifies the target profile');
select is((select (detail->>'from') || '→' || (detail->>'to') from public.audit_events
  where action = 'member.status_changed' and detail->>'to' = 'disabled'), 'active→disabled',
  'AC-AUD-306 disable event captures old and new status');
select is((select (detail->>'from') || '→' || (detail->>'to') from public.audit_events
  where action = 'member.status_changed' and detail->>'to' = 'active'), 'disabled→active',
  'AC-AUD-307 re-enable event captures old and new status');
select is((select count(*)::int from public.audit_events where action = 'member.role_changed'
  and entity_id = '35100000-0000-0000-0000-0000000000a2'), 1,
  'AC-AUD-308 role change produces one event');
select is((select actor_id from public.audit_events where action = 'member.role_changed'),
  '35100000-0000-0000-0000-0000000000a1'::uuid,
  'AC-AUD-309 role event records the Admin actor');
select is((select (detail->>'from') || '→' || (detail->>'to') from public.audit_events
  where action = 'member.role_changed'), 'Engineer→Project Manager',
  'AC-AUD-310 role event captures old and new role');
select is((select count(*)::int from public.audit_events where entity_id = '35100000-0000-0000-0000-0000000000a2'), 3,
  'AC-AUD-311 unrelated profile name change does not add an event');
select ok(not exists (select 1 from public.audit_events
  where action in ('member.status_changed', 'member.role_changed')
    and (detail::text ilike '%@%' or detail::text ilike '%Audit Member%' or detail::text ilike '%Renamed Member%')),
  'AC-AUD-312 membership audit payload contains no email or name');
select is((select count(*)::int from public.audit_events where action like 'member.%'
  and org_id = '35100000-0000-0000-0000-000000000001'), 3,
  'AC-AUD-313 membership events retain the target org');

select * from finish();
rollback;
