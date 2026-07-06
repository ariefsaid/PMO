-- 0114_agent_query_entity_broadened.test.sql — broadened read scope is RLS-bounded (Defect 2).
--
-- Proves at the SQL/RLS layer (ADR-0010) that a NEWLY-exposed entity (procurements, plus milestones
-- → project_milestones) is readable under the caller JWT but ONLY for the caller's own org: a
-- cross-org caller reads ZERO rows. RLS is the enforcement authority; the agent's broadened
-- entity catalogue adds no privilege (every read is under the caller JWT, capped row-by-row by the
-- org-scoped SELECT policy procurements_select / project_milestones_select).
--
-- Modeled on 0090_agent_query_entity_rls.test.sql. Org A = seed '00000000-…-0001'; Org B = '01140000-…-0002'.
-- Fixture namespace: 01140000-….
begin;
select plan(8);

-- ── Fixtures (inserted as table owner, bypassing RLS) ─────────────────────────
insert into organizations (id, name) values
  ('01140000-0000-0000-0000-000000000002','Agent Broadened Read Org B');

insert into auth.users (id, email) values
  ('01140000-0000-0000-0000-0000000000a1','brd-alice@example.com'),
  ('01140000-0000-0000-0000-0000000000b1','brd-bob@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01140000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','Brd Alice','brd-alice@example.com','Project Manager'),
  ('01140000-0000-0000-0000-0000000000b1','01140000-0000-0000-0000-000000000002','Brd Bob','brd-bob@example.com','Project Manager');

-- Org-A + Org-B procurement cases (minimal: title + status are the only required fields; the
-- agent-curated read columns include the optional ones, but the RLS proof only needs org-scoped rows).
insert into procurements (id, org_id, title, status) values
  ('01140000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Org A PR','Draft'),
  ('01140000-0000-0000-0000-000000000011','01140000-0000-0000-0000-000000000002','Org B PR','Draft');

-- Org-A + Org-B projects (parents for the milestones below; project_milestones.project_id is NOT NULL).
insert into projects (id, org_id, name) values
  ('01140000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Org A Project'),
  ('01140000-0000-0000-0000-000000000002','01140000-0000-0000-0000-000000000002','Org B Project');

-- Org-A + Org-B milestones (project_id NOT NULL → reference the projects just inserted).
insert into project_milestones (id, org_id, project_id, name) values
  ('01140000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','01140000-0000-0000-0000-000000000001','Org A Milestone'),
  ('01140000-0000-0000-0000-000000000021','01140000-0000-0000-0000-000000000002','01140000-0000-0000-0000-000000000002','Org B Milestone');

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AR-BRD-001: procurements (newly exposed) — org-A caller sees her own, zero of org-B.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01140000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from procurements where org_id = '01140000-0000-0000-0000-000000000002'),
  0,
  'AC-AR-BRD-001: newly-exposed procurements — org-A caller reads ZERO org-B rows (RLS ceiling)');
select ok(
  (select count(*)::int from procurements where org_id = '00000000-0000-0000-0000-000000000001') >= 1,
  'AC-AR-BRD-001: positive control — org-A caller sees her own org-A procurement');

reset role;

-- Org-B caller: sees her own, zero of org-A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01140000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(
  (select count(*)::int from procurements where org_id = '00000000-0000-0000-0000-000000000001'),
  0,
  'AC-AR-BRD-001: org-B caller reads ZERO org-A procurements');
select ok(
  (select count(*)::int from procurements where org_id = '01140000-0000-0000-0000-000000000002') >= 1,
  'AC-AR-BRD-001: org-B caller sees her own org-B procurement');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AR-BRD-002: milestones (friendly key → project_milestones) — same org wall.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"01140000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select count(*)::int from project_milestones where org_id = '01140000-0000-0000-0000-000000000002'),
  0,
  'AC-AR-BRD-002: newly-exposed milestones — org-A caller reads ZERO org-B rows');
select ok(
  (select count(*)::int from project_milestones where org_id = '00000000-0000-0000-0000-000000000001') >= 1,
  'AC-AR-BRD-002: positive control — org-A caller sees her own org-A milestone');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AC-AR-BRD-003: schema guard — every newly-exposed table HAS RLS enabled + an org/owner-scoped
-- SELECT policy (the precondition for safe exposure). RLS enabled is the load-bearing check; the
-- org/owner scope is the cross-tenant wall this whole defect relies on.
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname in ('procurements','project_milestones','timesheets') and c.relrowsecurity),
  3,
  'AC-AR-BRD-003: all three newly-exposed tables have row level security ENABLED');
select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and cmd='SELECT'
       and tablename in ('procurements','project_milestones','timesheets')
       and (qual ilike '%auth_org_id()%')),
  3,
  'AC-AR-BRD-003: every newly-exposed table has an org-scoped (auth_org_id) SELECT policy');

select * from finish();
rollback;
