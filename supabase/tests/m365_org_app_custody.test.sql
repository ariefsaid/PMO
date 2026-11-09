-- #1017 S2 (migration 0817): per-org Microsoft 365 app registration. The secret lives only in Vault, the table has
-- no API-role path, and only a service-role caller acting for an active Admin (or Operator) of the org, on a plan
-- with M365 on, can save or clear it.
-- AC-M365SS-005 save: row + Vault secret + audit without the secret · AC-M365SS-006 who may save ·
-- AC-M365SS-007 no anon/authenticated path.
-- Mutation checks (CI proves; each must turn the named tests red): drop the Admin/Operator check in
-- m365_set_org_app -> AC-M365SS-006; grant authenticated execute on m365_org_app_resolve -> AC-M365SS-007.
begin;
select plan(33);

insert into organizations (id, name) values
 ('e8170000-0000-0000-0000-00000000000a','Org A'),
 ('e8170000-0000-0000-0000-00000000000b','Org B'),
 ('e8170000-0000-0000-0000-00000000000c','Org C plan-off');
insert into auth.users (id, email) values
 ('e8170000-0000-0000-0000-0000000000a1','e817-admin-a@example.com'),
 ('e8170000-0000-0000-0000-0000000000a2','e817-pm-a@example.com'),
 ('e8170000-0000-0000-0000-0000000000a3','e817-off-a@example.com'),
 ('e8170000-0000-0000-0000-0000000000b1','e817-admin-b@example.com'),
 ('e8170000-0000-0000-0000-0000000000c1','e817-admin-c@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('e8170000-0000-0000-0000-0000000000a1','e8170000-0000-0000-0000-00000000000a','Admin A','e817-admin-a@example.com','Admin','active'),
 ('e8170000-0000-0000-0000-0000000000a2','e8170000-0000-0000-0000-00000000000a','PM A','e817-pm-a@example.com','Project Manager','active'),
 ('e8170000-0000-0000-0000-0000000000a3','e8170000-0000-0000-0000-00000000000a','Deactivated Admin A','e817-off-a@example.com','Admin','disabled'),
 ('e8170000-0000-0000-0000-0000000000b1','e8170000-0000-0000-0000-00000000000b','Admin B','e817-admin-b@example.com','Admin','active'),
 ('e8170000-0000-0000-0000-0000000000c1','e8170000-0000-0000-0000-00000000000c','Admin C','e817-admin-c@example.com','Admin','active');
insert into org_features (org_id, feature_key, enabled) values
 ('e8170000-0000-0000-0000-00000000000a','m365_integration',true),
 ('e8170000-0000-0000-0000-00000000000b','m365_integration',true),
 ('e8170000-0000-0000-0000-00000000000c','m365_integration',false);

-- ── AC-M365SS-005 an Admin saves ─────────────────────────────────────────────────────────────────
set local role service_role;
select is(public.m365_set_org_app('e8170000-0000-0000-0000-00000000000a','AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','sekret-one','e8170000-0000-0000-0000-0000000000a1'),
  '{"changed_app": false}'::jsonb, 'AC-M365SS-005 a first save reports no app change');
reset role;
select is((select tenant_id || '/' || client_id from m365_org_apps where org_id='e8170000-0000-0000-0000-00000000000a'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'AC-M365SS-005 the row exists with lower-cased ids');
select is((select s.decrypted_secret from m365_org_apps a join vault.decrypted_secrets s on s.name = a.secret_ref
            where a.org_id='e8170000-0000-0000-0000-00000000000a'), 'sekret-one', 'AC-M365SS-005 the secret resolves from Vault');
select is((select count(*)::int from m365_org_apps where secret_ref = 'sekret-one'), 0, 'AC-M365SS-005 the table holds a reference, not the secret');
select is((select detail->>'tenant_id' || '/' || (detail->>'client_id') from audit_events
            where org_id='e8170000-0000-0000-0000-00000000000a' and action='m365.app.configured'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'AC-M365SS-005 the audit row names tenant and client');
select is((select count(*)::int from audit_events where org_id='e8170000-0000-0000-0000-00000000000a'
            and (detail::text like '%sekret-one%' or detail::text like '%m365-org-app-%')), 0,
  'AC-M365SS-005 no audit row holds the secret or its reference');

-- resolve returns the stored app and secret to the service role
set local role service_role;
select is((select tenant_id || '/' || client_id || '/' || client_secret from public.m365_org_app_resolve('e8170000-0000-0000-0000-00000000000a')),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/sekret-one', 'AC-M365SS-005 resolve returns the org app and its secret');
select is((select count(*)::int from public.m365_org_app_resolve('e8170000-0000-0000-0000-00000000000b')), 0, 'AC-M365SS-005 an org with no app resolves to zero rows');
reset role;

-- secret rotation: the old Vault secret goes, the new one stays
select set_config('e817.old_ref', (select secret_ref from m365_org_apps where org_id='e8170000-0000-0000-0000-00000000000a'), true);
set local role service_role;
select is(public.m365_set_org_app('e8170000-0000-0000-0000-00000000000a','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','sekret-two','e8170000-0000-0000-0000-0000000000a1'),
  '{"changed_app": false}'::jsonb, 'AC-M365SS-005 a secret-only rotation reports no app change');
reset role;
select is((select count(*)::int from vault.secrets where name = current_setting('e817.old_ref')), 0, 'AC-M365SS-005 rotation deletes the previous Vault secret');
select is((select s.decrypted_secret from m365_org_apps a join vault.decrypted_secrets s on s.name = a.secret_ref
            where a.org_id='e8170000-0000-0000-0000-00000000000a'), 'sekret-two', 'AC-M365SS-005 rotation stores the new secret');
select is((select count(*)::int from audit_events where org_id='e8170000-0000-0000-0000-00000000000a' and action='m365.app.rotated'), 1,
  'AC-M365SS-005 rotation is audited');

-- a null secret keeps the stored one (tenant/client edit only)
select set_config('e817.ref2', (select secret_ref from m365_org_apps where org_id='e8170000-0000-0000-0000-00000000000a'), true);
set local role service_role;
select is((public.m365_set_org_app('e8170000-0000-0000-0000-00000000000a','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc',null,'e8170000-0000-0000-0000-0000000000a1'))->>'changed_app',
  'true', 'AC-M365SS-005 a client id edit reports an app change');
reset role;
select is((select secret_ref from m365_org_apps where org_id='e8170000-0000-0000-0000-00000000000a'), current_setting('e817.ref2'),
  'AC-M365SS-005 a null secret keeps the stored secret reference');

-- ── AC-M365SS-006 who may save ───────────────────────────────────────────────────────────────────
set local role service_role;
select throws_ok($$select public.m365_set_org_app('e8170000-0000-0000-0000-00000000000a','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','x','e8170000-0000-0000-0000-0000000000a2')$$,
  '42501', null, 'AC-M365SS-006 a Project Manager cannot save');
select throws_ok($$select public.m365_set_org_app('e8170000-0000-0000-0000-00000000000a','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','x','e8170000-0000-0000-0000-0000000000a3')$$,
  '42501', null, 'AC-M365SS-006 a deactivated Admin cannot save');
select throws_ok($$select public.m365_set_org_app('e8170000-0000-0000-0000-00000000000a','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','x','e8170000-0000-0000-0000-0000000000b1')$$,
  '42501', null, 'AC-M365SS-006 an Admin of another org cannot save');
select throws_ok($$select public.m365_set_org_app('e8170000-0000-0000-0000-00000000000c','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','x','e8170000-0000-0000-0000-0000000000c1')$$,
  '42501', null, 'AC-M365SS-006 an Admin of an org with M365 off cannot save');
select throws_ok($$select public.m365_set_org_app('e8170000-0000-0000-0000-00000000000a','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','x',null)$$,
  '42501', null, 'AC-M365SS-006 a call with no actor is refused');
select throws_ok($$select public.m365_clear_org_app('e8170000-0000-0000-0000-00000000000a','e8170000-0000-0000-0000-0000000000a2')$$,
  '42501', null, 'AC-M365SS-006 a Project Manager cannot clear');
reset role;
select is((select count(*)::int from m365_org_apps where org_id in ('e8170000-0000-0000-0000-00000000000b','e8170000-0000-0000-0000-00000000000c')), 0,
  'AC-M365SS-006 the refused calls stored nothing');

-- ── AC-M365SS-007 no anon / authenticated path ───────────────────────────────────────────────────
select ok(not has_table_privilege('authenticated', 'public.m365_org_apps', 'SELECT'), 'AC-M365SS-007 authenticated cannot select m365_org_apps');
select ok(not has_table_privilege('anon', 'public.m365_org_apps', 'SELECT'), 'AC-M365SS-007 anon cannot select m365_org_apps');
select ok(not has_function_privilege('anon', 'public.m365_set_org_app(uuid,text,text,text,uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.m365_set_org_app(uuid,text,text,text,uuid)', 'EXECUTE'),
  'AC-M365SS-007 anon and authenticated cannot execute m365_set_org_app');
select ok(not has_function_privilege('anon', 'public.m365_org_app_resolve(uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.m365_org_app_resolve(uuid)', 'EXECUTE'),
  'AC-M365SS-007 anon and authenticated cannot execute m365_org_app_resolve');
select ok(not has_function_privilege('anon', 'public.m365_clear_org_app(uuid,uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.m365_clear_org_app(uuid,uuid)', 'EXECUTE'),
  'AC-M365SS-007 anon and authenticated cannot execute m365_clear_org_app');
select ok(has_function_privilege('service_role', 'public.m365_set_org_app(uuid,text,text,text,uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.m365_org_app_resolve(uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.m365_clear_org_app(uuid,uuid)', 'EXECUTE'),
  'AC-M365SS-007 service_role can execute all three');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e8170000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select * from public.m365_org_app_resolve('e8170000-0000-0000-0000-00000000000a')$$, '42501', null,
  'AC-M365SS-007 an Admin JWT cannot read the secret through resolve');
reset role;

set local role service_role;
select throws_ok($$select public.m365_set_org_app('e8170000-0000-0000-0000-00000000000b','common','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','x','e8170000-0000-0000-0000-0000000000b1')$$,
  '23514', null, 'AC-M365SS-007 a non-GUID tenant id is rejected');
select throws_ok($$select public.m365_set_org_app('e8170000-0000-0000-0000-00000000000b','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',null,'e8170000-0000-0000-0000-0000000000b1')$$,
  '22023', null, 'AC-M365SS-005 a first save needs a secret');

-- clear: row, Vault secret gone, audited
reset role;
select set_config('e817.ref3', (select secret_ref from m365_org_apps where org_id='e8170000-0000-0000-0000-00000000000a'), true);
set local role service_role;
select public.m365_clear_org_app('e8170000-0000-0000-0000-00000000000a','e8170000-0000-0000-0000-0000000000a1');
reset role;
select is((select count(*)::int from m365_org_apps where org_id='e8170000-0000-0000-0000-00000000000a'), 0, 'AC-M365SS-005 clear removes the row');
select is((select count(*)::int from vault.secrets where name = current_setting('e817.ref3')), 0, 'AC-M365SS-005 clear removes the Vault secret');
select is((select count(*)::int from audit_events where org_id='e8170000-0000-0000-0000-00000000000a' and action='m365.app.cleared'), 1, 'AC-M365SS-005 clear is audited');

select * from finish();
rollback;
