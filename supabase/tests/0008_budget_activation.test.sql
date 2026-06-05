begin;
select plan(3);

-- Fixtures (inserted as table owner, bypassing RLS).
insert into organizations (id, name) values
  ('d0000000-0000-0000-0000-000000000001','Activation Test Org');

insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-0000000000a1','pm-act@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('d0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-000000000001','PM Act','pm-act@example.com','Project Manager');

insert into projects (id, org_id, name, status) values
  ('d1111111-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','Budget Act Project','Ongoing Project');

-- v1 Active with a line-item, v2 Draft (inserted as table owner so the trigger passes on Draft).
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('d2222222-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','d1111111-0000-0000-0000-000000000001',1,'Initial Budget','Active'),
  ('d2222222-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000001','d1111111-0000-0000-0000-000000000001',2,'Revised Budget','Draft');

-- Insert line-item while v1 is Active would be blocked by trigger; insert against the Draft v2 instead.
-- For v1 we bypass by inserting directly as table owner in the same txn before RLS is set.
insert into budget_line_items (org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('d0000000-0000-0000-0000-000000000001','d2222222-0000-0000-0000-000000000002','Labor','Team costs',500000,0);

-- Become the PM.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- Activate v2 (Draft → Active).
select lives_ok(
  $$ select activate_budget_version('d2222222-0000-0000-0000-000000000002') $$,
  'AC-727: activate_budget_version succeeds for PM on a Draft version');

-- AC-727: v2 is now Active.
select is(
  (select status::text from budget_versions where id = 'd2222222-0000-0000-0000-000000000002'),
  'Active',
  'AC-727: the activated version (v2) is now Active');

-- AC-727: exactly one Active per project (v1 was archived); single-Active invariant holds.
select is(
  (select count(*)::int from budget_versions
   where project_id = 'd1111111-0000-0000-0000-000000000001' and status = 'Active'),
  1,
  'AC-727: exactly one Active version per project after activation (single-Active invariant)');

reset role;
select * from finish();
rollback;
