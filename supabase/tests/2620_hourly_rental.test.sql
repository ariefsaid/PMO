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
set local role authenticated;
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a4');
select is((public.check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,160,'[{"date":"2026-09-01","hours":24},{"date":"2026-09-02","hours":16}]',null))->>'deduction','4000.00','AC-HRE-001 deduction uses explicit hours');
select is((public.check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,160,'[{"date":"2026-09-01","hours":24},{"date":"2026-09-02","hours":16}]',null))->>'expected_amount','16000.00','AC-HRE-001 expected_amount uses explicit hours');
select is((public.check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,160,'[{"date":"2026-09-01","hours":24},{"date":"2026-09-02","hours":16}]',null))->>'billable_hours','160.00','AC-HRE-001 billable_hours uses explicit hours');
select is((public.check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',20,0,'[{"date":"2026-09-01","hours":24},{"date":"2026-09-02","hours":16}]',null))->>'billable_hours','0.00','AC-HRE-001 billable hours floor zero');
select lives_ok($$select public.check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,160,'[{"date":"2026-09-01","hours":24},{"date":"2026-09-02","hours":16}]','disputed')$$,'AC-HRE-004 officer records dispute');
select is((public.check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,160,'[{"date":"2026-09-01","hours":24},{"date":"2026-09-02","hours":16}]',null))->>'invoice_hours','160.00','AC-HRE-001 invoice quantity remains separate');
select is((public.check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,160,'[{"date":"2026-09-01","hours":24},{"date":"2026-09-03","hours":16}]',null))->>'deduction','2400.00','AC-HRE-002 unproven hours excluded');
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a5');
select throws_ok($$select public.check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,160,'[{"date":"2026-09-01","hours":24},{"date":"2026-09-02","hours":16}]',null)$$,'42501','not authorized','AC-HRE-003 unrelated role refused');
select is((select count(*)::int from hourly_rental_checks),0,'AC-HRE-003 unrelated role reads no snapshots');
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from hourly_rental_checks),1,'AC-HRE-004 officer reads saved dispute');
select throws_ok($$select check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,160,'[{"date":"2026-09-01","hours":25}]',null)$$,'22023','invalid dated broken hours','AC-HRE-001 daily broken hours bounded');
select throws_ok($$select check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,160,'[]','approved')$$,'22023','invalid check outcome','AC-HRE-003 checks never approve');
select throws_ok($$select equipment_rental_check('16910000-0000-0000-0000-0000000000f2','2026-09-01','2026-09-10',3000,'include')$$,'42501','not authorized','AC-HRE-003 officer cannot override unproven days');
select is((equipment_rental_check('16910000-0000-0000-0000-0000000000f2','2026-09-01','2026-09-10',3000))->>'rental_amount','3000.00','AC-HRE-001 daily rental unchanged');
reset role;
insert into organizations(id,name,built_in_roles_enabled) values ('26200000-0000-0000-0000-000000000001','Other rental org',true);
update profiles set org_id = '26200000-0000-0000-0000-000000000001' where id = '16910000-0000-0000-0000-0000000000a4';
set local role authenticated;
select pg_temp.act_as('16910000-0000-0000-0000-0000000000a4');
select throws_ok($$select check_hourly_rental('16910000-0000-0000-0000-0000000000f1','2026-09-01','2026-09-30',200,160,'[]',null)$$,'P0002','rented asset not found','AC-HRE-003 other organisation asset refused');
select is((select count(*)::int from hourly_rental_checks),0,'AC-HRE-003 other organisation snapshots hidden');
reset role;
select * from finish();
rollback;
