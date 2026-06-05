begin;
select plan(4);

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

-- AC-731: search_path-injection resistance (audit LOW-BV-1). Plant a pg_temp.budget_versions shadow that
-- reports every version as 'Draft' and prepend pg_temp to search_path; because enforce_draft_line_item()
-- pins `set search_path = public` and schema-qualifies public.budget_versions, the trigger still reads the
-- real Active status and rejects the UPDATE (P0001) rather than resolving the spoofed Draft shadow.
create table pg_temp.budget_versions (id uuid, status text);
insert into pg_temp.budget_versions (id, status)
  values ('ab222222-0000-0000-0000-000000000001','Draft');
-- The shadow is put on the path only inside the asserted statement (so pgTAP's own functions stay
-- resolvable for throws_ok). public.budget_line_items is fully qualified; the trigger's own pinned
-- search_path is what must keep it reading public.budget_versions despite pg_temp being first here.
select throws_ok(
  $$ set local search_path = pg_temp, public;
     update public.budget_line_items set budgeted_amount = 123456
     where id = 'ab333333-0000-0000-0000-000000000001' $$,
  'P0001', null,
  'AC-731: pg_temp.budget_versions shadow cannot spoof Draft — trigger search_path pin holds (P0001)');

reset role;
select * from finish();
rollback;
