-- 0090_agent_query_entity_rls.test.sql — agent query_entity RLS tenancy proof.
-- AC-AR-012: cross-tenant projects/companies read under user-A JWT returns ZERO org-B rows.
-- RLS is the ceiling (NFR-AR-SEC-003, ADR-0001). The query_entity action adds no privilege.
-- Org A = default '00000000-…-0001'; Org B = '00900000-…-0002'. Fixture namespace: 00900000-….
begin;
select plan(3);

-- ── Fixtures (inserted as table owner, bypassing RLS) ─────────────────────────
insert into organizations (id, name) values
  ('00900000-0000-0000-0000-000000000002','Agent RLS Test Org B');

insert into auth.users (id, email) values
  ('00900000-0000-0000-0000-0000000000a1','agent-alice@example.com'),
  ('00900000-0000-0000-0000-0000000000b1','agent-bob@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00900000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Agent Alice','agent-alice@example.com','Engineer'),
  ('00900000-0000-0000-0000-0000000000b1','00900000-0000-0000-0000-000000000002','Agent Bob','agent-bob@example.com','Engineer');

-- Org A has a project and a company.
insert into projects (id, org_id, name, status, project_manager_id)
  values ('00900000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Org A Project','Ongoing Project','00900000-0000-0000-0000-0000000000a1');

insert into companies (id, org_id, name, type)
  values ('00900000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','Org A Company','Client');

-- Org B also has a project and a company.
insert into projects (id, org_id, name, status, project_manager_id)
  values ('00900000-0000-0000-0000-000000000011','00900000-0000-0000-0000-000000000002','Org B Project','Ongoing Project','00900000-0000-0000-0000-0000000000b1');

insert into companies (id, org_id, name, type)
  values ('00900000-0000-0000-0000-000000000021','00900000-0000-0000-0000-000000000002','Org B Company','Client');

-- ════════════════════════════════════════════════════════════════════════════
-- Switch to Alice (org A) via the authenticated role (simulates the caller-JWT path).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"00900000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-AR-012: Alice (org A) reads zero org-B projects — RLS is the ceiling.
select is(
  (select count(*)::int from projects where org_id = '00900000-0000-0000-0000-000000000002'),
  0,
  'AC-AR-012: org-A user reads zero org-B projects — RLS is the ceiling');

-- AC-AR-012: Alice (org A) reads zero org-B companies regardless of any filter.
select is(
  (select count(*)::int from companies where org_id = '00900000-0000-0000-0000-000000000002'),
  0,
  'AC-AR-012: org-A user reads zero org-B companies regardless of any model-supplied filter');

-- Positive control: Alice sees at least one of her own org-A projects (proves the read path is live).
select ok(
  (select count(*)::int from projects where org_id = '00000000-0000-0000-0000-000000000001') >= 1,
  'AC-AR-012: positive control — org-A user sees her own org-A projects');

reset role;

select * from finish();
rollback;
