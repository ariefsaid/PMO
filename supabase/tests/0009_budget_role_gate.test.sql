begin;
select plan(8);

-- Fixtures (inserted as table owner, bypassing RLS).
insert into organizations (id, name) values
  ('e0000000-0000-0000-0000-000000000001','Role Gate Test Org');

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-0000000000a1','eng-rg@example.com'),
  ('e0000000-0000-0000-0000-0000000000a2','pm-rg@example.com'),
  ('e0000000-0000-0000-0000-0000000000a3','finance-rg@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('e0000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-000000000001','Eng RG','eng-rg@example.com','Engineer'),
  ('e0000000-0000-0000-0000-0000000000a2','e0000000-0000-0000-0000-000000000001','PM RG','pm-rg@example.com','Project Manager'),
  ('e0000000-0000-0000-0000-0000000000a3','e0000000-0000-0000-0000-000000000001','Finance RG','finance-rg@example.com','Finance');

insert into projects (id, org_id, name, status) values
  ('e1111111-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','Role Gate Project','Ongoing Project');

-- Insert Draft version + line-item as table owner (bypasses RLS + trigger since status=Draft).
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('e2222222-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','e1111111-0000-0000-0000-000000000001',1,'v1 Draft','Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount) values
  ('e3333333-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001','e2222222-0000-0000-0000-000000000001','Labor','Engineer labor',100000);

-- ── T17: Engineer role ────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-728: Engineer can SELECT budget_versions.
select is(
  (select count(*)::int from budget_versions where project_id = 'e1111111-0000-0000-0000-000000000001'),
  1,
  'AC-728: Engineer can SELECT budget_versions (read allowed)');

-- AC-728: Engineer can SELECT budget_line_items.
select is(
  (select count(*)::int from budget_line_items where budget_version_id = 'e2222222-0000-0000-0000-000000000001'),
  1,
  'AC-728: Engineer can SELECT budget_line_items (read allowed)');

-- AC-728: Engineer cannot INSERT into budget_versions (role gate = 42501).
select throws_ok(
  $$ insert into budget_versions (org_id, project_id, version, name, status)
     values ('e0000000-0000-0000-0000-000000000001','e1111111-0000-0000-0000-000000000001',99,'Eng version','Draft') $$,
  '42501', null,
  'AC-728: Engineer INSERT into budget_versions blocked (42501)');

-- AC-728: Engineer cannot INSERT into budget_line_items (role gate = 42501).
select throws_ok(
  $$ insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount)
     values ('e0000000-0000-0000-0000-000000000001','e2222222-0000-0000-0000-000000000001','Materials',5000) $$,
  '42501', null,
  'AC-728: Engineer INSERT into budget_line_items blocked (42501)');

reset role;

-- ── T18: Project Manager may write ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- AC-729: PM can INSERT a Draft budget_versions row.
select lives_ok(
  $$ insert into budget_versions (org_id, project_id, version, name, status)
     values ('e0000000-0000-0000-0000-000000000001','e1111111-0000-0000-0000-000000000001',2,'PM Draft','Draft') $$,
  'AC-729: Project Manager can INSERT a Draft budget_versions row');

-- AC-729: PM can INSERT a budget_line_items row (into the Draft v1).
select lives_ok(
  $$ insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount)
     values ('e0000000-0000-0000-0000-000000000001','e2222222-0000-0000-0000-000000000001','Materials',25000) $$,
  'AC-729: Project Manager can INSERT a budget_line_items row');

reset role;

-- ── T18: Finance role may write ───────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"e0000000-0000-0000-0000-0000000000a3","role":"authenticated"}';

-- AC-729: Finance can INSERT a Draft budget_versions row.
select lives_ok(
  $$ insert into budget_versions (org_id, project_id, version, name, status)
     values ('e0000000-0000-0000-0000-000000000001','e1111111-0000-0000-0000-000000000001',3,'Finance Draft','Draft') $$,
  'AC-729: Finance role can INSERT a Draft budget_versions row');

-- AC-729: Finance can INSERT a budget_line_items row (into the Draft v1).
select lives_ok(
  $$ insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount)
     values ('e0000000-0000-0000-0000-000000000001','e2222222-0000-0000-0000-000000000001','Overheads',10000) $$,
  'AC-729: Finance role can INSERT a budget_line_items row');

reset role;
select * from finish();
rollback;
