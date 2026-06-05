begin;
select plan(3);

-- Fixtures (inserted as table owner, bypassing RLS).
insert into organizations (id, name) values
  ('ab000000-0000-0000-0000-000000000001','Draft Guard Org');

insert into auth.users (id, email) values
  ('ab000000-0000-0000-0000-0000000000a1','pm-dg@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('ab000000-0000-0000-0000-0000000000a1','ab000000-0000-0000-0000-000000000001','PM DG','pm-dg@example.com','Project Manager');

insert into projects (id, org_id, name, status) values
  ('ab111111-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','Draft Guard Project','Ongoing Project');

-- Insert as Draft first, then promote to Active (mirrors seed pattern — trigger blocks inserting into Active).
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('ab222222-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','ab111111-0000-0000-0000-000000000001',1,'Active v1','Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('ab333333-0000-0000-0000-000000000001','ab000000-0000-0000-0000-000000000001','ab222222-0000-0000-0000-000000000001','Labor','Line item',500000,0);
-- Promote to Active as table owner.
update budget_versions set status = 'Active' where id = 'ab222222-0000-0000-0000-000000000001';

-- Become the PM.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ab000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-731: INSERT a line-item into an Active version is rejected (P0001 from enforce_draft_line_item trigger).
select throws_ok(
  $$ insert into budget_line_items (org_id, budget_version_id, category, budgeted_amount)
     values ('ab000000-0000-0000-0000-000000000001','ab222222-0000-0000-0000-000000000001','Materials',10000) $$,
  'P0001', null,
  'AC-731: INSERT into Active version rejected by budget_line_items_draft_guard trigger (P0001)');

-- AC-731: UPDATE an existing line-item on an Active version is rejected (P0001).
select throws_ok(
  $$ update budget_line_items set budgeted_amount = 999999
     where id = 'ab333333-0000-0000-0000-000000000001' $$,
  'P0001', null,
  'AC-731: UPDATE on Active version line-item rejected by budget_line_items_draft_guard trigger (P0001)');

-- AC-731: DELETE an existing line-item on an Active version is rejected (P0001).
select throws_ok(
  $$ delete from budget_line_items where id = 'ab333333-0000-0000-0000-000000000001' $$,
  'P0001', null,
  'AC-731: DELETE on Active version line-item rejected by budget_line_items_draft_guard trigger (P0001)');

reset role;
select * from finish();
rollback;
