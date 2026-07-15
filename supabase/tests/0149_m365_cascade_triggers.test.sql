-- 0149_m365_cascade_triggers.test.sql
-- AC-M365-121 [pgTAP]: offboard/disentitlement cascade TRIGGERS fire (not just the RPC).
-- Proves: profiles.status→disabled trigger, org_features.m365_integration true→false trigger,
-- org_features DELETE while enabled trigger, LOW-1 entra_tenant_id CHECK, LOW-2 reason allowlist.
-- Runs as pgTAP superuser (triggers fire regardless of the public RPC's auth guard — that's the point
-- of the guard-free _core).
begin;
select plan(14);

-- ============================================================================
-- SETUP: two orgs, users, operator, active m365 connections.
-- ============================================================================
insert into organizations (id, name) values
  ('01490000-0000-0000-0000-000000000001','AC-M365-121 Org A'),
  ('01490000-0000-0000-0000-000000000002','AC-M365-121 Org B');

insert into auth.users (id, email) values
  ('01490000-0000-0000-0000-0000000000a1','m365-trigger-a@example.com'),
  ('01490000-0000-0000-0000-0000000000b1','m365-trigger-b@example.com'),
  ('01490000-0000-0000-0000-0000000000c1','m365-trigger-c@example.com'),
  ('00000000-0000-0000-0000-0000000000f1','m365-trigger-operator@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01490000-0000-0000-0000-0000000000a1','01490000-0000-0000-0000-000000000001','User A','m365-trigger-a@example.com','Admin','active'),
  ('01490000-0000-0000-0000-0000000000b1','01490000-0000-0000-0000-000000000002','User B','m365-trigger-b@example.com','Admin','active'),
  ('01490000-0000-0000-0000-0000000000c1','01490000-0000-0000-0000-000000000002','User C','m365-trigger-c@example.com','Project Manager','active'),
  ('00000000-0000-0000-0000-0000000000f1','01490000-0000-0000-0000-000000000001','Operator','m365-trigger-operator@example.com','Admin','active');

-- Operator row for org_features write policy (operator_toggle_feature needs it).
insert into platform_operators (user_id) values ('00000000-0000-0000-0000-0000000000f1');

-- Org A: m365_integration enabled + one connection (User A).
insert into org_features (org_id, feature_key, enabled, updated_by)
values ('01490000-0000-0000-0000-000000000001','m365_integration',true,'00000000-0000-0000-0000-0000000000f1');

insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01490000-0000-0000-0000-000000000001','01490000-0000-0000-0000-0000000000a1',
   'tenant-a', array['offline_access','Files.Read'], '\x01'::bytea, '\x02'::bytea, 'kek-v1', 'active');

-- Org B: m365_integration enabled + two connections (User B + User C).
insert into org_features (org_id, feature_key, enabled, updated_by)
values ('01490000-0000-0000-0000-000000000002','m365_integration',true,'00000000-0000-0000-0000-0000000000f1');

insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01490000-0000-0000-0000-000000000002','01490000-0000-0000-0000-0000000000b1',
   'tenant-b', array['offline_access','Files.Read'], '\x03'::bytea, '\x04'::bytea, 'kek-v1', 'active'),
  ('01490000-0000-0000-0000-000000000002','01490000-0000-0000-0000-0000000000c1',
   'tenant-b', array['offline_access','Files.Read'], '\x05'::bytea, '\x06'::bytea, 'kek-v1', 'active');

-- ============================================================================
-- TEST 1: AC-M365-121 — profiles offboard trigger (status active→disabled).
-- ============================================================================
update public.profiles set status = 'disabled' where id = '01490000-0000-0000-0000-0000000000a1';

-- Verify connection deleted (read as superuser; ms_graph_connections has no client-readable policy).
reset role;
select is(
  (select count(*)::int from public.ms_graph_connections where user_id = '01490000-0000-0000-0000-0000000000a1'),
  0, 'AC-M365-121 offboard trigger: User A connection deleted');

-- Verify audit event with reason='offboard'.
select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked'
       and org_id = '01490000-0000-0000-0000-000000000001'
       and detail->>'reason' = 'offboard'
       and detail->>'user_id' = '01490000-0000-0000-0000-0000000000a1'),
  1, 'AC-M365-121 offboard trigger: audit event recorded with reason=offboard');

-- Verify Org B's connections untouched (org-scoped).
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01490000-0000-0000-0000-000000000002'),
  2, 'AC-M365-121 offboard trigger: Org B connections untouched');

-- ============================================================================
-- TEST 2: Disentitlement trigger — org_features UPDATE (enabled true→false).
-- ============================================================================
-- Toggle m365_integration OFF for Org B via operator_toggle_feature (Operator path).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select public.operator_toggle_feature('01490000-0000-0000-0000-000000000002', 'm365_integration', false) $$,
  'AC-M365-121 disentitlement: operator_toggle_feature succeeds');
reset role;

-- Verify BOTH Org B connections deleted (p_user_id=NULL → all users in org).
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01490000-0000-0000-0000-000000000002'),
  0, 'AC-M365-121 disentitlement UPDATE trigger: all Org B connections deleted');

-- Verify audit events for BOTH connections with reason='disentitled'.
select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked'
       and org_id = '01490000-0000-0000-0000-000000000002'
       and detail->>'reason' = 'disentitled'),
  2, 'AC-M365-121 disentitlement UPDATE trigger: two audit events with reason=disentitled');

-- Verify Org A's connection (already deleted by offboard) stays gone.
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01490000-0000-0000-0000-000000000001'),
  0, 'AC-M365-121 disentitlement UPDATE trigger: Org A connections still zero');

-- ============================================================================
-- TEST 3: Disentitlement trigger — org_features DELETE (row removed while enabled=true).
-- ============================================================================
-- Re-seed Org A with m365_integration enabled + a connection for User C.
delete from public.ms_graph_connections where org_id = '01490000-0000-0000-0000-000000000001';
delete from public.org_features where org_id = '01490000-0000-0000-0000-000000000001';

insert into org_features (org_id, feature_key, enabled, updated_by)
values ('01490000-0000-0000-0000-000000000001','m365_integration',true,'00000000-0000-0000-0000-0000000000f1');

insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01490000-0000-0000-0000-000000000001','01490000-0000-0000-0000-0000000000c1',
   'tenant-a', array['offline_access','Files.Read'], '\x07'::bytea, '\x08'::bytea, 'kek-v1', 'active');

-- Delete the org_features row (simulating operator removing the feature entirely).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
delete from public.org_features
 where org_id = '01490000-0000-0000-0000-000000000001' and feature_key = 'm365_integration';
reset role;

-- Verify connection deleted.
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01490000-0000-0000-0000-000000000001'),
  0, 'AC-M365-121 disentitlement DELETE trigger: Org A connection deleted');

-- Verify audit event with reason='disentitled'.
select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked'
       and org_id = '01490000-0000-0000-0000-000000000001'
       and detail->>'reason' = 'disentitled'),
  1, 'AC-M365-121 disentitlement DELETE trigger: audit event with reason=disentitled');

-- ============================================================================
-- TEST 4: LOW-1 — CHECK constraint on ms_graph_connections.entra_tenant_id format.
-- ============================================================================
-- Valid tenant ID should succeed.
select lives_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
       values ('01490000-0000-0000-0000-000000000001','01490000-0000-0000-0000-0000000000a1',
               'valid-tenant-123', array['offline_access'], '\x99'::bytea, 'kek-v1', 'active') $$,
  'LOW-1 valid entra_tenant_id passes CHECK');

-- Invalid tenant ID with path traversal attempt should fail CHECK (23514).
select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
       values ('01490000-0000-0000-0000-000000000001','01490000-0000-0000-0000-0000000000a1',
               'evil/../../etc', array['offline_access'], '\x99'::bytea, 'kek-v1', 'active') $$,
  '23514', null, 'LOW-1 invalid entra_tenant_id fails CHECK');

-- Clean up the valid insert for test isolation.
delete from public.ms_graph_connections where entra_tenant_id = 'valid-tenant-123';

-- ============================================================================
-- TEST 5: LOW-2 — m365_disconnect_cascade p_reason allowlist (22023 on bogus reason).
-- ============================================================================
-- Direct call to public RPC with bogus reason should raise 22023 (from LOW-2 allowlist).
select throws_ok(
  $$ select public.m365_disconnect_cascade('01490000-0000-0000-0000-000000000001',
                                             '01490000-0000-0000-0000-0000000000a1',
                                             'bogus_reason') $$,
  '22023', null, 'LOW-2 public RPC bogus_reason raises 22023');

-- Also test the internal _core directly (should also raise 22023).
select throws_ok(
  $$ select public._m365_disconnect_cascade_core('01490000-0000-0000-0000-000000000001',
                                                   '01490000-0000-0000-0000-0000000000a1',
                                                   'also_bogus',
                                                   '01490000-0000-0000-0000-0000000000a1') $$,
  '22023', null, 'LOW-2 internal _core bogus_reason raises 22023');

-- Valid reason should not throw (test one representative: offboard).
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01490000-0000-0000-0000-000000000001','01490000-0000-0000-0000-0000000000a1',
   'tenant-a', array['offline_access'], '\x10'::bytea, '\x11'::bytea, 'kek-v1', 'active');

select lives_ok(
  $$ select public._m365_disconnect_cascade_core('01490000-0000-0000-0000-000000000001',
                                                   '01490000-0000-0000-0000-0000000000a1',
                                                   'offboard',
                                                   '01490000-0000-0000-0000-0000000000a1') $$,
  'LOW-2 internal _core valid reason=offboard succeeds');

select * from finish();
rollback;