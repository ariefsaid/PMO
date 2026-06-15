-- 0040_win_rate_all_time.test.sql — all-time dual win-rate oracle
-- AC-1106 / FR-SPD-006/007 / OD-SP-3
-- DECOUPLED from seed: uses its own isolated org so a future seed change cannot affect
-- the assertions. UUID prefix 00400000-…
--
-- Fixture: 2 Ongoing wins (6,000,000 + 2,000,000) + 1 Loss Tender (650,000)
--   win_rate_count = 2 / (2+1) = 0.666667
--   win_rate_value = 8,000,000 / (8,000,000 + 650,000) = 8,000,000 / 8,650,000 = 0.924855
begin;
select plan(2);

-- ── Isolated org + executive ──────────────────────────────────────────────────
insert into organizations (id, name) values
  ('00400000-0000-0000-0000-000000000001', 'Win Rate Test Org (0040)');

insert into auth.users (id, email) values
  ('00400000-0000-0000-0000-0000000000a1', 'exec@winrate0040.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00400000-0000-0000-0000-0000000000a1', '00400000-0000-0000-0000-000000000001',
   'Exec 0040', 'exec@winrate0040.example', 'Executive');

-- ── Decided projects ──────────────────────────────────────────────────────────
-- Win 1: Ongoing Project, contract_value = 6,000,000
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent, decided_at)
values
  ('40000000-0000-0000-0000-000000000101', '00400000-0000-0000-0000-000000000001',
   'W0001', 'Win Project One', 'Ongoing Project',
   '00400000-0000-0000-0000-0000000000a1',
   6000000, 5000000, 0, '2026-01-15T00:00:00Z'),
-- Win 2: Ongoing Project, contract_value = 2,000,000
  ('40000000-0000-0000-0000-000000000102', '00400000-0000-0000-0000-000000000001',
   'W0002', 'Win Project Two', 'Ongoing Project',
   '00400000-0000-0000-0000-0000000000a1',
   2000000, 1800000, 0, '2026-02-10T00:00:00Z'),
-- Loss: Loss Tender, contract_value = 650,000
  ('40000000-0000-0000-0000-000000000103', '00400000-0000-0000-0000-000000000001',
   'L0001', 'Loss Project One', 'Loss Tender',
   '00400000-0000-0000-0000-0000000000a1',
   650000, 0, 0, '2026-02-20T00:00:00Z');

-- ── Authenticate as the test-org Executive ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00400000-0000-0000-0000-0000000000a1","role":"authenticated"}';

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
