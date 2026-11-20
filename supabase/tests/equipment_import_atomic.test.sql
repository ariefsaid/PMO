begin;
create extension if not exists pgtap;
select plan(12);
insert into organizations (id,name,default_currency,default_timezone) values
('25300000-0000-0000-0000-000000000001','Import A','IDR','UTC'),
('25300000-0000-0000-0000-000000000002','Import B','IDR','UTC');
insert into auth.users (id,email) values
('25300000-0000-0000-0000-000000000011','import-admin@example.test'),
('25300000-0000-0000-0000-000000000012','import-pm@example.test'),
('25300000-0000-0000-0000-000000000013','import-engineer@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values
('25300000-0000-0000-0000-000000000011','25300000-0000-0000-0000-000000000001','Admin','import-admin@example.test','Admin','active'),
('25300000-0000-0000-0000-000000000012','25300000-0000-0000-0000-000000000001','PM','import-pm@example.test','Project Manager','active'),
('25300000-0000-0000-0000-000000000013','25300000-0000-0000-0000-000000000001','Engineer','import-engineer@example.test','Engineer','active');
insert into companies (id,org_id,name,type) values
('25300000-0000-0000-0000-000000000021','25300000-0000-0000-0000-000000000001','Vendor A','Vendor'),
('25300000-0000-0000-0000-000000000022','25300000-0000-0000-0000-000000000002','Vendor B','Vendor');
create function pg_temp.act_as(uid uuid) returns void language sql as $$select set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true)$$;
set local role authenticated;
select pg_temp.act_as('25300000-0000-0000-0000-000000000011');
select lives_ok($$select create_rented_equipment_asset('ADMIN','Crane','hours','25300000-0000-0000-0000-000000000021',100,'day','IDR','2026-01-01',null)$$,'Admin creates rental');
select throws_ok($$select create_rented_equipment_asset('RETRY','Crane','hours','25300000-0000-0000-0000-000000000021',1000000000000,'day','IDR','2026-01-01',null)$$,'22003',null,'term insert failure rolls back asset');
select is((select count(*)::int from equipment_assets where code='RETRY'),0,'failure rolls back asset');
select throws_ok($$select create_rented_equipment_asset('ZERO','Crane','hours','25300000-0000-0000-0000-000000000021',0,'day','IDR','2026-01-01',null)$$,'22023',null,'zero rate rejected');
select lives_ok($$select create_rented_equipment_asset('RETRY','Crane','hours','25300000-0000-0000-0000-000000000021',100,'day','IDR','2026-01-01',null)$$,'same code succeeds on retry');
select throws_ok($$select create_rented_equipment_asset('CROSS','Crane','hours','25300000-0000-0000-0000-000000000022',100,'day','IDR','2026-01-01',null)$$,'P0002',null,'other org vendor rejected');
select is((select count(*)::int from equipment_assets where code='CROSS'),0,'cross org failure rolls back');
select pg_temp.act_as('25300000-0000-0000-0000-000000000012');
select lives_ok($$select create_rented_equipment_asset('PM','Crane','days','25300000-0000-0000-0000-000000000021',100,'month','IDR','2026-01-01',null)$$,'PM can create rental');
select pg_temp.act_as('25300000-0000-0000-0000-000000000013');
select throws_ok($$select create_rented_equipment_asset('DENIED','Crane','hours','25300000-0000-0000-0000-000000000021',100,'day','IDR','2026-01-01',null)$$,'42501',null,'Engineer cannot create rental');
reset role;
select is((select count(*)::int from equipment_assets a join equipment_rental_terms t on t.asset_id=a.id and t.org_id=a.org_id where a.code in ('ADMIN','PM','RETRY') and a.ownership='rented'),3,'each success has rental terms in same org');
select is((select count(*)::int from equipment_assets where code='DENIED'),0,'denied call has no asset');
select is(has_function_privilege('anon','public.create_rented_equipment_asset(text,text,text,uuid,numeric,text,text,date,date)','execute'),false,'anon cannot execute');
select * from finish();
rollback;
