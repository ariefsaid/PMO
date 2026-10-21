begin;
create extension if not exists pgtap;
select plan(5);
insert into organizations(id,name) values ('33540000-0000-0000-0000-000000000001','CQ Org');
insert into auth.users(id,email) values ('33540000-0000-0000-0000-000000000011','cq-finance@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33540000-0000-0000-0000-000000000011','33540000-0000-0000-0000-000000000001','CQ Finance','cq-finance@example.invalid','Finance','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount) values ('33540000-0000-0000-0000-000000000021','33540000-0000-0000-0000-000000000001','CQ Project','Ongoing Project',20000,'exclusive',0);
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33540000-0000-0000-0000-000000000031','33540000-0000-0000-0000-000000000001','33540000-0000-0000-0000-000000000021','CQ WO','Issued',10000,'inclusive',1000);
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('33540000-0000-0000-0000-000000000041','33540000-0000-0000-0000-000000000001','33540000-0000-0000-0000-000000000021','LINE','Contract line','km',10,100);
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values
 ('33540000-0000-0000-0000-000000000001','33540000-0000-0000-0000-000000000031','33540000-0000-0000-0000-000000000041',10);
select is((select order_net from work_order_billing where work_order_id='33540000-0000-0000-0000-000000000031'),9000::numeric,'AC-CQ-008 an unclosed inclusive order is normalised once');
select is((select remaining from work_order_billing where work_order_id='33540000-0000-0000-0000-000000000031'),9000::numeric,'AC-CQ-008 unchanged order net is the remaining balance');
select is((select count(*)::int from pg_proc where proname='get_project_drawdown' and prosecdef=false),1,'AC-CQ-008 drawdown remains SECURITY INVOKER');
select ok(pg_get_functiondef('public.transition_work_order(uuid,public.work_order_status,boolean)'::regprocedure) like '%close it by confirming its final BAST%','AC-CQ-006 DD-CQ-9 routes allocated manual close through final BAST');
set local role authenticated;
set local request.jwt.claims='{"sub":"33540000-0000-0000-0000-000000000011","role":"authenticated"}';
select throws_ok($$select public.transition_work_order('33540000-0000-0000-0000-000000000031','Closed')$$,'42501','this work order has contract lines: close it by confirming its final BAST','AC-CQ-006 manual close is refused for an allocated work order');
reset role;
select * from finish();
rollback;
