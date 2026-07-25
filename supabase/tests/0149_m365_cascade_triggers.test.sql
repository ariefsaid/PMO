-- 0149_m365_cascade_triggers.test.sql
-- AC-M365-121 [pgTAP]: NFR-M365-107 (tokens deleted on offboard / disentitlement) is enforced
-- end-to-end through the REAL lifecycle paths, hardened per the Luna DB-round review (C1/H2/H3/H5/M3).
--
-- What this proves (Luna fixes):
--   • AC-M365-121 offboard via the REAL admin_set_user_status RPC (not a superuser UPDATE), with
--     actor_id attribution + C1(a) PKCE-state purge (pending callback can no longer resurrect).
--   • AC-M365-121 disentitlement via operator_toggle_feature UPDATE (real path), actor_id + PKCE purge.
--   • H2: absent-row toggle-OFF (INSERT enabled=false) cascades; DELETE of ANY m365_integration row
--     (incl. a disabled one) cascades.
--   • H3: mutating feature_key / org_id on org_features raises (row identity is immutable).
--   • C1(b): the ms_graph_connections write-guard rejects an INSERT for a disabled user and for a
--     disentitled org (token resurrection is structurally impossible).
--   • M3: entra_tenant_id CHECK rejects '..' and '.' (path-confusion hardening).
--   • LOW-2: the p_reason allowlist (22023 on a bogus reason).
-- Runs as pgTAP superuser (the guard-free _core + the triggers fire for every role including
-- service_role; the public RPCs are driven under a realistic authenticated JWT context).
begin;
select plan(25);

-- ============================================================================
-- SETUP: three orgs, users, an operator, entitled orgs, active connections + pending PKCE states.
-- H5(iii) fix: every connection's (user_id, org_id) matches the user's profile org (the composite
-- FK enforces it) — the prior fixture wrongly put an Org-A connection on a user whose profile was
-- in Org B.
-- ============================================================================
insert into organizations (id, name) values
  ('a1490000-0000-0000-0000-000000000001','AC-M365-121 Org A'),
  ('a1490000-0000-0000-0000-000000000002','AC-M365-121 Org B'),
  ('a1490000-0000-0000-0000-000000000003','AC-M365-121 Org C');

insert into auth.users (id, email) values
  ('a1490000-0000-0000-0000-0000000000a1','m365-a1@example.com'),
  ('a1490000-0000-0000-0000-0000000000a2','m365-a2@example.com'),
  ('a1490000-0000-0000-0000-0000000000b1','m365-b1@example.com'),
  ('a1490000-0000-0000-0000-0000000000b2','m365-b2@example.com'),
  ('a1490000-0000-0000-0000-0000000000c1','m365-c1@example.com'),
  ('00000000-0000-0000-0000-0000000000f1','m365-operator@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('a1490000-0000-0000-0000-0000000000a1','a1490000-0000-0000-0000-000000000001','Admin A1','m365-a1@example.com','Admin','active'),
  ('a1490000-0000-0000-0000-0000000000a2','a1490000-0000-0000-0000-000000000001','User A2','m365-a2@example.com','Engineer','active'),
  ('a1490000-0000-0000-0000-0000000000b1','a1490000-0000-0000-0000-000000000002','Admin B1','m365-b1@example.com','Admin','active'),
  ('a1490000-0000-0000-0000-0000000000b2','a1490000-0000-0000-0000-000000000002','User B2','m365-b2@example.com','Engineer','active'),
  ('a1490000-0000-0000-0000-0000000000c1','a1490000-0000-0000-0000-000000000003','User C1','m365-c1@example.com','Engineer','active'),
  ('00000000-0000-0000-0000-0000000000f1','a1490000-0000-0000-0000-000000000001','Operator','m365-operator@example.com','Admin','active');

-- Operator row so is_operator() is true on the authenticated operator path (actor_id assertion).
insert into platform_operators (user_id) values ('00000000-0000-0000-0000-0000000000f1');

-- Org A + Org B entitled for m365_integration (Org C starts with NO row — used by the H2 INSERT test).
insert into org_features (org_id, feature_key, enabled, updated_by) values
  ('a1490000-0000-0000-0000-000000000001','m365_integration',true,'00000000-0000-0000-0000-0000000000f1'),
  ('a1490000-0000-0000-0000-000000000002','m365_integration',true,'00000000-0000-0000-0000-0000000000f1');

-- Active connections (every (user_id, org_id) agrees with the profile — H5iii). The C1(b)
-- write-guard requires active user + entitled org, satisfied for all of these.
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('a1490000-0000-0000-0000-000000000001','a1490000-0000-0000-0000-0000000000a2',
   '11111111-2222-3333-4444-555555555555', array['offline_access','Files.Read'], '\x01000000000000000000000000000000000000000000000000000000'::bytea, '\x02000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active'),
  ('a1490000-0000-0000-0000-000000000002','a1490000-0000-0000-0000-0000000000b1',
   '11111111-2222-3333-4444-555555555555', array['offline_access','Files.Read'], '\x03000000000000000000000000000000000000000000000000000000'::bytea, '\x04000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active'),
  ('a1490000-0000-0000-0000-000000000002','a1490000-0000-0000-0000-0000000000b2',
   '11111111-2222-3333-4444-555555555555', array['offline_access','Files.Read'], '\x05000000000000000000000000000000000000000000000000000000'::bytea, '\x06000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');

-- Pending PKCE states (C1a must purge these on offboard / disentitlement so an in-flight callback
-- cannot resurrect a connection).
insert into public.m365_pkce_states (org_id, user_id, code_verifier, state, scopes, expires_at) values
  ('a1490000-0000-0000-0000-000000000001','a1490000-0000-0000-0000-0000000000a2','v-a2','st-a2',array['Files.Read'], now()+interval '5 min'),
  ('a1490000-0000-0000-0000-000000000002','a1490000-0000-0000-0000-0000000000b1','v-b1','st-b1',array['Files.Read'], now()+interval '5 min'),
  ('a1490000-0000-0000-0000-000000000002','a1490000-0000-0000-0000-0000000000b2','v-b2','st-b2',array['Files.Read'], now()+interval '5 min');

-- ============================================================================
-- TEST 1: AC-M365-121 — offboard via the REAL admin_set_user_status RPC (Admin path).
-- M4: drives the real lifecycle (not a superuser profiles UPDATE); asserts actor_id + C1(a) PKCE purge.
-- ============================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1490000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select public.admin_set_user_status('a1490000-0000-0000-0000-0000000000a2','disabled','a1490000-0000-0000-0000-000000000001') $$,
  'AC-M365-121 offboard: admin_set_user_status(disable User A2) succeeds under Admin A1');
reset role;

select is(
  (select count(*)::int from public.ms_graph_connections where user_id = 'a1490000-0000-0000-0000-0000000000a2'),
  0, 'AC-M365-121 offboard: User A2 connection deleted by the trigger');

select is(
  (select count(*)::int from public.m365_pkce_states where user_id = 'a1490000-0000-0000-0000-0000000000a2'),
  0, 'AC-M365-121 offboard (C1a): pending PKCE state for User A2 purged — in-flight callback cannot resurrect');

select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked'
       and org_id = 'a1490000-0000-0000-0000-000000000001'
       and detail->>'reason' = 'offboard'
       and detail->>'user_id' = 'a1490000-0000-0000-0000-0000000000a2'
       and actor_id = 'a1490000-0000-0000-0000-0000000000a1'),
  1, 'AC-M365-121 offboard (M4): audit recorded with reason=offboard AND actor_id=acting Admin A1');

select is(
  (select count(*)::int from public.ms_graph_connections where org_id = 'a1490000-0000-0000-0000-000000000002'),
  2, 'AC-M365-121 offboard: Org B connections untouched (org-scoped)');

-- ============================================================================
-- TEST 2: AC-M365-121 — disentitlement via the REAL operator_toggle_feature UPDATE path.
-- M4: asserts actor_id (operator) + C1(a) PKCE purge for the all-org branch.
-- ============================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select public.operator_toggle_feature('a1490000-0000-0000-0000-000000000002','m365_integration',false) $$,
  'AC-M365-121 disentitlement: operator_toggle_feature(Org B, false) succeeds');
reset role;

select is(
  (select count(*)::int from public.ms_graph_connections where org_id = 'a1490000-0000-0000-0000-000000000002'),
  0, 'AC-M365-121 disentitlement UPDATE: all Org B connections deleted');

select is(
  (select count(*)::int from public.m365_pkce_states where org_id = 'a1490000-0000-0000-0000-000000000002'),
  0, 'AC-M365-121 disentitlement UPDATE (C1a): all Org B pending PKCE states purged');

select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked'
       and org_id = 'a1490000-0000-0000-0000-000000000002'
       and detail->>'reason' = 'disentitled'
       and actor_id = '00000000-0000-0000-0000-0000000000f1'),
  2, 'AC-M365-121 disentitlement UPDATE (M4): two audits with reason=disentitled AND actor_id=operator');

-- ============================================================================
-- TEST 3: C1(b) — the ms_graph_connections write-guard rejects resurrection.
-- After TEST 1 User A2 is disabled (Org A still entitled); after TEST 2 Org B is disentitled.
-- ============================================================================
select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
       values ('a1490000-0000-0000-0000-000000000001','a1490000-0000-0000-0000-0000000000a2',
               '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x10000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active') $$,
  '42501', null, 'C1(b) write-guard: INSERT for a DISABLED user is rejected (42501) — no resurrection');

select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
       values ('a1490000-0000-0000-0000-000000000002','a1490000-0000-0000-0000-0000000000b1',
               '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x11000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active') $$,
  '42501', null, 'C1(b) write-guard: INSERT for a DISENTITLED org is rejected (42501) — no resurrection');

-- ============================================================================
-- TEST 4: H2 — absent-row toggle-OFF (INSERT enabled=false) cascades.
-- Org C has NO m365_integration row. Seed a stale connection by briefly suspending the write-guard
-- (simulates legacy / callback-race data the INSERT cascade must still clean), then toggle OFF.
-- ============================================================================
alter table public.ms_graph_connections disable trigger m365_connection_write_guard;
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('a1490000-0000-0000-0000-000000000003','a1490000-0000-0000-0000-0000000000c1',
        '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x20000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');
alter table public.ms_graph_connections enable trigger m365_connection_write_guard;

select is(
  (select count(*)::int from public.ms_graph_connections where org_id = 'a1490000-0000-0000-0000-000000000003'),
  1, 'H2 setup: stale Org C connection present (legacy/race data)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select public.operator_toggle_feature('a1490000-0000-0000-0000-000000000003','m365_integration',false) $$,
  'H2: operator_toggle_feature(Org C, false) on an ABSENT row performs an INSERT and succeeds');
reset role;

select is(
  (select count(*)::int from public.ms_graph_connections where org_id = 'a1490000-0000-0000-0000-000000000003'),
  0, 'H2: absent-row INSERT of enabled=false cascades — stale Org C connection deleted');

select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked'
       and org_id = 'a1490000-0000-0000-0000-000000000003'
       and detail->>'reason' = 'disentitled'),
  1, 'H2: absent-row INSERT cascade audited with reason=disentitled');

-- ============================================================================
-- TEST 5: H2 (broadened) — DELETE of a DISABLED m365_integration row cascades.
-- Prior behavior skipped the cascade when OLD.enabled was false; the broadened trigger fires on ANY
-- m365_integration deletion. Re-enable Org C, add a connection, flip to false WITHOUT cascading
-- (UPDATE trigger suspended), then DELETE the disabled row and assert the connection is cleaned.
-- ============================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select lives_ok(
  $$ select public.operator_toggle_feature('a1490000-0000-0000-0000-000000000003','m365_integration',true) $$,
  'H2-delete setup: re-enable Org C m365_integration (UPDATE false->true, no cascade)');
reset role;

-- A connection for the now-entitled Org C / active User C1 (write-guard passes).
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('a1490000-0000-0000-0000-000000000003','a1490000-0000-0000-0000-0000000000c1',
        '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x21000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');

-- Flip the row to disabled WITHOUT firing the UPDATE cascade (suspend only the AFTER UPDATE trigger;
-- the BEFORE immutability trigger stays — it allows enabled changes).
alter table public.org_features disable trigger m365_disentitle_update_trigger;
update public.org_features set enabled = false
 where org_id = 'a1490000-0000-0000-0000-000000000003' and feature_key = 'm365_integration';
alter table public.org_features enable trigger m365_disentitle_update_trigger;

-- DELETE the disabled m365_integration row -> broadened AFTER DELETE trigger must cascade.
delete from public.org_features
 where org_id = 'a1490000-0000-0000-0000-000000000003' and feature_key = 'm365_integration';

select is(
  (select count(*)::int from public.ms_graph_connections where org_id = 'a1490000-0000-0000-0000-000000000003'),
  0, 'H2 (broadened): DELETE of a DISABLED m365_integration row cascades — connection deleted');

-- ============================================================================
-- TEST 6: H3 — feature_key / org_id are immutable on org_features.
-- ============================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok(
  $$ update public.org_features set feature_key = 'crm'
      where org_id = 'a1490000-0000-0000-0000-000000000001' and feature_key = 'm365_integration' $$,
  '42501', null, 'H3: mutating feature_key raises (row identity is immutable)');
select throws_ok(
  $$ update public.org_features set org_id = 'a1490000-0000-0000-0000-000000000002'
      where org_id = 'a1490000-0000-0000-0000-000000000001' and feature_key = 'm365_integration' $$,
  '42501', null, 'H3: mutating org_id raises (row identity is immutable)');
-- A benign UPDATE (toggling enabled) must NOT raise — operator_toggle_feature upserts those columns.
select lives_ok(
  $$ update public.org_features set enabled = false, updated_at = now()
      where org_id = 'a1490000-0000-0000-0000-000000000001' and feature_key = 'm365_integration' $$,
  'H3: a benign enabled-toggle UPDATE does not raise (only identity columns are immutable)');
reset role;
-- (That benign toggle ALSO cascades Org A — fine, Org A had no connections left after TEST 1.)

-- ============================================================================
-- TEST 7: M3 — entra_tenant_id CHECK rejects dot-segments and all-dot values.
-- Org A is still entitled and Admin A1 is active, so a VALID insert passes the write-guard + CHECK.
-- (TEST 6's benign toggle flipped Org A to disabled; re-enable it first — false->true does NOT
-- cascade, so this is safe.)
-- ============================================================================
update public.org_features set enabled = true
 where org_id = 'a1490000-0000-0000-0000-000000000001' and feature_key = 'm365_integration';

select lives_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
       values ('a1490000-0000-0000-0000-000000000001','a1490000-0000-0000-0000-0000000000a1',
               'contoso.onmicrosoft.com', array['offline_access'], '\x30000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active') $$,
  'M3: a valid verified-domain tenant passes the CHECK');

select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
       values ('a1490000-0000-0000-0000-000000000001','a1490000-0000-0000-0000-0000000000a1',
               '..', array['offline_access'], '\x31000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active') $$,
  '23514', null, 'M3: tenant value ".." rejected by the CHECK (dot-segment)');

select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
       values ('a1490000-0000-0000-0000-000000000001','a1490000-0000-0000-0000-0000000000a1',
               '.', array['offline_access'], '\x32000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active') $$,
  '23514', null, 'M3: all-dot tenant value "." rejected by the CHECK');

-- ============================================================================
-- TEST 8: LOW-2 — p_reason allowlist (22023 on a bogus reason), public RPC + internal _core.
-- ============================================================================
select throws_ok(
  $$ select public.m365_disconnect_cascade('a1490000-0000-0000-0000-000000000001',
                                             'a1490000-0000-0000-0000-0000000000a1',
                                             'bogus_reason') $$,
  '22023', null, 'LOW-2 public RPC: bogus p_reason raises 22023');

select throws_ok(
  $$ select public._m365_disconnect_cascade_core('a1490000-0000-0000-0000-000000000001',
                                                   'a1490000-0000-0000-0000-0000000000a1',
                                                   'also_bogus',
                                                   'a1490000-0000-0000-0000-0000000000a1') $$,
  '22023', null, 'LOW-2 internal _core: bogus p_reason raises 22023');

select * from finish();
rollback;
