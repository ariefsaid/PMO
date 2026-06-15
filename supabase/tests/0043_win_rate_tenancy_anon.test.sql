-- 0043_win_rate_tenancy_anon.test.sql — win-rate tenancy isolation + anon revoke
-- AC-1109 / NFR-SPD-SEC-001 / NFR-SPD-TENANCY-001
-- DECOUPLED from seed: uses its own isolated org A + org B fixtures so a future
-- seed change cannot affect the assertions. UUID prefix 00430000-…
--
-- Fixture: org A has one Ongoing win (8,000,000); org B has its own Ongoing win
-- that must NOT bleed into org A's wins_value.
begin;
select plan(2);

-- ── Org A (the org under test) ────────────────────────────────────────────────
insert into organizations (id, name) values
  ('00430000-0000-0000-0000-000000000001', 'Win Rate Tenancy Org A (0043)');

insert into auth.users (id, email) values
  ('00430000-0000-0000-0000-0000000000a1', 'exec-a@wintenancy0043.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00430000-0000-0000-0000-0000000000a1', '00430000-0000-0000-0000-000000000001',
   'Exec A 0043', 'exec-a@wintenancy0043.example', 'Executive');

-- Org A: one Ongoing Project win — contract_value = 8,000,000
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent, decided_at)
values
  ('43000000-0000-0000-0000-000000000001', '00430000-0000-0000-0000-000000000001',
   'A-WIN-001', 'Org A Win Project', 'Ongoing Project',
   '00430000-0000-0000-0000-0000000000a1',
   8000000, 7000000, 0, '2026-01-15T00:00:00Z');

-- ── Org B (adversarial — large win that must NOT appear in org A results) ─────
insert into organizations (id, name) values
  ('00430000-0000-0000-0000-000000000002', 'Win Rate Tenancy Org B (0043)');

insert into auth.users (id, email) values
  ('00430000-0000-0000-0000-0000000000b1', 'exec-b@wintenancy0043.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00430000-0000-0000-0000-0000000000b1', '00430000-0000-0000-0000-000000000002',
   'WinRate B Exec 0043', 'exec-b@wintenancy0043.example', 'Executive');

-- Org B has a won project with a massive contract value
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent, decided_at)
values
  ('43000000-0000-0000-0000-000000000009', '00430000-0000-0000-0000-000000000002',
   'B-WIN-001', 'Org B Big Win', 'Ongoing Project',
   '00430000-0000-0000-0000-0000000000b1',
   99000000, 0, 0, '2026-01-15T00:00:00Z');

-- ── Authenticate as Org A Executive ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00430000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1109: org A wins_value = 8,000,000 (excludes org B's 99M win)
select is(
  (get_win_rate(null, null) ->> 'wins_value')::numeric,
  8000000::numeric,
  'AC-1109: wins_value excludes org B (NFR-SPD-TENANCY-001)'
);

reset role;

-- AC-1109: anon has no EXECUTE on get_win_rate(date, date)
select ok(
  not has_function_privilege('anon', 'get_win_rate(date,date)', 'execute'),
  'AC-1109: anon has no EXECUTE on get_win_rate (NFR-SPD-SEC-001)'
);

select * from finish();
rollback;
