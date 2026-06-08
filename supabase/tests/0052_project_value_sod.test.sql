-- 0052_project_value_sod.test.sql — the contract_value SoD write contract (ADR-0019, projects slice).
-- Proves the set_project_contract_value RPC re-asserts org + role + status, and that contract_value
-- is now RPC-ONLY (removed from the 0008/0012 direct-UPDATE column grant by 0014):
--   AC-PRJ-101  PRE-WIN, a PM (delivery role) CAN set contract_value via the RPC (and it persists).
--   AC-PRJ-102  on a WON/on-hand project, a PM is REJECTED setting contract_value via the RPC (42501).
--   AC-PRJ-103  on a WON/on-hand project, EXECUTIVE CAN set contract_value via the RPC (money authority).
--   AC-PRJ-104  on a WON/on-hand project, FINANCE CAN set contract_value via the RPC (money authority).
--   AC-PRJ-105  a direct UPDATE of projects.contract_value by a 4-role insider is DENIED (42501) — the
--               column is RPC-only (0014 removed it from the grant; the RPC is the sole writer).
--   AC-PRJ-106  cross-org: an org-B Exec cannot change an org-A project's value via the RPC (42501).
--   AC-PRJ-107  the RPC raises P0002 for an unknown project id.
-- RLS/RPC is the enforcement authority; the FE can('editContractValue',…) gate is only a clarity
-- projection (rbac-visibility.md §B2). Mirrors policy.ts: pre-win = Admin·Exec·PM; won = Admin·Exec·Finance.
begin;
select plan(12);

-- ── Fixtures (inserted as table owner, bypassing RLS) ───────────────────────
-- Org-A is the DEFAULT org ('…-0001'); org_id defaults to it so a default-org write-role satisfies
-- the RPC's auth_org_id() re-assertion without sending org_id. Org-B is the cross-org attacker.
insert into organizations (id, name) values
  ('00520000-0000-0000-0000-000000000002','Project Value SoD Org B');

insert into auth.users (id, email) values
  ('00520000-0000-0000-0000-0000000000a1','pv-pm@example.com'),
  ('00520000-0000-0000-0000-0000000000a2','pv-exec@example.com'),
  ('00520000-0000-0000-0000-0000000000a3','pv-finance@example.com'),
  ('00520000-0000-0000-0000-0000000000b1','pv-exec-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00520000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','PV PM','pv-pm@example.com','Project Manager'),
  ('00520000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000001','PV Exec','pv-exec@example.com','Executive'),
  ('00520000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000001','PV Finance','pv-finance@example.com','Finance'),
  ('00520000-0000-0000-0000-0000000000b1','00520000-0000-0000-0000-000000000002','PV Exec B','pv-exec-b@example.com','Executive');

-- A PRE-WIN opportunity (Negotiation) and a WON/on-hand project (Ongoing Project), both org-A.
insert into projects (id, org_id, code, name, status, project_manager_id, contract_value) values
  ('00520000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',
   'PV-PRE','Pre-win Opportunity','Negotiation','00520000-0000-0000-0000-0000000000a1',500000),
  ('00520000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',
   'PV-WON','Won Project','Ongoing Project','00520000-0000-0000-0000-0000000000a1',2000000);

-- ════════════════════════════════════════════════════════════════════════════
-- AC-PRJ-101: PRE-WIN — a PM (delivery role) CAN set the value via the RPC.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select set_project_contract_value('00520000-0000-0000-0000-000000000010', 650000) $$,
  'AC-PRJ-101: a PM CAN set contract_value on a PRE-WIN project via the RPC');

-- AC-PRJ-105: but a DIRECT update of contract_value by the same PM is denied (RPC-only column, 0014).
select throws_ok(
  $$ update projects set contract_value = 999
       where id = '00520000-0000-0000-0000-000000000010' $$,
  '42501', null,
  'AC-PRJ-105: direct UPDATE projects.contract_value by a 4-role user is denied (RPC-only column)');

-- AC-PRJ-102: on the WON project, the PM is REJECTED by the RPC (SoD — money authority only).
select throws_ok(
  $$ select set_project_contract_value('00520000-0000-0000-0000-000000000020', 2500000) $$,
  '42501', null,
  'AC-PRJ-102: a PM is REJECTED setting contract_value on a WON/on-hand project (SoD, 42501)');

reset role;

-- AC-PRJ-101: confirm the PRE-WIN value persisted (the PM write took effect).
select is(
  (select contract_value from projects where id = '00520000-0000-0000-0000-000000000010'),
  650000::numeric,
  'AC-PRJ-101: the PRE-WIN contract_value persisted after the PM RPC call');

-- AC-PRJ-102: confirm the WON value is UNCHANGED (the PM SoD rejection wrote nothing).
select is(
  (select contract_value from projects where id = '00520000-0000-0000-0000-000000000020'),
  2000000::numeric,
  'AC-PRJ-102: the WON contract_value is unchanged after the rejected PM attempt');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-PRJ-103: WON — EXECUTIVE (money authority) CAN set the value via the RPC.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select set_project_contract_value('00520000-0000-0000-0000-000000000020', 2300000) $$,
  'AC-PRJ-103: an EXECUTIVE CAN set contract_value on a WON project via the RPC');

-- AC-PRJ-107: the RPC raises P0002 for an unknown project id.
select throws_ok(
  $$ select set_project_contract_value('00520000-0000-0000-0000-0000000000ff', 1) $$,
  'P0002', null,
  'AC-PRJ-107: set_project_contract_value raises P0002 for an unknown project id');

reset role;

select is(
  (select contract_value from projects where id = '00520000-0000-0000-0000-000000000020'),
  2300000::numeric,
  'AC-PRJ-103: the WON contract_value persisted after the Executive RPC call');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-PRJ-104: WON — FINANCE (money authority) CAN set the value via the RPC.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000a3","role":"authenticated"}';

select lives_ok(
  $$ select set_project_contract_value('00520000-0000-0000-0000-000000000020', 2450000) $$,
  'AC-PRJ-104: FINANCE CAN set contract_value on a WON project via the RPC');

reset role;

select is(
  (select contract_value from projects where id = '00520000-0000-0000-0000-000000000020'),
  2450000::numeric,
  'AC-PRJ-104: the WON contract_value persisted after the Finance RPC call');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-PRJ-106: cross-org — an org-B Executive cannot change an org-A project's value.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00520000-0000-0000-0000-0000000000b1","role":"authenticated"}';

-- The RPC's internal org re-assertion (v_org <> auth_org_id()) denies it → 42501.
select throws_ok(
  $$ select set_project_contract_value('00520000-0000-0000-0000-000000000020', 1) $$,
  '42501', null,
  'AC-PRJ-106: a cross-org (org-B) Executive cannot change an org-A project value (org re-assertion, 42501)');

reset role;

-- Confirm the cross-org attempt wrote nothing (value still the Finance figure).
select is(
  (select contract_value from projects where id = '00520000-0000-0000-0000-000000000020'),
  2450000::numeric,
  'AC-PRJ-106: the org-A value is unchanged after the rejected cross-org attempt');

select * from finish();
rollback;
