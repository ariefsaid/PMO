-- 0084_fk_hotpath_indexes.test.sql
-- AC-PERF-001 through AC-PERF-011: migration 0042 indexes exist in pg_indexes.
-- Each test asserts one index added by 0042_fk_hotpath_indexes.sql.
begin;
select plan(11);

-- AC-PERF-001: payments.invoice_id FK index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'payments'
      and indexname  = 'idx_payments_invoice_id'
  ),
  'AC-PERF-001: idx_payments_invoice_id exists on payments(invoice_id)'
);

-- AC-PERF-002: procurement_invoices.po_id FK index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'procurement_invoices'
      and indexname  = 'idx_procurement_invoices_po_id'
  ),
  'AC-PERF-002: idx_procurement_invoices_po_id exists on procurement_invoices(po_id)'
);

-- AC-PERF-003: procurement_receipts.po_id FK index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'procurement_receipts'
      and indexname  = 'idx_procurement_receipts_po_id'
  ),
  'AC-PERF-003: idx_procurement_receipts_po_id exists on procurement_receipts(po_id)'
);

-- AC-PERF-004: tasks.assignee_id FK index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'tasks'
      and indexname  = 'idx_tasks_assignee_id'
  ),
  'AC-PERF-004: idx_tasks_assignee_id exists on tasks(assignee_id)'
);

-- AC-PERF-005: task_dependencies.depends_on_id FK index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'task_dependencies'
      and indexname  = 'idx_task_dependencies_depends_on_id'
  ),
  'AC-PERF-005: idx_task_dependencies_depends_on_id exists on task_dependencies(depends_on_id)'
);

-- AC-PERF-006: crm_activities.company_id FK index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'crm_activities'
      and indexname  = 'idx_crm_activities_company_id'
  ),
  'AC-PERF-006: idx_crm_activities_company_id exists on crm_activities(company_id)'
);

-- AC-PERF-007: procurement_quotations.rfq_id FK index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'procurement_quotations'
      and indexname  = 'idx_procurement_quotations_rfq_id'
  ),
  'AC-PERF-007: idx_procurement_quotations_rfq_id exists on procurement_quotations(rfq_id)'
);

-- AC-PERF-008: procurement_quotations.vendor_id FK index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'procurement_quotations'
      and indexname  = 'idx_procurement_quotations_vendor_id'
  ),
  'AC-PERF-008: idx_procurement_quotations_vendor_id exists on procurement_quotations(vendor_id)'
);

-- AC-PERF-009: timesheets.approved_by FK index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'timesheets'
      and indexname  = 'idx_timesheets_approved_by'
  ),
  'AC-PERF-009: idx_timesheets_approved_by exists on timesheets(approved_by)'
);

-- AC-PERF-010: incident_reports (org_id, status) composite index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'incident_reports'
      and indexname  = 'idx_incident_reports_org_status'
  ),
  'AC-PERF-010: idx_incident_reports_org_status exists on incident_reports(org_id, status)'
);

-- AC-PERF-011: profiles.role hot-filter index exists
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'profiles'
      and indexname  = 'idx_profiles_role'
  ),
  'AC-PERF-011: idx_profiles_role exists on profiles(role)'
);

select * from finish();
rollback;
