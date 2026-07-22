-- AC-IEM-003/006/008: atomic finalize, operator-only trap recovery, and grants.
begin;
select plan(10);
insert into organizations (id, name) values
 ('a1470000-0000-0000-0000-000000000001','IEM 147 Org A'), ('a1470000-0000-0000-0000-000000000002','IEM 147 Org B');
insert into auth.users (id, email) values
 ('a1470000-0000-0000-0000-0000000000a1','a147-a@example.com'), ('a1470000-0000-0000-0000-0000000000b1','a147-b@example.com'), ('a1470000-0000-0000-0000-0000000000f1','a147-op@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a1470000-0000-0000-0000-0000000000a1','a1470000-0000-0000-0000-000000000001','A Admin','a147-a@example.com','Admin','active'),
 ('a1470000-0000-0000-0000-0000000000b1','a1470000-0000-0000-0000-000000000002','B Admin','a147-b@example.com','Admin','active'),
 ('a1470000-0000-0000-0000-0000000000f1','a1470000-0000-0000-0000-000000000001','Operator','a147-op@example.com','Engineer','active');
insert into platform_operators (user_id) values ('a1470000-0000-0000-0000-0000000000f1');
select vault.create_secret('a147-token', 'a147_secret');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status)
 values ('a1470000-0000-0000-0000-000000000001','clickup','', 'a147_secret', 'active');
select is((select has_function_privilege('authenticated', 'public.finalize_external_connect(uuid,text,text,boolean,boolean,uuid)', 'execute')), false, 'AC-IEM-008 finalize RPC is not executable by authenticated');
select is((select has_function_privilege('service_role', 'public.finalize_external_connect(uuid,text,text,boolean,boolean,uuid)', 'execute')), true, 'AC-IEM-008 finalize RPC is executable by service_role');
select is((select has_function_privilege('authenticated', 'public.recover_external_connect_trap(uuid,text,boolean,boolean,uuid)', 'execute')), false, 'AC-IEM-008 recovery RPC is not executable by authenticated');
set local role service_role;
select throws_ok($$select public.finalize_external_connect('a1470000-0000-0000-0000-000000000001','clickup','a147_secret',true,false,'a1470000-0000-0000-0000-0000000000a1')$$, null, null, 'AC-IEM-003 finalize rejects failed readiness');
select is((select count(*)::int from external_domain_ownership where org_id='a1470000-0000-0000-0000-000000000001' and external_tier='clickup' and domain='tasks'), 0, 'AC-IEM-003 readiness failure does not employ tasks ownership');
select is(public.recover_external_connect_trap('a1470000-0000-0000-0000-000000000001','clickup',true,true,'a1470000-0000-0000-0000-0000000000f1'), 'retained', 'AC-IEM-006 operator recovery retains ownership after readiness');
select is(public.recover_external_connect_trap('a1470000-0000-0000-0000-000000000001','clickup',true,true,'a1470000-0000-0000-0000-0000000000f1'), 'retained', 'AC-IEM-006 recovery is idempotent');
select is((select count(*)::int from external_domain_ownership where org_id='a1470000-0000-0000-0000-000000000001' and external_tier='clickup' and domain='tasks'), 1, 'AC-IEM-006 retained recovery leaves one ownership row');
select is(public.recover_external_connect_trap('a1470000-0000-0000-0000-000000000001','clickup',false,false,'a1470000-0000-0000-0000-0000000000f1'), 'released', 'AC-IEM-006 failed recovery releases tasks ownership');
select is((select count(*)::int from external_domain_ownership where org_id='a1470000-0000-0000-0000-000000000001' and external_tier='clickup' and domain='tasks'), 0, 'AC-IEM-006 released recovery restores PMO ownership');
select finish(); rollback;
