-- 0825_rls_policy_shape_guard.test.sql — #842 standing guard (docs/plans/2026-11-09-rls-initplan-helpers.md §4).
--   §1  CONSTANT-ARGUMENT guard: no public/storage policy calls org_feature_enabled / domain_externally_owned in the
--       per-row form (initplan arguments + literal key, call not itself the whole of a scalar sub-select), except the
--       tables in the allowlist below. The allowlist is the set of tables later slices (0821-0824) have not migrated
--       yet; each slice deletes its tables from it. A stale entry (no bare call left) fails too.
--   §2  ALL-POLICY allowlist: the ALL policies that still exist. Slice 0820 removed five; 0821-0824 remove the rest
--       except the four permanent ones (service-role-only census tables, pg_cron's own). A new ALL policy, or a stale
--       entry, fails.
--   §3  SELF-TEST of the detector (a detector that matches nothing looks like a passing one).
-- Adding a helper to the guard is one word in the helper list below.
begin;
select plan(8);

create function pg_temp.q825_bare(expr text) returns integer language sql immutable as $$
  select (select count(*) from regexp_matches(
    regexp_replace(coalesce(expr, ''), '''([^'']|'''')*''', '''x''', 'g'),
    '(?<!SELECT )(org_feature_enabled|domain_externally_owned)\(\( SELECT auth_org_id\(\) AS auth_org_id\), ''x''::text\)', 'g'))::int $$;
-- (string literals are masked to 'x' first, so a key literal and a literal that reads like a call both behave)

-- ── §1 constant-argument guard ──
create temporary table q825_pending_tables (t text primary key);
insert into q825_pending_tables values
  ('boq_items'),('budget_projections'),('companies'),('contacts'),('crm_activities'),('external_reference_items'),('fx_rates'),
  ('imprest_plan_lines'),('imprest_plans'),('incident_reports'),('incoming_payments'),('payment_files'),('payments'),
  ('procurement_invoice_files'),('procurement_quotation_files'),('procurement_receipt_files'),('progress_assessment_quantities'),
  ('project_progress_entries'),('purchase_order_files'),('purchase_request_files'),('rfq_files'),('sales_invoices'),
  ('stock_items'),('stock_units'),('stock_warehouses'),('timesheet_entries'),('timesheets'),('user_views');
grant select on q825_pending_tables to public;

select is_empty(
  $$select schemaname || '.' || tablename || ' ' || policyname || ' (' || cmd || ')' from pg_policies
     where schemaname in ('public', 'storage')
       and tablename not in (select t from q825_pending_tables)
       and pg_temp.q825_bare(qual) + pg_temp.q825_bare(with_check) > 0$$,
  'AC-RLS842-GUARD-001 no migrated public/storage policy calls org_feature_enabled/domain_externally_owned per row');

select is_empty(
  $$select t from q825_pending_tables p
     where not exists (select 1 from pg_policies x where x.schemaname in ('public', 'storage') and x.tablename = p.t
                         and pg_temp.q825_bare(x.qual) + pg_temp.q825_bare(x.with_check) > 0)$$,
  'AC-RLS842-GUARD-002 every pending-table allowlist entry still has a bare call (a migrated table must leave the list)');

-- ── §2 ALL-policy allowlist ──
select is(
  (select array_agg(schemaname || '.' || policyname order by schemaname || '.' || policyname) from pg_policies where cmd = 'ALL'),
  (select array_agg(x order by x) from unnest(array[
     'cron.cron_job_policy','cron.cron_job_run_details_policy',
     'public.odoo_ledger_census_seen_service','public.odoo_revenue_census_seen_service',
     -- pending slice 0821 (evidence files)
     'public.procurement_invoice_files_write','public.procurement_quotation_files_write','public.procurement_receipt_files_write',
     'public.payment_files_write','public.purchase_order_files_write','public.purchase_request_files_write','public.rfq_files_write',
     -- pending slice 0822 (budget / finance)
     'public.budget_category_account_map_write','public.budget_line_items_write','public.budget_projections_write',
     'public.budget_versions_write','public.expense_claim_files_write','public.expense_claim_lines_write','public.imprest_plan_lines_write',
     -- pending slice 0823 (delivery / CRM)
     'public.projects_write','public.project_documents_write','public.project_milestones_write','public.task_dependencies_write',
     'public.timesheet_entries_write','public.crm_activities_write','public.pipeline_stage_config_write',
     -- pending slice 0824 (platform / storage)
     'public.external_domain_ownership_write','public.external_reference_items_write','public.org_features_write',
     'storage.storage_objects_agent_attachments_write','storage.storage_objects_expense_receipt_write','storage.storage_objects_project_doc_write'
   ]) x),
  'AC-RLS842-GUARD-003 the ALL policies that exist are exactly the allowlist (a new ALL policy or a stale entry fails)');

-- ── §3 self-test ──
create table pg_temp.q825_ctl (id uuid primary key default gen_random_uuid(), org_id uuid, note text);
alter table pg_temp.q825_ctl enable row level security;
create policy c_bare    on pg_temp.q825_ctl for select using (org_feature_enabled((select auth_org_id()), 'procurement'));
create policy c_wrapped on pg_temp.q825_ctl for select using ((select org_feature_enabled((select auth_org_id()), 'procurement')));
create policy c_nested  on pg_temp.q825_ctl for select
  using (exists (select 1 from public.projects z where domain_externally_owned((select auth_org_id()), 'tasks')));
create policy c_column  on pg_temp.q825_ctl for select using (org_feature_enabled(org_id, 'procurement'));

select is((select pg_temp.q825_bare(qual) from pg_policies where tablename = 'q825_ctl' and policyname = 'c_bare'), 1,
  'AC-RLS842-GUARD-004 detector: a bare constant-argument call is one violation');
select is((select pg_temp.q825_bare(qual) from pg_policies where tablename = 'q825_ctl' and policyname = 'c_wrapped'), 0,
  'AC-RLS842-GUARD-005 detector: the whole call inside a scalar sub-select is clean');
select is((select pg_temp.q825_bare(qual) from pg_policies where tablename = 'q825_ctl' and policyname = 'c_nested'), 1,
  'AC-RLS842-GUARD-006 detector: a bare call inside a nested subquery is a violation');
select is((select pg_temp.q825_bare(qual) from pg_policies where tablename = 'q825_ctl' and policyname = 'c_column'), 0,
  'AC-RLS842-GUARD-007 detector: a column argument is per-row by nature and is not counted');
select ok((select count(*) from pg_policies where schemaname = 'public' and (qual ~ 'org_feature_enabled' or with_check ~ 'org_feature_enabled')) >= 60,
  'AC-RLS842-GUARD-008 the guard has real input (at least 60 policies call org_feature_enabled)');

select * from finish();
rollback;
