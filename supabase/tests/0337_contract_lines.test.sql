begin;
create extension if not exists pgtap;
select plan(7);
insert into organizations(id,name) values ('33500000-0000-0000-0000-000000000001','CQ Org');
insert into auth.users(id,email) values ('33500000-0000-0000-0000-000000000011','cq-admin@example.invalid');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('33500000-0000-0000-0000-000000000011','33500000-0000-0000-0000-000000000001','CQ Admin','cq-admin@example.invalid','Admin','active');
insert into projects(id,org_id,name,status,contract_value,tax_treatment,tax_amount) values
 ('33500000-0000-0000-0000-000000000021','33500000-0000-0000-0000-000000000001','CQ Project','Ongoing Project',100000,'exclusive',0);
set local role authenticated;
set local request.jwt.claims='{"sub":"33500000-0000-0000-0000-000000000011","role":"authenticated"}';
select lives_ok($$insert into boq_items(project_id,item_code,description,unit,quantity,rate,earning_basis) values
 ('33500000-0000-0000-0000-000000000021','UNIT','Unit line','km',2,10,'unit_rate')$$,'AC-CQ-001 unit-rate contract line is valid');
select lives_ok($$insert into boq_items(project_id,item_code,description,unit,quantity,rate,earning_basis,line_no,import_key) values
 ('33500000-0000-0000-0000-000000000021','LOT','Lot line','lot',1,10,'lump_sum',null,'unique-key')$$,'AC-CQ-001 lump sum requires quantity one and permits null line number');
select throws_ok($$insert into boq_items(project_id,item_code,description,unit,quantity,rate,earning_basis) values
 ('33500000-0000-0000-0000-000000000021','BAD','Bad basis','unit',1,10,'unknown')$$,'23514',null,'AC-CQ-001 invalid earning basis is refused');
select throws_ok($$insert into boq_items(project_id,item_code,description,unit,quantity,rate,earning_basis) values
 ('33500000-0000-0000-0000-000000000021','BAD','Bad lot','lot',2,10,'lump_sum')$$,'23514',null,'AC-CQ-001 lump sum quantity must equal one');
select throws_ok($$insert into boq_items(project_id,item_code,description,unit,quantity,rate) values
 ('33500000-0000-0000-0000-000000000021','BAD','Bad NaN','km','NaN',10)$$,'23514',null,'AC-CQ-001 NaN quantity is refused');
select throws_ok($$insert into boq_items(project_id,item_code,description,unit,quantity,rate,import_key) values
 ('33500000-0000-0000-0000-000000000021','DUP','Duplicate','km',1,10,'unique-key')$$,'23505',null,'AC-CQ-001 duplicate project import key is refused');
select is((select count(*)::int from information_schema.columns where table_schema='public' and table_name='boq_items' and column_name='work_order_id'),0,'AC-CQ-001 legacy single-work-order column is removed');
reset role;
select * from finish();
rollback;
