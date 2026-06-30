-- agent_write_sod_contract_value.test.sql — SoD fence proof for deferred money write (A3).
-- AC-AW-011: a direct UPDATE of projects.contract_value by a PM is blocked at the DB (42501).
--
-- This proves A3's deferral of money writes is SAFE: even if a future agent action attempted
-- a direct column update, the DB would block it. The only legal path is via the
-- set_project_contract_value() security-definer RPC (migration 0014, ADR-0019 §1).
--
-- The errcode 42501 is confirmed by AC-PRJ-105 in 0052_project_value_sod.test.sql which
-- already proves this fence. This test re-proves it from the agent-path perspective
-- (a PM JWT on a WON/on-hand project).
--
-- Uses unique UUID namespace 00AW0011-… to avoid collisions.
begin;
select plan(2);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('00aw0011-0000-0000-0000-000000000001','AW-011 Org A');

insert into auth.users (id, email) values
  ('00aw0011-0000-0000-0000-0000000000a1','aw011-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00aw0011-0000-0000-0000-0000000000a1','00aw0011-0000-0000-0000-000000000001',
   'AW011 PM','aw011-pm@example.com','Project Manager');

-- A WON/on-hand project — this is the status where SoD is strictest.
insert into projects (id, org_id, code, name, status, project_manager_id, contract_value) values
  ('00aw0011-0000-0000-0000-000000000010','00aw0011-0000-0000-0000-000000000001',
   'AW011-001','AW011 Won Project','Ongoing Project',
   '00aw0011-0000-0000-0000-0000000000a1', 1000000);

-- ── AC-AW-011: direct UPDATE of contract_value by a PM → 42501 (RPC-only column) ──
-- Migration 0014 removed contract_value from the direct-UPDATE column grant; the
-- set_project_contract_value() RPC is the only legal writer.
-- This is the same 42501 proven by AC-PRJ-105 in 0052_project_value_sod.test.sql.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00aw0011-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update projects set contract_value = 9999999
       where id = '00aw0011-0000-0000-0000-000000000010' $$,
  '42501', null,
  'AC-AW-011: direct UPDATE of projects.contract_value by a PM is blocked (RPC-only column, 42501)');

reset role;

-- Confirm the value was NOT changed (the fence held).
select is(
  (select contract_value from projects where id = '00aw0011-0000-0000-0000-000000000010'),
  1000000::numeric,
  'AC-AW-011: contract_value unchanged after the blocked direct UPDATE (fence held)');

select finish();
rollback;
