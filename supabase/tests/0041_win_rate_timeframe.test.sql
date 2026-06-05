-- 0041_win_rate_timeframe.test.sql — time-frame filter oracle
-- AC-1107 / FR-SPD-006 / OD-SP-3
-- decided_at: P001=2026-01-06, P003=2026-02-01, P004=2026-02-20
-- Jan range: W={P001}, L={} → count=1/1=1.0, value=5M/5M=1.0
-- Feb range: W={P003}, L={P004} → count=1/2=0.5, value=3M/3.65M=0.821918
begin;
select plan(4);

-- Seed Executive JWT
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1107: Jan range — only P001 decided (won); no loss → count=1.0, value=1.0
select is(
  (get_win_rate('2026-01-01', '2026-01-31') ->> 'win_rate_count')::numeric,
  1.0,
  'AC-1107: Jan range win_rate_count = 1.0 (FR-SPD-006)'
);

select is(
  (get_win_rate('2026-01-01', '2026-01-31') ->> 'win_rate_value')::numeric,
  1.0,
  'AC-1107: Jan range win_rate_value = 1.0 (FR-SPD-006)'
);

-- AC-1107: Feb range — P003 won (2026-02-01), P004 lost (2026-02-20)
-- count = 1/(1+1) = 0.5; value = 3,000,000/(3,000,000+650,000) = 3,000,000/3,650,000 ≈ 0.821918
select is(
  (get_win_rate('2026-02-01', '2026-02-28') ->> 'win_rate_count')::numeric,
  0.5,
  'AC-1107: Feb range win_rate_count = 0.5 (FR-SPD-006)'
);

select ok(
  abs((get_win_rate('2026-02-01', '2026-02-28') ->> 'win_rate_value')::numeric - 0.821918) < 1e-6,
  'AC-1107: Feb range win_rate_value = 0.821918 (FR-SPD-006)'
);

reset role;
select * from finish();
rollback;
