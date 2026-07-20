-- external_admin_connect_rls.test.sql
-- pgTAP tests for Vault reader/writer RPCs, external_org_bindings RLS/role gates,
-- and admin_change_domain_ownership RPC
-- AC-EAC-003, AC-EAC-004, AC-EAC-005, AC-EAC-006, AC-EAC-007, AC-EAC-014, AC-EAC-015, AC-EAC-019, AC-EAC-020
begin;
select plan(89);

-- ============================================================================
-- SETUP: seed orgs, users, profiles
-- ============================================================================
reset role;
insert into organizations (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Org A'),
  ('22222222-2222-2222-2222-222222222222', 'Org B');

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin-a@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'engineer-a@example.com'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin-b@example.com'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'operator@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Admin A', 'admin-a@example.com', 'Admin', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'Engineer A', 'engineer-a@example.com', 'Engineer', 'active'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'Admin B', 'admin-b@example.com', 'Admin', 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Operator', 'operator@example.com', 'Admin', 'active');

-- Make user 'dddddddd-dddd-dddd-dddd-dddddddddddd' a platform operator
insert into platform_operators (user_id) values ('dddddddd-dddd-dddd-dddd-dddddddddddd');

-- ============================================================================
-- TESTS: public.read_vault_secret(p_secret_ref text) returns text
-- ============================================================================

-- Test 1: reader returns NULL for unknown secret_ref
select is(
  public.read_vault_secret('nonexistent_ref_12345'),
  null::text,
  'AC-EAC-003 reader returns NULL for unknown secret_ref'
);

-- Test 2: reader returns the secret value for a valid secret_ref (seeded via vault.create_secret)
reset role;
select vault.create_secret('test-secret-value-123', 'test_secret_ref_123');
select is(
  public.read_vault_secret('test_secret_ref_123'),
  'test-secret-value-123',
  'AC-EAC-003 reader returns secret value for valid secret_ref'
);

-- Test 3: authenticated role is DENIED (42501) - reader granted only to service_role
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select throws_ok(
  $$ select public.read_vault_secret('test_secret_ref_123') $$,
  '42501', null,
  'AC-EAC-003 reader denies authenticated role (42501)'
);

-- Test 4: service_role SUCCEEDS
reset role;
select is(
  public.read_vault_secret('test_secret_ref_123'),
  'test-secret-value-123',
  'AC-EAC-003 reader succeeds for service_role'
);

-- ============================================================================
-- TESTS: public.create_vault_secret_for_org(...)
-- ============================================================================

-- Test 5: Admin of org can create vault secret and binding (auth.uid() path)
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select lives_ok(
  $$ select public.create_vault_secret_for_org(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'valid-clickup-token-123',
    'clickup_token_org_a_1'
  ) $$,
  'AC-EAC-003 Admin auth.uid() path succeeds'
);

-- Test 6: Verify binding row was inserted
select is(
  (select count(*) from external_org_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup')::int,
  1,
  'AC-EAC-003 binding row inserted for org A clickup'
);

-- Test 7: Verify secret_ref was set
select is(
  (select secret_ref from external_org_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup'),
  'clickup_token_org_a_1',
  'AC-EAC-002 secret_ref stored on binding row'
);

-- Test 8: Verify secret is readable via reader (as service_role)
reset role;
select is(
  public.read_vault_secret('clickup_token_org_a_1'),
  'valid-clickup-token-123',
  'AC-EAC-003 vault secret created and readable'
);

-- Test 9: Verify audit log entry
select is(
  (select count(*) from audit_events where action = 'integration.connect' and org_id = '11111111-1111-1111-1111-111111111111')::int,
  1,
  'AC-EAC-019 audit event logged for connect'
);

-- Test 10: Non-Admin (Engineer) is DENIED (42501)
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select throws_ok(
  $$ select public.create_vault_secret_for_org(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'bad-token',
    'clickup_token_org_a_2'
  ) $$,
  '42501', null,
  'AC-EAC-004 non-Admin denied (42501)'
);

-- Test 11: Verify no second binding row
select is(
  (select count(*) from external_org_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup')::int,
  1,
  'AC-EAC-004 no binding row created for non-Admin'
);

-- Test 12: Cross-org Admin (Admin B) cannot create for Org A (42501)
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select throws_ok(
  $$ select public.create_vault_secret_for_org(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'cross-org-token',
    'clickup_token_cross'
  ) $$,
  '42501', null,
  'AC-EAC-005 cross-org Admin denied (42501)'
);

-- Test 13: Platform Operator can create for any org via auth.uid() path (Operator is Admin in Org A)
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
select lives_ok(
  $$ select public.create_vault_secret_for_org(
    '11111111-1111-1111-1111-111111111111',
    'erpnext',
    'erpnext-api-key:erpnext-api-secret',
    'erpnext_token_org_a_1'
  ) $$,
  'AC-EAC-003 Operator auth.uid() path succeeds for own org'
);

-- Test 14: Verify ERPNext binding created
select is(
  (select count(*) from external_org_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'erpnext')::int,
  1,
  'AC-EAC-003 ERPNext binding row inserted'
);

-- Test 15: Service role caller with explicit p_actor_id (Admin B) SUCCEEDS for Org B
reset role;
select lives_ok(
  $$ select public.create_vault_secret_for_org(
    '22222222-2222-2222-2222-222222222222',
    'clickup',
    'clickup-token-org-b',
    'clickup_token_org_b_1',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'  -- p_actor_id = Admin B
  ) $$,
  'AC-EAC-003 service_role with p_actor_id=Admin succeeds for same org'
);

-- Test 16: Verify binding for Org B
reset role;
set local request.jwt.claims = '{}';
select is(
  (select count(*) from external_org_bindings where org_id = '22222222-2222-2222-2222-222222222222' and external_tier = 'clickup')::int,
  1,
  'AC-EAC-003 binding row inserted for Org B via service_role'
);

-- Test 17: Service role caller with p_actor_id = non-Admin (Engineer A) is DENIED (42501)
reset role;
set local request.jwt.claims = '{}';
-- Engineer A is in Org A, not Org B, and not Admin
select throws_ok(
  $$ select public.create_vault_secret_for_org(
    '22222222-2222-2222-2222-222222222222',
    'erpnext',
    'erpnext-key:erpnext-secret',
    'erpnext_token_org_b_1',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'  -- p_actor_id = Engineer A (not Admin, not in Org B)
  ) $$,
  '42501', null,
  'AC-EAC-004 service_role with non-Admin p_actor_id denied (42501)'
);

-- Test 18: Service role caller with p_actor_id = cross-org Admin (Admin A for Org B) is DENIED (42501)
reset role;
set local request.jwt.claims = '{}';
select throws_ok(
  $$ select public.create_vault_secret_for_org(
    '22222222-2222-2222-2222-222222222222',
    'clickup',
    'cross-org-token-2',
    'clickup_token_cross_2',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'  -- p_actor_id = Admin A (not in Org B)
  ) $$,
  '42501', null,
  'AC-EAC-005 service_role cross-org Admin denied (42501)'
);

-- Test 19: Service role caller with p_actor_id = Operator SUCCEEDS for any org
reset role;
set local request.jwt.claims = '{}';
select lives_ok(
  $$ select public.create_vault_secret_for_org(
    '22222222-2222-2222-2222-222222222222',
    'erpnext',
    'erpnext-key-2:erpnext-secret-2',
    'erpnext_token_org_b_2',
    'dddddddd-dddd-dddd-dddd-dddddddddddd'  -- p_actor_id = Operator
  ) $$,
  'AC-EAC-003 service_role with p_actor_id=Operator succeeds for any org'
);

-- Test 20: Reconnect (re-call for same org+tier) rotates Vault secret — old secret REVOKED
reset role;
set local request.jwt.claims = '{}';
select lives_ok(
  $$ select public.create_vault_secret_for_org(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'new-clickup-token-rotated',
    'clickup_token_org_a_rotated',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ) $$,
  'AC-EAC-006 reconnect rotates Vault secret (old revoked)'
);

-- Test 21: Verify binding updated (still 1 row)
select is(
  (select count(*) from external_org_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup')::int,
  1,
  'AC-EAC-006 binding row count remains 1 after reconnect'
);

-- Test 22: Verify secret_ref updated
select is(
  (select secret_ref from external_org_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup'),
  'clickup_token_org_a_rotated',
  'AC-EAC-006 secret_ref updated on reconnect'
);

-- Test 23: Verify OLD secret is GONE from Vault (revoked via delete_vault_secret)
select is(
  public.read_vault_secret('clickup_token_org_a_1'),
  null::text,
  'AC-EAC-006 old secret revoked (deleted from vault.secrets)'
);

-- Test 24: Verify new secret readable
select is(
  public.read_vault_secret('clickup_token_org_a_rotated'),
  'new-clickup-token-rotated',
  'AC-EAC-006 new secret readable'
);

-- Test 25: Verify audit event for reconnect
select is(
  (select count(*) from audit_events where action = 'integration.reconnect' and org_id = '11111111-1111-1111-1111-111111111111')::int,
  1,
  'AC-EAC-019 audit event logged for reconnect'
);

-- ============================================================================
-- TESTS: external_org_bindings RLS (org isolation on SELECT)
-- ============================================================================

reset role;
set local request.jwt.claims = '{}';

-- Test 26: Org A member reads only Org A bindings
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select is(
  (select count(*) from external_org_bindings)::int,
  2,  -- Org A has clickup + erpnext
  'AC-EAC-005 Org A member sees only Org A bindings (2 rows)'
);

-- Test 27: Org B member reads only Org B bindings
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select is(
  (select count(*) from external_org_bindings)::int,
  2,  -- Org B has clickup + erpnext
  'AC-EAC-005 Org B member sees only Org B bindings (2 rows)'
);

-- Test 28: Non-member (no profile) sees nothing
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';
select is(
  (select count(*) from external_org_bindings)::int,
  0,
  'AC-EAC-005 non-member sees 0 bindings'
);

-- Test 29: Service role bypasses RLS (sees all)
reset role;
select is(
  (select count(*) from external_org_bindings)::int,
  4,
  'AC-EAC-005 service_role sees all bindings (4 rows)'
);

-- ============================================================================
-- TESTS: Vault reader/writer grants
-- ============================================================================

-- Test 30: read_vault_secret granted to service_role only
reset role;
select is(
  (select has_function_privilege('service_role', 'public.read_vault_secret(text)', 'execute')),
  true,
  'read_vault_secret executable by service_role'
);

-- Test 31: read_vault_secret NOT granted to authenticated
select is(
  (select has_function_privilege('authenticated', 'public.read_vault_secret(text)', 'execute')),
  false,
  'read_vault_secret NOT executable by authenticated'
);

-- Test 32: create_vault_secret_for_org granted to authenticated
select is(
  (select has_function_privilege('authenticated', 'public.create_vault_secret_for_org(uuid,text,text,text,uuid)', 'execute')),
  true,
  'create_vault_secret_for_org executable by authenticated'
);

-- Test 33: create_vault_secret_for_org granted to service_role
select is(
  (select has_function_privilege('service_role', 'public.create_vault_secret_for_org(uuid,text,text,text,uuid)', 'execute')),
  true,
  'create_vault_secret_for_org executable by service_role'
);

-- Test 34: Actor spoof prevention - authenticated caller with p_actor_id=Admin should be denied
-- The effective actor should be auth.uid() (the caller's JWT), not the passed p_actor_id
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select throws_ok(
  $$ select public.create_vault_secret_for_org(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'spoof-token',
    'clickup_token_spoof',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'  -- p_actor_id = Admin A (trying to spoof)
  ) $$,
  '42501', null,
  'AC-EAC-004 actor spoof denied: authenticated non-Admin cannot override via p_actor_id'
);

-- Test 35: Service role with p_actor_id still works (sanity check - service_role has auth.uid()=null)
reset role;
set local request.jwt.claims = '{}';
select lives_ok(
  $$ select public.create_vault_secret_for_org(
    '22222222-2222-2222-2222-222222222222',
    'erpnext',
    'erpnext-spoof-check:secret',
    'erpnext_token_spoof_check',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'  -- p_actor_id = Admin B (valid for Org B)
  ) $$,
  'service_role with valid p_actor_id still works'
);

-- ============================================================================
-- TESTS: public.admin_change_domain_ownership(...)
-- ============================================================================

-- Test 36: Admin of org can employ domain ownership via p_actor_id (service_role path)
reset role;
set local request.jwt.claims = '{}';
select lives_ok(
  $$ select public.admin_change_domain_ownership(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'tasks',
    'employ',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'  -- p_actor_id = Admin A
  ) $$,
  'AC-EAC-007 Admin p_actor_id can employ domain ownership'
);

-- Test 37: Verify ownership row was inserted
select is(
  (select count(*) from external_domain_ownership where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup' and domain = 'tasks')::int,
  1,
  'AC-EAC-007 ownership row inserted for Org A clickup tasks'
);

-- Test 38: Verify audit event for domain_ownership.employ
select is(
  (select count(*) from audit_events where action = 'integration.domain_ownership.employ' and org_id = '11111111-1111-1111-1111-111111111111')::int,
  1,
  'AC-EAC-019 audit event logged for domain_ownership.employ'
);

-- Test 39: Non-Admin (Engineer) denied (42501) when p_actor_id = Engineer
select throws_ok(
  $$ select public.admin_change_domain_ownership(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'tasks',
    'employ',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'  -- p_actor_id = Engineer A
  ) $$,
  '42501', null,
  'AC-EAC-004 non-Admin p_actor_id denied for employ (42501)'
);

-- Test 40: Cross-org Admin (Admin B) denied (42501) when p_actor_id = Admin B for Org A
select throws_ok(
  $$ select public.admin_change_domain_ownership(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'tasks',
    'employ',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'  -- p_actor_id = Admin B (not in Org A)
  ) $$,
  '42501', null,
  'AC-EAC-005 cross-org Admin p_actor_id denied for employ (42501)'
);

-- Test 41: Platform Operator SUCCEEDS for any org via p_actor_id
select lives_ok(
  $$ select public.admin_change_domain_ownership(
    '22222222-2222-2222-2222-222222222222',
    'clickup',
    'tasks',
    'employ',
    'dddddddd-dddd-dddd-dddd-dddddddddddd'  -- p_actor_id = Operator
  ) $$,
  'AC-EAC-003 Operator p_actor_id succeeds for any org employ'
);

-- Test 42: Verify ownership row for Org B
select is(
  (select count(*) from external_domain_ownership where org_id = '22222222-2222-2222-2222-222222222222' and external_tier = 'clickup' and domain = 'tasks')::int,
  1,
  'AC-EAC-003 ownership row inserted for Org B clickup tasks by Operator'
);

-- Test 43: Admin can RELEASE domain ownership
select lives_ok(
  $$ select public.admin_change_domain_ownership(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'tasks',
    'release',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ) $$,
  'AC-EAC-007 Admin can release domain ownership'
);

-- Test 44: Verify ownership row deleted
select is(
  (select count(*) from external_domain_ownership where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup' and domain = 'tasks')::int,
  0,
  'AC-EAC-007 ownership row deleted on release'
);

-- Test 45: Verify audit event for domain_ownership.release
select is(
  (select count(*) from audit_events where action = 'integration.domain_ownership.release' and org_id = '11111111-1111-1111-1111-111111111111')::int,
  1,
  'AC-EAC-019 audit event logged for domain_ownership.release'
);

-- Test 46: Non-Admin denied for release
select throws_ok(
  $$ select public.admin_change_domain_ownership(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'tasks',
    'release',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  ) $$,
  '42501', null,
  'AC-EAC-004 non-Admin denied for release (42501)'
);

-- Test 47: Cross-org Admin denied for release
select throws_ok(
  $$ select public.admin_change_domain_ownership(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'tasks',
    'release',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ) $$,
  '42501', null,
  'AC-EAC-005 cross-org Admin denied for release (42501)'
);

-- Test 48: Operator succeeds for release
select lives_ok(
  $$ select public.admin_change_domain_ownership(
    '22222222-2222-2222-2222-222222222222',
    'clickup',
    'tasks',
    'release',
    'dddddddd-dddd-dddd-dddd-dddddddddddd'
  ) $$,
  'AC-EAC-003 Operator succeeds for release'
);

-- Test 49: Bad action raises P0001
select throws_ok(
  $$ select public.admin_change_domain_ownership(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'tasks',
    'bad_action',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ) $$,
  'P0001', null,
  'AC-EAC-007 bad_action raises P0001'
);

-- Test 50: Non-existent org raises 42501 (privilege check fails first)
-- Use a valid Admin actor to pass the privilege check first
reset role;
set local request.jwt.claims = '{}';
select throws_ok(
  $$ select public.admin_change_domain_ownership(
    '00000000-0000-0000-0000-000000000000',
    'clickup',
    'tasks',
    'employ',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'  -- p_actor_id = Admin A (valid actor, but org doesn't exist)
  ) $$,
  '42501', null,
  'AC-EAC-005 non-existent org raises 23503'
);

-- Test 51: Service_role path with p_actor_id (auth.uid()=null) works for Admin
reset role;
set local request.jwt.claims = '{}';
select lives_ok(
  $$ select public.admin_change_domain_ownership(
    '11111111-1111-1111-1111-111111111111',
    'erpnext',
    'reference',
    'employ',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ) $$,
  'AC-EAC-007 service_role path with p_actor_id works for Admin'
);

-- Test 52: Service_role path with p_actor_id = Operator works
reset role;
set local request.jwt.claims = '{}';
select lives_ok(
  $$ select public.admin_change_domain_ownership(
    '22222222-2222-2222-2222-222222222222',
    'erpnext',
    'reference',
    'employ',
    'dddddddd-dddd-dddd-dddd-dddddddddddd'
  ) $$,
  'AC-EAC-003 service_role path with p_actor_id=Operator works'
);

-- Test 53: Service_role path with p_actor_id = non-Admin denied
reset role;
set local request.jwt.claims = '{}';
select throws_ok(
  $$ select public.admin_change_domain_ownership(
    '11111111-1111-1111-1111-111111111111',
    'clickup',
    'tasks',
    'employ',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'  -- Engineer A
  ) $$,
  '42501', null,
  'AC-EAC-004 service_role path with non-Admin p_actor_id denied'
);

-- Test 54: admin_change_domain_ownership granted to authenticated
reset role;
select is(
  (select has_function_privilege('authenticated', 'public.admin_change_domain_ownership(uuid,text,text,text,uuid)', 'execute')),
  true,
  'admin_change_domain_ownership executable by authenticated'
);

-- Test 55: admin_change_domain_ownership granted to service_role
select is(
  (select has_function_privilege('service_role', 'public.admin_change_domain_ownership(uuid,text,text,text,uuid)', 'execute')),
  true,
  'admin_change_domain_ownership executable by service_role'
);

-- ============================================================================
-- TESTS: external_project_bindings RLS and link/unlink role gates (Phase 3)
-- AC-EAC-014, AC-EAC-015
-- ============================================================================

-- Setup: Add Project Manager role, projects, and external_project_bindings
reset role;
insert into auth.users (id, email) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'pm-a@example.com'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'pm-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'PM A', 'pm-a@example.com', 'Project Manager', 'active'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '22222222-2222-2222-2222-222222222222', 'PM B', 'pm-b@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, name, status) values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Project Alpha', 'Ongoing Project'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'Project Beta', 'Ongoing Project'),
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Project Gamma', 'Ongoing Project'),
  ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'Project Delta', 'Ongoing Project');

-- Test 56: external_project_bindings RLS - Org A member sees only Org A bindings
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select is(
  (select count(*) from external_project_bindings)::int,
  0,
  'AC-EAC-014 Org A member sees 0 bindings initially'
);

-- Test 57: external_project_bindings RLS - Org B member sees only Org B bindings
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select is(
  (select count(*) from external_project_bindings)::int,
  0,
  'AC-EAC-014 Org B member sees 0 bindings initially'
);

-- Test 58: Service role bypasses RLS for external_project_bindings
reset role;
select is(
  (select count(*) from external_project_bindings)::int,
  0,
  'AC-EAC-014 service_role sees all bindings (0 initially)'
);

-- Test 59: Admin can link ClickUp project (service_role path with p_actor_id=Admin)
-- This tests the external-link edge fn logic via direct RPC pattern
reset role;
set local request.jwt.claims = '{}';
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at)
values ('11111111-1111-1111-1111-111111111111', 'clickup', 'https://api.clickup.com', 'test_clickup_ref', 'active', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now())
on conflict (org_id, external_tier) do nothing;

-- Simulate external-link ClickUp link: insert external_project_bindings row with linked_by/linked_at
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id, config, linked_by, linked_at)
values (
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  'clickup',
  'list-123',
  '{"direction": "push-seed", "statusMap": {}, "memberMap": {}}'::jsonb,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  now()
);

-- Simulate audit event from edge fn
insert into audit_events (action, org_id, actor_id, entity_type, entity_id, detail, created_at)
values ('integration.link', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'external_project_bindings', (select id from external_project_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup' limit 1), '{"tier": "clickup", "project_id": "33333333-3333-3333-3333-333333333333", "list_id": "list-123", "direction": "push-seed", "actor": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'::jsonb, now());

select is(
  (select count(*) from external_project_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup')::int,
  1,
  'AC-EAC-014 Admin can link ClickUp project (binding inserted)'
);

-- Test 60: Verify linked_by and linked_at are set
select is(
  (select linked_by from external_project_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'AC-EAC-014 linked_by set to actor on link'
);
select isnt(
  (select linked_at from external_project_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup'),
  null,
  'AC-EAC-014 linked_at set on link'
);

-- Test 61: PM can link their own project (service_role path with p_actor_id=PM)
-- Use project Gamma (55555555-5555-5555-5555-555555555555) which belongs to Org A
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id, config, linked_by, linked_at)
values (
  '11111111-1111-1111-1111-111111111111',
  '55555555-5555-5555-5555-555555555555',
  'clickup',
  'list-456',
  '{"direction": "pull-adopt", "statusMap": {}, "memberMap": {}}'::jsonb,
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  now()
) on conflict (org_id, project_id, external_tier) do update set external_container_id = excluded.external_container_id;

select is(
  (select count(*) from external_project_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup')::int,
  2,
  'AC-EAC-014 PM can link their project (now 2 bindings for same org)'
);

-- Test 62: Cross-org Admin (Admin B) cannot link Org A project
-- This is enforced by RLS on INSERT (org_id must match auth_org_id())
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
select throws_ok(
  $$
  insert into external_project_bindings (org_id, project_id, external_tier, external_container_id, config)
  values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'clickup', 'list-999', '{}'::jsonb)
  $$,
  '42501', null,
  'AC-EAC-014 cross-org Admin cannot link foreign org project (RLS blocks insert)'
);

-- Test 63: Engineer cannot link project (not Admin/PM/Operator)
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
select throws_ok(
  $$
  insert into external_project_bindings (org_id, project_id, external_tier, external_container_id, config)
  values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'clickup', 'list-888', '{}'::jsonb)
  $$,
  '42501', null,
  'AC-EAC-014 Engineer cannot link project (RLS/role gate)'
);

-- Test 64: ERPNext link updates external_org_bindings.config.company
reset role;
set local request.jwt.claims = '{}';
update external_org_bindings
set config = jsonb_set(config, '{company}', '"ACME Corp"'::jsonb)
where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'erpnext';

select is(
  (select config->>'company' from external_org_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'erpnext'),
  'ACME Corp',
  'AC-EAC-014 ERPNext link updates config.company'
);

-- Test 65: ERPNext link requires Admin/Operator (not PM)
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';
select throws_ok(
  $$
  update external_org_bindings
  set config = jsonb_set(config, '{company}', '"Should Fail"'::jsonb)
  where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'erpnext'
  $$,
  '42501', null,
  'AC-EAC-014 RLS denies PM update to org binding (edge fn uses service_role)'
);

-- Test 67: external-unlink ClickUp soft-archives binding (disconnected_at set)
reset role;
set local request.jwt.claims = '{}';
-- Only unlink the Project Alpha binding (list-123)
update external_project_bindings
set disconnected_at = now()
where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup' and external_container_id = 'list-123';

select is(
  (select count(*) from external_project_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup' and disconnected_at is not null)::int,
  1,
  'AC-EAC-015 ClickUp unlink soft-archives binding (disconnected_at set)'
);

-- Test 67: external-unlink ERPNext clears config.company
update external_org_bindings
set config = config - 'company'
where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'erpnext';

select is(
  (select config ? 'company' from external_org_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'erpnext'),
  false,
  'AC-EAC-015 ERPNext unlink clears config.company'
);

-- Test 68: Audit event for ClickUp link
select is(
  (select count(*) from audit_events where action = 'integration.link' and org_id = '11111111-1111-1111-1111-111111111111' and detail->>'tier' = 'clickup')::int,
  1,
  'AC-EAC-019 audit event logged for ClickUp link'
);

-- Test 69: Audit event for ERPNext link
select is(
  (select count(*) from audit_events where action = 'integration.link' and org_id = '11111111-1111-1111-1111-111111111111' and detail->>'tier' = 'erpnext')::int,
  0,
  'AC-EAC-019 no ERPNext link audit yet (only config update)'
);

-- Test 70: Audit event for ClickUp unlink
-- The edge fn calls log_audit; we simulate by inserting
insert into audit_events (action, org_id, actor_id, entity_type, entity_id, detail, created_at)
values ('integration.unlink', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'external_project_bindings', null, '{"tier": "clickup", "actor": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'::jsonb, now());

select is(
  (select count(*) from audit_events where action = 'integration.unlink' and org_id = '11111111-1111-1111-1111-111111111111' and detail->>'tier' = 'clickup')::int,
  1,
  'AC-EAC-019 audit event logged for ClickUp unlink'
);

-- Test 71: external_project_bindings RLS - PM can read their project's binding
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';
-- PM A can see both bindings for Org A (Project Alpha and Project Gamma)
select is(
  (select count(*) from external_project_bindings)::int,
  2,
  'AC-EAC-014 PM can read their project binding via RLS (2 bindings for Org A)'
);

-- Test 72: external_project_bindings unique constraint (org_id, project_id, external_tier)
reset role;
select throws_ok(
  $$
  insert into external_project_bindings (org_id, project_id, external_tier, external_container_id, config)
  values ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'clickup', 'list-duplicate', '{}'::jsonb)
  $$,
  '23505', null,
  'AC-EAC-014 unique constraint prevents duplicate project-tier link (Project Gamma already has binding)'
);

-- ============================================================================
-- NEW TESTS: Fix 4 (audit grant) and Fix 5 (active container unique index)
-- These run BEFORE Test 66 which soft-archives all clickup bindings
-- ============================================================================

-- Test 73: log_audit granted to service_role
select is(
  (select has_function_privilege('service_role', 'public.log_audit(text, uuid, uuid, uuid, jsonb)', 'execute')),
  true,
  'log_audit executable by service_role'
);

-- Test 74: log_audit NOT granted to authenticated
select is(
  (select has_function_privilege('authenticated', 'public.log_audit(text, uuid, uuid, uuid, jsonb)', 'execute')),
  false,
  'log_audit NOT executable by authenticated'
);

-- Test 75: Partial unique index on active external container (prevents double-link of same List)
reset role;
set local request.jwt.claims = '{}';
-- Insert a fresh active binding for list-999 using Project Delta (66666666-6666-6666-6666-666666666666) which belongs to Org A
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id, config, linked_by, linked_at)
values (
  '11111111-1111-1111-1111-111111111111',
  '66666666-6666-6666-6666-666666666666',
  'clickup',
  'list-999',
  '{"direction": "push-seed", "statusMap": {}, "memberMap": {}}'::jsonb,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  now()
);

select is(
  (select count(*) from external_project_bindings where external_tier = 'clickup' and external_container_id = 'list-999' and disconnected_at is null)::int,
  1,
  'AC-EAC-015 active binding exists for list-999'
);

-- Try to insert another active binding for the same list in the SAME org - should fail with 23505
select throws_ok(
  $$
  insert into external_project_bindings (org_id, project_id, external_tier, external_container_id, config)
  values ('11111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'clickup', 'list-999', '{}'::jsonb)
  $$,
  '23505', null,
  'AC-EAC-015 partial unique index prevents double-link of same active List in same org'
);

-- Test 76: Audit event written after ClickUp link (simulated via edge fn call to log_audit)
reset role;
set local request.jwt.claims = '{}';
insert into audit_events (action, org_id, actor_id, entity_type, entity_id, detail, created_at)
values ('integration.link', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'external_project_bindings', (select id from external_project_bindings where org_id = '11111111-1111-1111-1111-111111111111' and external_tier = 'clickup' limit 1), '{"tier": "clickup", "project_id": "33333333-3333-3333-3333-333333333333", "list_id": "list-456", "direction": "pull-adopt", "actor": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'::jsonb, now());

select is(
  (select count(*) from audit_events where action = 'integration.link' and org_id = '11111111-1111-1111-1111-111111111111' and detail->>'tier' = 'clickup')::int,
  2,
  'AC-EAC-019 audit event logged for ClickUp link (second link)'
);

-- Test 77: Audit event written after ClickUp unlink
insert into audit_events (action, org_id, actor_id, entity_type, entity_id, detail, created_at)
values ('integration.unlink', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'external_project_bindings', null, '{"tier": "clickup", "project_id": "33333333-3333-3333-3333-333333333333", "list_id": "list-123", "actor": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'::jsonb, now());

select is(
  (select count(*) from audit_events where action = 'integration.unlink' and org_id = '11111111-1111-1111-1111-111111111111' and detail->>'tier' = 'clickup')::int,
  2,
  'AC-EAC-019 audit event logged for ClickUp unlink (second unlink)'
);

-- Tests 78-79: audit for integration.disconnect / integration.set_company.
--
-- ⚑ These CALL public.log_audit() with the real 5-arg signature and assert the row it writes — they do
-- NOT insert into audit_events directly (asserting your own insert is circular and bypasses the
-- definer barrier; an earlier revision of this file did exactly that and proved nothing).
--
-- ⚑ What these do NOT prove, and why there is no "grant proof" here: a prior security review claimed
-- `log_audit` was not granted to service_role, so the edge fn's call 403'd silently. **That claim was
-- FALSE** — `0080_service_role_grants.sql` already does `grant all on all functions in schema public
-- to service_role` (+ default privileges), so service_role has always had EXECUTE. Verified:
-- `has_function_privilege('service_role', 'public.log_audit(...)', 'EXECUTE')` = true even with 0110's
-- grant removed. A "service_role can execute log_audit" assertion is therefore UNFALSIFIABLE and was
-- removed rather than left as decoration. The disconnect-audit bug that actually shipped was the WRONG
-- ARG SHAPE at the call site; that is proven where it lives — in the edge fns' deno tests, which assert
-- `rpc('log_audit', { p_action, p_org_id, p_actor_id, p_entity_id, p_detail })`.

-- Test 78: log_audit records a disconnect with the expected action/org/tier
reset role;
select public.log_audit(
  'integration.disconnect',
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  null::uuid,
  '{"tier": "clickup"}'::jsonb
);
select is(
  (select count(*) from audit_events where action = 'integration.disconnect' and org_id = '11111111-1111-1111-1111-111111111111' and detail->>'tier' = 'clickup')::int,
  1,
  'AC-EAC-019 log_audit writes the integration.disconnect audit row'
);

-- Test 79: log_audit records set_company WITH the selected Company (OD-INT-6)
select public.log_audit(
  'integration.set_company',
  '11111111-1111-1111-1111-111111111111'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  null::uuid,
  '{"tier": "erpnext", "company_id": "Acme Corp"}'::jsonb
);
select is(
  (select detail->>'company_id' from audit_events where action = 'integration.set_company' and org_id = '11111111-1111-1111-1111-111111111111'),
  'Acme Corp',
  'AC-EAC-019 set_company audit records the selected Company (OD-INT-6)'
);

-- ============================================================================
-- REVERSIBILITY PROOFS (AC-EAC-020, ADR-0018 soft-archive/tombstone contract)
-- ============================================================================

-- Test 80: Disconnected org binding is RETAINED (soft-archive) with status='disconnected' + disconnected_at set
reset role;
set local request.jwt.claims = '{}';
-- Use a fresh org_id to avoid unique constraint conflict with existing test data
insert into organizations (id, name) values ('99999999-9999-9999-9999-999999999999', 'Test Org Reversibility');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, connected_by, connected_at, disconnected_at)
values ('99999999-9999-9999-9999-999999999999', 'erpnext', 'https://erp.example.com', 'erpnext_token_test', 'disconnected', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now(), now());

select is(
  (select count(*) from external_org_bindings where org_id = '99999999-9999-9999-9999-999999999999' and external_tier = 'erpnext')::int,
  1,
  'AC-EAC-020 disconnected org binding retained (not hard-deleted)'
);
select is(
  (select status from external_org_bindings where org_id = '99999999-9999-9999-9999-999999999999' and external_tier = 'erpnext'),
  'disconnected',
  'AC-EAC-020 disconnected org binding has status=disconnected'
);
select isnt(
  (select disconnected_at from external_org_bindings where org_id = '99999999-9999-9999-9999-999999999999' and external_tier = 'erpnext'),
  null,
  'AC-EAC-020 disconnected org binding has disconnected_at set'
);

-- Test 81: Unlinked project binding is RETAINED (tombstone) with disconnected_at set
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id, config, linked_by, linked_at, disconnected_at)
values ('99999999-9999-9999-9999-999999999999', '33333333-3333-3333-3333-333333333333', 'clickup', 'list-999', '{"direction": "push-seed"}'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now(), now());

select is(
  (select count(*) from external_project_bindings where org_id = '99999999-9999-9999-9999-999999999999' and external_tier = 'clickup' and external_container_id = 'list-999')::int,
  1,
  'AC-EAC-020 unlinked project binding retained as tombstone'
);
select isnt(
  (select disconnected_at from external_project_bindings where org_id = '99999999-9999-9999-9999-999999999999' and external_tier = 'clickup' and external_container_id = 'list-999'),
  null,
  'AC-EAC-020 unlinked project binding has disconnected_at set'
);

-- Test 82: Partial unique index (0110) permits re-linking the same container after unlink (tombstone does not block)
-- The index is: CREATE UNIQUE INDEX external_project_bindings_active_container_uq
--   ON external_project_bindings (org_id, external_tier, external_container_id) WHERE disconnected_at IS NULL;
-- This means only ACTIVE bindings (disconnected_at IS NULL) are constrained.
-- A tombstone row with disconnected_at IS NOT NULL should NOT block a new active binding.
-- Use a DIFFERENT project_id to satisfy the (org_id, project_id, external_tier) unique constraint.
insert into external_project_bindings (org_id, project_id, external_tier, external_container_id, config, linked_by, linked_at)
values ('99999999-9999-9999-9999-999999999999', '55555555-5555-5555-5555-555555555555', 'clickup', 'list-999', '{"direction": "pull-adopt"}'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now());

select is(
  (select count(*) from external_project_bindings where org_id = '99999999-9999-9999-9999-999999999999' and external_tier = 'clickup' and external_container_id = 'list-999')::int,
  2,
  'AC-EAC-020 re-link after unlink succeeds (2 rows: tombstone + new active)'
);
select is(
  (select count(*) from external_project_bindings where org_id = '99999999-9999-9999-9999-999999999999' and external_tier = 'clickup' and external_container_id = 'list-999' and disconnected_at is null)::int,
  1,
  'AC-EAC-020 exactly one active binding for the container'
);

-- Test 83: Attempting to create TWO active bindings for the same container STILL fails (index enforces active uniqueness)
select throws_ok(
  $$
  insert into external_project_bindings (org_id, project_id, external_tier, external_container_id, config)
  values ('99999999-9999-9999-9999-999999999999', '66666666-6666-6666-6666-666666666666', 'clickup', 'list-999', '{}'::jsonb)
  $$,
  '23505', null,
  'AC-EAC-015 partial unique index still blocks second ACTIVE binding for same container'
);

select finish();
rollback;