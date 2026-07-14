-- external_admin_connect_rls.test.sql
-- pgTAP tests for Vault reader/writer RPCs and external_org_bindings RLS/role gates
-- AC-EAC-003, AC-EAC-004, AC-EAC-005, AC-EAC-006, AC-EAC-014, AC-EAC-015, AC-EAC-019, AC-EAC-020
begin;
select plan(33);

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

-- Test 20: Reconnect (re-call for same org+tier) updates secret_ref, old secret remains in Vault (Phase 1)
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
  'AC-EAC-006 reconnect updates secret_ref (Phase 1: old secret not revoked)'
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

-- Test 23: Verify old secret still exists in Vault (Phase 1: no revocation)
select is(
  public.read_vault_secret('clickup_token_org_a_1'),
  'valid-clickup-token-123',
  'AC-EAC-006 old secret remains in Vault (Phase 1: no revocation)'
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

select finish();
rollback;