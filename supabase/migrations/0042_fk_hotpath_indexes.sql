-- 0042_fk_hotpath_indexes.sql
-- Adds indexes for unindexed FK columns and hot-filter columns identified by
-- catalog audit (FK constraints vs pg_indexes) and DAL grep (src/lib/db/*).
-- All statements are idempotent (CREATE INDEX IF NOT EXISTS).
-- Catalog analysis run: 2026-06-21.

-- ── payments.invoice_id ───────────────────────────────────────────────────────
-- FK → procurement_invoices.id. Unindexed. Used in the settlement-chain join
-- when loading a payment's parent invoice; also checked by the cascade-guard
-- on invoice delete. payments.procurement_id is already indexed separately.
create index if not exists idx_payments_invoice_id
  on public.payments (invoice_id);

-- ── procurement_invoices.po_id ────────────────────────────────────────────────
-- FK → purchase_orders.id. Unindexed. Settlement chain:
-- PO → VI → PAY; the po_id link back to PO has no index, causing a seq-scan on
-- every joined load of invoice detail.
create index if not exists idx_procurement_invoices_po_id
  on public.procurement_invoices (po_id);

-- ── procurement_receipts.po_id ────────────────────────────────────────────────
-- FK → purchase_orders.id. Unindexed. Same settlement-chain pattern as above:
-- PO → GR join used in detail loads and transition guards.
create index if not exists idx_procurement_receipts_po_id
  on public.procurement_receipts (po_id);

-- ── tasks.assignee_id ─────────────────────────────────────────────────────────
-- FK → profiles.id. Unindexed. Every listTasks / getTask call joins to
-- profiles via `assignee:profiles!tasks_assignee_id_fkey`; without an index
-- each join hits a seq-scan on profiles.
create index if not exists idx_tasks_assignee_id
  on public.tasks (assignee_id);

-- ── task_dependencies.depends_on_id ──────────────────────────────────────────
-- FK → tasks.id. The composite PK (task_id, depends_on_id) only covers
-- lookups by task_id. Cascade deletes (when a task is deleted, all rows where
-- depends_on_id = deleted_task_id must be found) cause a seq-scan without this.
create index if not exists idx_task_dependencies_depends_on_id
  on public.task_dependencies (depends_on_id);

-- ── crm_activities.company_id ─────────────────────────────────────────────────
-- FK → companies.id. Unindexed. crm_activities_contact_idx covers contact_id
-- but not company_id. Used in batch fetches (.in('contact_id', ...)) and in
-- FK cascade-guard when archiving a company.
create index if not exists idx_crm_activities_company_id
  on public.crm_activities (company_id);

-- ── procurement_quotations.rfq_id ─────────────────────────────────────────────
-- FK → rfqs.id. Unindexed. procurement_quotations_procurement_idx covers
-- procurement_id; rfq_id has no index even though it's the predecessor FK in
-- the PR → RFQ → Quotation settlement chain. Needed for FK cascade checks and
-- join-fetches in the RFQ detail view.
create index if not exists idx_procurement_quotations_rfq_id
  on public.procurement_quotations (rfq_id);

-- ── procurement_quotations.vendor_id ──────────────────────────────────────────
-- FK → companies.id. Unindexed. Vendor-scoped quotation lookups (e.g. "all
-- quotes from vendor X") and FK cascade-guard on company archive/delete.
create index if not exists idx_procurement_quotations_vendor_id
  on public.procurement_quotations (vendor_id);

-- ── timesheets.approved_by ────────────────────────────────────────────────────
-- FK → profiles.id. Unindexed. Used in FK cascade lookup when a profile is
-- changed/removed; also available for manager-scoped timesheet queries.
-- (timesheets_user_week_idx covers user_id; approved_by is a separate column.)
create index if not exists idx_timesheets_approved_by
  on public.timesheets (approved_by);

-- ── incident_reports.status ───────────────────────────────────────────────────
-- Hot filter: DAL listIncidents() uses .eq('status', ...) optionally.
-- incident_reports has only org_id indexed; status filter causes a seq-scan
-- over the org's rows. Low-cardinality (3 values) but the DAL filters on it
-- so an (org_id, status) composite hits both the RLS predicate and the filter.
create index if not exists idx_incident_reports_org_status
  on public.incident_reports (org_id, status);

-- ── profiles.role ─────────────────────────────────────────────────────────────
-- Hot filter: DAL listProjectManagers() uses .eq('role', 'Project Manager').
-- profiles_org_id_idx covers org_id, but role has no index. Called on every
-- project create/edit to populate the PM picker. role is near-static (almost
-- never updated), so maintenance cost is negligible.
create index if not exists idx_profiles_role
  on public.profiles (role);
