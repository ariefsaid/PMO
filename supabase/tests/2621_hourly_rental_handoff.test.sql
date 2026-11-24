begin;
create extension if not exists pgtap;
select no_plan();
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('16910000-0000-0000-0000-00000000000a', 'EMR Org', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('16910000-0000-0000-0000-0000000000a1', 'emr-admin@example.com'),
  ('16910000-0000-0000-0000-0000000000a2', 'emr-fin@example.com'),
  ('16910000-0000-0000-0000-0000000000a3', 'emr-pm@example.com'),
  ('16910000-0000-0000-0000-0000000000a4', 'emr-eqm@example.com'),
  ('16910000-0000-0000-0000-0000000000a5', 'emr-safety@example.com'),
  ('16910000-0000-0000-0000-0000000000a6', 'emr-hr@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16910000-0000-0000-0000-0000000000a1', '16910000-0000-0000-0000-00000000000a', 'EMR Admin', 'emr-admin@example.com', 'Admin', 'active'),
  ('16910000-0000-0000-0000-0000000000a2', '16910000-0000-0000-0000-00000000000a', 'EMR Fin', 'emr-fin@example.com', 'Finance', 'active'),
  ('16910000-0000-0000-0000-0000000000a3', '16910000-0000-0000-0000-00000000000a', 'EMR PM', 'emr-pm@example.com', 'Project Manager', 'active');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('16910000-0000-0000-0000-0000000000a4', '16910000-0000-0000-0000-00000000000a', 'EMR Equipment Manager', 'emr-eqm@example.com', 'Engineer', 'active', 'equipment_officer'),
  ('16910000-0000-0000-0000-0000000000a5', '16910000-0000-0000-0000-00000000000a', 'EMR Safety Manager', 'emr-safety@example.com', 'Project Manager', 'active', 'safety_manager'),
  ('16910000-0000-0000-0000-0000000000a6', '16910000-0000-0000-0000-00000000000a', 'EMR HR Manager', 'emr-hr@example.com', 'Project Manager', 'active', 'hr_manager');
insert into companies (id, org_id, name, type) values
  ('16910000-0000-0000-0000-0000000000e1', '16910000-0000-0000-0000-00000000000a', 'EMR Rental Co', 'Vendor');
insert into equipment_assets (id, org_id, code, name, default_unit, ownership) values
  ('16910000-0000-0000-0000-0000000000f1', '16910000-0000-0000-0000-00000000000a', 'EMR-1', 'Excavator', 'hours', 'owned'),
  ('16910000-0000-0000-0000-0000000000f2', '16910000-0000-0000-0000-00000000000a', 'EMR-2', 'Crane', 'hours', 'rented');
insert into equipment_rental_terms (org_id, asset_id, vendor_id, rate, basis, currency, rented_from) values
  ('16910000-0000-0000-0000-00000000000a', '16910000-0000-0000-0000-0000000000f2', '16910000-0000-0000-0000-0000000000e1', 300.00, 'day', 'IDR', '2026-09-01');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.term_json(p_asset uuid, p_from text) returns jsonb language sql as $$
  select jsonb_build_object('asset_id', p_asset, 'vendor_id', '16910000-0000-0000-0000-0000000000e1', 'rate', '150.00', 'basis', 'day',
                            'currency', 'IDR', 'rented_from', p_from);
$$;
update equipment_assets set ownership = 'rented' where code = 'EMR-1';
insert into equipment_rental_terms (org_id,asset_id,vendor_id,rate,basis,currency,rented_from) values ('16910000-0000-0000-0000-00000000000a','16910000-0000-0000-0000-0000000000f1','16910000-0000-0000-0000-0000000000e1',100,'hour','IDR','2026-09-01');
insert into equipment_downtime_proofs (org_id,asset_id,proof_date,file_name,file_path) values ('16910000-0000-0000-0000-00000000000a','16910000-0000-0000-0000-0000000000f1','2026-09-01','repair.pdf','hourly/repair.pdf');
insert into storage.objects (bucket_id,name) values ('equipment-proof','hourly/repair.pdf');
insert into equipment_downtime_proofs (org_id,asset_id,proof_date,file_name,file_path) values ('16910000-0000-0000-0000-00000000000a','16910000-0000-0000-0000-0000000000f1','2026-09-02','repair.pdf','hourly/repair.pdf');
insert into procurements(id,org_id,title,vendor_id) values ('26210000-0000-0000-0000-000000000001','16910000-0000-0000-0000-00000000000a','Rental purchase','16910000-0000-0000-0000-0000000000e1');
insert into procurement_invoices(id,org_id,procurement_id,vi_number,status,amount,tax_treatment,tax_amount) values ('26210000-0000-0000-0000-000000000002','16910000-0000-0000-0000-00000000000a','26210000-0000-0000-0000-000000000001','VI-RENTAL','Received',17000,'exclusive',0);
set local role authenticated;
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a4');
select lives_ok($$select check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,170,'[]','disputed','26210000-0000-0000-0000-000000000002','Billed broken hours')$$,'AC-HRE-005 officer disputes a specific invoice');
select throws_ok($$select check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,170,'[]','disputed')$$,'22023','choose a supplier invoice for this rental vendor','AC-HRE-005 a dispute cannot be saved without its invoice');
select throws_ok($$select check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,170,'[]','disputed','26210000-0000-0000-0000-000000000002',' ')$$,'22023','a dispute needs a note of at most 1000 characters','AC-HRE-005 dispute requires officer note');
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a2');
select is(get_hourly_rental_checks(null,'26210000-0000-0000-0000-000000000001')->0->>'note','Billed broken hours','AC-HRE-005 Finance reads officer note on purchase');
select is(get_hourly_rental_checks(null,'26210000-0000-0000-0000-000000000001')->0->>'invoice_number','VI-RENTAL','AC-HRE-005 identifies actual supplier invoice');
select is((select amount from procurement_invoices where id = '26210000-0000-0000-0000-000000000002'),17000::numeric,'AC-HRE-005 dispute changes no supplier invoice amount');
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a5');
select throws_ok($$select get_hourly_rental_checks(null,'26210000-0000-0000-0000-000000000001')$$,'42501','not authorized','AC-HRE-005 unrelated role receives no new read');
reset role;
insert into organizations(id,name,built_in_roles_enabled) values ('26210000-0000-0000-0000-00000000000b','Other rental organisation',true);
insert into auth.users(id,email) values ('26210000-0000-0000-0000-00000000000b','foreign-finance@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('26210000-0000-0000-0000-00000000000b','26210000-0000-0000-0000-00000000000b','Foreign Finance','foreign-finance@example.test','Finance','active');
set local role authenticated;
select pg_temp.act_as('26210000-0000-0000-0000-00000000000b');
select is(get_hourly_rental_checks(null,'26210000-0000-0000-0000-000000000001'),'[]'::jsonb,'AC-HRE-005 foreign Finance cannot read flag');
select is((select count(*)::int from hourly_rental_checks),0,'AC-HRE-005 foreign Finance cannot bypass reader');
reset role;
select * from finish();
rollback;
