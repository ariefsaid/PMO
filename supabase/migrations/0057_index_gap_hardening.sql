-- 0057_index_gap_hardening.sql — data-layer performance hardening #4 (full-codebase review
-- 2026-07-04, INDEX-GAP table): composite indexes for the RLS-predicate + hot-order column
-- combinations the DAL actually issues, so these queries stay index-scoped (not sequential) as
-- table sizes grow. Every index below is justified against a real query in `src/lib/db/*` — no
-- speculative indexing. Forward-only, additive; reversibility contract is `supabase db reset`
-- (pre-production, ADR-0006).
--
-- Forward rollback (drop in any order — pure additive indexes, nothing depends on them):
--   drop index if exists public.notifications_owner_created_idx;
--   drop index if exists public.agent_threads_owner_live_pin_updated_idx;
--   drop index if exists public.projects_org_contract_value_idx;
--   drop index if exists public.projects_org_status_contract_value_idx;
--   drop index if exists public.purchase_requests_org_id_idx;
--   drop index if exists public.rfqs_org_id_idx;
--   drop index if exists public.purchase_orders_org_id_idx;
--   drop index if exists public.payments_org_id_idx;
--   drop index if exists public.procurement_status_events_org_id_idx;
--   drop index if exists public.timesheets_org_status_week_idx;
--   drop index if exists public.companies_live_name_idx;
--   drop index if exists public.profiles_org_full_name_idx;

-- ── notifications ────────────────────────────────────────────────────────────────────────────
-- Serves listNotifications() (src/lib/db/notifications.ts): RLS owner_id = auth.uid() (0048) +
-- ORDER BY created_at DESC over ALL rows (read + unread) — the existing
-- notifications_owner_unread_idx is a partial index covering ONLY the unread-count fast path
-- (listUnreadCount), not this full-list read.
create index notifications_owner_created_idx
  on notifications (owner_id, created_at desc);

-- ── agent_threads ────────────────────────────────────────────────────────────────────────────
-- Serves listAgentThreads() (src/lib/db/agentThreads.ts): RLS owner_id = auth.uid() (0046) +
-- WHERE archived_at IS NULL + ORDER BY pinned_at DESC NULLS LAST, updated_at DESC. The existing
-- agent_threads_owner_live_idx is (owner_id) WHERE archived_at IS NULL only — it supports the
-- owner+live filter but not the pinned/updated sort, which still needs an in-memory sort today.
create index agent_threads_owner_live_pin_updated_idx
  on agent_threads (owner_id, pinned_at desc, updated_at desc)
  where archived_at is null;

-- ── projects ─────────────────────────────────────────────────────────────────────────────────
-- Serves get_executive_dashboard()'s top_projects CTE (0032_fix_top_projects_spent.sql):
-- RLS org_id = auth_org_id() (0002) + ORDER BY contract_value DESC LIMIT 5, unfiltered by status.
create index projects_org_contract_value_idx
  on projects (org_id, contract_value desc);

-- Serves get_sales_pipeline()'s `pl` CTE (0020_sales_pipeline_attention.sql): RLS org_id +
-- WHERE status IN ('Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation')
-- + ORDER BY contract_value DESC. Extends the existing projects_org_status_idx (org_id, status)
-- with the sort column so the pipeline project list avoids a post-filter sort.
create index projects_org_status_contract_value_idx
  on projects (org_id, status, contract_value desc);

-- ── procurement record tables (purchase_requests/rfqs/purchase_orders/payments) ────────────────
-- Each table's RLS SELECT predicate is `org_id = auth_org_id()` directly (0035), but the only
-- existing index is the FK-parent (procurement_id) — an org-scoped read (e.g. any listing that
-- is not already procurement_id-filtered, and RLS's own predicate evaluation) has no org_id
-- index to use. One index per table, mirroring procurements_org_id_idx (0001).
create index purchase_requests_org_id_idx on purchase_requests (org_id);
create index rfqs_org_id_idx              on rfqs              (org_id);
create index purchase_orders_org_id_idx   on purchase_orders   (org_id);
create index payments_org_id_idx          on payments          (org_id);

-- ── procurement_status_events ────────────────────────────────────────────────────────────────
-- RLS SELECT predicate is `org_id = auth_org_id()` (0038) on this append-only per-transition log;
-- the existing procurement_status_events_procurement_idx is (procurement_id, created_at) only —
-- no index backs the org_id predicate for an org-wide read (e.g. an audit/activity view not
-- already scoped to one procurement).
create index procurement_status_events_org_id_idx
  on procurement_status_events (org_id);

-- ── timesheets ───────────────────────────────────────────────────────────────────────────────
-- Serves listTimesheetsAwaitingApproval() (src/lib/db/timesheetTransition.ts): RLS org_id
-- AND (user_id = self OR privileged-role OR manager-of) (0007) + WHERE status = 'Submitted' +
-- ORDER BY week_start_date DESC. Extends the existing timesheets_org_status_idx (org_id, status)
-- with the sort column so the org_id+status leading pair the RLS AND-predicate always supplies
-- also serves the ORDER BY.
create index timesheets_org_status_week_idx
  on timesheets (org_id, status, week_start_date desc);

-- ── companies ────────────────────────────────────────────────────────────────────────────────
-- Serves listCompanies()/listClientCompanies() (src/lib/db/companies.ts): RLS org_id +
-- WHERE archived_at IS NULL + ORDER BY name. The existing companies_live_idx is (org_id) WHERE
-- archived_at IS NULL only — no name column, so the sort is not index-backed.
create index companies_live_name_idx
  on companies (org_id, name)
  where archived_at is null;

-- ── profiles ─────────────────────────────────────────────────────────────────────────────────
-- Serves listOrgProfiles() (src/lib/db/profiles.ts): RLS org_id = auth_org_id() (0002) +
-- ORDER BY full_name, the assignee/picker source read org-wide (no role filter).
create index profiles_org_full_name_idx
  on profiles (org_id, full_name);
