begin;
create extension if not exists pgtap;
select plan(8);
insert into organizations(id,name) values ('33510000-0000-0000-0000-000000000001','CQ Org'),('33510000-0000-0000-0000-000000000002','CQ Other');
insert into auth.users(id,email) values
 ('33510000-0000-0000-0000-000000000011','cq-pm@example.invalid'),('33510000-0000-0000-0000-000000000012','cq-engineer@example.invalid'),
 ('33510000-0000-0000-0000-000000000013','cq-disabled@example.invalid'),('33510000-0000-0000-0000-000000000014','cq-other@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('33510000-0000-0000-0000-000000000011','33510000-0000-0000-0000-000000000001','CQ PM','cq-pm@example.invalid','Project Manager','active'),
 ('33510000-0000-0000-0000-000000000012','33510000-0000-0000-0000-000000000001','CQ Engineer','cq-engineer@example.invalid','Engineer','active'),
 ('33510000-0000-0000-0000-000000000013','33510000-0000-0000-0000-000000000001','CQ Disabled','cq-disabled@example.invalid','Project Manager','disabled'),
 ('33510000-0000-0000-0000-000000000014','33510000-0000-0000-0000-000000000002','CQ Other','cq-other@example.invalid','Admin','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount,project_manager_id) values
 ('33510000-0000-0000-0000-000000000021','33510000-0000-0000-0000-000000000001','CQ Project','Ongoing Project',10000,'exclusive',0,'33510000-0000-0000-0000-000000000011');
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33510000-0000-0000-0000-000000000031','33510000-0000-0000-0000-000000000001','33510000-0000-0000-0000-000000000021','CQ WO','Issued',10000,'exclusive',0);
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('33510000-0000-0000-0000-000000000041','33510000-0000-0000-0000-000000000001','33510000-0000-0000-0000-000000000021','LINE','Contract line','km',10,1000);
set local role authenticated;
set local request.jwt.claims='{"sub":"33510000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$insert into work_order_lines(work_order_id,boq_item_id,quantity) values('33510000-0000-0000-0000-000000000031','33510000-0000-0000-0000-000000000041',12)$$,'AC-CQ-002 over-order is recorded as a visible allocation');
select throws_ok($$insert into work_order_lines(work_order_id,boq_item_id,quantity) values('33510000-0000-0000-0000-000000000031','33510000-0000-0000-0000-000000000041',1)$$,'23505',null,'AC-CQ-002 duplicate allocation per work order and line is refused');
select throws_ok($$update work_order_lines set work_order_id='33510000-0000-0000-0000-000000000099'$$,'42501',null,'AC-CQ-002 allocation parent cannot be repointed');
set local request.jwt.claims='{"sub":"33510000-0000-0000-0000-000000000012","role":"authenticated"}';
select throws_ok($$insert into work_order_lines(work_order_id,boq_item_id,quantity) values('33510000-0000-0000-0000-000000000031','33510000-0000-0000-0000-000000000041',1)$$,'42501',null,'AC-CQ-002 Engineer cannot allocate');
set local request.jwt.claims='{"sub":"33510000-0000-0000-0000-000000000013","role":"authenticated"}';
select is((select count(*)::int from work_order_lines),0,'AC-CQ-002 disabled member reads no allocations');
set local request.jwt.claims='{"sub":"33510000-0000-0000-0000-000000000014","role":"authenticated"}';
select is((select count(*)::int from work_order_lines),0,'AC-CQ-002 other organization reads no allocations');
reset role;
select is(has_table_privilege('anon','public.work_order_lines','select'),false,'AC-CQ-002 anon cannot read allocations');
select is((select quantity from work_order_lines where work_order_id='33510000-0000-0000-0000-000000000031'),12::numeric,'AC-CQ-002 over-order remains visible');
select * from finish();
rollback;
