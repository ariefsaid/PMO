-- Purchase-specific defaults, separation of duties, and senior escalation.
begin;
select plan(10);
insert into organizations (id,name,default_currency,built_in_roles_enabled) values ('fa040000-0000-0000-0000-000000000001','Default purchase routing','USD',true);
insert into auth.users(id,email) values
('fa040000-0000-0000-0000-000000000011','rr4-admin@example.test'),
('fa040000-0000-0000-0000-000000000012','rr4-requester@example.test'),
('fa040000-0000-0000-0000-000000000013','rr4-deputy@example.test'),
('fa040000-0000-0000-0000-000000000014','rr4-procurement@example.test'),
('fa040000-0000-0000-0000-000000000015','rr4-senior@example.test');
insert into auth.users(id,email) values
('fa040000-0000-0000-0000-000000000016','rr4-pm@example.test'),
('fa040000-0000-0000-0000-000000000017','rr4-gone@example.test');
insert into profiles (id,org_id,full_name,email,role,status,built_in_role) values
('fa040000-0000-0000-0000-000000000011','fa040000-0000-0000-0000-000000000001','Admin','rr4-admin@example.test','Admin','active',null),
('fa040000-0000-0000-0000-000000000012','fa040000-0000-0000-0000-000000000001','Buyer','rr4-requester@example.test','Engineer','active','buyer'),
('fa040000-0000-0000-0000-000000000013','fa040000-0000-0000-0000-000000000001','Deputy','rr4-deputy@example.test','Project Manager','active','deputy_project_manager'),
('fa040000-0000-0000-0000-000000000014','fa040000-0000-0000-0000-000000000001','Procurement','rr4-procurement@example.test','Project Manager','active','procurement_manager'),
('fa040000-0000-0000-0000-000000000015','fa040000-0000-0000-0000-000000000001','Senior','rr4-senior@example.test','Finance','active',null),
('fa040000-0000-0000-0000-000000000016','fa040000-0000-0000-0000-000000000001','Manager','rr4-pm@example.test','Project Manager','active',null),
('fa040000-0000-0000-0000-000000000017','fa040000-0000-0000-0000-000000000001','Gone Procurement','rr4-gone@example.test','Project Manager','disabled','procurement_manager');
insert into projects(id,org_id,name,status,currency,deputy_manager_id) values ('fa040000-0000-0000-0000-000000000021','fa040000-0000-0000-0000-000000000001','Default project','Ongoing Project','USD','fa040000-0000-0000-0000-000000000013');
insert into budget_versions(id,org_id,project_id,version,name,status,currency) values ('fa040000-0000-0000-0000-000000000031','fa040000-0000-0000-0000-000000000001','fa040000-0000-0000-0000-000000000021',1,'budget','Draft','USD');
insert into budget_line_items(org_id,budget_version_id,category,budgeted_amount) values ('fa040000-0000-0000-0000-000000000001','fa040000-0000-0000-0000-000000000031','Materials',1000);
update budget_versions set status='Active' where id='fa040000-0000-0000-0000-000000000031';
insert into spend_approvers(org_id,project_id,profile_id) values ('fa040000-0000-0000-0000-000000000001',null,'fa040000-0000-0000-0000-000000000015');
insert into procurements(id,org_id,title,status,total_value,project_id,currency,budget_category,requested_by_id,purchase_type_id)
select x.id::uuid, 'fa040000-0000-0000-0000-000000000001', x.title, 'Requested', x.amount, 'fa040000-0000-0000-0000-000000000021', 'USD', 'Materials', x.requester::uuid, t.id
from (values
('fa040000-0000-0000-0000-000000000041','Goods',100::numeric,'fa040000-0000-0000-0000-000000000012','Goods'),
('fa040000-0000-0000-0000-000000000042','Service',100::numeric,'fa040000-0000-0000-0000-000000000012','Service'),
('fa040000-0000-0000-0000-000000000043','Own request',100::numeric,'fa040000-0000-0000-0000-000000000013','Goods'),
('fa040000-0000-0000-0000-000000000044','Over budget',2000::numeric,'fa040000-0000-0000-0000-000000000012','Goods')) x(id,title,amount,requester,type_name)
join purchase_types t on t.org_id='fa040000-0000-0000-0000-000000000001' and t.name=x.type_name;
insert into projects(id,org_id,name,status,currency,project_manager_id,deputy_manager_id) values
('fa040000-0000-0000-0000-000000000022','fa040000-0000-0000-0000-000000000001','No deputy','Ongoing Project','USD','fa040000-0000-0000-0000-000000000016',null),
('fa040000-0000-0000-0000-000000000023','fa040000-0000-0000-0000-000000000001','Named approver','Ongoing Project','USD','fa040000-0000-0000-0000-000000000016','fa040000-0000-0000-0000-000000000013');
insert into budget_versions(id,org_id,project_id,version,name,status,currency) values
('fa040000-0000-0000-0000-000000000032','fa040000-0000-0000-0000-000000000001','fa040000-0000-0000-0000-000000000022',1,'b2','Draft','USD'),('fa040000-0000-0000-0000-000000000033','fa040000-0000-0000-0000-000000000001','fa040000-0000-0000-0000-000000000023',1,'b3','Draft','USD');
insert into budget_line_items(org_id,budget_version_id,category,budgeted_amount) values ('fa040000-0000-0000-0000-000000000001','fa040000-0000-0000-0000-000000000032','Materials',1000),('fa040000-0000-0000-0000-000000000001','fa040000-0000-0000-0000-000000000033','Materials',1000);
update budget_versions set status='Active' where id in ('fa040000-0000-0000-0000-000000000032','fa040000-0000-0000-0000-000000000033');
insert into spend_approvers(org_id,project_id,profile_id) values ('fa040000-0000-0000-0000-000000000001','fa040000-0000-0000-0000-000000000023','fa040000-0000-0000-0000-000000000014');
insert into procurements(id,org_id,title,status,total_value,project_id,currency,budget_category,requested_by_id,purchase_type_id)
select x.id::uuid,'fa040000-0000-0000-0000-000000000001',x.title,'Requested',100,x.project::uuid,'USD','Materials','fa040000-0000-0000-0000-000000000012',t.id
from (values ('fa040000-0000-0000-0000-000000000045','No deputy goods','fa040000-0000-0000-0000-000000000022','Goods'),('fa040000-0000-0000-0000-000000000047','Named approver goods','fa040000-0000-0000-0000-000000000023','Goods')) x(id,title,project,type_name)
join purchase_types t on t.org_id='fa040000-0000-0000-0000-000000000001' and t.name=x.type_name;
insert into procurements(id,org_id,title,status,total_value,project_id,currency,budget_category,requested_by_id,purchase_type_id,rental_from,rental_to)
select 'fa040000-0000-0000-0000-000000000046','fa040000-0000-0000-0000-000000000001','Rental','Requested',100,'fa040000-0000-0000-0000-000000000021','USD','Materials','fa040000-0000-0000-0000-000000000012',t.id,'2026-12-01','2026-12-10'
from purchase_types t where t.org_id='fa040000-0000-0000-0000-000000000001' and t.name='Rental';
set local role authenticated;
set local request.jwt.claims = '{"sub":"fa040000-0000-0000-0000-000000000011","role":"authenticated"}';
select is((select route from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000041']::uuid[])),'project','AC-003 goods use project default');
select is((select approvers->0->>'id' from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000041']::uuid[])),'fa040000-0000-0000-0000-000000000013','AC-003 goods name the deputy');
select is((select approvers->0->>'id' from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000042']::uuid[])),'fa040000-0000-0000-0000-000000000014','AC-004 service names Procurement Manager');
select is((select route from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000043']::uuid[])),'admin','AC-005 sole requester falls to Admin');
select is((select approvers->0->>'id' from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000044']::uuid[])),'fa040000-0000-0000-0000-000000000015','AC-006 over budget remains senior first');
select is((select approvers->0->>'id' from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000045']::uuid[])),'fa040000-0000-0000-0000-000000000016','AC-003 no deputy: the project manager');
select is((select jsonb_array_length(approvers) from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000046']::uuid[])),1,'AC-004 rental: active Procurement Managers only (an inactive holder is skipped)');
select is((select approvers->0->>'id' from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000046']::uuid[])),'fa040000-0000-0000-0000-000000000014','AC-004 rental names the Procurement Manager');
select is((select approvers->0->>'id' from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000047']::uuid[])),'fa040000-0000-0000-0000-000000000014','AC-003 a named project approver is used, never the default');
select is((select count(*)::int from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000047']::uuid[]) where route='project'),1,'AC-003 named approver keeps the project route');
select * from finish();
rollback;
