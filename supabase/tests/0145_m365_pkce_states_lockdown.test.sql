-- 0145_m365_pkce_states_lockdown.test.sql
-- AC-M365-101 [pgTAP]: m365_pkce_states is server-only — RLS enabled+forced, ZERO policies, and
-- an authenticated (non-service_role) JWT is denied SELECT/INSERT/UPDATE (FR-M365-101, NFR-M365-104).
-- AC-M365-142 [pgTAP]: state column has UNIQUE constraint (single-use enforcement).
begin;
select plan(7);

insert into organizations (id, name) values
  ('01450000-0000-0000-0000-000000000001','AC-M365-101 Org');
insert into auth.users (id, email) values
  ('01450000-0000-0000-0000-0000000000a1','m365-pkce-lockdown@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01450000-0000-0000-0000-0000000000a1','01450000-0000-0000-0000-000000000001','PKCE User','m365-pkce-lockdown@example.com','Admin');

-- Seed a PKCE state AS THE TABLE OWNER (service_role write path bypasses RLS).
insert into public.m365_pkce_states
  (org_id, user_id, code_verifier, state, scopes, expires_at)
values
  ('01450000-0000-0000-0000-000000000001','01450000-0000-0000-0000-0000000000a1',
   'verifier-abc', 'state-xyz', array['offline_access','Files.Read'], now() + interval '10 minutes');

select is((select relrowsecurity   from pg_class where oid = 'public.m365_pkce_states'::regclass),
          true, 'AC-M365-101 RLS is enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.m365_pkce_states'::regclass),
          true, 'AC-M365-101 RLS is forced');
select is((select count(*)::int from pg_policies
             where schemaname = 'public' and tablename = 'm365_pkce_states'),
          0, 'AC-M365-101 the table has ZERO policies (no client-readable policy)');
select is(
  (select count(*)::int from information_schema.table_constraints
     where constraint_schema = 'public' and table_name = 'm365_pkce_states'
       and constraint_type = 'UNIQUE' and constraint_name like '%state%'),
  1, 'AC-M365-142 state column has UNIQUE constraint (single-use)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01450000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ select * from public.m365_pkce_states $$,
  '42501', null, 'AC-M365-101 authenticated SELECT denied (no grant, no policy)');
select throws_ok(
  $$ insert into public.m365_pkce_states (org_id,user_id,code_verifier,state,expires_at)
     values ('01450000-0000-0000-0000-000000000001','01450000-0000-0000-0000-0000000000a1','v','s',now() + interval '10 minutes') $$,
  '42501', null, 'AC-M365-101 authenticated INSERT denied');
select throws_ok(
  $$ update public.m365_pkce_states set code_verifier = 'tampered' $$,
  '42501', null, 'AC-M365-101 authenticated UPDATE denied');

reset role;
select * from finish();
rollback;