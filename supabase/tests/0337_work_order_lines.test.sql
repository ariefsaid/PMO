begin;
create extension if not exists pgtap;
select plan(17);
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
-- AC-CQ-002: over-order is shown (not blocked, not clamped) and allocations freeze with the work order.
insert into boq_items(id,org_id,project_id,item_code,description,unit,quantity,rate) values
 ('33510000-0000-0000-0000-000000000042','33510000-0000-0000-0000-000000000001','33510000-0000-0000-0000-000000000021','KM','Generic km line','km',1900,50000);
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33510000-0000-0000-0000-000000000032','33510000-0000-0000-0000-000000000001','33510000-0000-0000-0000-000000000021','CQ WO two','Issued',10000,'exclusive',0),
 ('33510000-0000-0000-0000-000000000033','33510000-0000-0000-0000-000000000001','33510000-0000-0000-0000-000000000021','CQ WO closed','Issued',10000,'exclusive',0),
 ('33510000-0000-0000-0000-000000000034','33510000-0000-0000-0000-000000000001','33510000-0000-0000-0000-000000000021','CQ WO cancelled','Issued',10000,'exclusive',0);
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values
 ('33510000-0000-0000-0000-000000000001','33510000-0000-0000-0000-000000000033','33510000-0000-0000-0000-000000000041',1),
 ('33510000-0000-0000-0000-000000000001','33510000-0000-0000-0000-000000000034','33510000-0000-0000-0000-000000000041',1);
update work_orders set status='Closed' where id='33510000-0000-0000-0000-000000000033';
update work_orders set status='Cancelled' where id='33510000-0000-0000-0000-000000000034';
set local role authenticated;
set local request.jwt.claims='{"sub":"33510000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$insert into work_order_lines(work_order_id,boq_item_id,quantity) values('33510000-0000-0000-0000-000000000031','33510000-0000-0000-0000-000000000042',1000)$$,'AC-CQ-002 first order allocates 1000 of 1900 km');
select lives_ok($$insert into work_order_lines(work_order_id,boq_item_id,quantity) values('33510000-0000-0000-0000-000000000032','33510000-0000-0000-0000-000000000042',950)$$,'AC-CQ-002 second order allocating 950 km (total 1950 over 1900) is saved, not blocked');
select is((select e->>'contract_balance' from jsonb_array_elements(public.get_project_billing('33510000-0000-0000-0000-000000000021')->'boq') e where e->>'boq_item_id'='33510000-0000-0000-0000-000000000042')::numeric,-50::numeric,'AC-CQ-002 over-order is shown as a negative contract balance, not clamped at zero');
select throws_ok($$insert into work_order_lines(work_order_id,boq_item_id,quantity) values('33510000-0000-0000-0000-000000000033','33510000-0000-0000-0000-000000000042',1)$$,'42501','allocations are frozen after a work order closes or is cancelled','AC-CQ-002 a Closed work order refuses a new allocation');
select throws_ok($$update work_order_lines set quantity=2 where work_order_id='33510000-0000-0000-0000-000000000033'$$,'42501','allocations are frozen after a work order closes or is cancelled','AC-CQ-002 a Closed work order refuses an allocation update');
select throws_ok($$delete from work_order_lines where work_order_id='33510000-0000-0000-0000-000000000033'$$,'42501','allocations are frozen after a work order closes or is cancelled','AC-CQ-002 a Closed work order refuses an allocation delete');
select throws_ok($$insert into work_order_lines(work_order_id,boq_item_id,quantity) values('33510000-0000-0000-0000-000000000034','33510000-0000-0000-0000-000000000042',1)$$,'42501','allocations are frozen after a work order closes or is cancelled','AC-CQ-002 a Cancelled work order refuses a new allocation');
select throws_ok($$update work_order_lines set quantity=2 where work_order_id='33510000-0000-0000-0000-000000000034'$$,'42501','allocations are frozen after a work order closes or is cancelled','AC-CQ-002 a Cancelled work order refuses an allocation update');
select throws_ok($$delete from work_order_lines where work_order_id='33510000-0000-0000-0000-000000000034'$$,'42501','allocations are frozen after a work order closes or is cancelled','AC-CQ-002 a Cancelled work order refuses an allocation delete');
reset role;
select * from finish();
rollback;
