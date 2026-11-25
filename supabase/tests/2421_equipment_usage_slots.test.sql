-- Equipment job: distinct work-order slots; mutation: restore rollback/2421 before the assertions.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone) values
  ('24210000-0000-0000-0000-00000000000a', 'EQU Org',   'IDR', 'Asia/Jakarta'),
  ('24210000-0000-0000-0000-00000000000b', 'EQU Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('24210000-0000-0000-0000-0000000000a1', 'equ-admin@example.com'),
  ('24210000-0000-0000-0000-0000000000a2', 'equ-fin@example.com'),
  ('24210000-0000-0000-0000-0000000000a3', 'equ-pm1@example.com'),   -- manages P1 and P3
  ('24210000-0000-0000-0000-0000000000a4', 'equ-pm2@example.com'),   -- manages P2
  ('24210000-0000-0000-0000-0000000000a5', 'equ-exec@example.com'),
  ('24210000-0000-0000-0000-0000000000a6', 'equ-eng1@example.com'),
  ('24210000-0000-0000-0000-0000000000a7', 'equ-eng2@example.com'),
  ('24210000-0000-0000-0000-0000000000b1', 'equ-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('24210000-0000-0000-0000-0000000000a1', '24210000-0000-0000-0000-00000000000a', 'EQU Admin', 'equ-admin@example.com', 'Admin', 'active'),
  ('24210000-0000-0000-0000-0000000000a2', '24210000-0000-0000-0000-00000000000a', 'EQU Fin',   'equ-fin@example.com',   'Finance', 'active'),
  ('24210000-0000-0000-0000-0000000000a3', '24210000-0000-0000-0000-00000000000a', 'EQU PM1',   'equ-pm1@example.com',   'Project Manager', 'active'),
  ('24210000-0000-0000-0000-0000000000a4', '24210000-0000-0000-0000-00000000000a', 'EQU PM2',   'equ-pm2@example.com',   'Project Manager', 'active'),
  ('24210000-0000-0000-0000-0000000000a5', '24210000-0000-0000-0000-00000000000a', 'EQU Exec',  'equ-exec@example.com',  'Executive', 'active'),
  ('24210000-0000-0000-0000-0000000000a6', '24210000-0000-0000-0000-00000000000a', 'EQU Eng1',  'equ-eng1@example.com',  'Engineer', 'active'),
  ('24210000-0000-0000-0000-0000000000a7', '24210000-0000-0000-0000-00000000000a', 'EQU Eng2',  'equ-eng2@example.com',  'Engineer', 'active'),
  ('24210000-0000-0000-0000-0000000000b1', '24210000-0000-0000-0000-00000000000b', 'EQU XOrg',  'equ-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('24210000-0000-0000-0000-0000000000c1', '24210000-0000-0000-0000-00000000000a', 'EQU P1', 'Ongoing Project', '24210000-0000-0000-0000-0000000000a3'),
  ('24210000-0000-0000-0000-0000000000c2', '24210000-0000-0000-0000-00000000000a', 'EQU P2', 'Ongoing Project', '24210000-0000-0000-0000-0000000000a4'),
  ('24210000-0000-0000-0000-0000000000c3', '24210000-0000-0000-0000-00000000000a', 'EQU P3', 'Ongoing Project', '24210000-0000-0000-0000-0000000000a3'),
  ('24210000-0000-0000-0000-0000000000cb', '24210000-0000-0000-0000-00000000000b', 'EQU PX', 'Ongoing Project', null);
-- A1 loader (hours), A2 truck (days), A3/A4 hire-rate machines (hours), A9 foreign (ids are hex: d1..d4, d9)
insert into equipment_assets (id, org_id, code, name, default_unit) values
  ('24210000-0000-0000-0000-0000000000d1', '24210000-0000-0000-0000-00000000000a', 'LDR-1', 'Loader 1', 'hours'),
  ('24210000-0000-0000-0000-0000000000d2', '24210000-0000-0000-0000-00000000000a', 'TRK-1', 'Truck 1',  'days'),
  ('24210000-0000-0000-0000-0000000000d3', '24210000-0000-0000-0000-00000000000a', 'GEN-1', 'Generator 1', 'hours'),
  ('24210000-0000-0000-0000-0000000000d4', '24210000-0000-0000-0000-00000000000a', 'EXC-1', 'Excavator 1', 'hours'),
  ('24210000-0000-0000-0000-0000000000d9', '24210000-0000-0000-0000-00000000000b', 'LDR-X', 'Foreign loader', 'hours');


update organizations set built_in_roles_enabled=true where id='24210000-0000-0000-0000-00000000000a';
update profiles set built_in_role='equipment_officer' where id='24210000-0000-0000-0000-0000000000a6';
insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount) values
 ('24210000-0000-0000-0000-000000000401','24210000-0000-0000-0000-00000000000a','24210000-0000-0000-0000-0000000000c1','First work','Issued',100,'exclusive',0),
 ('24210000-0000-0000-0000-000000000402','24210000-0000-0000-0000-00000000000a','24210000-0000-0000-0000-0000000000c1','Second work','Issued',100,'exclusive',0);
create function pg_temp.save_slot(wo uuid, qty numeric) returns jsonb language sql as $$
 select save_equipment_usage(jsonb_build_object('asset_id','24210000-0000-0000-0000-0000000000d1','project_id','24210000-0000-0000-0000-0000000000c1','work_date','2026-09-10','quantity',qty,'unit','hours','work_order_id',wo));
$$;
create temp table slots(k text,v jsonb); grant all on slots to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"24210000-0000-0000-0000-0000000000a6","role":"authenticated"}';
insert into slots values ('first',pg_temp.save_slot('24210000-0000-0000-0000-000000000401',12));
select is((select work_order_id from equipment_usage_entries where id=(select (v->>'id')::uuid from slots where k='first')),'24210000-0000-0000-0000-000000000401'::uuid,'AC-EQU-SPLIT attribution is saved atomically');
select lives_ok($$insert into slots values ('second',pg_temp.save_slot('24210000-0000-0000-0000-000000000402',13))$$,'AC-EQU-SPLIT a second work order saves on the same machine day');
select is((select count(*) from equipment_usage_entries where asset_id='24210000-0000-0000-0000-0000000000d1'),2::bigint,'AC-EQU-SPLIT both entries remain');
select is((select sum(quantity) from equipment_usage_entries where asset_id='24210000-0000-0000-0000-0000000000d1'),25::numeric,'AC-EQU-SPLIT totals include both slots');
select is((select v->>'over_24h' from slots where k='second'),'true','AC-EQU-SPLIT aggregate over 24 hours remains a warning');
select throws_ok($$select pg_temp.save_slot('24210000-0000-0000-0000-000000000401',2)$$,'23505',null,'AC-EQU-SPLIT the exact same slot is still unique');
select throws_ok($$select pg_temp.save_slot('24210000-0000-0000-0000-000000000499',3)$$,'23514','COST_WO_PROJECT: the work order belongs to another project','AC-EQU-SPLIT nonexistent work order refuses the entire save');
select is((select count(*) from equipment_usage_entries where asset_id='24210000-0000-0000-0000-0000000000d1'),2::bigint,'AC-EQU-SPLIT no unattributed orphan survives a failed save');
select transition_equipment_usage((select (v->>'id')::uuid from slots where k='first'),'Submitted');
select throws_like($$select transition_equipment_usage((select (v->>'id')::uuid from slots where k='first'),'Approved')$$,'%separation of duties%','AC-EQU-SPLIT author cannot approve own attributed usage');
select is((select quantity from equipment_usage_entries where id=(select (v->>'id')::uuid from slots where k='first')),12::numeric,'AC-EQU-SPLIT second work order did not replace first hours');
reset role;
select * from finish(); rollback;
