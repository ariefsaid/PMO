-- #2260: the service-only read of an organization's own Microsoft 365 app WITHOUT its secret, plus the
-- moment Microsoft last accepted those values (client secrets expire, so the Admin has to be able to see
-- how old the last check is). Migration 1122; the table itself is 0817's, and its API-role lockdown is
-- unchanged — this read is the ONLY new surface.
-- AC-M365AV-001: the read returns tenant id, client id, the stored validation time and whether a secret is
-- stored — never the secret or its Vault reference — for one org only, and no API role may call it.
-- Mutation checks (CI proves; each must turn the named test red): add client_secret/secret_ref to the
-- result → the result-contract test; drop the `where org_id = p_org_id` predicate → the cross-org test;
-- grant execute to authenticated → the ACL test.
begin;
select plan(13);

insert into organizations (id, name) values
 ('e2260000-0000-0000-0000-00000000000a','Status Org A'),
 ('e2260000-0000-0000-0000-00000000000b','Status Org B');
insert into auth.users (id, email) values
 ('e2260000-0000-0000-0000-0000000000a1','e2260-status-admin-a@example.com'),
 ('e2260000-0000-0000-0000-0000000000b1','e2260-status-admin-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('e2260000-0000-0000-0000-0000000000a1','e2260000-0000-0000-0000-00000000000a','Status Admin A','e2260-status-admin-a@example.com','Admin','active'),
 ('e2260000-0000-0000-0000-0000000000b1','e2260000-0000-0000-0000-00000000000b','Status Admin B','e2260-status-admin-b@example.com','Admin','active');
insert into org_features (org_id, feature_key, enabled) values
 ('e2260000-0000-0000-0000-00000000000a','m365_integration',true),
 ('e2260000-0000-0000-0000-00000000000b','m365_integration',true);

-- ── AC-M365AV-001 the result contract: the ids, the validation time, whether a secret is stored ────
select is(pg_get_function_result('public.m365_org_app_status(uuid)'::regprocedure),
  'TABLE(tenant_id text, client_id text, validated_at timestamp with time zone, secret_set boolean)',
  'AC-M365AV-001 the read returns the ids, the validation time and a secret-present flag — never the secret');

select ok(not has_function_privilege('anon', 'public.m365_org_app_status(uuid)', 'EXECUTE'),
  'AC-M365AV-001 anon cannot execute the organization app read');
select ok(not has_function_privilege('authenticated', 'public.m365_org_app_status(uuid)', 'EXECUTE'),
  'AC-M365AV-001 authenticated cannot execute the organization app read');
select ok(has_function_privilege('service_role', 'public.m365_org_app_status(uuid)', 'EXECUTE'),
  'AC-M365AV-001 service_role is the only caller that can execute the organization app read');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"e2260000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.m365_org_app_status('e2260000-0000-0000-0000-00000000000a') $$,
  '42501', null,
  'AC-M365AV-001 a signed-in Admin still cannot execute the read directly — it is service-only');
reset role;

-- an org with no app of its own reads zero rows (not a fabricated row)
set local role service_role;
select is((select count(*)::int from public.m365_org_app_status('e2260000-0000-0000-0000-00000000000a')), 0,
  'AC-M365AV-001 an organization with no app of its own reads zero rows');
reset role;

-- ── AC-M365AV-001 the stored values, and the stored validation time ─────────────────────────────────
set local role service_role;
select public.m365_set_org_app(
  'e2260000-0000-0000-0000-00000000000a',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'sekret-status-nine',
  'e2260000-0000-0000-0000-0000000000a1');
select is((select tenant_id || '/' || client_id from public.m365_org_app_status('e2260000-0000-0000-0000-00000000000a')),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'AC-M365AV-001 the read returns the stored tenant and client id');
select is((select secret_set from public.m365_org_app_status('e2260000-0000-0000-0000-00000000000a')), true,
  'AC-M365AV-001 the read reports that a secret is stored');
reset role;

-- the value is the STORED moment, not the moment of reading: age the row and read it back
update public.m365_org_apps set validated_at = now() - interval '3 days'
 where org_id = 'e2260000-0000-0000-0000-00000000000a';
set local role service_role;
select is((select validated_at = now() - interval '3 days' from public.m365_org_app_status('e2260000-0000-0000-0000-00000000000a')), true,
  'AC-M365AV-001 the read returns the stored validation time, so the card can show how old the check is');
reset role;

-- one organization's app is never visible to another
set local role service_role;
select is((select count(*)::int from public.m365_org_app_status('e2260000-0000-0000-0000-00000000000b')), 0,
  'AC-M365AV-001 another organization reads none of these values');
reset role;

-- a stored row whose Vault secret is gone reads as "no secret" — the ids and time still read
delete from vault.secrets
 where name = (select secret_ref from public.m365_org_apps where org_id = 'e2260000-0000-0000-0000-00000000000a');
set local role service_role;
select is((select secret_set from public.m365_org_app_status('e2260000-0000-0000-0000-00000000000a')), false,
  'AC-M365AV-001 a row whose secret is gone reads as no secret stored');
select is((select tenant_id from public.m365_org_app_status('e2260000-0000-0000-0000-00000000000a')),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'AC-M365AV-001 the ids stay readable when the secret is gone');
reset role;

-- an unknown organization reads zero rows, never a fallback to "any app"
set local role service_role;
select is((select count(*)::int from public.m365_org_app_status('e2260000-0000-0000-0000-0000000000ff')), 0,
  'AC-M365AV-001 an unknown organization reads zero rows');
reset role;

select * from finish();
rollback;
