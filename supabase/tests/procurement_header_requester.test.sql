-- Requester header edits remain scoped to an active member and editable case.
begin;
select plan(19);
insert into organizations(id,name) values ('e6050000-0000-0000-0000-000000000001','Header org'),('e6050000-0000-0000-0000-000000000002','Other header org');
insert into auth.users(id,email) values ('e6050000-0000-0000-0000-000000000011','header-owner@example.test'),('e6050000-0000-0000-0000-000000000012','header-other@example.test'),('e6050000-0000-0000-0000-000000000013','header-admin@example.test'),('e6050000-0000-0000-0000-000000000014','header-outside@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('e6050000-0000-0000-0000-000000000011','e6050000-0000-0000-0000-000000000001','Owner','header-owner@example.test','Engineer','active'),
 ('e6050000-0000-0000-0000-000000000012','e6050000-0000-0000-0000-000000000001','Other','header-other@example.test','Engineer','active'),
 ('e6050000-0000-0000-0000-000000000013','e6050000-0000-0000-0000-000000000001','Admin','header-admin@example.test','Admin','active'),
 ('e6050000-0000-0000-0000-000000000014','e6050000-0000-0000-0000-000000000002','Outside','header-outside@example.test','Admin','active');
insert into projects(id,org_id,name,status) values ('e6050000-0000-0000-0000-000000000021','e6050000-0000-0000-0000-000000000001','Project','Ongoing Project'),('e6050000-0000-0000-0000-000000000022','e6050000-0000-0000-0000-000000000002','Outside project','Ongoing Project');
insert into companies(id,org_id,name,type) values ('e6050000-0000-0000-0000-000000000023','e6050000-0000-0000-0000-000000000001','Supplier','Vendor'),('e6050000-0000-0000-0000-000000000024','e6050000-0000-0000-0000-000000000002','Outside supplier','Vendor');
insert into procurements(id,org_id,title,status,requested_by_id,budget_category) values
 ('e6050000-0000-0000-0000-000000000031','e6050000-0000-0000-0000-000000000001','Draft','Draft','e6050000-0000-0000-0000-000000000011','Materials'),
 ('e6050000-0000-0000-0000-000000000032','e6050000-0000-0000-0000-000000000001','Rejected','Rejected','e6050000-0000-0000-0000-000000000011',null),
 ('e6050000-0000-0000-0000-000000000033','e6050000-0000-0000-0000-000000000001','Requested','Requested','e6050000-0000-0000-0000-000000000011',null);
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6050000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"title":"Changed","project_id":"e6050000-0000-0000-0000-000000000021","vendor_id":"e6050000-0000-0000-0000-000000000023"}') $$, 'Requester edits their Draft');
select is((select title from procurements where id='e6050000-0000-0000-0000-000000000031'),'Changed','Draft title persists');
select is((select budget_category from procurements where id='e6050000-0000-0000-0000-000000000031'),'Materials','Omitted category stays unchanged');
select lives_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000032','{"title":"Revised","budget_category":null}') $$, 'Requester edits their Rejected case');
select throws_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000033','{"title":"No"}') $$, '42501', null, 'Submitted case cannot be edited');
select throws_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"status":"Requested"}') $$, '22023', null, 'Status is not a header field');
select throws_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"requested_by_id":"e6050000-0000-0000-0000-000000000012"}') $$, '22023', null, 'Requester identity is not a header field');
select throws_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"currency":"USD"}') $$, '22023', null, 'Currency is not a header field');
select throws_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"project_id":"e6050000-0000-0000-0000-000000000022"}') $$, '42501', null, 'Other organization project cannot be linked');
select throws_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"vendor_id":"e6050000-0000-0000-0000-000000000024"}') $$, '42501', null, 'Other organization supplier cannot be linked');
set local request.jwt.claims = '{"sub":"e6050000-0000-0000-0000-000000000012","role":"authenticated"}';
select throws_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"title":"No"}') $$, '42501', null, 'Other Engineer cannot edit the requester case');
select throws_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"title":"No","requested_by_id":"e6050000-0000-0000-0000-000000000012"}') $$, '22023', null, 'Caller cannot claim the requester identity');
set local request.jwt.claims = '{"sub":"e6050000-0000-0000-0000-000000000014","role":"authenticated"}';
select throws_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"title":"No"}') $$, '42501', null, 'Other organization Admin cannot edit the case');
set local request.jwt.claims = '{"sub":"e6050000-0000-0000-0000-000000000013","role":"authenticated"}';
select lives_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"title":"Admin edit"}') $$, 'Same organization Admin can edit Draft');
reset role;
update profiles set status='disabled' where id='e6050000-0000-0000-0000-000000000011';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e6050000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"title":"No"}') $$, '42501', null, 'Inactive requester cannot edit');
reset role;
update profiles set status='active' where id='e6050000-0000-0000-0000-000000000011';
insert into org_features(org_id,feature_key,enabled) values ('e6050000-0000-0000-0000-000000000001','procurement',false);
set local role authenticated;
select throws_ok($$ select public.update_procurement_header('e6050000-0000-0000-0000-000000000031','{"title":"No"}') $$, '42501', null, 'Disabled procurement cannot be edited');
reset role;
select ok(not coalesce(has_function_privilege('anon',to_regprocedure('public.update_procurement_header(uuid,jsonb)'),'EXECUTE'),false),'Anonymous execution is denied');
select ok(coalesce(has_function_privilege('authenticated',to_regprocedure('public.update_procurement_header(uuid,jsonb)'),'EXECUTE'),false),'Authenticated execution is granted');
select is((select title from procurements where id='e6050000-0000-0000-0000-000000000031'),'Admin edit','Denied edits did not alter the case');
select * from finish();
rollback;
