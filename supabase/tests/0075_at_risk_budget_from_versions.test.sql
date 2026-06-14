-- 0075_at_risk_budget_from_versions.test.sql
-- AC-W2-1-RPC-01/02/03: budget is DERIVED from the Active budget-version line-items
-- (Σ budget_line_items.budgeted_amount WHERE budget_versions.status='Active'), NOT the
-- dead stored projects.budget column (same class as the 0074 / 0032 spent fix).
--
-- A project with stored projects.budget=0 but an Active version totalling $100,000
-- and a $95,000 Ordered PO must:
--   (a) APPEAR in get_executive_dashboard().projects_at_risk  [AC-W2-1-RPC-01]
--   (b) have top_projects.budget = 100,000                    [AC-W2-1-RPC-02]
--   (c) have get_projects_delivery().budget = 100,000         [AC-W2-1-RPC-03]
--
-- Isolated UUID prefix 00750000-… ensures no seed-data dependency.
-- Caller: test-org Executive (mirrors 0074 pattern).
begin;
select plan(3);

-- ── Test org + user ──────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('00750000-0000-0000-0000-000000000001', 'Budget Derive Test Org');

insert into auth.users (id, email) values
  ('00750000-0000-0000-0000-0000000000a1', 'exec@budgetderive.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00750000-0000-0000-0000-0000000000a1', '00750000-0000-0000-0000-000000000001',
   'Test Exec', 'exec@budgetderive.example', 'Executive');

-- ── Project: stored budget=0 (the bug), Active version total=$100,000 ────────
-- status = 'Ongoing Project' → included in active_committed CTE + top_projects.
-- committed_spend / derived_budget = 95,000 / 100,000 = 95% ≥ 0.9 → AT RISK.
-- With the bug (stored budget=0) the budget>0 guard EXCLUDES this project → count 0.
insert into projects (id, org_id, name, status, contract_value, budget, spent) values
  ('00750000-0000-0000-0000-000000000d01', '00750000-0000-0000-0000-000000000001',
   'DERIVED_AT_RISK', 'Ongoing Project', 200000, 0, 0);

-- Budget version: insert as 'Draft' first (the enforce_draft_line_item trigger blocks inserts
-- when the version is non-Draft), add line-items, then activate to 'Active'.
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('00750000-0000-0000-0000-000000000b01', '00750000-0000-0000-0000-000000000001',
   '00750000-0000-0000-0000-000000000d01', 1, 'v1 Active', 'Draft');

-- Two line-items summing to 100,000.  Category must be a valid budget_category enum value.
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount) values
  ('00750000-0000-0000-0000-000000000c01', '00750000-0000-0000-0000-000000000001',
   '00750000-0000-0000-0000-000000000b01', 'Labor', 'Crew', 60000),
  ('00750000-0000-0000-0000-000000000c02', '00750000-0000-0000-0000-000000000001',
   '00750000-0000-0000-0000-000000000b01', 'Materials', 'Steel', 40000);

-- Activate the version so the derived-budget subquery sees it (v.status = 'Active').
update budget_versions
   set status = 'Active'
 where id = '00750000-0000-0000-0000-000000000b01';

-- Ordered PO of $95,000 (committed basis: Ordered..Paid).
insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('00750000-0000-0000-0000-000000000e01', '00750000-0000-0000-0000-000000000001',
   'At-Risk PO', 'Ordered', 95000,
   '00750000-0000-0000-0000-000000000d01', '00750000-0000-0000-0000-0000000000a1');

-- ── Run as the test-org Executive ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00750000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-W2-1-RPC-01: DERIVED_AT_RISK now appears in projects_at_risk.
-- Pre-fix (stored budget=0): budget>0 guard excludes it → count 0.
-- Post-fix (derived budget=100,000): committed 95k / 100k = 95% ≥ 0.9 → count 1.
select is(
  (get_executive_dashboard() ->> 'projects_at_risk')::int,
  1,
  'AC-W2-1-RPC-01: projects_at_risk uses DERIVED Active-version budget (stored projects.budget=0 no longer hides the overrun)'
);

-- AC-W2-1-RPC-02: top_projects.budget is the derived Σ (100,000), not the stored 0.
select is(
  (
    select (e ->> 'budget')::numeric
    from json_array_elements(
      (get_executive_dashboard() ->> 'top_projects')::json
    ) e
    where e ->> 'name' = 'DERIVED_AT_RISK'
  ),
  100000::numeric,
  'AC-W2-1-RPC-02: top_projects.budget = Σ Active-version line-items (100,000), not dead stored column (0)'
);

-- AC-W2-1-RPC-03: get_projects_delivery returns derived budget (100,000) for stored-0 project.
select is(
  (
    select budget
    from get_projects_delivery(array['00750000-0000-0000-0000-000000000d01']::uuid[])
    where project_id = '00750000-0000-0000-0000-000000000d01'
  ),
  100000::numeric,
  'AC-W2-1-RPC-03: get_projects_delivery.budget = Σ Active-version line-items, not stored projects.budget'
);

reset role;
select * from finish();
rollback;
