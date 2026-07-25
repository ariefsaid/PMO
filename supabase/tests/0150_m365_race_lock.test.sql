-- 0150_m365_race_lock.test.sql
-- AC-M365-160/161/162 [pgTAP]: the C1-RACE closure's DETERMINISTIC behavior — the write-guard's new
-- FOR UPDATE locks do not weaken rejection, and the lifecycle cleanup is now idempotent / self-
-- repairing on the FINAL state (so a stale row from any past race is cleaned the next time the state
-- is re-written).
--
-- What this proves (Luna re-verify round 2 closure):
--   • AC-M365-160: the write-guard STILL rejects an INSERT for a disabled user and a disentitled org
--                  (the FOR UPDATE locks added in 0114 serialize, they do not weaken the check).
--   • AC-M365-161: the offboard trigger now fires whenever NEW.status = 'disabled' (not only on the
--                  active→disabled transition) → re-saving an already-disabled profile REPAIRS a
--                  leftover connection from a past race / legacy data.
--   • AC-M365-162: the disentitle UPDATE branch now fires whenever the FINAL state is
--                  m365_integration + enabled=false (true→false AND false→false) → re-saving false
--                  REPAIRS a leftover connection.
--
-- The actual two-session callback/lifecycle RACE is proven by scripts/m365-race-probe.sh (pgTAP runs
-- in a single transaction and cannot express it). This file covers the deterministic invariants that
-- close holds even without concurrency. Runs as pgTAP superuser.
begin;
select plan(11);

-- ============================================================================
-- SETUP: three orgs (one per AC, no state bleed), users, an operator, entitled orgs.
-- ============================================================================
insert into organizations (id, name) values
  ('a1500000-0000-0000-0000-000000000001','AC-M365-160 Org'),
  ('a1500000-0000-0000-0000-000000000002','AC-M365-161 Org'),
  ('a1500000-0000-0000-0000-000000000003','AC-M365-162 Org');

insert into auth.users (id, email) values
  ('a1500000-0000-0000-0000-0000000000a1','m365-160-u1@example.com'),
  ('a1500000-0000-0000-0000-0000000000a2','m365-160-admin@example.com'),
  ('a1500000-0000-0000-0000-0000000000b1','m365-161-u1@example.com'),
  ('a1500000-0000-0000-0000-0000000000b2','m365-161-admin@example.com'),
  ('a1500000-0000-0000-0000-0000000000c1','m365-162-u1@example.com'),
  ('a1500000-0000-0000-0000-0000000000c2','m365-162-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('a1500000-0000-0000-0000-0000000000a1','a1500000-0000-0000-0000-000000000001','U1','m365-160-u1@example.com','Engineer','active'),
  ('a1500000-0000-0000-0000-0000000000a2','a1500000-0000-0000-0000-000000000001','Admin','m365-160-admin@example.com','Admin','active'),
  ('a1500000-0000-0000-0000-0000000000b1','a1500000-0000-0000-0000-000000000002','U1','m365-161-u1@example.com','Engineer','active'),
  ('a1500000-0000-0000-0000-0000000000b2','a1500000-0000-0000-0000-000000000002','Admin','m365-161-admin@example.com','Admin','active'),
  ('a1500000-0000-0000-0000-0000000000c1','a1500000-0000-0000-0000-000000000003','U1','m365-162-u1@example.com','Engineer','active'),
  ('a1500000-0000-0000-0000-0000000000c2','a1500000-0000-0000-0000-000000000003','Admin','m365-162-admin@example.com','Admin','active');

insert into org_features (org_id, feature_key, enabled, updated_by) values
  ('a1500000-0000-0000-0000-000000000001','m365_integration',true,null),
  ('a1500000-0000-0000-0000-000000000002','m365_integration',true,null),
  ('a1500000-0000-0000-0000-000000000003','m365_integration',true,null);

-- ============================================================================
-- AC-M365-160: write-guard rejection is NOT weakened by the new FOR UPDATE locks.
-- Org 1 / User a1 active + entitled. Disable the user, then assert an INSERT is rejected; flip the
-- user back active but disentitle the org, then assert an INSERT is rejected there too.
-- ============================================================================
-- (a) disable the user → INSERT rejected.
update public.profiles set status = 'disabled' where id = 'a1500000-0000-0000-0000-0000000000a1';
select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
       values ('a1500000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-0000000000a1',
               '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x10000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active') $$,
  '42501', null, 'AC-M365-160 write-guard (locked): INSERT for a DISABLED user is rejected (42501)');

-- (b) re-activate the user but disentitle the org → INSERT rejected.
update public.profiles set status = 'active' where id = 'a1500000-0000-0000-0000-0000000000a1';
update public.org_features set enabled = false
 where org_id = 'a1500000-0000-0000-0000-000000000001' and feature_key = 'm365_integration';
select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
       values ('a1500000-0000-0000-0000-000000000001','a1500000-0000-0000-0000-0000000000a1',
               '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x11000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active') $$,
  '42501', null, 'AC-M365-160 write-guard (locked): INSERT for a DISENTITLED org is rejected (42501)');

-- ============================================================================
-- AC-M365-161: offboard cleanup is idempotent / self-repairing (fire on FINAL state 'disabled').
-- Org 2 / User b1 active + entitled. Offboard (active→disabled) cleans a connection; then a LEFTOVER
-- row is seeded (simulating a stale survivor from a past race) and a re-save of the disabled profile
-- (disabled→disabled, e.g. a name edit) REPAIRS it.
-- ============================================================================
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('a1500000-0000-0000-0000-000000000002','a1500000-0000-0000-0000-0000000000b1',
        '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x20000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');

-- Offboard (active→disabled): the transition trigger cleans the connection.
update public.profiles set status = 'disabled' where id = 'a1500000-0000-0000-0000-0000000000b1';
select is(
  (select count(*)::int from public.ms_graph_connections where user_id = 'a1500000-0000-0000-0000-0000000000b1'),
  0, 'AC-M365-161 setup: active→disabled offboard cleaned the connection');

-- Seed a LEFTOVER (a stale survivor the transition-only trigger of 0111/0113 could not reach). The
-- write-guard would reject this for a disabled user, so suspend it briefly (mirrors 0149 TEST 4).
alter table public.ms_graph_connections disable trigger m365_connection_write_guard;
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('a1500000-0000-0000-0000-000000000002','a1500000-0000-0000-0000-0000000000b1',
        '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x21000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');
alter table public.ms_graph_connections enable trigger m365_connection_write_guard;
select is(
  (select count(*)::int from public.ms_graph_connections where user_id = 'a1500000-0000-0000-0000-0000000000b1'),
  1, 'AC-M365-161 setup: a leftover stale row is present (simulating a past-race survivor)');

-- Re-save the disabled profile by re-asserting the status column (disabled→disabled). Under 0114
-- the trigger is AFTER UPDATE OF status + WHEN NEW.status='disabled', so a status re-save FIRES
-- and REPAIRS the leftover survivor; under the old transition-only WHEN it would NOT fire and the
-- row would survive. (Round-3 LOW narrowed the trigger to OF status — so a non-status edit no
-- longer fires; the realistic repair path is a status write, which admin_set_user_status always
-- issues. The self-repair-on-final-state semantics are preserved.)
update public.profiles set status = 'disabled' where id = 'a1500000-0000-0000-0000-0000000000b1';
select is(
  (select count(*)::int from public.ms_graph_connections where user_id = 'a1500000-0000-0000-0000-0000000000b1'),
  0, 'AC-M365-161 self-repair: re-saving a DISABLED profile (disabled→disabled) cleans the leftover survivor');
select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked' and org_id = 'a1500000-0000-0000-0000-000000000002'
       and detail->>'reason' = 'offboard'
       and detail->>'user_id' = 'a1500000-0000-0000-0000-0000000000b1'),
  2, 'AC-M365-161 self-repair: the repair fire audited reason=offboard (initial + repair)');

-- ============================================================================
-- AC-M365-162: disentitlement cleanup is idempotent / self-repairing (fire on FINAL enabled=false).
-- Org 3 / User c1 active + entitled. Toggle m365 true→false cleans a connection; then a LEFTOVER is
-- seeded and a re-save of the disabled entitlement (false→false) REPAIRS it.
-- ============================================================================
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('a1500000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-0000000000c1',
        '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x30000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');

-- Disentitle (true→false): the transition cascade cleans the connection.
update public.org_features set enabled = false
 where org_id = 'a1500000-0000-0000-0000-000000000003' and feature_key = 'm365_integration';
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = 'a1500000-0000-0000-0000-000000000003'),
  0, 'AC-M365-162 setup: true→false disentitlement cleaned the connection');

-- Seed a LEFTOVER (the write-guard would reject this for a disentitled org, so suspend it briefly).
alter table public.ms_graph_connections disable trigger m365_connection_write_guard;
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('a1500000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-0000000000c1',
        '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x31000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');
alter table public.ms_graph_connections enable trigger m365_connection_write_guard;
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = 'a1500000-0000-0000-0000-000000000003'),
  1, 'AC-M365-162 setup: a leftover stale row is present (simulating a past-race survivor)');

-- Re-save the disabled entitlement by re-asserting enabled=false (false→false). Under 0114 the
-- UPDATE trigger is AFTER UPDATE OF enabled + the body fires on FINAL enabled=false, so an enabled
-- re-save REPAIRS the leftover survivor; under the old true→false-only branch it would NOT fire.
-- (Round-3 LOW narrowed the trigger to OF enabled; operator_toggle_feature always SETs enabled, so
-- the lifecycle repair path still fires. The self-repair-on-final-state semantics are preserved.)
update public.org_features set enabled = false
 where org_id = 'a1500000-0000-0000-0000-000000000003' and feature_key = 'm365_integration';
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = 'a1500000-0000-0000-0000-000000000003'),
  0, 'AC-M365-162 self-repair: re-saving a disabled entitlement (false→false) cleans the leftover survivor');
select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked' and org_id = 'a1500000-0000-0000-0000-000000000003'
       and detail->>'reason' = 'disentitled'),
  2, 'AC-M365-162 self-repair: the repair fire audited reason=disentitled (initial + repair)');

-- Sanity: enabling the entitlement (false→true) must NEVER cascade (no recursion / no false cleanup).
update public.org_features set enabled = true
 where org_id = 'a1500000-0000-0000-0000-000000000003' and feature_key = 'm365_integration';
-- Insert a fresh entitled connection, then toggle false→true again (a benign re-enable): it survives.
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('a1500000-0000-0000-0000-000000000003','a1500000-0000-0000-0000-0000000000c1',
        '11111111-2222-3333-4444-555555555555', array['offline_access'], '\x32000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');
update public.org_features set enabled = true
 where org_id = 'a1500000-0000-0000-0000-000000000003' and feature_key = 'm365_integration';
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = 'a1500000-0000-0000-0000-000000000003'),
  1, 'AC-M365-162 (no false cleanup): enabling / re-enabling never cascades — the entitled connection survives');

select * from finish();
rollback;
