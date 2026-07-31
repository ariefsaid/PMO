-- 0178_m365_member_gate.test.sql
-- AC-M365SEP-004 [pgTAP] — a member whose auth.users.banned_until is in the future has
--   is_active_member() = false, so the org_features RLS read (org_features_select conjoins
--   is_active_member()) returns no row. This is the DB half of the membership rule: the edge-fn
--   explicit status check (NFR-M365SEP-002, proven in unit) covers profiles.status; banned_until
--   is covered here, at the DB layer. Without this, a raw-banned caller (status left 'active')
--   would still pass the edge-fn status check and be stopped ONLY by this RLS — the same accidental
--   protection §1.4 flags, kept load-bearing at the DB layer.
-- AC-M365SEP-008 [pgTAP] — cross-org isolation on ms_graph_connections. The table is SERVER-ONLY:
--   RLS forced with NO policy and `revoke all` from client roles (0106). So no client JWT — of either
--   org — can read or write ANY connection row; the service-role edge fn (unit-tested to scope by
--   org_id + user_id) is the sole accessor. This is the DB-layer guarantee that "only A's row is read
--   or written": a client cannot subvert the edge-fn scoping by going around it. (Complements 0146,
--   which proves the WRITE path resolves org_id under caller-JWT RLS.)
-- AC-M365SEP-010 [pgTAP] — a PM cannot enable m365_integration: operator_toggle_feature raises
--   'operator_only', and a direct INSERT is denied by org_features_write (is_operator() and
--   is_active_member()). NON-REGRESSION: the data-access de-gate (step 3) must NOT touch the
--   Operator-only ENTITLEMENT authority (step 1) — two gates, never one decision (NFR-M365SEP-001).
begin;
create extension if not exists pgtap;
select plan(23);

-- ── Fixtures (inserted as table owner, RLS bypassed) ────────────────────────────────────────────
insert into organizations (id, name) values
  ('01780000-0000-0000-0000-000000000001','M365SEP Org A'),
  ('01780000-0000-0000-0000-000000000002','M365SEP Org B');

-- 0a1 = raw-banned (status active, banned_until in the FUTURE — the manual-ban gap 0095 closed).
-- 0a2 = control (active, never banned). 0b1/0b2 = connected members (one per org). 0c1 = a PM.
insert into auth.users (id, email, banned_until) values
  ('01780000-0000-0000-0000-0000000000a1','m365sep-banned@example.com', now() + interval '1 day'),
  ('01780000-0000-0000-0000-0000000000a2','m365sep-control@example.com', null),
  ('01780000-0000-0000-0000-0000000000a3','m365sep-disabled@example.com', null),
  ('01780000-0000-0000-0000-0000000000b1','m365sep-conn-a@example.com', null),
  ('01780000-0000-0000-0000-0000000000b2','m365sep-conn-b@example.com', null),
  ('01780000-0000-0000-0000-0000000000c1','m365sep-pm@example.com', null);

insert into profiles (id, org_id, full_name, email, role, status) values
  ('01780000-0000-0000-0000-0000000000a1','01780000-0000-0000-0000-000000000001','Banned','m365sep-banned@example.com','Project Manager','active'),
  ('01780000-0000-0000-0000-0000000000a2','01780000-0000-0000-0000-000000000001','Control','m365sep-control@example.com','Project Manager','active'),
  ('01780000-0000-0000-0000-0000000000a3','01780000-0000-0000-0000-000000000001','Disabled','m365sep-disabled@example.com','Project Manager','disabled'),
  ('01780000-0000-0000-0000-0000000000b1','01780000-0000-0000-0000-000000000001','Conn A','m365sep-conn-a@example.com','Admin','active'),
  ('01780000-0000-0000-0000-0000000000b2','01780000-0000-0000-0000-000000000002','Conn B','m365sep-conn-b@example.com','Admin','active'),
  ('01780000-0000-0000-0000-0000000000c1','01780000-0000-0000-0000-000000000001','PM','m365sep-pm@example.com','Project Manager','active');

-- Both orgs entitled for m365_integration (also satisfies the m365_connection_write_guard for the
-- AC-008 connection inserts below).
insert into org_features (org_id, feature_key, enabled) values
  ('01780000-0000-0000-0000-000000000001','m365_integration',true),
  ('01780000-0000-0000-0000-000000000002','m365_integration',true);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-M365SEP-004 — banned_until in the future ⇒ is_active_member() false ⇒ org_features read empty.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01780000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(public.is_active_member(), false,
  'AC-M365SEP-004 a member whose banned_until is in the future has is_active_member() = false (status is active; the ban is the disqualifier)');
select is(
  (select count(*)::int from public.org_features where feature_key = 'm365_integration'),
  0,
  'AC-M365SEP-004 a banned caller''s org_features read returns NO row — org_features_select conjoins is_active_member(), so the entitlement row is hidden');
reset role;

-- AC-M365SEP-003/004 — RLS hides both disabled and banned profiles, so a caller-JWT-only mock
-- cannot prove their distinct state. The service-side membership read is deliberately the only
-- privileged classifier and must still distinguish the two states without relaxing profiles_select.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01780000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.profiles where id = '01780000-0000-0000-0000-0000000000a3'), 0,
  'AC-M365SEP-003 disabled caller reads NO profile row under real profiles_select RLS');
set local request.jwt.claims = '{"sub":"01780000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from public.profiles where id = '01780000-0000-0000-0000-0000000000a1'), 0,
  'AC-M365SEP-004 banned caller reads NO profile row under real profiles_select RLS');
reset role;

set local role service_role;
select is((public.m365_membership_state('01780000-0000-0000-0000-0000000000a3')->>'state'), 'disabled',
  'AC-M365SEP-003 service-side membership read classifies a disabled member distinctly');
select is((public.m365_membership_state('01780000-0000-0000-0000-0000000000a1')->>'state'), 'banned',
  'AC-M365SEP-004 service-side membership read classifies a raw-banned member distinctly');
select is((public.m365_membership_state('01780000-0000-0000-0000-0000000000a2')->>'state'), 'active',
  'AC-M365SEP-003/004 service-side membership read preserves the active control state');
reset role;

-- Control: the SAME org, an active never-banned member reads the entitled row. Proves it is the
-- ban (not the org, not the status) that hides the row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01780000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(public.is_active_member(), true,
  'AC-M365SEP-004 control: an active, never-banned member of the same org has is_active_member() = true');
select is(
  (select count(*)::int from public.org_features where feature_key = 'm365_integration'),
  1,
  'AC-M365SEP-004 control: that active member reads the entitled row — the ban was the only difference');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-M365SEP-008 — cross-org isolation on ms_graph_connections (the table is server-only).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Premise: two connections exist (service-role writes, RLS-bypassed by the owner; the write-guard
-- is satisfied — both users active, both orgs entitled).
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values
  ('01780000-0000-0000-0000-000000000001','01780000-0000-0000-0000-0000000000b1',
   'tenant-a', array['Files.Read','offline_access'], '\x01000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active'),
  ('01780000-0000-0000-0000-000000000002','01780000-0000-0000-0000-0000000000b2',
   'tenant-b', array['Files.Read','offline_access'], '\x02000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');

select is(
  (select count(*)::int from public.ms_graph_connections),
  2,
  'AC-M365SEP-008 premise: two connections exist — one per org (org A/user A, org B/user B)');

-- A client JWT of org A cannot read ANY connection row: the table has NO policy and `revoke all`
-- from authenticated (0106). The edge fn (service_role, scoped by org_id+user_id) is the sole reader.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ select count(*) from public.ms_graph_connections $$,
  '42501', null,
  'AC-M365SEP-008 a client of org A CANNOT read ms_graph_connections — the table is server-only (the edge-fn org_id+user_id scoping is the only read path)');
-- A client JWT of org B likewise cannot read any row — cross-org isolation is total at the DB layer:
-- no client reaches another org''s connection, or even their own.
set local request.jwt.claims = '{"sub":"01780000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok(
  $$ select count(*) from public.ms_graph_connections $$,
  '42501', null,
  'AC-M365SEP-008 a client of org B CANNOT read org A''s connection either — no client JWT reads any connection row');
-- Write isolation: a client cannot write a connection either.
set local request.jwt.claims = '{"sub":"01780000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ insert into public.ms_graph_connections (org_id, user_id, entra_tenant_id, refresh_token_ciphertext, key_id)
     values ('01780000-0000-0000-0000-000000000001','01780000-0000-0000-0000-0000000000b1','t','\x09000000000000000000000000000000000000000000000000000000'::bytea,'k') $$,
  '42501', null,
  'AC-M365SEP-008 a client CANNOT write a connection — only the service-role edge fn writes (with org_id+user_id scoping)');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- AC-M365SEP-010 — a PM cannot enable m365_integration (Operator-only entitlement; non-regression).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01780000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok(
  $$ select public.operator_toggle_feature('01780000-0000-0000-0000-000000000001','m365_integration',true) $$,
  '42501', 'operator_only',
  'AC-M365SEP-010 a PM CANNOT enable m365_integration via operator_toggle_feature — Operator-only entitlement (the data-access de-gate must not touch entitlement authority)');
select throws_ok(
  $$ insert into public.org_features (org_id, feature_key, enabled) values ('01780000-0000-0000-0000-000000000001','m365_integration',true) $$,
  '42501', null,
  'AC-M365SEP-010 a PM CANNOT directly INSERT an org_features row — org_features_write stays is_operator() and is_active_member() (non-regression)');
reset role;
select is(
  (select count(*)::int from public.org_features where org_id = '01780000-0000-0000-0000-000000000001' and feature_key = 'm365_integration'),
  1,
  'AC-M365SEP-010 no extra m365_integration row — entitlement authority is untouched by the step-3 data-access de-gate');

-- AC-M365-165 / FIX-2 — a direct auth.users ban transition must revoke both the pending OAuth
-- credential and the already-stored connection, even while profiles.status remains active.
insert into public.m365_pkce_states (org_id, user_id, code_verifier, state, scopes, expires_at)
values ('01780000-0000-0000-0000-000000000001', '01780000-0000-0000-0000-0000000000a2',
        'verifier-ban-regression', 'state-ban-regression', array['Files.Read'], now() + interval '10 minutes');
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id, status)
values ('01780000-0000-0000-0000-000000000001', '01780000-0000-0000-0000-0000000000a2',
        'tenant-ban-regression', array['Files.Read'], '\x01000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');
select is((select count(*)::int from public.m365_pkce_states where state = 'state-ban-regression'), 1,
  'AC-M365-165 setup: an active member has an outstanding PKCE state before the raw ban');
select is((select count(*)::int from public.ms_graph_connections where user_id = '01780000-0000-0000-0000-0000000000a2'), 1,
  'AC-M365-165 setup: an active member has a connection before the raw ban');
update auth.users set banned_until = now() + interval '1 day'
 where id = '01780000-0000-0000-0000-0000000000a2';
select is((select count(*)::int from public.m365_pkce_states where state = 'state-ban-regression'), 0,
  'AC-M365-165 direct auth.users ban deletes pending PKCE state');
select is((select count(*)::int from public.ms_graph_connections where user_id = '01780000-0000-0000-0000-0000000000a2'), 0,
  'AC-M365-165 direct auth.users ban deletes the connection');
select throws_ok(
  $$ select public.m365_upsert_connection(
       '01780000-0000-0000-0000-000000000001','01780000-0000-0000-0000-0000000000a2',
       'tenant-ban-regression','oid-ban',array['Files.Read'],
       '\x01000000000000000000000000000000000000000000000000000000'::bytea,
       '\x02000000000000000000000000000000000000000000000000000000'::bytea,now(),'kek-v1',now(),now()) $$,
  '42501', null,
  'AC-M365-165 banned_until is enforced by the connection write guard even when profiles.status remains active');

-- AC-M365-166 / FIX-5 — the transient state table has a durable per-user cap even if the
-- fail-open request limiter is unavailable.
insert into public.m365_pkce_states (org_id, user_id, code_verifier, state, scopes, expires_at)
select '01780000-0000-0000-0000-000000000001', '01780000-0000-0000-0000-0000000000a1',
       'cap-verifier-' || n, 'cap-state-' || n, array['Files.Read'], now() + interval '10 minutes'
  from generate_series(1, 5) as n;
select is((select count(*)::int from public.m365_pkce_states where user_id = '01780000-0000-0000-0000-0000000000a1'), 5,
  'AC-M365-166 five outstanding PKCE states are allowed for one user');
select throws_ok(
  $$ insert into public.m365_pkce_states (org_id, user_id, code_verifier, state, scopes, expires_at)
     values ('01780000-0000-0000-0000-000000000001','01780000-0000-0000-0000-0000000000a1','cap-overflow','cap-overflow',array['Files.Read'],now()+interval '10 minutes') $$,
  'P0001', 'm365_pkce_state_limit',
  'AC-M365-166 the sixth outstanding PKCE state is rejected by the per-user cap');

select * from finish();
rollback;
