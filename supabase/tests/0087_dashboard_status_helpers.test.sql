-- 0087_dashboard_status_helpers.test.sql — pins the shared dashboard status-set taxonomy
-- extracted by migration 0044_dashboard_status_helpers.sql.
--
-- The three dashboard RPCs (get_executive_dashboard, get_win_rate, get_sales_pipeline) used to
-- inline-duplicate three status-set literals. 0044 extracts each into one immutable SQL helper:
--   • committed_procurement_statuses() — the OD-BUDGET-2 committed-spend basis (Ordered..Paid)
--   • on_hand_project_statuses()       — the OD-SP-1 on-hand / won project set
--   • pipeline_project_statuses()      — the OD-SP-1 open-pipeline project set
--
-- This test is the SINGLE place the taxonomy is pinned: if anyone changes a helper's membership
-- (which would silently shift every Finance/exec dashboard number), this fails. Membership here is
-- byte-for-byte the literals that lived in the RPC bodies before extraction (behavior-preserving).
begin;
select plan(6);

-- ── helpers exist ───────────────────────────────────────────────────────────
select has_function('public', 'committed_procurement_statuses', 'committed_procurement_statuses() exists');
select has_function('public', 'on_hand_project_statuses',       'on_hand_project_statuses() exists');
select has_function('public', 'pipeline_project_statuses',      'pipeline_project_statuses() exists');

-- ── membership pinned (order-insensitive: compare as sorted arrays) ──────────
select is(
  (select array(select unnest(committed_procurement_statuses()) order by 1)),
  array['Ordered','Paid','Received','Vendor Invoiced']::text[],
  'committed_procurement_statuses() = the OD-BUDGET-2 committed basis (Ordered, Received, Vendor Invoiced, Paid)');

select is(
  (select array(select unnest(on_hand_project_statuses()) order by 1)),
  array['Close Out','On Hold','Ongoing Project','Won, Pending KoM']::text[],
  'on_hand_project_statuses() = the OD-SP-1 on-hand set (Won, Pending KoM / Ongoing Project / On Hold / Close Out)');

select is(
  (select array(select unnest(pipeline_project_statuses()) order by 1)),
  array['Leads','Negotiation','PQ Submitted','Quotation Submitted','Tender Submitted']::text[],
  'pipeline_project_statuses() = the OD-SP-1 open-pipeline set (Leads / PQ / Quotation / Tender / Negotiation)');

select * from finish();
rollback;
