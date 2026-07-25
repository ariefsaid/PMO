-- 0154_ms_graph_connections_lockdown.test.sql
-- AC-M365-001 [pgTAP]: ms_graph_connections is server-only — RLS enabled+forced, ZERO policies, and
-- an authenticated (non-service_role) JWT is denied SELECT/INSERT/UPDATE (FR-M365-002, NFR-M365-004).
begin;
select plan(6);

insert into organizations (id, name) values
  ('01420000-0000-0000-0000-000000000001','AC-M365-001 Org');
insert into auth.users (id, email) values
  ('01420000-0000-0000-0000-0000000000a1','m365-lockdown@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01420000-0000-0000-0000-0000000000a1','01420000-0000-0000-0000-000000000001','M365 User','m365-lockdown@example.com','Admin');

-- 0113 C1(b) write-guard requires an enabled m365_integration entitlement for any connection INSERT.
insert into org_features (org_id, feature_key, enabled)
values ('01420000-0000-0000-0000-000000000001','m365_integration',true);

-- Seed a connection AS THE TABLE OWNER (the service_role/edge-fn write path bypasses RLS).
insert into public.ms_graph_connections
  (org_id, user_id, entra_tenant_id, scopes, refresh_token_ciphertext, key_id)
values
  ('01420000-0000-0000-0000-000000000001','01420000-0000-0000-0000-0000000000a1',
   'tid-1', array['offline_access','Files.Read'], '\x00000000000000000000000000000000000000000000000000000000'::bytea, 'kek-v1');

select is((select relrowsecurity   from pg_class where oid = 'public.ms_graph_connections'::regclass),
          true, 'AC-M365-001 RLS is enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.ms_graph_connections'::regclass),
          true, 'AC-M365-001 RLS is forced');
select is((select count(*)::int from pg_policies
             where schemaname = 'public' and tablename = 'ms_graph_connections'),
          0, 'AC-M365-001 the table has ZERO policies (no client-readable policy)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01420000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select * from public.ms_graph_connections $$,
  '42501', null, 'AC-M365-001 authenticated SELECT denied (no grant, no policy)');
select throws_ok(
  $$ insert into public.ms_graph_connections (org_id,user_id,entra_tenant_id,refresh_token_ciphertext,key_id)
     values ('01420000-0000-0000-0000-000000000001','01420000-0000-0000-0000-0000000000a1','t','\x00000000000000000000000000000000000000000000000000000000'::bytea,'k') $$,
  '42501', null, 'AC-M365-001 authenticated INSERT denied');
select throws_ok(
  $$ update public.ms_graph_connections set status = 'revoked' $$,
  '42501', null, 'AC-M365-001 authenticated UPDATE denied');

reset role;
select * from finish();
rollback;
