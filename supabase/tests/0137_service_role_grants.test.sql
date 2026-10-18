-- 0137_service_role_grants.test.sql — service_role retains full DML on business tables after the
-- 0075 auto-expose lockdown (regression gate for migration 0080). The dev→main promote's e2e caught
-- `permission denied for table profiles` for service_role because 0075 re-granted authenticated/anon
-- but not service_role; this graduates that finding into a deterministic DB-layer gate so it can't
-- silently recur. (pgTAP normally runs as the superuser migration role which BYPASSES grants — these
-- assertions check the *catalog* grant via has_table_privilege(role, ...), so they DO catch it.)
--
-- Luna round-4 (MED-2) carve-out: public.ms_graph_connections is a DELIBERATE exception — it is the
-- ONE table from which service_role's direct INSERT/UPDATE/DELETE was revoked (0106) so the
-- security-definer lock-order RPCs (0105/0106) are the only mutation path (closing the child→parent
-- deadlock seam). The catalog backstop below excludes it; the exception is asserted explicitly.
begin;
select plan(20);

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

-- Catalog-driven backstop: NO ordinary base table in public is missing service_role INSERT —
-- EXCEPT the deliberate RPC-only tables: ms_graph_connections (0106) and the two internal
-- statement-state tables (0321). Those tables intentionally deny direct mutation; their owners'
-- trigger/RPC paths maintain state. Uses pg_class BY OID (relkind 'r'), which is authoritative —
-- no name-resolution phantoms, unlike information_schema. If a future migration adds an ordinary
-- table without the default-priv grant landing, this fails loud.
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in (
        'ms_graph_connections',
        'erp_financial_statement_dirty_date',
        'erp_financial_statement_published_context'
      )
      and not has_table_privilege('service_role', c.oid, 'INSERT')),
  0,
  'AC-SVCROLE-008 every ordinary public base table grants service_role INSERT');

-- Luna round-4 (MED-2) explicit exception: ms_graph_connections is RPC-only. service_role may NOT
-- directly INSERT/UPDATE/DELETE it (the 0105/0106 security-definer RPCs are the only mutation path),
-- and RETAINS SELECT (the edge fn loads connection rows). See 0152 for the functional RPC proof.
select is(has_table_privilege('service_role', 'public.ms_graph_connections', 'INSERT'), false,
  'AC-SVCROLE-009 MED-2: service_role may NOT directly INSERT ms_graph_connections (RPC-only)');
select is(has_table_privilege('service_role', 'public.ms_graph_connections', 'UPDATE'), false,
  'AC-SVCROLE-010 MED-2: service_role may NOT directly UPDATE ms_graph_connections (RPC-only)');
select is(has_table_privilege('service_role', 'public.ms_graph_connections', 'DELETE'), false,
  'AC-SVCROLE-011 MED-2: service_role may NOT directly DELETE ms_graph_connections (RPC-only)');
select is(has_table_privilege('service_role', 'public.ms_graph_connections', 'SELECT'), true,
  'AC-SVCROLE-012 MED-2: service_role RETAINS SELECT on ms_graph_connections (edge-fn reads)');

-- 0321 internal statement-state tables are trigger/RPC-maintained. service_role keeps SELECT for
-- its internal operation paths but must not mutate them directly; authenticated and anon cannot read.
select is(has_table_privilege('service_role', 'public.erp_financial_statement_dirty_date', 'INSERT'), false,
  'AC-SVCROLE-013 statement dirty-date state denies direct service_role INSERT');
select is(has_table_privilege('service_role', 'public.erp_financial_statement_dirty_date', 'UPDATE'), false,
  'AC-SVCROLE-014 statement dirty-date state denies direct service_role UPDATE');
select is(has_table_privilege('service_role', 'public.erp_financial_statement_dirty_date', 'DELETE'), false,
  'AC-SVCROLE-015 statement dirty-date state denies direct service_role DELETE');
select ok(
  has_table_privilege('service_role', 'public.erp_financial_statement_dirty_date', 'SELECT')
    and not has_table_privilege('authenticated', 'public.erp_financial_statement_dirty_date', 'SELECT')
    and not has_table_privilege('anon', 'public.erp_financial_statement_dirty_date', 'SELECT'),
  'AC-SVCROLE-016 statement dirty-date state is service-readable and user-private');

select is(has_table_privilege('service_role', 'public.erp_financial_statement_published_context', 'INSERT'), false,
  'AC-SVCROLE-017 published statement context denies direct service_role INSERT');
select is(has_table_privilege('service_role', 'public.erp_financial_statement_published_context', 'UPDATE'), false,
  'AC-SVCROLE-018 published statement context denies direct service_role UPDATE');
select is(has_table_privilege('service_role', 'public.erp_financial_statement_published_context', 'DELETE'), false,
  'AC-SVCROLE-019 published statement context denies direct service_role DELETE');
select ok(
  has_table_privilege('service_role', 'public.erp_financial_statement_published_context', 'SELECT')
    and not has_table_privilege('authenticated', 'public.erp_financial_statement_published_context', 'SELECT')
    and not has_table_privilege('anon', 'public.erp_financial_statement_published_context', 'SELECT'),
  'AC-SVCROLE-020 published statement context is service-readable and user-private');

select * from finish();
rollback;
