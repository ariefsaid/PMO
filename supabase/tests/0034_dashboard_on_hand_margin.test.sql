-- 0034_dashboard_on_hand_margin.test.sql — on-hand actual weighted margin oracle
-- AC-1100 / FR-SPD-001 / OD-MARGIN-1
-- DECOUPLED from seed: uses its own isolated org with exactly the on-hand projects
-- needed to prove the margin formula. UUID prefix 00340000-…
--
-- Fixture: 3 on-hand projects — contract_value = 5,000,000 + 3,000,000 + 2,000,000 = 10,000,000
--   One Paid PO of 405,000 against project 1 (committed spend via procurement basis).
--   on_hand_margin = (10,000,000 − 405,000) / 10,000,000 = 9,595,000 / 10,000,000 = 0.9595
--   on_hand_value  = 10,000,000
begin;
select plan(2);

-- ── Isolated org + executive ──────────────────────────────────────────────────
insert into organizations (id, name) values
  ('00340000-0000-0000-0000-000000000001', 'On-Hand Margin Test Org (0034)');

insert into auth.users (id, email) values
  ('00340000-0000-0000-0000-0000000000a1', 'exec@onhand0034.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00340000-0000-0000-0000-0000000000a1', '00340000-0000-0000-0000-000000000001',
   'Exec 0034', 'exec@onhand0034.example', 'Executive');

-- ── On-hand projects ──────────────────────────────────────────────────────────
-- P-ON1: Ongoing Project, contract_value = 5,000,000 — has committed spend
-- P-ON2: Ongoing Project, contract_value = 3,000,000 — no POs (spent=0)
-- P-ON3: Ongoing Project, contract_value = 2,000,000 — no POs (spent=0)
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent)
values
  ('34000000-0000-0000-0000-000000000001', '00340000-0000-0000-0000-000000000001',
   'ON001', 'On-Hand Project 1', 'Ongoing Project',
   '00340000-0000-0000-0000-0000000000a1',
   5000000, 4700000, 0),
  ('34000000-0000-0000-0000-000000000002', '00340000-0000-0000-0000-000000000001',
   'ON002', 'On-Hand Project 2', 'Ongoing Project',
   '00340000-0000-0000-0000-0000000000a1',
   3000000, 2000000, 0),
  ('34000000-0000-0000-0000-000000000003', '00340000-0000-0000-0000-000000000001',
   'ON003', 'On-Hand Project 3', 'Ongoing Project',
   '00340000-0000-0000-0000-0000000000a1',
   2000000, 2000000, 0);

-- ── Committed procurements on P-ON1 (total 405,000) ──────────────────────────
-- Ordered PO = 85,000; Paid PO = 320,000
insert into procurements (id, org_id, title, status, total_value, project_id, requested_by_id) values
  ('34000000-0000-0000-0000-000000000e01', '00340000-0000-0000-0000-000000000001',
   'Ordered PO', 'Ordered', 85000,
   '34000000-0000-0000-0000-000000000001', '00340000-0000-0000-0000-0000000000a1'),
  ('34000000-0000-0000-0000-000000000e02', '00340000-0000-0000-0000-000000000001',
   'Paid PO', 'Paid', 320000,
   '34000000-0000-0000-0000-000000000001', '00340000-0000-0000-0000-0000000000a1'),
  -- Draft PO — must NOT count in committed spend
  ('34000000-0000-0000-0000-000000000e03', '00340000-0000-0000-0000-000000000001',
   'Draft PO excluded', 'Draft', 9999999,
   '34000000-0000-0000-0000-000000000001', '00340000-0000-0000-0000-0000000000a1');

-- ── Authenticate as the test-org Executive ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00340000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1100: on_hand_margin = (10,000,000 − 405,000) / 10,000,000 = 0.9595
select ok(
  abs((get_executive_dashboard() ->> 'on_hand_margin')::numeric - 0.9595) < 1e-6,
  'AC-1100: on-hand weighted margin = 0.9595 (committed spend 405000, contract 10000000) (FR-SPD-001)'
);

-- AC-1100: on_hand_value = 5,000,000 + 3,000,000 + 2,000,000 = 10,000,000
select is(
  (get_executive_dashboard() ->> 'on_hand_value')::numeric,
  10000000::numeric,
  'AC-1100: on_hand_value = 10000000 (three on-hand Ongoing Project fixtures) (FR-SPD-001)'
);

reset role;
select * from finish();
rollback;
