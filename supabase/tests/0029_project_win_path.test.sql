-- 0029_project_win_path.test.sql
-- AC-1007: win path — capture customer_contract_ref + contract_date, stamp decided_at = contract_date.
-- Authorized PM transitions a Negotiation project to Won, Pending KoM with ref + date.
-- Asserts status, customer_contract_ref, contract_date, and decided_at = contract_date (OD-SP-3).
-- Atomicity: a single RPC call sets all four fields together (NFR-PR-ATOM-001).
-- (FR-PR-005, NFR-PR-ATOM-001, OD-SP-3/OD-PR-D)
begin;
select plan(5);

-- Fixtures: one org, one authorized PM, one Negotiation project.
insert into organizations (id, name) values
  ('00290000-0000-0000-0000-000000000001','PR Win Path Org');

insert into auth.users (id, email) values
  ('00290000-0000-0000-0000-0000000000a2','pr-win-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00290000-0000-0000-0000-0000000000a2','00290000-0000-0000-0000-000000000001','PR Win PM','pr-win-pm@example.com','Project Manager');

insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00290000-0000-0000-0000-000000000010','00290000-0000-0000-0000-000000000001',
   'PW-001','PR Win Project','Negotiation','00290000-0000-0000-0000-0000000000a2');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00290000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── Win the project ──────────────────────────────────────────────────────────
select lives_ok(
  $$ select transition_project('00290000-0000-0000-0000-000000000010','Won, Pending KoM','CPO-2026-77','2026-03-15') $$,
  'AC-1007: authorized win transition succeeds');

select is(
  (select status::text from projects where id = '00290000-0000-0000-0000-000000000010'),
  'Won, Pending KoM',
  'AC-1007: status is Won, Pending KoM');

select is(
  (select customer_contract_ref from projects where id = '00290000-0000-0000-0000-000000000010'),
  'CPO-2026-77',
  'AC-1007: customer ref captured');

select is(
  (select contract_date from projects where id = '00290000-0000-0000-0000-000000000010'),
  '2026-03-15'::date,
  'AC-1007: contract date captured');

select is(
  (select decided_at from projects where id = '00290000-0000-0000-0000-000000000010'),
  '2026-03-15'::timestamptz,
  'AC-1007: decided_at = contract_date (OD-SP-3)');

reset role;
select * from finish();
rollback;
