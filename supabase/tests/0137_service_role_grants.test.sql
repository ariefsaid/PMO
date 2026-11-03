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
select plan(37);

-- profiles: the exact table the promote e2e failed on (admin-invite-user inserts here).
select ok(has_table_privilege('service_role', 'public.profiles', 'INSERT'),
  'AC-SVCROLE-001 service_role has INSERT on profiles (admin-invite-user)');
select ok(has_table_privilege('service_role', 'public.profiles', 'SELECT'),
  'AC-SVCROLE-002 service_role has SELECT on profiles');
select ok(has_table_privilege('service_role', 'public.profiles', 'UPDATE'),
  'AC-SVCROLE-003 service_role has UPDATE on profiles');
select ok(has_table_privilege('service_role', 'public.contract_rate_lines', 'INSERT'),
  'AC-SVCROLE-021 service_role has INSERT on contract_rate_lines');
select ok(has_table_privilege('service_role', 'public.contract_rate_lines', 'SELECT'),
  'AC-SVCROLE-021 service_role has SELECT on contract_rate_lines');
select ok(has_table_privilege('service_role', 'public.contract_rate_assignees', 'INSERT'),
  'AC-SVCROLE-022 service_role has INSERT on contract_rate_assignees');
select ok(has_table_privilege('service_role', 'public.contract_rate_assignees', 'SELECT'),
  'AC-SVCROLE-022 service_role has SELECT on contract_rate_assignees');
select ok(has_table_privilege('service_role', 'public.tm_claims', 'INSERT'),
  'AC-SVCROLE-023 service_role has INSERT on tm_claims');
select ok(has_table_privilege('service_role', 'public.tm_claims', 'SELECT'),
  'AC-SVCROLE-023 service_role has SELECT on tm_claims');
select ok(has_table_privilege('service_role', 'public.tm_claim_lines', 'INSERT'),
  'AC-SVCROLE-024 service_role has INSERT on tm_claim_lines');
select ok(has_table_privilege('service_role', 'public.tm_claim_lines', 'SELECT'),
  'AC-SVCROLE-024 service_role has SELECT on tm_claim_lines');
select ok(has_table_privilege('service_role', 'public.tm_claim_sources', 'INSERT'),
  'AC-SVCROLE-025 service_role has INSERT on tm_claim_sources');
select ok(has_table_privilege('service_role', 'public.tm_claim_sources', 'SELECT'),
  'AC-SVCROLE-025 service_role has SELECT on tm_claim_sources');

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
-- statement-state tables (0321), plus procurement_import_runs (0399): import-run rows are minted
-- ONLY by the start_procurement_import_run definer, which stamps org and identity_version
-- server-side — a direct service_role INSERT would let a caller register run identities the RPC
-- path never attests. The owning proof is 0399_procurement_import_identity_authority.test.sql.
-- Also the four stock tables (0413, ADR-0097 §1): append-only ledger, single-writer balances and the
-- RPC-written documents/lines; service_role's writes are revoked on purpose. Proof:
-- stock_immutability_idempotency.test.sql (service role cannot insert/update/delete/truncate them).
-- Also imprest_cash_counts (0424): write-once cash counts, written only by record_imprest_count; service_role's
-- writes are revoked on purpose.
-- org_features (0070) remains service-readable but its switch writes use the audited RPC path.
-- The plan registry (0530) is also RPC-only: service_role has no direct table grants and reads
-- effective state through service_resolved_org_features; plans_permissions.test.sql owns that contract.
-- Uses pg_class BY OID (relkind 'r'), which is authoritative —
-- no name-resolution phantoms, unlike information_schema. If a future migration adds an ordinary
-- table without the default-priv grant landing, this fails loud.
select is(
  (select count(*)::int
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in (
        'ms_graph_connections',
        'erp_financial_statement_dirty_date',
        'erp_financial_statement_published_context',
        'procurement_import_runs',
        'stock_documents',
        'stock_document_lines',
        'stock_ledger',
        'stock_balances',
        'imprest_cash_counts',
        'org_features',
        'plans',
        'plan_features',
        'org_plans',
        'global_features',
        'odoo_revenue_census_seen'
      )
      and not has_table_privilege('service_role', c.oid, 'INSERT')),
  0,
  'AC-SVCROLE-008 every ordinary public base table grants service_role INSERT');

-- 0399's exemption is a named pin, not a silent omission: runs are RPC-minted (see above).
select ok(
  has_table_privilege('service_role', 'public.org_features', 'SELECT')
    and not has_table_privilege('service_role', 'public.org_features', 'INSERT')
    and not has_table_privilege('service_role', 'public.org_features', 'UPDATE')
    and not has_table_privilege('service_role', 'public.org_features', 'DELETE')
    and not has_table_privilege('service_role', 'public.org_features', 'TRUNCATE'),
  'AC-SVCROLE-008d org_features stays service-readable with audited-only switch writes');

select ok(
  not has_table_privilege('service_role', 'public.plans', 'SELECT')
    and not has_table_privilege('service_role', 'public.plan_features', 'SELECT')
    and not has_table_privilege('service_role', 'public.org_plans', 'SELECT')
    and not has_table_privilege('service_role', 'public.global_features', 'SELECT')
    and not has_table_privilege('service_role', 'public.plans', 'INSERT')
    and not has_table_privilege('service_role', 'public.plan_features', 'INSERT')
    and not has_table_privilege('service_role', 'public.org_plans', 'INSERT')
    and not has_table_privilege('service_role', 'public.global_features', 'INSERT'),
  'AC-SVCROLE-008c plan registry tables are private; resolution is through the service RPC');

select ok(
  has_table_privilege('service_role','public.revenue_erp_mirror','SELECT')
    and has_table_privilege('service_role','public.revenue_erp_mirror','INSERT')
    and has_table_privilege('service_role','public.revenue_erp_mirror','UPDATE')
    and has_table_privilege('service_role','public.revenue_erp_mirror','DELETE'),
  'AC-OCI-070 the revenue side mirror grants the service role its feed writes');
select ok(
  has_table_privilege('authenticated','public.revenue_erp_mirror','SELECT')
    and not has_table_privilege('authenticated','public.revenue_erp_mirror','INSERT')
    and not has_table_privilege('authenticated','public.revenue_erp_mirror','UPDATE')
    and not has_table_privilege('authenticated','public.revenue_erp_mirror','DELETE'),
  'AC-OCI-070 a user may read but cannot write the revenue side mirror');
select ok(
  not has_table_privilege('service_role','public.odoo_revenue_census_seen','SELECT')
    and not has_table_privilege('service_role','public.odoo_revenue_census_seen','INSERT')
    and not has_table_privilege('authenticated','public.odoo_revenue_census_seen','SELECT')
    and not has_table_privilege('anon','public.odoo_revenue_census_seen','SELECT'),
  'AC-OCI-070 census staging is available only through its security-definer RPCs');

select is(has_table_privilege('service_role', 'public.procurement_import_runs', 'INSERT'), false,
  'AC-SVCROLE-008b service_role may NOT directly INSERT procurement_import_runs (RPC-minted only)');
select is(has_table_privilege('service_role', 'public.procurement_import_runs', 'SELECT'), true,
  'AC-SVCROLE-008b service_role RETAINS SELECT on procurement_import_runs (0399 grant)');

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
