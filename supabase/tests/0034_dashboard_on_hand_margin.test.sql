-- 0034_dashboard_on_hand_margin.test.sql — on-hand actual weighted margin oracle
-- AC-1100 / FR-SPD-001 / OD-MARGIN-1
begin;
select plan(2);

-- Seed Executive JWT (sub = default-org Executive user)
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1100: on_hand_margin = (8,000,000 − 405,000) / 8,000,000 = 7,595,000 / 8,000,000 = 0.949375
-- P001 committed spent = PROC-002 Ordered 85,000 + PROC-005 Paid 320,000 = 405,000
-- P003 committed spent = 0 (Draft/Requested/Draft — all excluded)
select ok(
  abs((get_executive_dashboard() ->> 'on_hand_margin')::numeric - 0.949375) < 1e-6,
  'AC-1100: on-hand weighted margin = 0.949375 over seed on-hand projects (FR-SPD-001)'
);

-- AC-1100: on_hand_value = P001 5,000,000 + P003 3,000,000 = 8,000,000
select is(
  (get_executive_dashboard() ->> 'on_hand_value')::numeric,
  8000000::numeric,
  'AC-1100: on_hand_value = 8000000 (FR-SPD-001)'
);

reset role;
select * from finish();
rollback;
