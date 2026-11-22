begin;
create extension if not exists pgtap;
-- fix-billing items 1 and 2: who confirms a delivery record (BAST), the final record's separation of duties,
-- and the waiting-list data. Roles: PM prepares, a different Finance confirms; Executive and the author never confirm.
select plan(14);
insert into organizations(id,name) values ('33570000-0000-0000-0000-000000000001','FB Org');
insert into auth.users(id,email) values ('33570000-0000-0000-0000-000000000011','fb-pm@example.invalid'),('33570000-0000-0000-0000-000000000012','fb-fin@example.invalid'),('33570000-0000-0000-0000-000000000013','fb-fin2@example.invalid'),('33570000-0000-0000-0000-000000000014','fb-exec@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('33570000-0000-0000-0000-000000000011','33570000-0000-0000-0000-000000000001','FB PM','fb-pm@example.invalid','Project Manager','active'),
 ('33570000-0000-0000-0000-000000000012','33570000-0000-0000-0000-000000000001','FB Fin','fb-fin@example.invalid','Finance','active'),
 ('33570000-0000-0000-0000-000000000013','33570000-0000-0000-0000-000000000001','FB Fin2','fb-fin2@example.invalid','Finance','active'),
 ('33570000-0000-0000-0000-000000000014','33570000-0000-0000-0000-000000000001','FB Exec','fb-exec@example.invalid','Executive','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,project_manager_id) values
 ('33570000-0000-0000-0000-000000000021','33570000-0000-0000-0000-000000000001','FB Project','Ongoing Project',10000,'exclusive',0,'33570000-0000-0000-0000-000000000011');
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33570000-0000-0000-0000-000000000031','33570000-0000-0000-0000-000000000001','33570000-0000-0000-0000-000000000021','FB WO','Issued',10000,'exclusive',0);
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('33570000-0000-0000-0000-000000000041','33570000-0000-0000-0000-000000000001','33570000-0000-0000-0000-000000000021','LINE','Contract line','km',10,1000);
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values ('33570000-0000-0000-0000-000000000001','33570000-0000-0000-0000-000000000031','33570000-0000-0000-0000-000000000041',10);
set local role authenticated;
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$insert into project_documents(id,org_id,project_id,category,title,file_path) values
 ('33570000-0000-0000-0000-000000000051','33570000-0000-0000-0000-000000000001','33570000-0000-0000-0000-000000000021','Delivery record','Signed delivery record','33570000-0000-0000-0000-000000000001/33570000-0000-0000-0000-000000000021/33570000-0000-0000-0000-000000000051/record.pdf')$$,'FB the PM records the signed delivery record under the Delivery record category');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select public.transition_document_status('33570000-0000-0000-0000-000000000051','Issued')$$,'FB Finance issues the record document');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select set_config('fb.final',public.prepare_work_order_acceptance('33570000-0000-0000-0000-000000000031',current_date,true,'[{"boq_item_id":"33570000-0000-0000-0000-000000000041","quantity":10}]'::jsonb,'33570000-0000-0000-0000-000000000051')::text,true)$$,'FB the project PM may mark the record final when preparing it');
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation()),0,'FB the PM has nothing to confirm in the waiting data');
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('fb.final')::uuid)$$,'42501','only Admin or Finance may confirm an acceptance','FB the PM cannot confirm the final record');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000014","role":"authenticated"}';
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('fb.final')::uuid)$$,'42501','only Admin or Finance may confirm an acceptance','FB the top approver (Executive) cannot confirm either');
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation()),0,'FB an Executive has no confirmation waiting');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000012","role":"authenticated"}';
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation()),1,'FB Finance sees the waiting record in the waiting data');
select lives_ok($$select set_config('fb.own',public.prepare_work_order_acceptance('33570000-0000-0000-0000-000000000031',current_date,false,'[{"boq_item_id":"33570000-0000-0000-0000-000000000041","quantity":2}]'::jsonb,'33570000-0000-0000-0000-000000000051')::text,true)$$,'FB Finance prepares a record of their own');
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('fb.own')::uuid)$$,'42501','separation of duties: the preparer cannot confirm this acceptance','FB the author cannot confirm their own record');
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation() where id=current_setting('fb.own')::uuid),0,'FB the author does not see their own record as waiting for them');
set local request.jwt.claims='{"sub":"33570000-0000-0000-0000-000000000013","role":"authenticated"}';
select is((select count(*)::int from public.acceptances_awaiting_my_confirmation()),2,'FB another Finance user sees both records waiting');
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('fb.final')::uuid)$$,'FB a different Finance user confirms the final record');
select is((select status::text from work_orders where id='33570000-0000-0000-0000-000000000031'),'Closed','FB the confirmed final record closes the work order');
select * from finish();
rollback;
