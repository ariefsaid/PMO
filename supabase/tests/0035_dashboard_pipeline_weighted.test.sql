-- 0035_dashboard_pipeline_weighted.test.sql — pipeline weighted value oracle
-- AC-1101 / FR-SPD-002 / OD-SP-2
-- DECOUPLED from seed: uses its own isolated org with exactly the pipeline projects
-- needed to prove the weighted-value formula. UUID prefix 00350000-…
--
-- Fixture: 4 pipeline deals
--   Tender Submitted (×0.500): 1,200,000 + 950,000 + 1,000,000 = 3,150,000 → 1,575,000 weighted
--   PQ Submitted     (×0.250):   800,000                                   →   200,000 weighted
--   Σ pipeline_weighted_value = 1,775,000
begin;
select plan(1);

-- ── Isolated org + executive ──────────────────────────────────────────────────
insert into organizations (id, name) values
  ('00350000-0000-0000-0000-000000000001', 'Pipeline Weighted Test Org (0035)');

insert into auth.users (id, email) values
  ('00350000-0000-0000-0000-0000000000a1', 'exec@pipeweighted0035.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00350000-0000-0000-0000-0000000000a1', '00350000-0000-0000-0000-000000000001',
   'Exec 0035', 'exec@pipeweighted0035.example', 'Executive');

-- ── Pipeline stage config ─────────────────────────────────────────────────────
insert into pipeline_stage_config (org_id, status, win_probability) values
  ('00350000-0000-0000-0000-000000000001', 'Tender Submitted', 0.500),
  ('00350000-0000-0000-0000-000000000001', 'PQ Submitted',     0.250);

-- ── Pipeline projects ─────────────────────────────────────────────────────────
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent)
values
  -- Three Tender Submitted: 1,200,000 + 950,000 + 1,000,000 = 3,150,000 × 0.500 = 1,575,000
  ('35000000-0000-0000-0000-000000000001', '00350000-0000-0000-0000-000000000001',
   'TS001', 'Pipeline Deal Alpha', 'Tender Submitted',
   '00350000-0000-0000-0000-0000000000a1',
   1200000, 0, 0),
  ('35000000-0000-0000-0000-000000000002', '00350000-0000-0000-0000-000000000001',
   'TS002', 'Pipeline Deal Beta', 'Tender Submitted',
   '00350000-0000-0000-0000-0000000000a1',
   950000, 0, 0),
  ('35000000-0000-0000-0000-000000000003', '00350000-0000-0000-0000-000000000001',
   'TS003', 'Pipeline Deal Gamma', 'Tender Submitted',
   '00350000-0000-0000-0000-0000000000a1',
   1000000, 0, 0),
  -- One PQ Submitted: 800,000 × 0.250 = 200,000
  ('35000000-0000-0000-0000-000000000004', '00350000-0000-0000-0000-000000000001',
   'PQ001', 'Pipeline Deal Delta', 'PQ Submitted',
   '00350000-0000-0000-0000-0000000000a1',
   800000, 0, 0);

-- ── Authenticate as the test-org Executive ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00350000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1101: pipeline_weighted_value = 3,150,000×0.5 + 800,000×0.25 = 1,575,000 + 200,000 = 1,775,000
select is(
  (get_executive_dashboard() ->> 'pipeline_weighted_value')::numeric,
  1775000::numeric,
  'AC-1101: Σ(contract_value × win_prob) = (1.2M+0.95M+1.0M)×0.5 + 0.8M×0.25 = 1775000 (FR-SPD-002)'
);

reset role;
select * from finish();
rollback;
