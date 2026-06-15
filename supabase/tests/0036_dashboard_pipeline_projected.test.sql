-- 0036_dashboard_pipeline_projected.test.sql — pipeline projected margin oracle
-- AC-1102 / FR-SPD-003 / OD-MARGIN-1
-- DECOUPLED from seed: uses its own isolated org with exactly the pipeline projects
-- needed to prove the projected margin formula. UUID prefix 00360000-…
--
-- Fixture: 4 pipeline deals with Active budget versions:
--   Tender Submitted: P-TS1 (contract=1,200,000, budget=1,000,000) → margin contrib = 200,000
--                     P-TS2 (contract=950,000, budget=950,000)     → margin contrib = 0
--                     P-TS3 (contract=1,000,000, budget=1,000,000) → margin contrib = 0
--   PQ Submitted:     P-PQ1 (contract=800,000, budget=600,000)     → margin contrib = 200,000
--   pipeline_total_value    = 1,200,000+950,000+1,000,000+800,000 = 3,950,000
--   pipeline_projected_margin = 400,000 / 3,950,000 = 0.101266…
begin;
select plan(2);

-- ── Isolated org + executive ──────────────────────────────────────────────────
insert into organizations (id, name) values
  ('00360000-0000-0000-0000-000000000001', 'Pipeline Projected Margin Test Org (0036)');

insert into auth.users (id, email) values
  ('00360000-0000-0000-0000-0000000000a1', 'exec@projmargin0036.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00360000-0000-0000-0000-0000000000a1', '00360000-0000-0000-0000-000000000001',
   'Exec 0036', 'exec@projmargin0036.example', 'Executive');

-- ── Pipeline stage config ─────────────────────────────────────────────────────
insert into pipeline_stage_config (org_id, status, win_probability) values
  ('00360000-0000-0000-0000-000000000001', 'Tender Submitted', 0.500),
  ('00360000-0000-0000-0000-000000000001', 'PQ Submitted',     0.250);

-- ── Pipeline projects ─────────────────────────────────────────────────────────
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent)
values
  ('36000000-0000-0000-0000-000000000001', '00360000-0000-0000-0000-000000000001',
   'TS001', 'Projected Pipeline Alpha', 'Tender Submitted',
   '00360000-0000-0000-0000-0000000000a1',
   1200000, 0, 0),
  ('36000000-0000-0000-0000-000000000002', '00360000-0000-0000-0000-000000000001',
   'TS002', 'Projected Pipeline Beta', 'Tender Submitted',
   '00360000-0000-0000-0000-0000000000a1',
   950000, 0, 0),
  ('36000000-0000-0000-0000-000000000003', '00360000-0000-0000-0000-000000000001',
   'TS003', 'Projected Pipeline Gamma', 'Tender Submitted',
   '00360000-0000-0000-0000-0000000000a1',
   1000000, 0, 0),
  ('36000000-0000-0000-0000-000000000004', '00360000-0000-0000-0000-000000000001',
   'PQ001', 'Projected Pipeline Delta', 'PQ Submitted',
   '00360000-0000-0000-0000-0000000000a1',
   800000, 0, 0);

-- ── Budget versions (Draft → line items → Active) ─────────────────────────────
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('36000000-0000-0000-0000-000000000b01', '00360000-0000-0000-0000-000000000001',
   '36000000-0000-0000-0000-000000000001', 1, 'Tender Budget', 'Draft'),
  ('36000000-0000-0000-0000-000000000b02', '00360000-0000-0000-0000-000000000001',
   '36000000-0000-0000-0000-000000000002', 1, 'Tender Budget', 'Draft'),
  ('36000000-0000-0000-0000-000000000b03', '00360000-0000-0000-0000-000000000001',
   '36000000-0000-0000-0000-000000000003', 1, 'Tender Budget', 'Draft'),
  ('36000000-0000-0000-0000-000000000b04', '00360000-0000-0000-0000-000000000001',
   '36000000-0000-0000-0000-000000000004', 1, 'Tender Budget', 'Draft');

insert into budget_line_items (id, org_id, budget_version_id, category, budgeted_amount) values
  ('36000000-0000-0000-0000-000000000c01', '00360000-0000-0000-0000-000000000001',
   '36000000-0000-0000-0000-000000000b01', 'Labor', 1000000),  -- TS1 budget = 1,000,000
  ('36000000-0000-0000-0000-000000000c02', '00360000-0000-0000-0000-000000000001',
   '36000000-0000-0000-0000-000000000b02', 'Labor', 950000),   -- TS2 budget = 950,000 (= contract)
  ('36000000-0000-0000-0000-000000000c03', '00360000-0000-0000-0000-000000000001',
   '36000000-0000-0000-0000-000000000b03', 'Labor', 1000000),  -- TS3 budget = 1,000,000 (= contract)
  ('36000000-0000-0000-0000-000000000c04', '00360000-0000-0000-0000-000000000001',
   '36000000-0000-0000-0000-000000000b04', 'Labor', 600000);   -- PQ1 budget = 600,000

update budget_versions set status = 'Active'
  where id in (
    '36000000-0000-0000-0000-000000000b01',
    '36000000-0000-0000-0000-000000000b02',
    '36000000-0000-0000-0000-000000000b03',
    '36000000-0000-0000-0000-000000000b04');

-- ── Authenticate as the test-org Executive ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00360000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1102: pipeline_projected_margin = (200000+0+0+200000) / 3950000 = 400000/3950000 = 0.101266…
select ok(
  abs((get_executive_dashboard() ->> 'pipeline_projected_margin')::numeric - (400000.0/3950000.0)) < 1e-6,
  'AC-1102: projected margin = (200000+0+0+200000)/3950000 = 0.101266… (FR-SPD-003)'
);

-- AC-1102: pipeline_total_value = 1,200,000 + 950,000 + 1,000,000 + 800,000 = 3,950,000
select is(
  (get_executive_dashboard() ->> 'pipeline_total_value')::numeric,
  3950000::numeric,
  'AC-1102: pipeline_total_value = 3950000 (FR-SPD-003)'
);

reset role;
select * from finish();
rollback;
