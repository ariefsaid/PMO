-- 0036_dashboard_pipeline_projected.test.sql — pipeline projected margin oracle (post-SPD-S1)
-- AC-1102 / FR-SPD-003 / OD-MARGIN-1
-- Seed task SPD-S1: P002 Active budget → 1,000,000; P010 Active budget → 600,000
-- projected_margin = ((1,200,000−1,000,000) + (800,000−600,000)) / 2,000,000 = 400,000/2,000,000 = 0.200
begin;
select plan(2);

-- Seed Executive JWT
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1102: pipeline_projected_margin = 0.200 (after SPD-S1 seed adjustment)
select ok(
  abs((get_executive_dashboard() ->> 'pipeline_projected_margin')::numeric - 0.200) < 1e-6,
  'AC-1102: projected margin = (200000+200000)/2000000 = 0.200 (FR-SPD-003)'
);

-- AC-1102: pipeline_total_value = P002 1,200,000 + P010 800,000 = 2,000,000
select is(
  (get_executive_dashboard() ->> 'pipeline_total_value')::numeric,
  2000000::numeric,
  'AC-1102: pipeline_total_value = 2000000 (FR-SPD-003)'
);

reset role;
select * from finish();
rollback;
