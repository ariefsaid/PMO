-- 0043_win_rate_tenancy_anon.test.sql — win-rate tenancy isolation + anon revoke
-- AC-1109 / NFR-SPD-SEC-001 / NFR-SPD-TENANCY-001
begin;
select plan(2);

-- Insert org B with a won project (should NOT appear in default-org results)
insert into organizations (id, name) values
  ('00430000-0000-0000-0000-000000000001', 'Win Rate Tenancy Org B');

insert into auth.users (id, email) values
  ('00430000-0000-0000-0000-0000000000b1', 'winrate-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00430000-0000-0000-0000-0000000000b1', '00430000-0000-0000-0000-000000000001',
   'WinRate B Exec', 'winrate-b@example.com', 'Executive');

-- Org B has a won project with a massive contract value
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent, decided_at)
values
  ('43000000-0000-0000-0000-000000000001', '00430000-0000-0000-0000-000000000001',
   'B-WIN-001', 'Org B Big Win', 'Ongoing Project',
   '00430000-0000-0000-0000-0000000000b1',
   99000000, 0, 0, '2026-01-15T00:00:00Z');

-- Authenticate as DEFAULT-ORG Executive
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1109: default-org wins_value must be 8,000,000 (excludes org B's 99M win)
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
