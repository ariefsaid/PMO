-- 0137_service_role_grants.test.sql — service_role retains full DML on business tables after the
-- 0075 auto-expose lockdown (regression gate for migration 0080). The dev→main promote's e2e caught
-- `permission denied for table profiles` for service_role because 0075 re-granted authenticated/anon
-- but not service_role; this graduates that finding into a deterministic DB-layer gate so it can't
-- silently recur. (pgTAP normally runs as the superuser migration role which BYPASSES grants — these
-- assertions check the *catalog* grant via has_table_privilege(role, ...), so they DO catch it.)
begin;
select plan(8);

-- profiles: the exact table the promote e2e failed on (admin-invite-user inserts here).
select ok(has_table_privilege('service_role', 'public.profiles', 'INSERT'),
  'AC-SVCROLE-001 service_role has INSERT on profiles (admin-invite-user)');
select ok(has_table_privilege('service_role', 'public.profiles', 'SELECT'),
  'AC-SVCROLE-002 service_role has SELECT on profiles');
select ok(has_table_privilege('service_role', 'public.profiles', 'UPDATE'),
  'AC-SVCROLE-003 service_role has UPDATE on profiles');

-- A spread of other business tables the backend/dispatcher touches via service_role.
select ok(has_table_privilege('service_role', 'public.agent_runs', 'INSERT'),
  'AC-SVCROLE-004 service_role has INSERT on agent_runs (agent persistence)');
select ok(has_table_privilege('service_role', 'public.notifications', 'INSERT'),
  'AC-SVCROLE-005 service_role has INSERT on notifications (dispatcher)');
select ok(has_table_privilege('service_role', 'public.agent_dispatch_watermarks', 'UPDATE'),
  'AC-SVCROLE-006 service_role has UPDATE on agent_dispatch_watermarks');
select ok(has_table_privilege('service_role', 'public.projects', 'SELECT'),
  'AC-SVCROLE-007 service_role has SELECT on projects');

-- Catalog-driven backstop: NO ordinary base table in public is missing service_role INSERT. Uses
-- pg_class BY OID (relkind 'r'), which is authoritative — no name-resolution phantoms, unlike
-- information_schema. If a future migration adds a table without the default-priv grant landing,
-- this fails loud.
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not has_table_privilege('service_role', c.oid, 'INSERT')),
  0,
  'AC-SVCROLE-008 every public base table grants service_role INSERT (auto-expose-off backstop)');

select * from finish();
rollback;
