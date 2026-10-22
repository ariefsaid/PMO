begin;
select plan(4);
insert into organizations(id,name) values ('03460000-0000-0000-0000-000000000001','Connect cleanup test');
insert into auth.users(id,email) values ('03460000-0000-0000-0000-000000000011','connect-cleanup@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('03460000-0000-0000-0000-000000000011','03460000-0000-0000-0000-000000000001','Connect admin','connect-cleanup@example.invalid','Admin','active');
select vault.create_secret('staged-token','0346_staged');
set local role service_role;
select public.cleanup_external_connect_attempt('03460000-0000-0000-0000-000000000001','clickup','0346_staged','03460000-0000-0000-0000-000000000011');
select is((select count(*)::int from vault.secrets where name='0346_staged'),0,'AC-SEC-0346 cleanup removes an unbound staged secret');
select vault.create_secret('bound-token','0346_bound');
insert into external_org_bindings(org_id,external_tier,site_url,secret_ref,status)
 values ('03460000-0000-0000-0000-000000000001','clickup','','0346_bound','active'),
        ('03460000-0000-0000-0000-000000000001','erpnext','','0346_bound','active');
select public.cleanup_external_connect_attempt('03460000-0000-0000-0000-000000000001','clickup','0346_bound','03460000-0000-0000-0000-000000000011');
select is((select count(*)::int from vault.secrets where name='0346_bound'),1,'AC-SEC-0346 cleanup preserves a bound secret');
reset role;
select ok(not has_function_privilege('anon','public.cleanup_external_connect_attempt(uuid,text,text,uuid)','EXECUTE'),'AC-SEC-0346 cleanup is unavailable to anon');
select ok(not has_function_privilege('authenticated','public.cleanup_external_connect_attempt(uuid,text,text,uuid)','EXECUTE'),'AC-SEC-0346 cleanup is unavailable to authenticated');
select * from finish();
rollback;
