-- 0028_project_transition_legality.test.sql
-- AC-1006: legal-map gate + win-input requirement at the DB layer.
-- (i)  Leads → Won, Pending KoM (illegal jump) → P0001.
-- (ii) Negotiation → Won, Pending KoM with null ref/date → P0001 (win requires ref+date).
-- (iii) Negotiation → Negotiation (no-op) → P0001.
-- (FR-PR-001/003/005)
begin;
select plan(3);

-- Fixtures: one org, one authorized PM, projects in various states.
insert into organizations (id, name) values
  ('00280000-0000-0000-0000-000000000001','PR Legality Org');

insert into auth.users (id, email) values
  ('00280000-0000-0000-0000-0000000000a2','pr-legal-pm@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00280000-0000-0000-0000-0000000000a2','00280000-0000-0000-0000-000000000001','PR Legal PM','pr-legal-pm@example.com','Project Manager');

-- Project in Leads (illegal to jump to Won, Pending KoM directly from Leads).
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00280000-0000-0000-0000-000000000010','00280000-0000-0000-0000-000000000001',
   'PL-001','PR Leads Project','Leads','00280000-0000-0000-0000-0000000000a2');

-- Project in Negotiation (legal to win, but ref+date required).
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00280000-0000-0000-0000-000000000011','00280000-0000-0000-0000-000000000001',
   'PL-002','PR Negotiation Project','Negotiation','00280000-0000-0000-0000-0000000000a2');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00280000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- ── Test (i): Leads → Won, Pending KoM (illegal jump) → P0001 ───────────────
select throws_ok(
  $$ select transition_project('00280000-0000-0000-0000-000000000010','Won, Pending KoM','X','2026-01-01') $$,
  'P0001', null,
  'AC-1006: illegal Leads→Won jump rejected (P0001)');

-- ── Test (ii): Negotiation → Won with no ref/date → P0001 ───────────────────
select throws_ok(
  $$ select transition_project('00280000-0000-0000-0000-000000000011','Won, Pending KoM',null,null) $$,
  'P0001', null,
  'AC-1006: win requires customer contract ref and date (P0001)');

-- ── Test (iii): Negotiation → Negotiation (no-op) → P0001 ───────────────────
select throws_ok(
  $$ select transition_project('00280000-0000-0000-0000-000000000011','Negotiation') $$,
  'P0001', null,
  'AC-1006: no-op transition rejected (P0001)');

reset role;
select * from finish();
rollback;
