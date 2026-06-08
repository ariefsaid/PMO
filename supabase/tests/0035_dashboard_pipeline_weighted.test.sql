-- 0035_dashboard_pipeline_weighted.test.sql — pipeline weighted value oracle
-- AC-1101 / FR-SPD-002 / OD-SP-2
begin;
select plan(1);

-- Seed Executive JWT
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1101: pipeline_weighted_value over the 4 seeded pipeline deals (P011 added in PR #27;
-- P012 "Eastgate Depot Upgrade" added as AC-1011's dedicated expendable win-target row):
--   Tender Submitted (×0.500): P002 1,200,000 + P011 950,000 + P012 1,000,000 = 3,150,000 ⇒ 1,575,000
--   PQ Submitted     (×0.250): P010   800,000                                            ⇒   200,000
--   Σ = 1,575,000 + 200,000 = 1,775,000
-- win_probability from pipeline_stage_config (OD-SP-2 defaults locked)
select is(
  (get_executive_dashboard() ->> 'pipeline_weighted_value')::numeric,
  1775000::numeric,
  'AC-1101: Σ(contract_value × win_prob) = (1.2M+0.95M+1.0M)×0.5 + 0.8M×0.25 = 1775000 (FR-SPD-002)'
);

reset role;
select * from finish();
rollback;
