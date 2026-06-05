-- 0042_win_rate_empty_guard.test.sql — win-rate empty-range divide-by-zero guard
-- AC-1108 / FR-SPD-008
-- A future range with no decided deals must return 0/0 (no error)
begin;
select plan(2);

-- Seed Executive JWT
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1108: empty future range → win_rate_count = 0 (no division error)
select is(
  (get_win_rate('2030-01-01', '2030-12-31') ->> 'win_rate_count')::numeric,
  0::numeric,
  'AC-1108: empty range win_rate_count = 0 (no div-by-zero) (FR-SPD-008)'
);

-- AC-1108: empty future range → win_rate_value = 0 (no division error)
select is(
  (get_win_rate('2030-01-01', '2030-12-31') ->> 'win_rate_value')::numeric,
  0::numeric,
  'AC-1108: empty range win_rate_value = 0 (no div-by-zero) (FR-SPD-008)'
);

reset role;
select * from finish();
rollback;
