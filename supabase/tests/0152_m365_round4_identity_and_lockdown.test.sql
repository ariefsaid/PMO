-- 0152_m365_round4_identity_and_lockdown.test.sql
-- AC-M365-167/168 [pgTAP]: Luna round-4 fixes — the RPC identity binding (MED-1) and the service_role
-- direct-DML lockdown + the new parent-first delete RPC (MED-2).
--
-- What this proves:
--   • AC-M365-167 (MED-1): m365_refresh_connection / m365_set_connection_status / m365_delete_connection
--                  are IDENTITY-BOUND — a mismatched (org, user, connection) call matches ZERO rows
--                  (returns NULL, no mutation) instead of mutating a connection belonging to a
--                  different org/user. This is also what closes the mismatched-caller DEADLOCK Luna
--                  reproduced (a zero-row UPDATE/DELETE locks no connection tuple → no BEFORE trigger
--                  → no child→parent cycle); the two-session deadlock-freedom itself is proven by
--                  scripts/m365-deadlock-probe.sh. The matching call is unaffected.
--   • AC-M365-168 (MED-2): service_role no longer holds direct INSERT/UPDATE/DELETE on
--                  ms_graph_connections (the 0113/0114 RPCs are the only mutation path), SELECT is
--                  retained, the new m365_delete_connection RPC exists + is SECURITY DEFINER +
--                  identity-bound, and the lifecycle cascade (SECURITY DEFINER / postgres-owned)
--                  STILL deletes on offboard despite the service_role lockdown.
--
-- Runs as pgTAP superuser. The privilege assertions use has_table_privilege / has_function_privilege
-- (exactly what Postgres checks), avoiding session-level SET ROLE mutation inside the test txn.
begin;
select plan(22);

-- ============================================================================
-- SETUP: Org A / User A (owns the connection under test), Org B / User B (the mismatched identity),
-- Org C / User C (the lifecycle-cascade regression fixture). All active + entitled.
-- ============================================================================
insert into organizations (id, name) values
  ('a1520000-0000-0000-0000-000000000001','AC-M365-167 Org A'),  -- owns connA
  ('a1520000-0000-0000-0000-000000000002','AC-M365-167 Org B'),  -- mismatched identity
  ('a1520000-0000-0000-0000-000000000003','AC-M365-168 Org C');  -- lifecycle cascade regression

insert into auth.users (id, email) values
  ('a1520000-0000-0000-0000-0000000000a1','m365-167-a@example.com'),
  ('a1520000-0000-0000-0000-0000000000b1','m365-167-b@example.com'),
  ('a1520000-0000-0000-0000-0000000000c1','m365-168-c@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('a1520000-0000-0000-0000-0000000000a1','a1520000-0000-0000-0000-000000000001','A','m365-167-a@example.com','Engineer','active'),
  ('a1520000-0000-0000-0000-0000000000b1','a1520000-0000-0000-0000-000000000002','B','m365-167-b@example.com','Engineer','active'),
  ('a1520000-0000-0000-0000-0000000000c1','a1520000-0000-0000-0000-000000000003','C','m365-168-c@example.com','Engineer','active');

insert into org_features (org_id, feature_key, enabled, updated_by) values
  ('a1520000-0000-0000-0000-000000000001','m365_integration',true,null),
  ('a1520000-0000-0000-0000-000000000002','m365_integration',true,null),
  ('a1520000-0000-0000-0000-000000000003','m365_integration',true,null);

-- ============================================================================
-- AC-M365-167 (MED-1): the three connection-mutation RPCs are identity-bound.
-- Upsert a connection for Org A / User A (refresh_token_ciphertext = '\x01'), then prove a MISMATCHED
-- (Org B / User B) call to each RPC returns NULL and does NOT mutate connA, while the matching call
-- succeeds and mutates. (The mismatched UPDATE/DELETE matching zero rows is also what prevents the
-- child→parent deadlock Luna reproduced — no tuple lock, no BEFORE trigger, no cycle.)
-- ============================================================================

-- Create connA for Org A / User A via the sanctioned upsert RPC (refresh_token '\x01').
select public.m365_upsert_connection(
  'a1520000-0000-0000-0000-000000000001','a1520000-0000-0000-0000-0000000000a1',
  '11111111-2222-3333-4444-555555555555','oid-a',array['offline_access'],
  '\x01'::bytea,'\x02'::bytea,now(),'kek-v1',now(),now());
select is(count(*)::int, 1, 'AC-M365-167 setup: connA exists for Org A / User A')
  from public.ms_graph_connections
 where org_id = 'a1520000-0000-0000-0000-000000000001' and user_id = 'a1520000-0000-0000-0000-0000000000a1';

-- m365_refresh_connection: MISMATCHED (Org B / User B, connA.id) → NULL, NO mutation.
select is(
  public.m365_refresh_connection(
    'a1520000-0000-0000-0000-000000000002','a1520000-0000-0000-0000-0000000000b1',
    (select id from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1'),
    '\x99'::bytea,'\x99'::bytea,now(),now()),
  null::uuid,
  'AC-M365-167 MED-1: m365_refresh_connection with a MISMATCHED (org,user) returns NULL (identity not bound → rejected)');
select is(
  (select refresh_token_ciphertext from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1'),
  '\x01'::bytea,
  'AC-M365-167 MED-1: the mismatched refresh call did NOT mutate connA (refresh_token_ciphertext unchanged)');

-- m365_refresh_connection: MATCHING (Org A / User A, connA.id) → id, mutated.
select is(
  public.m365_refresh_connection(
    'a1520000-0000-0000-0000-000000000001','a1520000-0000-0000-0000-0000000000a1',
    (select id from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1'),
    '\x55'::bytea,'\x55'::bytea,now(),now()) is not null,
  true,
  'AC-M365-167 MED-1: the MATCHING refresh call returns the id');
select is(
  (select refresh_token_ciphertext from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1'),
  '\x55'::bytea,
  'AC-M365-167 MED-1: the matching refresh call MUTATED connA (refresh_token_ciphertext = 0x55)');

-- m365_set_connection_status: MISMATCHED → NULL, status still 'active'.
select is(
  public.m365_set_connection_status(
    'a1520000-0000-0000-0000-000000000002','a1520000-0000-0000-0000-0000000000b1',
    (select id from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1'),
    'revoked',now()),
  null::uuid,
  'AC-M365-167 MED-1: m365_set_connection_status with a MISMATCHED (org,user) returns NULL');
select is(
  (select status from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1'),
  'active',
  'AC-M365-167 MED-1: the mismatched status call did NOT change connA status (still active)');

-- m365_set_connection_status: MATCHING → id, status='stale'.
select is(
  public.m365_set_connection_status(
    'a1520000-0000-0000-0000-000000000001','a1520000-0000-0000-0000-0000000000a1',
    (select id from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1'),
    'stale',now()) is not null,
  true,
  'AC-M365-167 MED-1: the MATCHING status call returns the id');
select is(
  (select status from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1'),
  'stale',
  'AC-M365-167 MED-1: the matching status call set connA status = stale');

-- ============================================================================
-- AC-M365-168 (MED-2): service_role direct-DML lockdown + the m365_delete_connection RPC.
-- ============================================================================

-- service_role may NOT directly INSERT/UPDATE/DELETE ms_graph_connections (0114 revoked them); the
-- 0113/0114 SECURITY-DEFINER RPCs are the only mutation path. SELECT is retained.
select is(has_table_privilege('service_role','public.ms_graph_connections','insert'), false,
  'AC-M365-168 MED-2: service_role may NOT directly INSERT ms_graph_connections (RPCs are the only path)');
select is(has_table_privilege('service_role','public.ms_graph_connections','update'), false,
  'AC-M365-168 MED-2: service_role may NOT directly UPDATE ms_graph_connections');
select is(has_table_privilege('service_role','public.ms_graph_connections','delete'), false,
  'AC-M365-168 MED-2: service_role may NOT directly DELETE ms_graph_connections');
select is(has_table_privilege('service_role','public.ms_graph_connections','select'), true,
  'AC-M365-168 MED-2: service_role RETAINS SELECT on ms_graph_connections (the edge fn loads rows)');

-- The new m365_delete_connection RPC exists, is SECURITY DEFINER, and service_role may execute it
-- (the sanctioned delete path that replaces revoke.ts's former direct .delete()).
select is(count(*)::int, 1, 'AC-M365-168 MED-2: m365_delete_connection exists in public')
  from pg_proc where pronamespace='public'::regnamespace and proname='m365_delete_connection' and prosecdef;
select ok(has_function_privilege('service_role','public.m365_delete_connection(uuid,uuid,uuid)','execute'),
  'AC-M365-168 MED-2: service_role may execute m365_delete_connection (the sanctioned delete path)');

-- m365_delete_connection: MISMATCHED (Org B / User B, connA.id) → NULL, connA still present.
select is(
  public.m365_delete_connection(
    'a1520000-0000-0000-0000-000000000002','a1520000-0000-0000-0000-0000000000b1',
    (select id from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1')),
  null::uuid,
  'AC-M365-168 MED-1/2: m365_delete_connection with a MISMATCHED (org,user) returns NULL (no cross-identity delete)');
select is(count(*)::int, 1, 'AC-M365-168 MED-1/2: the mismatched delete did NOT remove connA')
  from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1';

-- m365_delete_connection: MATCHING (Org A / User A, connA.id) → id, connA deleted.
select is(
  public.m365_delete_connection(
    'a1520000-0000-0000-0000-000000000001','a1520000-0000-0000-0000-0000000000a1',
    (select id from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1')) is not null,
  true,
  'AC-M365-168 MED-2: the MATCHING m365_delete_connection returns the deleted id');
select is(count(*)::int, 0, 'AC-M365-168 MED-2: the matching delete REMOVED connA')
  from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000001' and user_id='a1520000-0000-0000-0000-0000000000a1';

-- m365_delete_connection: nonexistent id → NULL (no exception).
select is(
  public.m365_delete_connection(
    'a1520000-0000-0000-0000-000000000001','a1520000-0000-0000-0000-0000000000a1',
    '00000000-0000-0000-0000-000000000000'::uuid),
  null::uuid,
  'AC-M365-168 MED-2: m365_delete_connection on a nonexistent id returns NULL (no exception)');

-- ============================================================================
-- AC-M365-168 (MED-2 regression): the lifecycle cascade STILL deletes on offboard despite the
-- service_role direct-DML lockdown. The offboard trigger → _m365_disconnect_cascade_core is SECURITY
-- DEFINER (postgres-owned), so it bypasses service_role's revoked table grants. Proving this here is
-- the regression guard that MED-2's lockdown did NOT break lifecycle cleanup.
-- ============================================================================
select public.m365_upsert_connection(
  'a1520000-0000-0000-0000-000000000003','a1520000-0000-0000-0000-0000000000c1',
  '11111111-2222-3333-4444-555555555555','oid-c',array['offline_access'],
  '\x01'::bytea,'\x02'::bytea,now(),'kek-v1',now(),now());
select is(count(*)::int, 1, 'AC-M365-168 MED-2 setup: connC exists for Org C / User C')
  from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000003';
-- Offboard User C → the SECURITY-DEFINER offboard cascade still deletes connC.
update public.profiles set status = 'disabled' where id = 'a1520000-0000-0000-0000-0000000000c1';
select is(count(*)::int, 0, 'AC-M365-168 MED-2: the offboard cascade STILL deletes the connection after the service_role DML lockdown (SECURITY DEFINER bypasses the revoked grants)')
  from public.ms_graph_connections where org_id='a1520000-0000-0000-0000-000000000003';

select * from finish();
rollback;
