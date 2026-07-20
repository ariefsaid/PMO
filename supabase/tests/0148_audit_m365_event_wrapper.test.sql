-- 0148_audit_m365_event_wrapper.test.sql
-- AC-M365-170 [pgTAP]: audit_m365_event wrapper — service_role can call + writes 1 audit_events row + non-m365.* raises 22023 + authenticated/anon denied.
begin;
select plan(5);

insert into organizations (id, name) values
  ('01480000-0000-0000-0000-000000000001','AC-M365-170 Org');
insert into auth.users (id, email) values
  ('01480000-0000-0000-0000-0000000000a1','m365-audit-wrapper@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01480000-0000-0000-0000-0000000000a1','01480000-0000-0000-0000-000000000001','Audit User','m365-audit-wrapper@example.com','Admin');

-- (1) service_role can call with m365.* action → succeeds and writes exactly 1 audit_events row.
set local role service_role;
select lives_ok(
  $$ select public.audit_m365_event('m365.connection.initiated', '01480000-0000-0000-0000-000000000001', '01480000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', '{"scopes":["Files.Read","offline_access"]}'::jsonb) $$,
  'AC-M365-170 service_role can call audit_m365_event with m365.* action');

select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.initiated' and org_id = '01480000-0000-0000-0000-000000000001'
       and actor_id = '01480000-0000-0000-0000-0000000000a1'
       and detail @> '{"scopes":["Files.Read","offline_access"]}'::jsonb),
  1, 'AC-M365-170 exactly 1 audit_events row written with correct detail');
reset role;

-- (2) non-m365.* action raises 22023 (allowlist holds — broad service_role grant can't forge other domains' audit actions).
set local role service_role;
select throws_ok(
  $$ select public.audit_m365_event('agent.permission_denied', '01480000-0000-0000-0000-000000000001', '01480000-0000-0000-0000-0000000000a1', null, '{}'::jsonb) $$,
  '22023', null, 'AC-M365-170 non-m365.* action rejected with 22023 (allowlist enforced)');
reset role;

-- (3) authenticated has NO execute.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01480000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.audit_m365_event('m365.connection.initiated', '01480000-0000-0000-0000-000000000001', '01480000-0000-0000-0000-0000000000a1', null, '{}'::jsonb) $$,
  '42501', null, 'AC-M365-170 authenticated denied execute (no grant)');
reset role;

-- (4) anon has NO execute.
set local role anon;
select throws_ok(
  $$ select public.audit_m365_event('m365.connection.initiated', '01480000-0000-0000-0000-000000000001', '01480000-0000-0000-0000-0000000000a1', null, '{}'::jsonb) $$,
  '42501', null, 'AC-M365-170 anon denied execute (no grant)');
reset role;

select * from finish();
rollback;