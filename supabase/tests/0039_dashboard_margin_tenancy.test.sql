-- 0039_dashboard_margin_tenancy.test.sql — margin tenancy isolation (org B cannot bleed into org A KPIs)
-- AC-1105 / NFR-SPD-TENANCY-001
-- DECOUPLED from seed: uses its own isolated org A + org B fixtures so a future seed change
-- cannot affect the assertions. UUID prefix 00390000-…
begin;
select plan(2);

-- ── Org A (the "default org" under test) ─────────────────────────────────────
insert into organizations (id, name) values
  ('00390000-0000-0000-0000-000000000001', 'Margin Test Org A (0039)');

insert into auth.users (id, email) values
  ('00390000-0000-0000-0000-0000000000a1', 'exec-a@margin0039.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00390000-0000-0000-0000-0000000000a1', '00390000-0000-0000-0000-000000000001',
   'Exec A 0039', 'exec-a@margin0039.example', 'Executive');

-- Org A: two Ongoing Projects — contract_value = 4,000,000 + 6,000,000 = 10,000,000
-- spent = 0 via procurement basis (no POs); on_hand_margin = (10M - 0) / 10M = 1.0
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent)
values
  ('39000000-0000-0000-0000-000000000001', '00390000-0000-0000-0000-000000000001',
   'A001', 'Org A Project 1', 'Ongoing Project',
   '00390000-0000-0000-0000-0000000000a1',
   4000000, 3500000, 0),
  ('39000000-0000-0000-0000-000000000002', '00390000-0000-0000-0000-000000000001',
   'A002', 'Org A Project 2', 'Ongoing Project',
   '00390000-0000-0000-0000-0000000000a1',
   6000000, 5000000, 0);

-- ── Org B (the adversarial org — massive project that must NOT bleed into org A) ─
insert into organizations (id, name) values
  ('00390000-0000-0000-0000-000000000002', 'Margin Test Org B (0039)');

insert into auth.users (id, email) values
  ('00390000-0000-0000-0000-0000000000b1', 'exec-b@margin0039.example');

insert into profiles (id, org_id, full_name, email, role) values
  ('00390000-0000-0000-0000-0000000000b1', '00390000-0000-0000-0000-000000000002',
   'Org B Exec 0039', 'exec-b@margin0039.example', 'Executive');

-- Org B has one enormous Ongoing Project — if tenancy leaks, org A KPIs would blow up
insert into projects (id, org_id, code, name, status, project_manager_id,
                      contract_value, budget, spent)
values
  ('39000000-0000-0000-0000-000000000009', '00390000-0000-0000-0000-000000000002',
   'B001', 'Org B Mega Project', 'Ongoing Project',
   '00390000-0000-0000-0000-0000000000b1',
   99000000, 50000000, 0);

-- ── Authenticate as Org A Executive ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"00390000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-1105: org A on_hand_value = 10,000,000 (two own projects); org B's 99M must NOT appear
select is(
  (get_executive_dashboard() ->> 'on_hand_value')::numeric,
  10000000::numeric,
  'AC-1105: on_hand_value excludes org B (NFR-SPD-TENANCY-001)'
);

-- AC-1105: margin reflects only org A projects (no POs → spent=0 → margin = 1.0 > 0.9)
select ok(
  (get_executive_dashboard() ->> 'on_hand_margin')::numeric > 0.9,
  'AC-1105: margin reflects org A only, not org B (NFR-SPD-TENANCY-001)'
);

reset role;
select * from finish();
rollback;
