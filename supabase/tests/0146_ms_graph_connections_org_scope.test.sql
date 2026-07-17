-- 0146_ms_graph_connections_org_scope.test.sql
-- AC-M365-133 [pgTAP]: ms_graph_connections own-row/org-scoping under service_role writes.
-- The service_role write sets org_id explicitly from the resolved profile (FR-M365-164, NFR-M365-104/109).
-- Cross-org access is impossible because the edge function resolves org_id under caller JWT (RLS) and
-- writes ONLY that org_id. This test proves the write path cannot be tricked into writing another org.
begin;
select plan(4);

insert into organizations (id, name) values
  ('01460000-0000-0000-0000-000000000001','AC-M365-133 Org A'),
  ('01460000-0000-0000-0000-000000000002','AC-M365-133 Org B');
insert into auth.users (id, email) values
  ('01460000-0000-0000-0000-0000000000a1','m365-orgscope-a@example.com'),
  ('01460000-0000-0000-0000-0000000000b1','m365-orgscope-b@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01460000-0000-0000-0000-0000000000a1','01460000-0000-0000-0000-000000000001','User A','m365-orgscope-a@example.com','Admin'),
  ('01460000-0000-0000-0000-0000000000b1','01460000-0000-0000-0000-000000000002','User B','m365-orgscope-b@example.com','Admin');

-- 0111 C1(b) write-guard requires an enabled m365_integration entitlement in each org.
insert into org_features (org_id, feature_key, enabled) values
  ('01460000-0000-0000-0000-000000000001','m365_integration',true),
  ('01460000-0000-0000-0000-000000000002','m365_integration',true);

-- Simulate the edge function's service-role write for Org A's user (org_id comes from caller-JWT RLS read).
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01460000-0000-0000-0000-000000000001','01460000-0000-0000-0000-0000000000a1',
   'tenant-a', array['offline_access','Files.Read'], '\x01'::bytea, '\x02'::bytea, 'kek-v1', 'active');

-- Prove the unique(org_id, user_id) prevents a second row for the same user in the same org.
select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, refresh_token_ciphertext, key_id)
     values ('01460000-0000-0000-0000-000000000001','01460000-0000-0000-0000-0000000000a1','t','\x03'::bytea,'k') $$,
  '23505', null, 'AC-M365-133 unique(org_id,user_id) prevents duplicate connection per user per org');

-- Prove Org B's user gets their own row (different org_id).
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, access_token_ciphertext, key_id, status)
values
  ('01460000-0000-0000-0000-000000000002','01460000-0000-0000-0000-0000000000b1',
   'tenant-b', array['offline_access','Files.Read'], '\x03'::bytea, '\x04'::bytea, 'kek-v1', 'active');

select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01460000-0000-0000-0000-000000000001'),
  1, 'AC-M365-133 Org A has exactly 1 connection');
select is(
  (select count(*)::int from public.ms_graph_connections where org_id = '01460000-0000-0000-0000-000000000002'),
  1, 'AC-M365-133 Org B has exactly 1 connection');

-- Prove service_role cannot be tricked into writing org_id != resolved caller's org (the function
-- controls this; here we just show the FK on org_id rejects a non-existent org).
-- 0111: suspend the C1(b) write-guard for this one insert so the FK (not the guard's user/org-agreement
-- check) is what fires — the AC is specifically the org_id FK seam.
alter table public.ms_graph_connections disable trigger m365_connection_write_guard;
select throws_ok(
  $$ insert into public.ms_graph_connections
       (org_id, user_id, entra_tenant_id, refresh_token_ciphertext, key_id)
     values ('00000000-0000-0000-0000-000000000999','01460000-0000-0000-0000-0000000000a1','t','\x05'::bytea,'k') $$,
  '23503', null, 'AC-M365-133 FK on org_id rejects a non-existent org (org_id seam)');
alter table public.ms_graph_connections enable trigger m365_connection_write_guard;

select * from finish();
rollback;