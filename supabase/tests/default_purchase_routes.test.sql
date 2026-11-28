-- Purchase-specific defaults, separation of duties, and senior escalation.
begin;
select plan(5);
insert into organizations (id,name,default_currency,built_in_roles_enabled) values ('fa040000-0000-0000-0000-000000000001','Default purchase routing','USD',true);
insert into auth.users(id,email) values
('fa040000-0000-0000-0000-000000000011','rr4-admin@example.test'),
('fa040000-0000-0000-0000-000000000012','rr4-requester@example.test'),
('fa040000-0000-0000-0000-000000000013','rr4-deputy@example.test'),
('fa040000-0000-0000-0000-000000000014','rr4-procurement@example.test'),
('fa040000-0000-0000-0000-000000000015','rr4-senior@example.test');
insert into profiles (id,org_id,full_name,email,role,status,built_in_role) values
('fa040000-0000-0000-0000-000000000011','fa040000-0000-0000-0000-000000000001','Admin','rr4-admin@example.test','Admin','active',null),
('fa040000-0000-0000-0000-000000000012','fa040000-0000-0000-0000-000000000001','Buyer','rr4-requester@example.test','Engineer','active','buyer'),
('fa040000-0000-0000-0000-000000000013','fa040000-0000-0000-0000-000000000001','Deputy','rr4-deputy@example.test','Project Manager','active','deputy_project_manager'),
('fa040000-0000-0000-0000-000000000014','fa040000-0000-0000-0000-000000000001','Procurement','rr4-procurement@example.test','Project Manager','active','procurement_manager'),
('fa040000-0000-0000-0000-000000000015','fa040000-0000-0000-0000-000000000001','Senior','rr4-senior@example.test','Finance','active',null);
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
set local role authenticated;
set local request.jwt.claims = '{"sub":"fa040000-0000-0000-0000-000000000011","role":"authenticated"}';
select is((select route from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000041']::uuid[])),'project','AC-003 goods use project default');
select is((select approvers->0->>'id' from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000041']::uuid[])),'fa040000-0000-0000-0000-000000000013','AC-003 goods name the deputy');
select is((select approvers->0->>'id' from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000042']::uuid[])),'fa040000-0000-0000-0000-000000000014','AC-004 service names Procurement Manager');
select is((select route from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000043']::uuid[])),'admin','AC-005 sole requester falls to Admin');
select is((select approvers->0->>'id' from get_procurement_approval_routes(array['fa040000-0000-0000-0000-000000000044']::uuid[])),'fa040000-0000-0000-0000-000000000015','AC-006 over budget remains senior first');
select * from finish();
rollback;
