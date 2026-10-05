-- 0241_budget_line_version_pin.test.sql — a budget line belongs to one version for life (FR-BV-011).
-- Moving a line between versions changes BOTH versions' contents, so the draft guard must see the line's
-- current version as well as its target, and the version id itself is immutable.
begin;
select plan(5);

insert into organizations (id, name) values
  ('ab410000-0000-0000-0000-000000000001','Line Pin Org');
insert into auth.users (id, email) values
  ('ab410000-0000-0000-0000-0000000000a1','pm-pin@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('ab410000-0000-0000-0000-0000000000a1','ab410000-0000-0000-0000-000000000001','PM Pin','pm-pin@example.com','Project Manager');
insert into projects (id, org_id, name, status) values
  ('ab411111-0000-0000-0000-000000000001','ab410000-0000-0000-0000-000000000001','Line Pin Project','Ongoing Project');

-- v1 Active with one line; v2 Draft with one line.
insert into budget_versions (id, org_id, project_id, version, name, status) values
  ('ab412222-0000-0000-0000-000000000001','ab410000-0000-0000-0000-000000000001','ab411111-0000-0000-0000-000000000001',1,'Active v1','Draft'),
  ('ab412222-0000-0000-0000-000000000002','ab410000-0000-0000-0000-000000000001','ab411111-0000-0000-0000-000000000001',2,'Draft v2','Draft');
insert into budget_line_items (id, org_id, budget_version_id, category, description, budgeted_amount, actual_amount) values
  ('ab413333-0000-0000-0000-000000000001','ab410000-0000-0000-0000-000000000001','ab412222-0000-0000-0000-000000000001','Labor','Approved line',500000,0),
  ('ab413333-0000-0000-0000-000000000002','ab410000-0000-0000-0000-000000000001','ab412222-0000-0000-0000-000000000002','Labor','Draft line',100000,0);
update budget_versions set status = 'Active' where id = 'ab412222-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"ab410000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ update budget_line_items set budget_version_id = 'ab412222-0000-0000-0000-000000000002'
     where id = 'ab413333-0000-0000-0000-000000000001' $$,
  'P0001', 'a budget line cannot move to another version',
  'AC-731: a line cannot be moved out of an Active version into a Draft');

select throws_ok(
  $$ update budget_line_items set budget_version_id = 'ab412222-0000-0000-0000-000000000001'
     where id = 'ab413333-0000-0000-0000-000000000002' $$,
  'P0001', 'a budget line cannot move to another version',
  'AC-731: a line cannot be moved out of a Draft into an Active version');

select lives_ok(
  $$ update budget_line_items set budgeted_amount = 120000
     where id = 'ab413333-0000-0000-0000-000000000002' $$,
  'AC-731: a Draft line can still be edited in place');

reset role;
select is(
  (select budget_version_id from budget_line_items where id = 'ab413333-0000-0000-0000-000000000001'),
  'ab412222-0000-0000-0000-000000000001'::uuid,
  'AC-731: the approved line is still in the Active version');
select is(
  (select budgeted_amount from budget_line_items where id = 'ab413333-0000-0000-0000-000000000002'),
  120000::numeric,
  'AC-731: the in-place Draft edit landed');

select * from finish();
rollback;
