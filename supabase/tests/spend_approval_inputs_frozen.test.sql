-- spend_approval_inputs_frozen.test.sql — #803 FR-APR-020: once submitted, the inputs approval routing
-- decided on cannot be changed by a client; the server's quote selection still can change the total.
begin;
select plan(8);

insert into organizations (id, name, default_currency) values ('02344000-0000-0000-0000-00000000000a','APR Frz Org','IDR');
insert into auth.users (id, email) values
  ('02344000-0000-0000-0000-0000000000a1','apr-frz-pm@example.com'),
  ('02344000-0000-0000-0000-0000000000a2','apr-frz-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02344000-0000-0000-0000-0000000000a1','02344000-0000-0000-0000-00000000000a','Frz PM','apr-frz-pm@example.com','Project Manager','active'),
  ('02344000-0000-0000-0000-0000000000a2','02344000-0000-0000-0000-00000000000a','Frz Eng','apr-frz-eng@example.com','Engineer','active');
insert into companies (id, org_id, name, type) values
  ('02344000-0000-0000-0000-0000000000b1','02344000-0000-0000-0000-00000000000a','Frz Vendor','Vendor');
insert into projects (id, org_id, name, status) values
  ('02344000-0000-0000-0000-000000000101','02344000-0000-0000-0000-00000000000a','Frz P1','Ongoing Project'),
  ('02344000-0000-0000-0000-000000000102','02344000-0000-0000-0000-00000000000a','Frz P2','Ongoing Project');
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, budget_category) values
  ('02344000-0000-0000-0000-000000000401','02344000-0000-0000-0000-00000000000a','Submitted','02344000-0000-0000-0000-000000000101','02344000-0000-0000-0000-0000000000a2','Requested',    100,'Materials'),
  ('02344000-0000-0000-0000-000000000402','02344000-0000-0000-0000-00000000000a','Draft',    '02344000-0000-0000-0000-000000000101','02344000-0000-0000-0000-0000000000a2','Draft',        100,'Materials'),
  ('02344000-0000-0000-0000-000000000403','02344000-0000-0000-0000-00000000000a','Quoting',  '02344000-0000-0000-0000-000000000101','02344000-0000-0000-0000-0000000000a2','Vendor Quoted',100,'Materials');
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount) values
  ('02344000-0000-0000-0000-0000000000c1','02344000-0000-0000-0000-00000000000a','02344000-0000-0000-0000-000000000403','02344000-0000-0000-0000-0000000000b1',250);

set local role authenticated;
set local request.jwt.claims = '{"sub":"02344000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok($$ update procurements set project_id = '02344000-0000-0000-0000-000000000102' where id = '02344000-0000-0000-0000-000000000401' $$,
  '42501', 'procurements.project_id cannot change after the request is submitted: approval routing was decided on it',
  'AC-APR-018: the project of a submitted request is fixed');
select throws_ok($$ update procurements set budget_category = 'Labor' where id = '02344000-0000-0000-0000-000000000401' $$,
  '42501', 'procurements.budget_category cannot change after the request is submitted: approval routing was decided on it',
  'AC-APR-018: the budget category of a submitted request is fixed');
select throws_ok($$ update procurements set total_value = 999 where id = '02344000-0000-0000-0000-000000000401' $$,
  '42501', 'procurements.total_value cannot change after the request is submitted: approval routing was decided on it',
  'AC-APR-018: the header total of a submitted request is fixed');
select lives_ok($$ update procurements set title = 'Renamed' where id = '02344000-0000-0000-0000-000000000401' $$,
  'AC-APR-018: a non-routing column is still editable');
select lives_ok($$ update procurements set project_id = '02344000-0000-0000-0000-000000000102' where id = '02344000-0000-0000-0000-000000000402' $$,
  'AC-APR-018: a Draft request''s project is still editable');
select lives_ok($$ select select_procurement_quote('02344000-0000-0000-0000-0000000000c1') $$,
  'AC-APR-018: quote selection (server path) still runs');
reset role;

select is((select project_id from procurements where id = '02344000-0000-0000-0000-000000000402'),
  '02344000-0000-0000-0000-000000000102'::uuid, 'AC-APR-018: the Draft edit landed');
select is((select total_value from procurements where id = '02344000-0000-0000-0000-000000000403'), 250::numeric,
  'AC-APR-018: quote selection set the total');

select * from finish();
rollback;
