-- 0108_index_gap_hardening.test.sql — data-layer performance hardening #4 (full-codebase review
-- 2026-07-04, INDEX-GAP table). Proves the composite indexes added in
-- 0057_index_gap_hardening.sql exist with the exact column order the backing query needs.
-- Schema-shape only (has_index), no RLS/data fixtures required.
begin;
select plan(12);

-- ── notifications: listNotifications() owner + ORDER BY created_at desc ───────────────────────
select has_index('notifications', 'notifications_owner_created_idx', array['owner_id','created_at'],
  'AC-PERF-001: notifications (owner_id, created_at desc) index exists');

-- ── agent_threads: listAgentThreads() owner+live + pinned/updated order ────────────────────────
select has_index('agent_threads', 'agent_threads_owner_live_pin_updated_idx',
  array['owner_id','pinned_at','updated_at'],
  'AC-PERF-001: agent_threads (owner_id, pinned_at desc, updated_at desc) where archived_at is null index exists');

-- ── projects: dashboard top_projects (org_id, contract_value desc) ─────────────────────────────
select has_index('projects', 'projects_org_contract_value_idx', array['org_id','contract_value'],
  'AC-PERF-001: projects (org_id, contract_value desc) index exists');

-- ── projects: sales pipeline (org_id, status, contract_value desc) ─────────────────────────────
select has_index('projects', 'projects_org_status_contract_value_idx',
  array['org_id','status','contract_value'],
  'AC-PERF-001: projects (org_id, status, contract_value desc) index exists');

-- ── procurement record tables: RLS org_id predicate ────────────────────────────────────────────
select has_index('purchase_requests', 'purchase_requests_org_id_idx', array['org_id'],
  'AC-PERF-001: purchase_requests (org_id) index exists');
select has_index('rfqs', 'rfqs_org_id_idx', array['org_id'],
  'AC-PERF-001: rfqs (org_id) index exists');
select has_index('purchase_orders', 'purchase_orders_org_id_idx', array['org_id'],
  'AC-PERF-001: purchase_orders (org_id) index exists');
select has_index('payments', 'payments_org_id_idx', array['org_id'],
  'AC-PERF-001: payments (org_id) index exists');

-- ── procurement_status_events: RLS org_id predicate (append-only log) ──────────────────────────
select has_index('procurement_status_events', 'procurement_status_events_org_id_idx', array['org_id'],
  'AC-PERF-001: procurement_status_events (org_id) index exists');

-- ── timesheets: listTimesheetsAwaitingApproval() org+status + ORDER BY week_start_date desc ────
select has_index('timesheets', 'timesheets_org_status_week_idx',
  array['org_id','status','week_start_date'],
  'AC-PERF-001: timesheets (org_id, status, week_start_date desc) index exists');

-- ── companies / profiles: ORDER BY name / full_name ─────────────────────────────────────────────
select has_index('companies', 'companies_live_name_idx', array['org_id','name'],
  'AC-PERF-001: companies (org_id, name) where archived_at is null index exists');
select has_index('profiles', 'profiles_org_full_name_idx', array['org_id','full_name'],
  'AC-PERF-001: profiles (org_id, full_name) index exists');

select * from finish();
rollback;
