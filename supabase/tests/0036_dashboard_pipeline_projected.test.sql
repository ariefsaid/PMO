-- 0036_dashboard_pipeline_projected.test.sql — pipeline projected margin oracle (post-SPD-S1)
-- AC-1102 / FR-SPD-003 / OD-MARGIN-1
-- Seed task SPD-S1 budgets: P002 Active → 1,000,000; P010 Active → 600,000.
-- P011 "Highfield Bridge Survey" (Tender Submitted, contract 950,000, Active budget 950,000) was
-- added to the seed in PR #27. P012 "Eastgate Depot Upgrade" (Tender Submitted, contract 1,000,000,
-- Active budget 1,000,000) was added as AC-1011's dedicated expendable win-target → the pipeline set
-- is now 4 deals (P002 + P011 + P012 Tender, P010 PQ).
-- projected_margin = Σ(contract_value − active_budget) / Σ(contract_value) over the pipeline set
--   = ((1,200,000−1,000,000)+(950,000−950,000)+(1,000,000−1,000,000)+(800,000−600,000))
--      / (1,200,000+950,000+1,000,000+800,000)
--   = (200,000 + 0 + 0 + 200,000) / 3,950,000 = 400,000 / 3,950,000 = 0.101266…
-- (Both P011 and P012 have budget == contract, so each contributes 0 to the numerator while raising
-- the denominator — the numerator stays 400,000, the margin dilutes as the pipeline grows.)
begin;
select plan(2);

-- Seed Executive JWT
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1102: pipeline_projected_margin = 400000/3950000 = 0.101266… (repeating; assert vs exact fraction)
select ok(
  abs((get_executive_dashboard() ->> 'pipeline_projected_margin')::numeric - (400000.0/3950000.0)) < 1e-6,
  'AC-1102: projected margin = (200000+0+0+200000)/3950000 = 0.101266… (FR-SPD-003)'
);

-- AC-1102: pipeline_total_value = P002 1,200,000 + P011 950,000 + P012 1,000,000 + P010 800,000 = 3,950,000
select is(
  (get_executive_dashboard() ->> 'pipeline_total_value')::numeric,
  3950000::numeric,
  'AC-1102: pipeline_total_value = 3950000 (FR-SPD-003)'
);

reset role;
select * from finish();
rollback;
