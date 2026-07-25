-- 0144_org_features_m365_key.test.sql
-- AC-M365-010 [pgTAP]: the m365_integration entitlement is Operator-togglable via the existing
-- operator_toggle_feature RPC (the CHECK registry accepts it), and a non-Operator is denied
-- (FR-M365-010/011). Mirrors 0127/0122.
begin;
select plan(3);

insert into organizations (id, name) values
  ('01440000-0000-0000-0000-000000000001','AC-M365-010 Org');
insert into auth.users (id, email) values
  ('01440000-0000-0000-0000-0000000000f1','m365-op@example.com'),
  ('01440000-0000-0000-0000-0000000000a1','m365-ad@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01440000-0000-0000-0000-0000000000f1','01440000-0000-0000-0000-000000000001','Op','m365-op@example.com','Admin'),
  ('01440000-0000-0000-0000-0000000000a1','01440000-0000-0000-0000-000000000001','Ad','m365-ad@example.com','Admin');
insert into platform_operators (user_id) values ('01440000-0000-0000-0000-0000000000f1');

-- (a) Operator enables m365_integration → row persists enabled=true (proves the CHECK accepts it).
set local role authenticated;
set local request.jwt.claims = '{"sub":"01440000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select public.operator_toggle_feature('01440000-0000-0000-0000-000000000001','m365_integration',true) $$,
  'AC-M365-010 Operator enables m365_integration (CHECK registry accepts the key)');
select is(
  (select enabled from public.org_features
     where org_id = '01440000-0000-0000-0000-000000000001' and feature_key = 'm365_integration'),
  true, 'AC-M365-010 the m365_integration entitlement row persisted enabled=true');
reset role;

-- (b) A non-Operator org-Admin calling the same RPC is denied 42501.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01440000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select public.operator_toggle_feature('01440000-0000-0000-0000-000000000001','m365_integration',true) $$,
  '42501', null, 'AC-M365-010 a non-Operator is denied toggling the entitlement');
reset role;

select * from finish();
rollback;
