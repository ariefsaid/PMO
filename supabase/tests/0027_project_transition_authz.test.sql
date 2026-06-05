-- 0027_project_transition_authz.test.sql
-- AC-1005: tenant isolation + coarse role gate inside transition_project.
-- (i)  org-A PM calls transition_project on org-B project → 42501 (cross-org, tenant isolation).
-- (ii) org-A Engineer calls a legal transition on org-A's project → 42501 (coarse role gate).
-- (iii) org-A PM calls a legal transition on org-A's project → lives_ok (authorized).
-- (FR-PR-004/010, ADR-0011/0012)
begin;
select plan(3);

-- Fixtures: two orgs, one PM + one Engineer in org-A, one project per org.
insert into organizations (id, name) values
  ('00270000-0000-0000-0000-000000000001','PR Authz Org A'),
  ('00270000-0000-0000-0000-000000000002','PR Authz Org B');

insert into auth.users (id, email) values
  ('00270000-0000-0000-0000-0000000000a2','pr-pm-a@example.com'),
  ('00270000-0000-0000-0000-0000000000a4','pr-eng-a@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00270000-0000-0000-0000-0000000000a2','00270000-0000-0000-0000-000000000001','PR PM A','pr-pm-a@example.com','Project Manager'),
  ('00270000-0000-0000-0000-0000000000a4','00270000-0000-0000-0000-000000000001','PR Eng A','pr-eng-a@example.com','Engineer');

-- Org-A project (Leads → PQ Submitted is a legal first move).
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00270000-0000-0000-0000-000000000010','00270000-0000-0000-0000-000000000001',
   'PA-001','PR Authz Project A','Leads','00270000-0000-0000-0000-0000000000a2');

-- Org-B project (target for cross-org attempt).
insert into projects (id, org_id, code, name, status, project_manager_id) values
  ('00270000-0000-0000-0000-000000000020','00270000-0000-0000-0000-000000000002',
   'PB-001','PR Authz Project B','Leads','00270000-0000-0000-0000-0000000000a2');

-- ── Test (i): org-A PM on org-B project → 42501 (cross-org) ─────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00270000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select throws_ok(
  $$ select transition_project('00270000-0000-0000-0000-000000000020','Loss Tender') $$,
  '42501', null,
  'AC-1005: cross-org project transition raises 42501 (tenant isolation inside RPC)');

-- ── Test (ii): org-A Engineer on org-A project → 42501 (role gate) ──────────
set local request.jwt.claims = '{"sub":"00270000-0000-0000-0000-0000000000a4","role":"authenticated"}';

select throws_ok(
  $$ select transition_project('00270000-0000-0000-0000-000000000010','PQ Submitted') $$,
  '42501', null,
  'AC-1005: Engineer-role blocked by coarse role gate');

-- ── Test (iii): org-A PM on org-A project → lives_ok ────────────────────────
set local request.jwt.claims = '{"sub":"00270000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select transition_project('00270000-0000-0000-0000-000000000010','PQ Submitted') $$,
  'AC-1005: in-org Project Manager may transition');

reset role;
select * from finish();
rollback;
