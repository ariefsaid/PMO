-- budget_projections_rls.test.sql (P3c slice 0) — OWNS AC-BUD-052.
-- The PMO-owned forward view (FR-BUD-150, NFR-BUD-SEC-003/004): PMO grain (category), org-isolated,
-- OD-BUDGET-3 role-gated, with the parent-project-org guard. Inline fixture idiom. Namespaced 0b3d UUIDs.
begin;
select plan(7);

-- Org A + Org B; a Finance (OD-BUDGET-3) and an Engineer (not) in A, a Finance in B; a project in each.
insert into organizations (id, name) values
  ('0b3d0000-0000-0000-0000-000000000001','AC-BUD proj Org A'),
  ('0b3d0000-0000-0000-0000-000000000002','AC-BUD proj Org B');
insert into auth.users (id, email) values
  ('0b3d0000-0000-0000-0000-0000000000a1','proj-finance-a@example.com'),
  ('0b3d0000-0000-0000-0000-0000000000a2','proj-eng-a@example.com'),
  ('0b3d0000-0000-0000-0000-0000000000b1','proj-finance-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('0b3d0000-0000-0000-0000-0000000000a1','0b3d0000-0000-0000-0000-000000000001','A Finance','proj-finance-a@example.com','Finance','active'),
  ('0b3d0000-0000-0000-0000-0000000000a2','0b3d0000-0000-0000-0000-000000000001','A Engineer','proj-eng-a@example.com','Engineer','active'),
  ('0b3d0000-0000-0000-0000-0000000000b1','0b3d0000-0000-0000-0000-000000000002','B Finance','proj-finance-b@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('0b3d0000-0000-0000-0000-0000000000c1','0b3d0000-0000-0000-0000-000000000001','Proj A','Ongoing Project');

-- ── Structure: PMO grain (category) + the upsert-target unique ──────────────────────────────────
select has_table('public','budget_projections', 'AC-BUD-052 budget_projections exists');
select col_type_is('public','budget_projections','category','budget_category',
                   'AC-BUD-052 the projection is at PMO grain (category), not ERP account grain');
select col_is_unique('public','budget_projections', array['org_id','project_id','fiscal_year','category'],
                     'AC-BUD-052 one ETC per (org, project, fy, category) — the upsert target');

-- ── Finance (OD-BUDGET-3) may author an ETC on its own project ──────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"0b3d0000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$insert into public.budget_projections (project_id, fiscal_year, category, pmo_etc)
      values ('0b3d0000-0000-0000-0000-0000000000c1','2026','Labor',35000.00)$$,
  'AC-BUD-052 Finance (OD-BUDGET-3) may author an ETC');

-- ── Engineer is DENIED (OD-BUDGET-3 gate) ───────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"0b3d0000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$insert into public.budget_projections (project_id, fiscal_year, category, pmo_etc)
      values ('0b3d0000-0000-0000-0000-0000000000c1','2026','Materials',100.00)$$,
  '42501', null, 'AC-BUD-052 Engineer ETC write denied 42501 (OD-BUDGET-3 gate)');

-- ── Cross-org: Org-B Finance cannot author against Org-A's project (parent-project-org guard) ────
set local request.jwt.claims = '{"sub":"0b3d0000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$insert into public.budget_projections (project_id, fiscal_year, category, pmo_etc)
      values ('0b3d0000-0000-0000-0000-0000000000c1','2026','Labor',1.00)$$,
  '42501', null, 'AC-BUD-052 cross-org ETC write denied 42501');
select is((select count(*)::int from public.budget_projections), 0,
          'AC-BUD-052 org B cannot read org A ETC rows');

select finish();
rollback;
