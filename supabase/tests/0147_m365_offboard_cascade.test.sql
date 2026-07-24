-- 0147_m365_offboard_cascade.test.sql
-- AC-M365-121 [pgTAP]: offboard/disentitlement cascade deletes ms_graph_connections and audits.
-- Ties into the existing admin_set_user_status (0065) + operator_toggle_feature (0070).
-- The cascade is a new security-definer RPC: public.m365_disconnect_cascade(p_org_id, p_user_id?, p_reason).
begin;
select plan(7);

-- Setup two orgs with active connections.
insert into organizations (id, name) values
  ('01470000-0000-0000-0000-000000000001','AC-M365-121 Org A'),
  ('01470000-0000-0000-0000-000000000002','AC-M365-121 Org B');
insert into auth.users (id, email) values
  ('01470000-0000-0000-0000-0000000000a1','m365-cascade-a@example.com'),
  ('01470000-0000-0000-0000-0000000000b1','m365-cascade-b@example.com'),
  ('01470000-0000-0000-0000-0000000000c1','m365-admin-b@example.com'),
  ('00000000-0000-0000-0000-0000000000f1','m365-operator@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01470000-0000-0000-0000-0000000000a1','01470000-0000-0000-0000-000000000001','User A','m365-cascade-a@example.com','Admin'),
  ('01470000-0000-0000-0000-0000000000b1','01470000-0000-0000-0000-000000000002','User B','m365-cascade-b@example.com','Admin'),
  ('01470000-0000-0000-0000-0000000000c1','01470000-0000-0000-0000-000000000002','Admin B','m365-admin-b@example.com','Admin'),
  ('00000000-0000-0000-0000-0000000000f1','01470000-0000-0000-0000-000000000001','Operator','m365-operator@example.com','Admin');

-- 0113 C1(b) write-guard requires an enabled m365_integration entitlement in each org.
insert into org_features (org_id, feature_key, enabled) values
  ('01470000-0000-0000-0000-000000000001','m365_integration',true),
  ('01470000-0000-0000-0000-000000000002','m365_integration',true);

insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01470000-0000-0000-0000-000000000001','01470000-0000-0000-0000-0000000000a1',
   'tenant-a', array['offline_access','Files.Read'], '\x01000000000000000000000000000000000000000000000000000000'::bytea, '\x02000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active'),
  ('01470000-0000-0000-0000-000000000002','01470000-0000-0000-0000-0000000000b1',
   'tenant-b', array['offline_access','Files.Read'], '\x03000000000000000000000000000000000000000000000000000000'::bytea, '\x04000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');

-- (1) Operator disentitles Org A (m365_integration = false) → cascade deletes Org A's connection only.
-- Insert operator BEFORE setting role (runs as superuser, bypasses RLS on platform_operators).
insert into platform_operators (user_id) values ('00000000-0000-0000-0000-0000000000f1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}';

-- Call the cascade RPC (Operator path, reason='disentitled').
select lives_ok(
  $$ select public.m365_disconnect_cascade('01470000-0000-0000-0000-000000000001', null, 'disentitled') $$,
  'AC-M365-121 Operator cascade on org disentitlement succeeds');

-- Verify counts as superuser (ms_graph_connections has no client-readable policy).
reset role;
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01470000-0000-0000-0000-000000000001'),
  0, 'AC-M365-121 Org A connection deleted by cascade');
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01470000-0000-0000-0000-000000000002'),
  1, 'AC-M365-121 Org B connection untouched (org-scoped)');

-- Audit row for Org A's connection.
select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked' and org_id = '01470000-0000-0000-0000-000000000001'
       and detail->>'reason' = 'disentitled'),
  1, 'AC-M365-121 audit event recorded with reason=disentitled');

-- (2) Admin in Org B offboards User B via cascade RPC directly (reason='offboard').
-- Ensure User B has a fresh connection.
delete from public.ms_graph_connections where user_id = '01470000-0000-0000-0000-0000000000b1';
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01470000-0000-0000-0000-000000000002','01470000-0000-0000-0000-0000000000b1',
   'tenant-b', array['offline_access','Files.Read'], '\x05000000000000000000000000000000000000000000000000000000'::bytea, '\x06000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1', 'active');

-- Admin B calls cascade RPC for User B (Admin path, reason='offboard').
set local role authenticated;
set local request.jwt.claims = '{"sub":"01470000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select lives_ok(
  $$ select public.m365_disconnect_cascade('01470000-0000-0000-0000-000000000002', '01470000-0000-0000-0000-0000000000b1', 'offboard') $$,
  'AC-M365-121 Admin cascade on user offboard succeeds');
reset role;

-- Verify connection deleted as superuser.
select is(
  (select count(*)::int from public.ms_graph_connections where user_id = '01470000-0000-0000-0000-0000000000b1'),
  0, 'AC-M365-121 User B connection deleted by offboard cascade');
select is(
  (select count(*)::int from public.audit_events
     where action = 'm365.connection.revoked' and org_id = '01470000-0000-0000-0000-000000000002'
       and detail->>'reason' = 'offboard'),
  1, 'AC-M365-121 audit event recorded with reason=offboard');

select * from finish();
rollback;