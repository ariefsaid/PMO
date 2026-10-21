begin;
create extension if not exists pgtap;
select plan(5);
insert into organizations(id,name) values ('33570000-0000-0000-0000-000000000001','CQ Org');
insert into auth.users(id,email) values ('33570000-0000-0000-0000-000000000011','cq-admin@example.invalid'),('33570000-0000-0000-0000-000000000012','cq-finance@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('33570000-0000-0000-0000-000000000011','33570000-0000-0000-0000-000000000001','CQ Admin','cq-admin@example.invalid','Admin','active'),
 ('33570000-0000-0000-0000-000000000012','33570000-0000-0000-0000-000000000001','CQ Finance','cq-finance@example.invalid','Finance','active');
select lives_ok($$select set_config('request.jwt.claims','{"sub":"33570000-0000-0000-0000-000000000011","role":"authenticated","client_id":"generic-client"}',true),set_config('request.method','GET',true),set_config('request.path','/boq_items',true),public.api_client_request_guard()$$,'AC-CQ-018 active Admin GET is allowed');
select lives_ok($$select set_config('request.method','POST',true),public.api_client_request_guard()$$,'AC-CQ-018 active Admin POST is allowed');
select throws_ok($$select set_config('request.method','PATCH',true),public.api_client_request_guard()$$,'42501',null,'AC-CQ-018 PATCH remains outside the load tier');
select throws_ok($$select set_config('request.method','POST',true),set_config('request.path','/rpc/prepare_work_order_acceptance',true),public.api_client_request_guard()$$,'42501',null,'AC-CQ-018 acceptance RPC remains outside the API-client tier');
select is((select prosrc like '%array[''budget_versions'', ''budget_line_items'', ''boq_items'']%' from pg_proc where oid='public.api_client_request_guard()'::regprocedure),true,'AC-CQ-018 latest guard explicitly lists contract lines');
select * from finish();
rollback;
