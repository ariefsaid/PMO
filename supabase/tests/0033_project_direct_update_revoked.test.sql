-- 0033_project_direct_update_revoked.test.sql
-- MED-PR-1: the win-capture / legal-map / decided_at columns (status, decided_at,
-- customer_contract_ref, contract_date) are RPC-only. A direct `update projects set ...`
-- on any of those columns by a 4-role insider MUST be denied (column-level UPDATE revoked
-- from `authenticated`) so the transition_project win-capture + legal map can't be bypassed.
-- The RPC path must still work, and direct UPDATE of NON-revoked columns must still work
-- (no over-revoke).
-- (FR-PR-001/005/006/007, ADR-0011/0012; auditor option b)
begin;
select plan(4);

-- Fixtures: one org, one PM, one Negotiation project.
insert into organizations (id, name) values
  ('00330000-0000-0000-0000-000000000001','PR Revoke Org');

insert into auth.users (id, email) values
  ('00330000-0000-0000-0000-0000000000a2','pr-revoke-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00330000-0000-0000-0000-0000000000a2','00330000-0000-0000-0000-000000000001',
   'PR Revoke PM','pr-revoke-pm@example.com','Project Manager');

insert into projects (id, org_id, code, name, status, project_manager_id, contract_value) values
  ('00330000-0000-0000-0000-000000000010','00330000-0000-0000-0000-000000000001',
   'PR-001','PR Revoke Project','Negotiation','00330000-0000-0000-0000-0000000000a2',500000);

-- Act as the in-org PM (a 4-role insider; passes projects_write's role gate).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00330000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── Test (i): direct UPDATE of status → denied (column-level UPDATE revoked) ──
select throws_ok(
  $$ update projects set status = 'Won, Pending KoM'
       where id = '00330000-0000-0000-0000-000000000010' $$,
  '42501', null,
  'MED-PR-1: direct UPDATE projects.status by a 4-role user is denied (RPC-only column)');

-- ── Test (ii): direct UPDATE of decided_at → denied (forging the decision date) ──
select throws_ok(
  $$ update projects set decided_at = now()
       where id = '00330000-0000-0000-0000-000000000010' $$,
  '42501', null,
  'MED-PR-1: direct UPDATE projects.decided_at by a 4-role user is denied (RPC-only column)');

-- ── Test (iii): the RPC path STILL works (transition_project by a PM) ──────────
-- Negotiation → Won requires the customer PO capture; this is the sole sanctioned path.
select lives_ok(
  $$ select transition_project('00330000-0000-0000-0000-000000000010',
       'Won, Pending KoM', 'CPO-REVOKE-1', '2026-03-01') $$,
  'MED-PR-1: transition_project (security-definer RPC) still performs the win transition');

-- ── Test (iv): direct UPDATE of a NON-revoked column STILL works (no over-revoke) ──
-- ADR-0019 NOTE: as of 0014, contract_value is ALSO removed from the direct column grant (the
-- set_project_contract_value RPC is its sole writer), so `name` is now the non-revoked column
-- that proves the revoke did not over-reach. (The contract_value lockdown + SoD is proven by
-- 0052_project_value_sod.test.sql.) `name` is in the 0008/0012/0014 grant list, so a 4-role
-- insider may still direct-update it.
select lives_ok(
  $$ update projects set name = 'PR Revoke Project (renamed)'
       where id = '00330000-0000-0000-0000-000000000010' $$,
  'MED-PR-1: direct UPDATE of a non-revoked column (name) still works for a 4-role user');

reset role;
select * from finish();
rollback;
