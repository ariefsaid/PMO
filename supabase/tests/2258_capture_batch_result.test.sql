-- AC-ROP-008 (#2258): a retry reads the stored result of a finished capture request, and only that.
begin;
select plan(17);
insert into organizations (id,name,default_currency) values
 ('22580000-0000-0000-0000-000000000001','Stored A','USD'),('22580000-0000-0000-0000-000000000002','Stored B','USD');
insert into auth.users (id,email,banned_until) values
 ('22580000-0000-0000-0000-000000000011','stored-admin-a@example.test',null),
 ('22580000-0000-0000-0000-000000000012','stored-finance-a@example.test',null),
 ('22580000-0000-0000-0000-000000000013','stored-inactive-a@example.test',null),
 ('22580000-0000-0000-0000-000000000014','stored-banned-a@example.test',now() + interval '1 day'),
 ('22580000-0000-0000-0000-000000000021','stored-admin-b@example.test',null);
insert into profiles (id,org_id,full_name,email,role,status) values
 ('22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000001','Admin A','stored-admin-a@example.test','Admin','active'),
 ('22580000-0000-0000-0000-000000000012','22580000-0000-0000-0000-000000000001','Finance A','stored-finance-a@example.test','Finance','active'),
 ('22580000-0000-0000-0000-000000000013','22580000-0000-0000-0000-000000000001','Inactive A','stored-inactive-a@example.test','Admin','inactive'),
 ('22580000-0000-0000-0000-000000000014','22580000-0000-0000-0000-000000000001','Banned A','stored-banned-a@example.test','Admin','active'),
 ('22580000-0000-0000-0000-000000000021','22580000-0000-0000-0000-000000000002','Admin B','stored-admin-b@example.test','Admin','active');
insert into projects (id,org_id,name,status) values ('22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000001','Project A','Ongoing Project');
-- done: both groups processed; partial: one of two; undone: both processed, one capture undone later
insert into erp_capture_batches (org_id,request_id,actor_id,project_id,reviewed_revision,current_revision,precision,groups,next_index,results) values
 ('22580000-0000-0000-0000-000000000001','22580000-0000-0000-0000-000000000041','22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000031','rev','rev','{}',
  '[{"project_id":"22580000-0000-0000-0000-000000000031","source_ids":["a"]},{"project_id":"22580000-0000-0000-0000-000000000031","source_ids":["b"]}]',2,'[{"outcome":"created"},{"outcome":"created"}]'),
 ('22580000-0000-0000-0000-000000000001','22580000-0000-0000-0000-000000000042','22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000031','rev','rev','{}',
  '[{"project_id":"22580000-0000-0000-0000-000000000031","source_ids":["a"]},{"project_id":"22580000-0000-0000-0000-000000000031","source_ids":["b"]}]',1,'[{"outcome":"created"}]');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_batch_result('22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000041','rev')->>'complete','true','AC-ROP-008 a finished request returns its stored result');
select is(public.capture_history_batch_result('22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000041','rev')->'results'->1->>'outcome','created','AC-ROP-008 the stored result carries the group outcomes');
select is(public.capture_history_batch_result('22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000042','rev')->>'complete','false','AC-ROP-008 a partly finished request is not reported complete');
select is(public.capture_history_batch_result('22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000043','rev')->>'found','false','AC-ROP-008 an unknown request is not found');
select is(public.capture_history_batch_result('22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000041','other')->>'found','false','AC-ROP-008 a different reviewed revision is not found');
select is(public.capture_history_batch_result('22580000-0000-0000-0000-000000000011',null,'22580000-0000-0000-0000-000000000041','rev')->>'found','false','AC-ROP-008 a different scope is not found');
select is(public.capture_history_batch_result('22580000-0000-0000-0000-000000000021','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000041','rev')->>'found','false','AC-ROP-008 another organisation never sees the request');
select throws_ok($$select public.capture_history_batch_result('22580000-0000-0000-0000-000000000012','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000041','rev')$$,'42501',null,'AC-ROP-008 Finance is refused');
select throws_ok($$select public.capture_history_batch_result('22580000-0000-0000-0000-000000000013','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000041','rev')$$,'42501',null,'AC-ROP-008 an inactive Admin is refused');
select throws_ok($$select public.capture_history_batch_result('22580000-0000-0000-0000-000000000014','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000041','rev')$$,'42501',null,'AC-ROP-008 a banned Admin is refused');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22580000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$select public.capture_history_batch_result('22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000041','rev')$$,'42501',null,'AC-ROP-008 a signed-in Admin cannot call it directly');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.capture_history_batch_result('22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000041','rev')$$,'42501',null,'AC-ROP-008 anonymous is refused');
reset role;
select ok(not has_function_privilege('authenticated','public.capture_history_batch_result(uuid,uuid,uuid,text)','execute') and not has_function_privilege('anon','public.capture_history_batch_result(uuid,uuid,uuid,text)','execute'),'AC-ROP-008 only the service role holds execute');
select is((select count(*)::int from erp_capture_batches where org_id='22580000-0000-0000-0000-000000000001' and request_id='22580000-0000-0000-0000-000000000042' and next_index=1),1,'AC-ROP-008 reading changes no batch state');
-- a finished request with an undone capture is not reported as a success
insert into external_org_bindings (id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('22580000-0000-0000-0000-000000000051','22580000-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{"company":"Example"}',now(),'active');
insert into procurements (id,org_id,project_id,title,total_value,status) values
 ('22580000-0000-0000-0000-000000000061','22580000-0000-0000-0000-000000000001','22580000-0000-0000-0000-000000000031','Undone','1','Draft');
insert into erp_purchase_captures (procurement_id,org_id,binding_id,request_id,payload,kind,stage,captured_by,undone_at,undo_reason) values
 ('22580000-0000-0000-0000-000000000061','22580000-0000-0000-0000-000000000001','22580000-0000-0000-0000-000000000051',md5('22580000-0000-0000-0000-000000000041:group:1')::uuid,'{}','order','ordered','22580000-0000-0000-0000-000000000011',now(),'wrong');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_batch_result('22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000041','rev')->>'complete','false','AC-ROP-008 a finished request with an undone capture is not reported complete');
select is(public.capture_history_batch_result('22580000-0000-0000-0000-000000000011','22580000-0000-0000-0000-000000000031','22580000-0000-0000-0000-000000000041','rev')->>'found','true','AC-ROP-008 the undone request is still found');
reset role;
select * from finish();
rollback;
