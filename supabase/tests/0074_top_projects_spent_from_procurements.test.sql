-- 0074_top_projects_spent_from_procurements.test.sql
-- AC-MONEY-01: top_projects.spent is computed from procurements (Ordered..Paid),
-- not the dead stored projects.spent column (always 0 without a trigger).
-- Also verifies projects_at_risk uses committed spend, not projects.spent.
--
-- Uses isolated test data (UUID prefix 00740000-…) so no seed-data dependency.
begin;
select plan(4);

-- ── Test org + users ──────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('00740000-0000-0000-0000-000000000001','Money Fix Test Org');

insert into auth.users (id, email) values
  ('00740000-0000-0000-0000-0000000000a1','exec@moneyfixtest.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00740000-0000-0000-0000-0000000000a1','00740000-0000-0000-0000-000000000001',
   'Test Exec','exec@moneyfixtest.example','Executive');

-- ── Projects ─────────────────────────────────────────────────────────────────
-- PAID_PROJECT: Ongoing Project with projects.spent=0 (dead column) but has a
--   $3,700,000 Paid PO. budget=10,000,000 (large, so NOT at risk despite big PO).
--   3.7M / 10M = 37% < 90%.
-- AT_RISK_PROJECT: Ongoing Project with committed_spend/budget > 0.9.
--   budget=100,000, Ordered PO=95,000 → 95% = at risk.
-- NOT_AT_RISK_PROJECT: Ongoing Project with no POs → 0% committed → not at risk.
insert into projects (id, org_id, name, status, contract_value, budget, spent) values
  ('00740000-0000-0000-0000-000000000d01','00740000-0000-0000-0000-000000000001',
   'PAID_PROJECT','Ongoing Project',5000000,10000000,0),
  ('00740000-0000-0000-0000-000000000d02','00740000-0000-0000-0000-000000000001',
   'AT_RISK_PROJECT','Ongoing Project',200000,100000,0);

-- ── Procurements ──────────────────────────────────────────────────────────────
-- PAID_PROJECT: one Paid PO of $3,700,000 (committed).
insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('00740000-0000-0000-0000-000000000e01','00740000-0000-0000-0000-000000000001',
   'Large Paid PO','Paid',3700000,
   '00740000-0000-0000-0000-000000000d01','00740000-0000-0000-0000-0000000000a1'),
  -- A Draft PO that must NOT be counted (excluded from committed set).
  ('00740000-0000-0000-0000-000000000e02','00740000-0000-0000-0000-000000000001',
   'Draft PO excluded','Draft',9999999,
   '00740000-0000-0000-0000-000000000d01','00740000-0000-0000-0000-0000000000a1');

-- AT_RISK_PROJECT: Ordered PO of $95,000 → 95% of budget → at risk.
insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('00740000-0000-0000-0000-000000000e03','00740000-0000-0000-0000-000000000001',
   'At-Risk PO','Ordered',95000,
   '00740000-0000-0000-0000-000000000d02','00740000-0000-0000-0000-0000000000a1');

-- Budget versions: migration 0033 derives budget from Active version line-items (not stored column).
-- Add Active version + line-items matching the stored budget values so at-risk logic fires correctly.
-- AT_RISK_PROJECT: Active version = 100,000 (matches stored budget, 95k PO → 95% at risk).
-- PAID_PROJECT: Active version = 10,000,000 (matches stored budget, 3.7M PO → 37% — NOT at risk).
-- Insert as Draft, add line-items, then activate (enforce_draft_line_item trigger).
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('00740000-0000-0000-0000-000000000b01','00740000-0000-0000-0000-000000000001',
   '00740000-0000-0000-0000-000000000d02', 1, 'v1', 'Draft'),
  ('00740000-0000-0000-0000-000000000b02','00740000-0000-0000-0000-000000000001',
   '00740000-0000-0000-0000-000000000d01', 1, 'v1', 'Draft');

insert into budget_line_items (id, org_id, budget_version_id, category, budgeted_amount) values
  ('00740000-0000-0000-0000-000000000c01','00740000-0000-0000-0000-000000000001',
   '00740000-0000-0000-0000-000000000b01','Labor', 100000),
  ('00740000-0000-0000-0000-000000000c02','00740000-0000-0000-0000-000000000001',
   '00740000-0000-0000-0000-000000000b02','Labor', 10000000);

update budget_versions set status = 'Active'
 where id in ('00740000-0000-0000-0000-000000000b01','00740000-0000-0000-0000-000000000b02');

-- ── Run as the test-org Executive ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"00740000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-MONEY-01 (1): top_projects for PAID_PROJECT shows spent=3,700,000 (Paid PO),
-- NOT spent=0 (the dead stored column value). Proof the fix is in place.
select is(
  (
    select (e->>'spent')::numeric
    from json_array_elements(
      (get_executive_dashboard()->>'top_projects')::json
    ) e
    where e->>'name' = 'PAID_PROJECT'
  ),
  3700000::numeric,
  'AC-MONEY-01: top_projects.spent = committed Paid PO value (3,700,000), not dead stored column (0)'
);

-- AC-MONEY-01 (2): Draft PO is excluded — spent must not include the Draft $9,999,999.
select ok(
  (
    select (e->>'spent')::numeric
    from json_array_elements(
      (get_executive_dashboard()->>'top_projects')::json
    ) e
    where e->>'name' = 'PAID_PROJECT'
  ) < 9999999::numeric,
  'AC-MONEY-01: Draft procurements are excluded from top_projects.spent (committed set = Ordered..Paid)'
);

-- AC-MONEY-01 (3): projects_at_risk counts AT_RISK_PROJECT (committed 95k / budget 100k = 95% > 90%).
-- With the dead stored column (spent=0), this would return 0. After the fix it returns 1.
select is(
  (get_executive_dashboard()->>'projects_at_risk')::int,
  1,
  'AC-MONEY-01: projects_at_risk counts projects where committed_spend/budget > 0.9 (not dead projects.spent)'
);

-- AC-MONEY-01 (4): on_hand_margin is still correct after the rewrite (regression guard on
-- the existing on_hand CTE — unchanged from 0009, but verify the function still compiles and
-- the on-hand contract value matches our two Ongoing-Project test rows).
-- on_hand_value = PAID(5M) + AT_RISK(200k) = 5,200,000
select is(
  (get_executive_dashboard()->>'on_hand_value')::numeric,
  5200000::numeric,
  'AC-MONEY-01 regression: on_hand_value still sums contract_value of on-hand projects correctly'
);

reset role;
select * from finish();
rollback;
