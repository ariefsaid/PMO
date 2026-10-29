begin;
select plan(20);
insert into organizations(id,name) values ('39000000-0000-0000-0000-000000000001','Link test');
insert into auth.users(id) values ('39000000-0000-0000-0000-000000000011'),('39000000-0000-0000-0000-000000000012'),('39000000-0000-0000-0000-000000000013'),('39000000-0000-0000-0000-000000000014'),('39000000-0000-0000-0000-000000000015');
update auth.users set banned_until = now() + interval '1 day' where id = '39000000-0000-0000-0000-000000000013';
insert into profiles(id,org_id,full_name,email,role,status) values
('39000000-0000-0000-0000-000000000011','39000000-0000-0000-0000-000000000001','Admin','link-admin@example.invalid','Admin','active'),
('39000000-0000-0000-0000-000000000012','39000000-0000-0000-0000-000000000001','Disabled','link-disabled@example.invalid','Admin','disabled'),
('39000000-0000-0000-0000-000000000013','39000000-0000-0000-0000-000000000001','Banned','link-banned@example.invalid','Admin','active'),
('39000000-0000-0000-0000-000000000014','39000000-0000-0000-0000-000000000001','Manager','link-manager@example.invalid','Project Manager','active'),
('39000000-0000-0000-0000-000000000015','39000000-0000-0000-0000-000000000001','Operator','link-operator@example.invalid','Finance','active');
insert into platform_operators(user_id) values ('39000000-0000-0000-0000-000000000015');
insert into projects(id,org_id,name,status,project_manager_id) values ('39000000-0000-0000-0000-000000000021','39000000-0000-0000-0000-000000000001','Link project','Ongoing Project','39000000-0000-0000-0000-000000000014'),
('39000000-0000-0000-0000-000000000022','39000000-0000-0000-0000-000000000001','Second project','Ongoing Project','39000000-0000-0000-0000-000000000014');
insert into external_org_bindings(org_id,external_tier,site_url,status,secret_ref,config) values ('39000000-0000-0000-0000-000000000001','erpnext','https://integration.example.test','active','','{}');
select ok(not has_function_privilege('authenticated','public.link_external_project(uuid,uuid,uuid,text,jsonb)','execute'),'project link is service only');
select ok(not has_function_privilege('authenticated','public.link_external_company(uuid,uuid,text,text)','execute'),'company link is service only');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select link_external_project('00000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000011','39000000-0000-0000-0000-000000000021','a','{}')$$,'42501',null,'project link requires actor membership in organization');
select throws_ok($$select link_external_company('00000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000011','Acme','https://integration.example.test')$$,'42501',null,'company link requires actor membership in organization');
select throws_ok($$select link_external_project('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000012','39000000-0000-0000-0000-000000000021','a','{}')$$,'42501',null,'disabled actor cannot link project');
select throws_ok($$select link_external_project('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000013','39000000-0000-0000-0000-000000000021','a','{}')$$,'42501',null,'banned actor cannot link project');
select throws_ok($$select link_external_company('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000012','Acme','https://integration.example.test')$$,'42501',null,'disabled actor cannot link company');
select throws_ok($$select link_external_company('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000013','Acme','https://integration.example.test')$$,'42501',null,'banned actor cannot link company');
select throws_ok($$select link_external_company('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000014','Acme','https://integration.example.test')$$,'42501',null,'manager cannot link company');
select ok(link_external_company('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000015','Operator Company','https://integration.example.test'),'operator links company');
select ok(link_external_company('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000011','Acme','https://integration.example.test'),'Admin links company');
select lives_ok($$select link_external_project('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000015','39000000-0000-0000-0000-000000000022','operator-list','{}')$$,'operator links project');
select lives_ok($$select link_external_project('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000014','39000000-0000-0000-0000-000000000021','a','{}')$$,'assigned manager links project');
reset role;
update profiles set status='disabled' where id='39000000-0000-0000-0000-000000000015';
set local role service_role;
select throws_ok($$select link_external_company('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000015','Acme','https://integration.example.test')$$,'42501',null,'operator requires active standing');
reset role;
update profiles set status='active' where id='39000000-0000-0000-0000-000000000015';
delete from platform_operators where user_id='39000000-0000-0000-0000-000000000015';
set local role service_role;
select throws_ok($$select link_external_company('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000015','Acme','https://integration.example.test')$$,'42501',null,'current operator authority is required');
reset role;
update profiles set role='Finance' where id='39000000-0000-0000-0000-000000000014';
set local role service_role;
select throws_ok($$select link_external_project('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000014','39000000-0000-0000-0000-000000000021','b','{}')$$,'42501',null,'current role is required after assignment');
select throws_ok($$select unlink_external_integration('39000000-0000-0000-0000-000000000001','clickup','39000000-0000-0000-0000-000000000021','39000000-0000-0000-0000-000000000014')$$,'42501',null,'current role is required to unlink');
reset role;
update profiles set role='Project Manager' where id='39000000-0000-0000-0000-000000000014';
update projects set project_manager_id='39000000-0000-0000-0000-000000000011' where id='39000000-0000-0000-0000-000000000021';
set local role service_role;
select throws_ok($$select link_external_project('39000000-0000-0000-0000-000000000001','39000000-0000-0000-0000-000000000014','39000000-0000-0000-0000-000000000021','b','{}')$$,'42501',null,'current project assignment is required');
select is((select config->>'company' from external_org_bindings where org_id='39000000-0000-0000-0000-000000000001'),'Acme','denials preserve company');
select is((select count(*)::integer from external_project_bindings where org_id='39000000-0000-0000-0000-000000000001'),2,'denials preserve project links');
reset role;
select * from finish();
rollback;
