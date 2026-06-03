begin;
select plan(2);

-- Fixtures (inserted as table owner, bypassing RLS).
insert into projects (id, org_id, name, status) values
  ('c1111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Idx Test Project','Ongoing Project');

-- AC-108: at most one Active budget version per project (budget_versions_one_active_idx).
insert into budget_versions (id, project_id, version, name, status) values
  ('c2222222-0000-0000-0000-000000000001','c1111111-0000-0000-0000-000000000001',1,'V1','Active');
select throws_ok(
  $$ insert into budget_versions (project_id, version, name, status)
     values ('c1111111-0000-0000-0000-000000000001',2,'V2','Active') $$,
  '23505', null,
  'AC-108: a second Active budget version per project is rejected (partial unique index)');

-- AC-108: at most one selected quote per procurement (procurement_quotations_one_selected_idx).
insert into companies (id, org_id, name, type) values
  ('c3333333-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Vendor X','Vendor');
insert into procurements (id, org_id, title, status) values
  ('c4444444-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Idx Proc','Vendor Quoted');
insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, is_selected) values
  ('c4444444-0000-0000-0000-000000000001','c3333333-0000-0000-0000-000000000001','Q1',100,true);
select throws_ok(
  $$ insert into procurement_quotations (procurement_id, vendor_id, reference, total_amount, is_selected)
     values ('c4444444-0000-0000-0000-000000000001','c3333333-0000-0000-0000-000000000001','Q2',90,true) $$,
  '23505', null,
  'AC-108: a second selected quote per procurement is rejected (partial unique index)');

select * from finish();
rollback;
