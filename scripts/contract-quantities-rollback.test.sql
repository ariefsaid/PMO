-- AC-CQ-003 upgrade/reversal integration harness; runner expands migration markers in-place.
\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap;
select plan(5);
-- @0337_DOWN@
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='boq_items' and column_name='work_order_id'),'AC-CQ-003 rollback restores the legacy link');
insert into organizations(id,name) values ('33580000-0000-0000-0000-000000000001','CQ Rollback Org');
insert into auth.users(id,email) values ('33580000-0000-0000-0000-000000000011','cq-rollback@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values ('33580000-0000-0000-0000-000000000011','33580000-0000-0000-0000-000000000001','CQ Rollback','cq-rollback@example.invalid','Admin','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount) values
 ('33580000-0000-0000-0000-000000000021','33580000-0000-0000-0000-000000000001','CQ Project','Ongoing Project',10000,'exclusive',0);
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('33580000-0000-0000-0000-000000000031','33580000-0000-0000-0000-000000000001','33580000-0000-0000-0000-000000000021','CQ WO 1','Issued',5000,'exclusive',0),
 ('33580000-0000-0000-0000-000000000032','33580000-0000-0000-0000-000000000001','33580000-0000-0000-0000-000000000021','CQ WO 2','Issued',5000,'exclusive',0);
insert into boq_items(id,org_id,project_id,work_order_id,item_code,description,unit,quantity,rate) values
 ('33580000-0000-0000-0000-000000000041','33580000-0000-0000-0000-000000000001','33580000-0000-0000-0000-000000000021','33580000-0000-0000-0000-000000000031','ONE','Single allocation','unit',2,100),
 ('33580000-0000-0000-0000-000000000042','33580000-0000-0000-0000-000000000001','33580000-0000-0000-0000-000000000021',null,'MANY','Multiple allocations','unit',2,100);
-- @0337_UP@
select is((select quantity from work_order_lines where boq_item_id='33580000-0000-0000-0000-000000000041'),2::numeric,'AC-CQ-003 upgrade backfills the old line quantity');
insert into work_order_lines(org_id,work_order_id,boq_item_id,quantity) values
 ('33580000-0000-0000-0000-000000000001','33580000-0000-0000-0000-000000000031','33580000-0000-0000-0000-000000000042',1),
 ('33580000-0000-0000-0000-000000000001','33580000-0000-0000-0000-000000000032','33580000-0000-0000-0000-000000000042',1);
-- @0337_DOWN@
select is((select work_order_id from boq_items where id='33580000-0000-0000-0000-000000000041'),'33580000-0000-0000-0000-000000000031'::uuid,'AC-CQ-003 one allocation round-trips to the old link');
select is((select work_order_id from boq_items where id='33580000-0000-0000-0000-000000000042'),null::uuid,'AC-CQ-003 multiple allocations do not select an arbitrary old link');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='boq_items' and column_name='earning_basis'),'AC-CQ-003 rollback removes the new contract metadata');
select * from finish();
rollback;
