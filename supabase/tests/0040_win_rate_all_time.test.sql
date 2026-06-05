-- 0040_win_rate_all_time.test.sql — all-time dual win-rate oracle
-- AC-1106 / FR-SPD-006/007 / OD-SP-3
-- W = {P001 Ongoing, P003 Ongoing}; L = {P004 Loss Tender}
-- win_rate_count = 2/(2+1) = 0.666667
-- win_rate_value = 8,000,000/(8,000,000+650,000) = 8,000,000/8,650,000 = 0.924855
begin;
select plan(2);

-- Seed Executive JWT
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1106: win_rate_count = 2/3 ≈ 0.666667
select ok(
  abs((get_win_rate(null, null) ->> 'win_rate_count')::numeric - 0.666667) < 1e-6,
  'AC-1106: count win-rate 2/3 = 0.666667 (FR-SPD-006/007)'
);

-- AC-1106: win_rate_value = 8,000,000/8,650,000 ≈ 0.924855
select ok(
  abs((get_win_rate(null, null) ->> 'win_rate_value')::numeric - 0.924855) < 1e-6,
  'AC-1106: value win-rate 8M/8.65M = 0.924855 (FR-SPD-006/007)'
);

reset role;
select * from finish();
rollback;
