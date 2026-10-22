begin;
create extension if not exists pgtap;
select plan(95);
insert into organizations(id,name) values ('33520000-0000-0000-0000-000000000001','CQ Org');
insert into auth.users(id,email) values ('33520000-0000-0000-0000-000000000011','cq-pm@example.invalid'),('33520000-0000-0000-0000-000000000012','cq-finance@example.invalid'),('33520000-0000-0000-0000-000000000013','cq-engineer@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('33520000-0000-0000-0000-000000000011','33520000-0000-0000-0000-000000000001','CQ PM','cq-pm@example.invalid','Project Manager','active'),
 ('33520000-0000-0000-0000-000000000012','33520000-0000-0000-0000-000000000001','CQ Finance','cq-finance@example.invalid','Finance','active'),
 ('33520000-0000-0000-0000-000000000013','33520000-0000-0000-0000-000000000001','CQ Engineer','cq-engineer@example.invalid','Engineer','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,project_manager_id) values
 ('33520000-0000-0000-0000-000000000021','33520000-0000-0000-0000-000000000001','CQ Project','Ongoing Project',10000,'exclusive',0,'33520000-0000-0000-0000-000000000011');
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33520000-0000-0000-0000-000000000031','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000021','CQ WO','Issued',10000,'exclusive',0);
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('33520000-0000-0000-0000-000000000041','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000021','LINE','Contract line','km',10,1000);
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values
 ('33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000031','33520000-0000-0000-0000-000000000041',10);
select is(has_table_privilege('authenticated','public.work_order_acceptances','INSERT'),false,'AC-CQ-004 client cannot insert acceptance headers');
select is(has_table_privilege('authenticated','public.work_order_acceptance_lines','INSERT'),false,'AC-CQ-004 client cannot insert acceptance lines');
select is(has_function_privilege('anon','public.prepare_work_order_acceptance(uuid,date,boolean,jsonb,uuid,text,uuid)','EXECUTE'),false,'AC-CQ-005 anon cannot prepare BAST');
select is(has_function_privilege('authenticated','public.withdraw_work_order_acceptance(uuid)','EXECUTE'),true,'AC-CQ-004 authenticated may invoke gated withdrawal RPC');
select is(has_function_privilege('authenticated','public.confirm_work_order_acceptance(uuid)','EXECUTE'),true,'AC-CQ-005 authenticated may invoke gated confirmation RPC');
set local role authenticated;
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000013","role":"authenticated"}';
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000031',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000041","quantity":1}]'::jsonb)$$,'42501',null,'AC-CQ-004 Engineer cannot prepare BAST');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000031',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000041","quantity":1}]'::jsonb)$$,'AC-CQ-004 project PM prepares a cumulative draft');
select is((select count(*)::int from work_order_acceptances where work_order_id='33520000-0000-0000-0000-000000000031' and status='Draft'),1,'AC-CQ-004 preparation creates one Draft header');
select is((select quantity from work_order_acceptance_lines l join work_order_acceptances a on a.id=l.acceptance_id where a.work_order_id='33520000-0000-0000-0000-000000000031'),1::numeric,'AC-CQ-004 preparation records line quantity');
-- Create register evidence as the project PM, then issue it as a distinct member.
select lives_ok($$insert into project_documents(id,org_id,project_id,category,title,file_path) values
 ('33520000-0000-0000-0000-000000000051','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000021','Acceptance','Generic acceptance record','33520000-0000-0000-0000-000000000001/33520000-0000-0000-0000-000000000021/33520000-0000-0000-0000-000000000051/generic-document.pdf')$$,'AC-CQ-005 a project document is recorded with its file');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select public.transition_document_status('33520000-0000-0000-0000-000000000051','Issued')$$,'AC-CQ-005 a distinct Finance member issues the register evidence');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select set_config('cq.stage',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000031',current_date,false,
 '[{"boq_item_id":"33520000-0000-0000-0000-000000000041","quantity":8}]'::jsonb,'33520000-0000-0000-0000-000000000051')::text,true)$$,'AC-CQ-004 project PM prepares a cumulative stage BAST');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('cq.stage')::uuid)$$,'AC-CQ-005 distinct Finance confirms a stage acceptance');
select is((select status::text from work_orders where id='33520000-0000-0000-0000-000000000031'),'Issued','AC-CQ-010 stage BAST does not close its work order');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$update work_order_lines set quantity=7 where work_order_id='33520000-0000-0000-0000-000000000031'$$,'23514','allocation cannot be reduced below its latest confirmed acceptance','AC-CQ-002 allocation cannot be reduced below latest confirmed cumulative quantity');
select lives_ok($$update work_order_lines set quantity=8 where work_order_id='33520000-0000-0000-0000-000000000031'$$,'AC-CQ-002 latest confirmed acceptance quantity remains allocatable');
select throws_ok($$delete from work_order_lines where work_order_id='33520000-0000-0000-0000-000000000031' and boq_item_id='33520000-0000-0000-0000-000000000041'$$,'23514','an allocation with confirmed acceptance cannot be deleted','AC-CQ-002 an allocation with a confirmed acceptance quantity cannot be deleted');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select set_config('cq.self',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000031',current_date,false,
 '[{"boq_item_id":"33520000-0000-0000-0000-000000000041","quantity":1}]'::jsonb,'33520000-0000-0000-0000-000000000051')::text,true)$$,'AC-CQ-005 Finance prepares an acceptance');
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.self')::uuid)$$,'42501',null,'AC-CQ-005 a preparer cannot confirm with another active member present');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select set_config('cq.final',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000031',current_date,true,
 '[{"boq_item_id":"33520000-0000-0000-0000-000000000041","quantity":11}]'::jsonb,'33520000-0000-0000-0000-000000000051')::text,true)$$,'AC-CQ-007 final quantity above the ordered value may be prepared for explicit review');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.final')::uuid)$$,'BW001',null,'AC-CQ-007 final closing value above PO net is refused');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000031',current_date,true,
 '[{"boq_item_id":"33520000-0000-0000-0000-000000000041","quantity":9}]'::jsonb,'33520000-0000-0000-0000-000000000051',null,current_setting('cq.final')::uuid)$$,'AC-CQ-004 draft replacement validates new final quantities');
reset role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($$insert into sales_invoices(id,org_id,project_id,work_order_id,amount,tax_treatment,tax_amount,currency,status)
 values('33520000-0000-0000-0000-000000000061','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000021','33520000-0000-0000-0000-000000000031',9500,'exclusive',0,'USD','Unpaid')$$,'AC-CQ-007 an invoice reserves billed work against the issued order');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
set role authenticated;
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.final')::uuid)$$,'BW001',null,'AC-CQ-007 final close below already billed work is refused');
select is((select status::text from work_orders where id='33520000-0000-0000-0000-000000000031'),'Issued','AC-CQ-007 failed lower-bound check rolls back the close');
reset role;
set local request.jwt.claims='{"role":"service_role"}';
update sales_invoices set status='Cancelled' where id='33520000-0000-0000-0000-000000000061';
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
set role authenticated;
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('cq.final')::uuid)$$,'AC-CQ-006 distinct Finance confirmer closes at the accepted net value');
select is((select closing_value from work_orders where id='33520000-0000-0000-0000-000000000031'),9000::numeric,'AC-CQ-006 close stores the exact accepted value');
select is((select order_net from work_order_billing where work_order_id='33520000-0000-0000-0000-000000000031'),9000::numeric,'AC-CQ-008 billing uses closing value, not original PO net');
select is((select remaining from work_order_billing where work_order_id='33520000-0000-0000-0000-000000000031'),9000::numeric,'AC-CQ-008 remaining uses closing value');
select is((select committed from public.get_project_drawdown('33520000-0000-0000-0000-000000000021')),9000::numeric,'AC-CQ-008 drawdown uses closing value');
select is((select order_value from work_orders where id='33520000-0000-0000-0000-000000000031'),10000::numeric,'AC-CQ-006 original PO value remains unchanged');
reset role;
select throws_ok($$update work_orders set closing_value=9999 where id='33520000-0000-0000-0000-000000000031'$$,'42501','work-order closing value is immutable','AC-CQ-006 closing money cannot be changed after confirmation');

-- Extended fixtures (AC-CQ-004/005): second project + PM, second final order, and a single-member org.
insert into auth.users(id,email) values ('33520000-0000-0000-0000-000000000014','cq-pm2@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33520000-0000-0000-0000-000000000014','33520000-0000-0000-0000-000000000001','CQ PM2','cq-pm2@example.invalid','Project Manager','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,project_manager_id) values
 ('33520000-0000-0000-0000-000000000022','33520000-0000-0000-0000-000000000001','CQ Project 2','Ongoing Project',100000,'exclusive',0,'33520000-0000-0000-0000-000000000011'),
 ('33520000-0000-0000-0000-000000000023','33520000-0000-0000-0000-000000000001','CQ Project 3','Ongoing Project',100000,'exclusive',0,'33520000-0000-0000-0000-000000000014');
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('33520000-0000-0000-0000-000000000042','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','L1','Line one','km',10,1000),
 ('33520000-0000-0000-0000-000000000043','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','L2','Line two','km',10,1000),
 ('33520000-0000-0000-0000-000000000044','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','L3','Line three','km',10,1000);
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33520000-0000-0000-0000-000000000032','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','CQ WO two','Issued',20000,'exclusive',0),
 ('33520000-0000-0000-0000-000000000033','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','CQ WO three','Issued',5000,'exclusive',0);
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values
 ('33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000032','33520000-0000-0000-0000-000000000042',10),('33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000032','33520000-0000-0000-0000-000000000043',10),('33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000033','33520000-0000-0000-0000-000000000044',10);
insert into project_documents(id,org_id,project_id,category,title,status,file_path) values
 ('33520000-0000-0000-0000-000000000052','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','Acceptance','Evidence project 2','Issued','33520000-0000-0000-0000-000000000001/33520000-0000-0000-0000-000000000022/33520000-0000-0000-0000-000000000052/p2.pdf'),
 ('33520000-0000-0000-0000-000000000053','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000023','Acceptance','Evidence project 3','Issued','33520000-0000-0000-0000-000000000001/33520000-0000-0000-0000-000000000023/33520000-0000-0000-0000-000000000053/p3.pdf');
insert into organizations(id,name) values ('33520000-0000-0000-0000-000000000002','CQ Solo Org');
insert into auth.users(id,email) values ('33520000-0000-0000-0000-000000000015','cq-solo@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33520000-0000-0000-0000-000000000015','33520000-0000-0000-0000-000000000002','CQ Solo','cq-solo@example.invalid','Finance','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount) values ('33520000-0000-0000-0000-000000000024','33520000-0000-0000-0000-000000000002','CQ Solo Project','Ongoing Project',100000,'exclusive',0);
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values ('33520000-0000-0000-0000-000000000045','33520000-0000-0000-0000-000000000002','33520000-0000-0000-0000-000000000024','S1','Solo line','km',10,1000);
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values ('33520000-0000-0000-0000-000000000034','33520000-0000-0000-0000-000000000002','33520000-0000-0000-0000-000000000024','CQ Solo WO','Issued',10000,'exclusive',0);
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values ('33520000-0000-0000-0000-000000000002','33520000-0000-0000-0000-000000000034','33520000-0000-0000-0000-000000000045',10);
insert into project_documents(id,org_id,project_id,category,title,status,file_path) values ('33520000-0000-0000-0000-000000000054','33520000-0000-0000-0000-000000000002','33520000-0000-0000-0000-000000000024','Acceptance','Solo evidence','Issued','33520000-0000-0000-0000-000000000002/33520000-0000-0000-0000-000000000024/33520000-0000-0000-0000-000000000054/solo.pdf');
set local role authenticated;
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000032',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1}]'::jsonb,'33520000-0000-0000-0000-000000000053')$$,'23514',null,'AC-CQ-004 a document from another project is refused on prepare');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000014","role":"authenticated"}';
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000032',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1}]'::jsonb,'33520000-0000-0000-0000-000000000052')$$,'42501',null,'AC-CQ-004 another project''s PM cannot prepare a BAST');
select is((select count(*)::int from work_order_acceptances where work_order_id='33520000-0000-0000-0000-000000000032'),0,'AC-CQ-004 refused preparations leave no header');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select set_config('cq.del',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000032',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1},{"boq_item_id":"33520000-0000-0000-0000-000000000043","quantity":1}]'::jsonb,'33520000-0000-0000-0000-000000000052')::text,true)$$,'AC-CQ-005 PM prepares a two-line draft');
select lives_ok($$delete from work_order_lines where work_order_id='33520000-0000-0000-0000-000000000032' and boq_item_id='33520000-0000-0000-0000-000000000043'$$,'AC-CQ-005 an unaccepted allocation may be deleted after preparing');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.del')::uuid)$$,'23514','an accepted contract line is no longer allocated to this work order','AC-CQ-005 confirm refuses a line whose allocation was deleted');
select is((select status from work_order_acceptances where id=current_setting('cq.del')::uuid),'Draft','AC-CQ-005 the refused confirmation leaves the BAST a Draft');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select public.withdraw_work_order_acceptance(current_setting('cq.del')::uuid)$$,'AC-CQ-004 the preparer withdraws a draft');
select is((select status from work_order_acceptances where id=current_setting('cq.del')::uuid),'Withdrawn','AC-CQ-004 withdrawn BAST is marked Withdrawn');
select throws_ok($$select public.withdraw_work_order_acceptance(current_setting('cq.del')::uuid)$$,'42501','only a Draft acceptance can be withdrawn','AC-CQ-004 withdrawing twice is refused');
select lives_ok($$select set_config('cq.conf',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000032',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":3}]'::jsonb,'33520000-0000-0000-0000-000000000052')::text,true)$$,'AC-CQ-004 PM prepares a BAST to confirm');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('cq.conf')::uuid)$$,'AC-CQ-005 Finance confirms it');
select is((select confirm_basis from work_order_acceptances where id=current_setting('cq.conf')::uuid),'standard','AC-CQ-005 a distinct confirmer records the standard basis');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$update work_order_acceptances set note='x' where id=current_setting('cq.conf')::uuid$$,'42501',null,'AC-CQ-004 a client cannot edit a BAST header');
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000032',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":4}]'::jsonb,'33520000-0000-0000-0000-000000000052',null,current_setting('cq.conf')::uuid)$$,'P0002',null,'AC-CQ-004 a confirmed BAST cannot be replaced by the prepare RPC');
reset role;
select throws_ok($$update work_order_acceptances set note='x' where id=current_setting('cq.conf')::uuid$$,'42501','acceptance is immutable','AC-CQ-004 a confirmed BAST header cannot be edited');
select throws_ok($$delete from work_order_acceptances where id=current_setting('cq.conf')::uuid$$,'42501','acceptance is immutable','AC-CQ-004 a confirmed BAST cannot be deleted');
select throws_ok($$update work_order_acceptance_lines set quantity=1 where acceptance_id=current_setting('cq.conf')::uuid$$,'42501','acceptance lines are immutable outside draft replacement','AC-CQ-004 a confirmed BAST line cannot be edited');
select throws_ok($$delete from work_order_acceptance_lines where acceptance_id=current_setting('cq.conf')::uuid$$,'42501','acceptance lines are immutable outside draft replacement','AC-CQ-004 a confirmed BAST line cannot be deleted');
select throws_ok($$update work_order_acceptances set note='x' where id=current_setting('cq.del')::uuid$$,'42501','acceptance is immutable','AC-CQ-004 a withdrawn BAST cannot be edited');
select is((select quantity from work_order_acceptance_lines where acceptance_id=current_setting('cq.conf')::uuid),3::numeric,'AC-CQ-004 refused edits left the confirmed quantity intact');
set local role authenticated;
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select set_config('cq.f1',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000033',current_date,true,'[{"boq_item_id":"33520000-0000-0000-0000-000000000044","quantity":1}]'::jsonb,'33520000-0000-0000-0000-000000000052')::text,true)$$,'AC-CQ-005 PM prepares a first final BAST');
select lives_ok($$select set_config('cq.f2',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000033',current_date,true,'[{"boq_item_id":"33520000-0000-0000-0000-000000000044","quantity":2}]'::jsonb,'33520000-0000-0000-0000-000000000052')::text,true)$$,'AC-CQ-005 PM prepares a competing final BAST');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('cq.f1')::uuid)$$,'AC-CQ-005 Finance confirms the first final BAST');
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.f2')::uuid)$$,'42501','only an issued work order can confirm an acceptance','AC-CQ-005 a second final on the same order cannot be confirmed');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000033',current_date,true,'[{"boq_item_id":"33520000-0000-0000-0000-000000000044","quantity":1}]'::jsonb,'33520000-0000-0000-0000-000000000052')$$,'42501',null,'AC-CQ-005 a closed order cannot prepare another final');
reset role;
select throws_ok($$insert into work_order_acceptances(org_id,project_id,work_order_id,acceptance_date,is_final,status,prepared_by,confirmed_by,confirmed_at,confirm_basis) values ('33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','33520000-0000-0000-0000-000000000033',current_date,true,'Confirmed','33520000-0000-0000-0000-000000000011','33520000-0000-0000-0000-000000000012',now(),'standard')$$,'23505',null,'AC-CQ-005 the database allows one confirmed final per order');
set local role authenticated;
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000015","role":"authenticated"}';
select lives_ok($$select set_config('cq.solo1',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000034',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000045","quantity":2}]'::jsonb,'33520000-0000-0000-0000-000000000054')::text,true)$$,'AC-CQ-005 the sole member prepares a BAST');
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('cq.solo1')::uuid)$$,'AC-CQ-005 the sole active member may confirm their own BAST');
select is((select confirm_basis from work_order_acceptances where id=current_setting('cq.solo1')::uuid),'sole_operator','AC-CQ-005 sole-operator confirmation is recorded as such');
select lives_ok($$select set_config('cq.solo2',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000034',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000045","quantity":3}]'::jsonb,'33520000-0000-0000-0000-000000000054')::text,true)$$,'AC-CQ-005 the sole member prepares a second BAST');
reset role;
insert into auth.users(id,email) values ('33520000-0000-0000-0000-000000000016','cq-second@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33520000-0000-0000-0000-000000000016','33520000-0000-0000-0000-000000000002','CQ Second','cq-second@example.invalid','Engineer','active');
set local role authenticated;
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000015","role":"authenticated"}';
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.solo2')::uuid)$$,'42501',null,'AC-CQ-005 with a second active member the preparer can no longer confirm their own BAST');
select is((select status from work_order_acceptances where id=current_setting('cq.solo2')::uuid),'Draft','AC-CQ-005 the refused self-confirmation leaves the BAST a Draft');
reset role;
-- AC-CQ-004/005 refusal matrix: fixtures (a fully allocated order with a lump-sum line, a Draft order, a disabled Finance user).
insert into auth.users(id,email) values ('33520000-0000-0000-0000-000000000017','cq-disabled-fin@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33520000-0000-0000-0000-000000000017','33520000-0000-0000-0000-000000000001','CQ Disabled Finance','cq-disabled-fin@example.invalid','Finance','disabled');
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate,earning_basis) values
 ('33520000-0000-0000-0000-000000000046','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','LS','Lump line','lot',1,1000,'lump_sum');
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33520000-0000-0000-0000-000000000035','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','CQ WO refusals','Issued',20000,'exclusive',0),
 ('33520000-0000-0000-0000-000000000036','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','CQ WO draft','Draft',20000,'exclusive',0);
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values
 ('33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000035','33520000-0000-0000-0000-000000000042',10),
 ('33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000035','33520000-0000-0000-0000-000000000043',10),
 ('33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000035','33520000-0000-0000-0000-000000000046',1);
insert into project_documents(id,org_id,project_id,category,title,status,file_path) values
 ('33520000-0000-0000-0000-000000000055','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','Acceptance','Draft evidence','Draft','33520000-0000-0000-0000-000000000001/33520000-0000-0000-0000-000000000022/33520000-0000-0000-0000-000000000055/draft.pdf');
insert into project_documents(id,org_id,project_id,category,title,status) values
 ('33520000-0000-0000-0000-000000000056','33520000-0000-0000-0000-000000000001','33520000-0000-0000-0000-000000000022','Acceptance','Fileless evidence','Issued');
set local role authenticated;
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1},{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":2}]'::jsonb)$$,'23514','each contract line may appear once in an acceptance','AC-CQ-004 a repeated line is refused');
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000044","quantity":1}]'::jsonb)$$,'23514','every acceptance line must be allocated to this work order','AC-CQ-004 a line not allocated to the work order is refused');
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":-1}]'::jsonb)$$,'23514','acceptance quantities must be finite, nonnegative and have at most 3 decimals','AC-CQ-004 a negative quantity is refused');
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1.2345}]'::jsonb)$$,'23514','acceptance quantities must be finite, nonnegative and have at most 3 decimals','AC-CQ-004 a 4-decimal quantity is refused');
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000046","quantity":2}]'::jsonb)$$,'23514','lump-sum acceptance quantity cannot exceed one','AC-CQ-004 a lump-sum quantity above one is refused');
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,true,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1}]'::jsonb)$$,'23514','a final acceptance must include every allocated contract line','AC-CQ-004 a final acceptance omitting an allocated line is refused');
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,false,'[]'::jsonb)$$,'23502','acceptance date and at least one quantity are required','AC-CQ-004 empty lines are refused');
select throws_ok($$select public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000036',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1}]'::jsonb)$$,'42501','only an issued work order can prepare an acceptance','AC-CQ-004 a non-Issued work order cannot prepare a BAST');
select is((select count(*)::int from work_order_acceptances where work_order_id in ('33520000-0000-0000-0000-000000000035','33520000-0000-0000-0000-000000000036')),0,'AC-CQ-004 every refused preparation left no header');
-- Drafts that differ only by evidence: absent, Draft-status, fileless, and (forged post-prepare) another project's document.
select lives_ok($$select set_config('cq.absent',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1}]'::jsonb)::text,true)$$,'AC-CQ-005 PM prepares a BAST without a document');
select lives_ok($$select set_config('cq.draftdoc',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1}]'::jsonb,'33520000-0000-0000-0000-000000000055')::text,true)$$,'AC-CQ-005 PM prepares a BAST citing a Draft-status document');
select lives_ok($$select set_config('cq.nofile',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1}]'::jsonb,'33520000-0000-0000-0000-000000000056')::text,true)$$,'AC-CQ-005 PM prepares a BAST citing a document with no file');
select lives_ok($$select set_config('cq.foreign',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1}]'::jsonb,'33520000-0000-0000-0000-000000000052')::text,true)$$,'AC-CQ-005 PM prepares a BAST citing a valid document (later forged to a foreign one)');
select lives_ok($$select set_config('cq.ok',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000035',current_date,false,'[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":1}]'::jsonb,'33520000-0000-0000-0000-000000000052')::text,true)$$,'AC-CQ-005 PM prepares a valid BAST for actor refusals');
reset role;
update work_order_acceptances set document_id='33520000-0000-0000-0000-000000000053' where id=current_setting('cq.foreign')::uuid;
set local role authenticated;
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.absent')::uuid)$$,'23514','confirmation requires an Issued or Approved project document with a file','AC-CQ-005 confirm fails with an absent document');
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.draftdoc')::uuid)$$,'23514','confirmation requires an Issued or Approved project document with a file','AC-CQ-005 confirm fails with a Draft-status document');
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.nofile')::uuid)$$,'23514','confirmation requires an Issued or Approved project document with a file','AC-CQ-005 confirm fails with a document that has no file');
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.foreign')::uuid)$$,'23514','confirmation requires an Issued or Approved project document with a file','AC-CQ-005 confirm fails with another project''s document');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.ok')::uuid)$$,'42501','only Admin or Finance may confirm an acceptance','AC-CQ-005 a Project Manager cannot confirm');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000017","role":"authenticated"}';
select throws_matching($$select public.confirm_work_order_acceptance(current_setting('cq.ok')::uuid)$$,'not an active member','AC-CQ-005 a disabled Finance user cannot confirm');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000015","role":"authenticated"}';
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.ok')::uuid)$$,'P0002','acceptance not found','AC-CQ-005 another organization''s Finance cannot confirm');
reset role;
select is((select count(*)::int from work_order_acceptances where work_order_id='33520000-0000-0000-0000-000000000035' and status='Draft'),5,'AC-CQ-005 every refused confirmation left its BAST a Draft');
-- Count reads while retaining the installed billing implementation and its invoker contract.
create temporary table cq_billing_reads (n integer);
grant select, insert on cq_billing_reads to authenticated;
alter function public.get_project_billing(uuid) rename to cq_test_billing;
create function public.get_project_billing(p_project_id uuid) returns jsonb
 language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 insert into pg_temp.cq_billing_reads values (1);
 return public.cq_test_billing(p_project_id);
end; $$;
revoke all on function public.get_project_billing(uuid) from public,anon;
grant execute on function public.get_project_billing(uuid) to authenticated;
discard plans;
set local role authenticated;
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
select throws_ok($$select public.confirm_work_order_acceptance(current_setting('cq.conf')::uuid)$$,
 '42501','acceptance is immutable','AC-CQ-005 a stage acceptance is confirmed only once');
select is((select confirmed_by from work_order_acceptances where id=current_setting('cq.conf')::uuid),
 '33520000-0000-0000-0000-000000000012'::uuid,'AC-CQ-005 a repeated confirmation preserves its confirmer');
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select set_config('cq.corrected',public.prepare_work_order_acceptance('33520000-0000-0000-0000-000000000032',current_date,false,
 '[{"boq_item_id":"33520000-0000-0000-0000-000000000042","quantity":2}]'::jsonb,'33520000-0000-0000-0000-000000000052')::text,true)$$,
 'AC-CQ-004 a later cumulative stage records the current accepted quantity');
select pg_sleep(0.005);
set local request.jwt.claims='{"sub":"33520000-0000-0000-0000-000000000012","role":"authenticated"}';
select lives_ok($$select public.confirm_work_order_acceptance(current_setting('cq.corrected')::uuid)$$,
 'AC-CQ-005 distinct Finance confirms the later cumulative stage');
select is((select count(*) from cq_billing_reads),1::bigint,
 'AC-CQ-005 one confirmation reads the billing summary once');
select ok((select confirmed_at from work_order_acceptances where id=current_setting('cq.corrected')::uuid)
 > (select confirmed_at from work_order_acceptances where id=current_setting('cq.conf')::uuid),
 'AC-CQ-005 confirmation timestamps reflect the time of each serialized confirmation');
select is((select (line->>'accepted_quantity')::numeric
 from jsonb_array_elements(public.get_project_billing('33520000-0000-0000-0000-000000000022')->'boq') line
 where line->>'boq_item_id'='33520000-0000-0000-0000-000000000042'),2::numeric,
 'AC-CQ-012 billing uses the most recently confirmed cumulative stage');
select is((select quantity from work_order_acceptance_lines where acceptance_id=current_setting('cq.conf')::uuid),3::numeric,
 'AC-CQ-004 a later stage preserves the previously signed quantity');
reset role;
select * from finish();
rollback;
