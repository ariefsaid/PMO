-- 0153_m365_connection_oid_write_once.test.sql
-- AC-M365-174 [pgTAP]: the entra_user_object_id WRITE-ONCE column trigger (0115) — the structural
-- enforcement for the TOFU + enforce-on-reconnect owner decision (2026-07-17). Makes Microsoft-user-
-- identity re-binding IMPOSSIBLE at the DB boundary, complementing the callback's best-effort TOFU
-- pre-check (a callback-only check is TOCTOU-vulnerable; the trigger fires for every role incl.
-- service_role and RLS bypass does not skip triggers).
--
-- What this proves (AC-M365-174):
--   • NULL → value        ALLOWED   (the first connect PINS the identity — trust-on-first-use)
--   • value → same value  ALLOWED   (reconnect with the SAME Microsoft identity; unrelated column
--                                    updates also work — the trigger only guards entra_user_object_id)
--   • value → different   REJECTED  (identity rebind — same-tenant consent-phishing indicator;
--                                    errcode 42501 'identity_rebind_forbidden', oid unchanged)
--   • value → NULL        REJECTED  (cannot un-pin the identity; would allow re-TOFU on reconnect)
--   • the production reconnect path — m365_upsert_connection's ON CONFLICT DO UPDATE — obeys the
--     same rule (same oid rotates tokens; a different oid raises 42501 'identity_rebind_forbidden').
--
-- Runs as pgTAP superuser (triggers fire regardless of role). The write-guard (0111) also fires on
-- these writes; the fixture user is active + the org entitled so it permits them, isolating the
-- write-once behavior under test. throws_ok catches each exception in a subtransaction so the outer
-- transaction survives for the post-state assertions.
begin;
select plan(15);

-- ============================================================================
-- SETUP: one active + entitled org/user. The connection row starts with a NULL entra_user_object_id
-- (the legacy / pre-feature shape, or the moment between INSERT and the first oid-bearing connect).
-- ============================================================================
insert into organizations (id, name) values
  ('a1530000-0000-0000-0000-000000000001','AC-M365-174 Org');
insert into auth.users (id, email) values
  ('a1530000-0000-0000-0000-0000000000a1','m365-174@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('a1530000-0000-0000-0000-0000000000a1','a1530000-0000-0000-0000-000000000001','U','m365-174@example.com','Engineer','active');
insert into org_features (org_id, feature_key, enabled, updated_by) values
  ('a1530000-0000-0000-0000-000000000001','m365_integration',true,null);

-- A NULL-oid connection (the TOFU starting state). Created via a direct INSERT (superuser) — the
-- write-guard permits it (active user + entitled org); the write-once trigger does not fire on INSERT.
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, entra_user_object_id, scopes, refresh_token_ciphertext, key_id, status)
values
  ('a1530000-0000-0000-0000-000000000001','a1530000-0000-0000-0000-0000000000a1',
   '11111111-2222-3333-4444-555555555555', null, array['offline_access'], '\x00'::bytea, 'kek-v1', 'active');
select is(count(*)::int, 1, 'AC-M365-174 setup: a NULL-oid connection exists')
  from public.ms_graph_connections
 where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1';

-- ============================================================================
-- AC-M365-174a: NULL → value is ALLOWED (the first connect PINS the identity — TOFU).
-- ============================================================================
select lives_ok(
  $$update public.ms_graph_connections set entra_user_object_id = 'oid-tofu-1'
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'$$,
  'AC-M365-174a TOFU: NULL → value is ALLOWED (the first connect pins the identity)');
select is(
  (select entra_user_object_id from public.ms_graph_connections
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'),
  'oid-tofu-1',
  'AC-M365-174a TOFU: the identity is now PINNED to oid-tofu-1');

-- ============================================================================
-- AC-M365-174b: value → same value is ALLOWED, and unrelated column updates still work (the trigger
-- guards ONLY entra_user_object_id — a reconnect rotates the refresh token with the SAME oid).
-- ============================================================================
select lives_ok(
  $$update public.ms_graph_connections set refresh_token_ciphertext = '\xaa'::bytea, status = 'active'
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'$$,
  'AC-M365-174b: an UNRELATED column update (refresh rotation, same oid) is ALLOWED');
select is(
  (select refresh_token_ciphertext from public.ms_graph_connections
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'),
  '\xaa'::bytea,
  'AC-M365-174b: the unrelated update MUTATED refresh_token_ciphertext (trigger did not block it)');
select is(
  (select entra_user_object_id from public.ms_graph_connections
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'),
  'oid-tofu-1',
  'AC-M365-174b: entra_user_object_id is UNCHANGED by the unrelated update (still oid-tofu-1)');

-- ============================================================================
-- AC-M365-174c: value → different value is REJECTED (identity rebind — 42501 identity_rebind_forbidden).
-- ============================================================================
select throws_ok(
  $$update public.ms_graph_connections set entra_user_object_id = 'oid-attacker'
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'$$,
  '42501', 'identity_rebind_forbidden',
  'AC-M365-174c: value → DIFFERENT value RAISES 42501 identity_rebind_forbidden (identity rebind blocked)');
select is(
  (select entra_user_object_id from public.ms_graph_connections
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'),
  'oid-tofu-1',
  'AC-M365-174c: the rejected rebind did NOT change entra_user_object_id (still oid-tofu-1)');

-- ============================================================================
-- AC-M365-174d: value → NULL is REJECTED (cannot un-pin the identity — would allow re-TOFU).
-- ============================================================================
select throws_ok(
  $$update public.ms_graph_connections set entra_user_object_id = null
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'$$,
  '42501', 'identity_rebind_forbidden',
  'AC-M365-174d: value → NULL RAISES 42501 identity_rebind_forbidden (cannot un-pin the identity)');
select is(
  (select entra_user_object_id from public.ms_graph_connections
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'),
  'oid-tofu-1',
  'AC-M365-174d: the rejected nullify did NOT change entra_user_object_id (still oid-tofu-1)');

-- ============================================================================
-- AC-M365-174e: the PRODUCTION reconnect path obeys the rule. m365_upsert_connection's
-- ON CONFLICT (org_id, user_id) DO UPDATE with the SAME oid rotates the tokens (value → same = ALLOWED).
-- ============================================================================
select is(
  public.m365_upsert_connection(
    'a1530000-0000-0000-0000-000000000001','a1530000-0000-0000-0000-0000000000a1',
    '11111111-2222-3333-4444-555555555555','oid-tofu-1',array['offline_access'],
    '\xbb'::bytea,'\xcc'::bytea,now(),'kek-v1',now(),now()) is not null,
  true,
  'AC-M365-174e: a reconnect via m365_upsert_connection with the SAME oid SUCCEEDS (rotates tokens)');
select is(
  (select refresh_token_ciphertext from public.ms_graph_connections
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'),
  '\xbb'::bytea,
  'AC-M365-174e: the same-oid reconnect ROTATED refresh_token_ciphertext (0xbb)');
select is(
  (select entra_user_object_id from public.ms_graph_connections
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'),
  'oid-tofu-1',
  'AC-M365-174e: the same-oid reconnect left entra_user_object_id PINNED (still oid-tofu-1)');

-- ============================================================================
-- AC-M365-174f: the PRODUCTION reconnect path with a DIFFERENT oid is REJECTED — the RPC propagates
-- the write-once trigger's 42501 identity_rebind_forbidden. This is the exact path a same-tenant
-- consent-phisher would take (initiate connect, phish the authorize URL to a victim in the same
-- Entra tenant, victim's oid differs from the pinned value).
-- ============================================================================
select throws_ok(
  $$select public.m365_upsert_connection(
    'a1530000-0000-0000-0000-000000000001','a1530000-0000-0000-0000-0000000000a1',
    '11111111-2222-3333-4444-555555555555','oid-attacker',array['offline_access'],
    '\xdd'::bytea,'\xee'::bytea,now(),'kek-v1',now(),now())$$,
  '42501', 'identity_rebind_forbidden',
  'AC-M365-174f: m365_upsert_connection with a DIFFERENT oid RAISES 42501 identity_rebind_forbidden (RPC propagates the write-once trigger)');
select is(
  (select entra_user_object_id from public.ms_graph_connections
    where org_id='a1530000-0000-0000-0000-000000000001' and user_id='a1530000-0000-0000-0000-0000000000a1'),
  'oid-tofu-1',
  'AC-M365-174f: the rejected rebind reconnect did NOT change entra_user_object_id (still oid-tofu-1)');

select * from finish();
rollback;
