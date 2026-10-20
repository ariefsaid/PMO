-- 0040_win_rate_all_time.test.sql — all-time dual win-rate oracle
-- AC-1106 / FR-SPD-006/007 / OD-SP-3
-- DECOUPLED from seed: uses its own isolated org so a future seed change cannot affect
-- the assertions. UUID prefix 00400000-…
--
-- Fixture: 2 Ongoing wins (6,000,000 + 2,000,000) + 2 valued Loss Tender rows;
-- one has a recorded decision date and one does not.
-- All-time includes both recorded losses: count rate = 2/4; value rate = 8M/8.75M.
begin;
select plan(6);

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
                      contract_value, budget, spent, decided_at, tax_treatment, tax_amount)
values
  ('40000000-0000-0000-0000-000000000101', '00400000-0000-0000-0000-000000000001',
   'W0001', 'Win Project One', 'Ongoing Project',
   '00400000-0000-0000-0000-0000000000a1',
   6000000, 5000000, 0, '2026-01-15T00:00:00Z', 'exclusive', 0),
-- Win 2: Ongoing Project, contract_value = 2,000,000
  ('40000000-0000-0000-0000-000000000102', '00400000-0000-0000-0000-000000000001',
   'W0002', 'Win Project Two', 'Ongoing Project',
   '00400000-0000-0000-0000-0000000000a1',
   2000000, 1800000, 0, '2026-02-10T00:00:00Z', 'exclusive', 0),
-- Loss: Loss Tender, contract_value = 650,000, with decision date
  ('40000000-0000-0000-0000-000000000103', '00400000-0000-0000-0000-000000000001',
   'L0001', 'Loss Project One', 'Loss Tender',
   '00400000-0000-0000-0000-0000000000a1',
   650000, 0, 0, '2026-02-20T00:00:00Z', 'exclusive', 0),
-- Recorded loss without a close date still belongs in All time.
  ('40000000-0000-0000-0000-000000000104', '00400000-0000-0000-0000-000000000001',
   'L0002', 'Loss Project Two', 'Loss Tender',
   '00400000-0000-0000-0000-0000000000a1',
   100000, 0, 0, null, 'exclusive', 0);

-- Keep this fixture single-currency except the explicit USD pair below.
update projects set currency = 'IDR'
where id in ('40000000-0000-0000-0000-000000000101', '40000000-0000-0000-0000-000000000102',
            '40000000-0000-0000-0000-000000000103', '40000000-0000-0000-0000-000000000104');
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent, decided_at, tax_treatment, tax_amount, currency)
values
  ('40000000-0000-0000-0000-000000000105', '00400000-0000-0000-0000-000000000001',
   'W0003', 'USD Win Project', 'Ongoing Project', '00400000-0000-0000-0000-0000000000a1',
   1000, 0, 0, null, 'exclusive', 0, 'USD'),
  ('40000000-0000-0000-0000-000000000106', '00400000-0000-0000-0000-000000000001',
   'L0003', 'USD Loss Project', 'Loss Tender', '00400000-0000-0000-0000-0000000000a1',
   300, 0, 0, null, 'exclusive', 0, 'USD');

-- ── Authenticate as the test-org Executive ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00400000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- All-time count includes both valued losses, with and without a decision date.
select ok(
  (get_win_rate(null, null) ->> 'losses_count')::int = 3
    and (get_win_rate(null, null) ->> 'win_rate_count')::numeric < 1,
  'AC-1106: all-time count rate includes valued loss without close date'
);

select ok(
  (get_win_rate(null, null) -> 'value_by_currency' -> 0 ->> 'losses_value')::numeric = 750000
    and (get_win_rate(null, null) -> 'value_by_currency' -> 0 ->> 'win_rate_value')::numeric < 1,
  'AC-1106: all-time IDR value rate includes valued loss without close date'
);

select ok(
  (get_win_rate('2026-02-01', '2026-02-28') ->> 'losses_count')::int = 1,
  'AC-1106: date-window rates continue to require a decision date'
);

select ok(
  get_win_rate(null, null) -> 'value_by_currency' -> 0 ->> 'currency' = 'IDR'
    and (get_win_rate(null, null) -> 'value_by_currency' -> 0 ->> 'wins_value')::numeric = 8000000
    and (get_win_rate(null, null) -> 'value_by_currency' -> 0 ->> 'losses_value')::numeric = 750000
    and get_win_rate(null, null) -> 'value_by_currency' -> 1 ->> 'currency' = 'USD'
    and (get_win_rate(null, null) -> 'value_by_currency' -> 1 ->> 'wins_value')::numeric = 1000
    and (get_win_rate(null, null) -> 'value_by_currency' -> 1 ->> 'losses_value')::numeric = 300,
  'AC-1106: value breakdown is per currency and ordered by currency'
);

select ok(
  get_win_rate(null, null) ->> 'wins_value' is null
    and get_win_rate(null, null) ->> 'losses_value' is null
    and get_win_rate(null, null) ->> 'win_rate_value' is null,
  'AC-1106: mixed-currency scalar values are null'
);

select ok(
  (get_win_rate('2026-02-01', '2026-02-28') ->> 'wins_value')::numeric = 2000000
    and (get_win_rate('2026-02-01', '2026-02-28') ->> 'losses_value')::numeric = 650000
    and (get_win_rate('2026-02-01', '2026-02-28') ->> 'win_rate_value')::numeric < 1,
  'AC-1106: single-currency range keeps legacy scalar values'
);

reset role;
select * from finish();
rollback;
