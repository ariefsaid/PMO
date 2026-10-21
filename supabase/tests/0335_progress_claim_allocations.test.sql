begin;
create extension if not exists pgtap;
select plan(4);
insert into organizations(id,name) values ('33560000-0000-0000-0000-000000000001','CQ Org');
insert into auth.users(id,email) values ('33560000-0000-0000-0000-000000000011','cq-finance@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33560000-0000-0000-0000-000000000011','33560000-0000-0000-0000-000000000001','CQ Finance','cq-finance@example.invalid','Finance','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,currency) values
 ('33560000-0000-0000-0000-000000000021','33560000-0000-0000-0000-000000000001','CQ Project','Ongoing Project',100000,'exclusive',0,'USD');
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount,currency) values
 ('33560000-0000-0000-0000-000000000031','33560000-0000-0000-0000-000000000001','33560000-0000-0000-0000-000000000021','CQ Issued','Issued',50000,'exclusive',0,'USD'),
 ('33560000-0000-0000-0000-000000000032','33560000-0000-0000-0000-000000000001','33560000-0000-0000-0000-000000000021','CQ Draft','Draft',50000,'exclusive',0,'USD');
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('33560000-0000-0000-0000-000000000041','33560000-0000-0000-0000-000000000001','33560000-0000-0000-0000-000000000021','ALLOC','Allocated','unit',10,1000),
 ('33560000-0000-0000-0000-000000000042','33560000-0000-0000-0000-000000000001','33560000-0000-0000-0000-000000000021','DRAFT','Draft allocation','unit',10,1000),
 ('33560000-0000-0000-0000-000000000043','33560000-0000-0000-0000-000000000001','33560000-0000-0000-0000-000000000021','FREE','Unallocated','unit',10,1000);
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values
 ('33560000-0000-0000-0000-000000000001','33560000-0000-0000-0000-000000000031','33560000-0000-0000-0000-000000000041',5),
 ('33560000-0000-0000-0000-000000000001','33560000-0000-0000-0000-000000000032','33560000-0000-0000-0000-000000000042',5);
set local role authenticated;
set local request.jwt.claims='{"sub":"33560000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$select public.create_progress_claim('33560000-0000-0000-0000-000000000021','progress',p_lines=>'[{"boq_item_id":"33560000-0000-0000-0000-000000000043","quantity":1}]'::jsonb)$$,'AC-CQ-011 project-level claim allows only an unallocated line');
select throws_ok($$select public.create_progress_claim('33560000-0000-0000-0000-000000000021','progress',p_lines=>'[{"boq_item_id":"33560000-0000-0000-0000-000000000041","quantity":1}]'::jsonb)$$,'23514',null,'AC-CQ-011 project-level claim rejects an allocated line');
select lives_ok($$select public.create_progress_claim('33560000-0000-0000-0000-000000000021','progress',p_work_order_id=>'33560000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"33560000-0000-0000-0000-000000000041","quantity":1}]'::jsonb)$$,'AC-CQ-011 work-order claim accepts a line allocated to that order');
select throws_ok($$select public.create_progress_claim('33560000-0000-0000-0000-000000000021','progress',p_work_order_id=>'33560000-0000-0000-0000-000000000031',p_lines=>'[{"boq_item_id":"33560000-0000-0000-0000-000000000042","quantity":1}]'::jsonb)$$,'23514',null,'AC-CQ-011 work-order claim rejects an unallocated line');
reset role;
select * from finish();
rollback;
