begin;
select plan(4);

-- Fixtures: two orgs with a project + Draft version each (inserted as table owner).
insert into organizations (id, name) values
  ('f0000000-0000-0000-0000-000000000001','Tenant A'),
  ('f0000000-0000-0000-0000-000000000002','Tenant B');

insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-0000000000a1','pm-a@example.com'),
  ('f0000000-0000-0000-0000-0000000000b1','pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('f0000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-000000000001','PM Tenant A','pm-a@example.com','Project Manager'),
  ('f0000000-0000-0000-0000-0000000000b1','f0000000-0000-0000-0000-000000000002','PM Tenant B','pm-b@example.com','Project Manager');

insert into projects (id, org_id, name, status) values
  ('f1111111-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','Project Tenant A','Ongoing Project'),
  ('f1111111-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000002','Project Tenant B','Ongoing Project');

insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('f2222222-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','f1111111-0000-0000-0000-000000000001',1,'A Draft','Draft'),
  ('f2222222-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000002','f1111111-0000-0000-0000-000000000002',1,'B Draft','Draft');

insert into budget_line_items (id, org_id, budget_version_id, category, budgeted_amount) values
  ('f3333333-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','f2222222-0000-0000-0000-000000000001','Labor',100000),
  ('f3333333-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000002','f2222222-0000-0000-0000-000000000002','Labor',200000);

-- Become org-A PM.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-730: org-A PM sees only org-A budget_versions (not org-B).
select is(
  (select count(*)::int from budget_versions),
  1,
  'AC-730: org-A PM sees only org-A budget_versions (SELECT isolation)');

-- AC-730: org-A PM sees only org-A budget_line_items (not org-B).
select is(
  (select count(*)::int from budget_line_items),
  1,
  'AC-730: org-A PM sees only org-A budget_line_items (SELECT isolation)');

-- AC-730: org-A PM cannot INSERT a budget_versions row stamped with org-B org_id.
select throws_ok(
  $$ insert into budget_versions (org_id, project_id, version, name, status)
     values ('f0000000-0000-0000-0000-000000000002','f1111111-0000-0000-0000-000000000001',99,'Spoofed','Draft') $$,
  '42501', null,
  'AC-730: inserting budget_versions with org-B org_id rejected (WRITE cross-org isolation)');

-- AC-730: org-A PM cannot INSERT a budget_line_items row whose parent version belongs to org-B
-- (parent-org guard in budget_line_items_write policy).
select throws_ok(
  $$ insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount)
     values ('f0000000-0000-0000-0000-000000000001','f2222222-0000-0000-0000-000000000002','Materials',5000) $$,
  '42501', null,
  'AC-730: inserting line-item with org-B parent version rejected (parent-org guard)');

reset role;
select * from finish();
rollback;
