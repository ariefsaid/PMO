-- rental_extension.test.sql — #2697: the guided rental extension creates its own purchase, linked, through the normal path.
-- AC-PTR-008 one new Draft, original untouched, idempotent · AC-PTR-009 order and overlap (mutation-checked) ·
-- AC-PTR-010 only a live rental · AC-PTR-011 nothing copied but defaults · AC-PTR-012 another organisation.
-- Migrations under test: 1350, 1351, 1352. Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(20);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26972000-0000-0000-0000-00000000000a', 'PTE Org',       'IDR', 'Asia/Jakarta'),
  ('26972000-0000-0000-0000-00000000000b', 'PTE Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('26972000-0000-0000-0000-0000000000a2', 'pte-pm@example.com'),
  ('26972000-0000-0000-0000-0000000000b1', 'pte-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26972000-0000-0000-0000-0000000000a2', '26972000-0000-0000-0000-00000000000a', 'PTE PM',    'pte-pm@example.com',    'Project Manager', 'active'),
  ('26972000-0000-0000-0000-0000000000b1', '26972000-0000-0000-0000-00000000000b', 'PTE XAdmin','pte-xadmin@example.com','Admin', 'active');
insert into org_purchase_type_settings (org_id, enabled) values ('26972000-0000-0000-0000-00000000000a', true);
insert into purchase_types (id, org_id, name, is_rental, position) values
  ('26972000-0000-0000-0000-0000000000f1', '26972000-0000-0000-0000-00000000000a', 'Hire',  true,  1),
  ('26972000-0000-0000-0000-0000000000f2', '26972000-0000-0000-0000-00000000000a', 'Buy',   false, 2);
insert into companies (id, org_id, name, type) values ('26972000-0000-0000-0000-0000000000e1', '26972000-0000-0000-0000-00000000000a', 'PTE Vendor', 'Vendor');
-- fixtures written as the owner: a live rental (R1), a cancelled rental (R2), a plain purchase (R3), an approved rental (R4)
insert into procurements (id, org_id, title, status, vendor_id, purchase_type_id, rental_from, rental_to, requested_by_id) values
  ('26972000-0000-0000-0000-000000000a01', '26972000-0000-0000-0000-00000000000a', 'Crane hire', 'Draft',     '26972000-0000-0000-0000-0000000000e1', '26972000-0000-0000-0000-0000000000f1', '2026-01-01', '2026-01-31', '26972000-0000-0000-0000-0000000000a2'),
  ('26972000-0000-0000-0000-000000000a02', '26972000-0000-0000-0000-00000000000a', 'Old hire',   'Cancelled', null, '26972000-0000-0000-0000-0000000000f1', '2026-01-01', '2026-01-31', '26972000-0000-0000-0000-0000000000a2'),
  ('26972000-0000-0000-0000-000000000a03', '26972000-0000-0000-0000-00000000000a', 'Cement',     'Draft',     null, '26972000-0000-0000-0000-0000000000f2', null, null, '26972000-0000-0000-0000-0000000000a2'),
  ('26972000-0000-0000-0000-000000000a04', '26972000-0000-0000-0000-00000000000a', 'Pump hire',  'Approved',  null, '26972000-0000-0000-0000-0000000000f1', '2026-01-01', '2026-01-31', '26972000-0000-0000-0000-0000000000a2');
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('26972000-0000-0000-0000-000000000b01', '26972000-0000-0000-0000-00000000000a', '26972000-0000-0000-0000-000000000a01', 'Crane', 1, 1000),
  ('26972000-0000-0000-0000-000000000b02', '26972000-0000-0000-0000-00000000000a', '26972000-0000-0000-0000-000000000a01', 'Operator', 2, 150);

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create temp table t_snap as select title, status, rental_from, rental_to, total_value from procurements where id = '26972000-0000-0000-0000-000000000a01';
grant all on t_snap to authenticated;
set local role authenticated;
select pg_temp._as('26972000-0000-0000-0000-0000000000a2');

-- AC-PTR-008 a later period creates exactly one new Draft purchase, linked, same type, requested by the caller
select lives_ok($$ select public.extend_rental_procurement('26972000-0000-0000-0000-000000000e01', '26972000-0000-0000-0000-000000000a01', '2026-02-01', '2026-02-28') $$,
  'AC-PTR-008 a live rental is extended');
select is((select count(*)::int from procurements where extends_procurement_id = '26972000-0000-0000-0000-000000000a01'), 1, 'AC-PTR-008 exactly one new purchase is linked');
select is((select status::text from procurements where id = '26972000-0000-0000-0000-000000000e01'), 'Draft', 'AC-PTR-011 the extension starts in Draft: it takes the normal request path');
select is((select purchase_type_id from procurements where id = '26972000-0000-0000-0000-000000000e01'), '26972000-0000-0000-0000-0000000000f1'::uuid, 'AC-PTR-008 it keeps the type');
select is((select requested_by_id from procurements where id = '26972000-0000-0000-0000-000000000e01'), '26972000-0000-0000-0000-0000000000a2'::uuid, 'AC-PTR-008 the caller is the requester');
select is((select vendor_id from procurements where id = '26972000-0000-0000-0000-000000000e01'), '26972000-0000-0000-0000-0000000000e1'::uuid, 'FR-PTR-009 vendor carries over as a default');
select is((select count(*)::int from procurement_items where procurement_id = '26972000-0000-0000-0000-000000000e01'), 2, 'FR-PTR-009 lines carry over as defaults');
select is((select (p.title, p.status, p.rental_from, p.rental_to, p.total_value) = (s.title, s.status, s.rental_from, s.rental_to, s.total_value)
             from procurements p, t_snap s where p.id = '26972000-0000-0000-0000-000000000a01'), true, 'AC-PTR-008 the original is unchanged');
select lives_ok($$ select public.extend_rental_procurement('26972000-0000-0000-0000-000000000e01', '26972000-0000-0000-0000-000000000a01', '2026-02-01', '2026-02-28') $$,
  'AC-PTR-008 a retry with the same id succeeds');
select is((select count(*)::int from procurements where extends_procurement_id = '26972000-0000-0000-0000-000000000a01'), 1, 'AC-PTR-008 and creates no second purchase');
select is((select count(*)::int from procurement_items where procurement_id = '26972000-0000-0000-0000-000000000e01'), 2, 'AC-PTR-008 nor a second set of lines');

-- AC-PTR-009 order and overlap
select throws_ok($$ select public.extend_rental_procurement('26972000-0000-0000-0000-000000000e02', '26972000-0000-0000-0000-000000000a01', '2026-01-31', '2026-02-10') $$, '22023',
  'PTYPE_EXT_ORDER: the extension must start after 2026-01-31 (the end of the rental it extends)', 'AC-PTR-009 starting on the original''s last day is refused');
select throws_ok($$ select public.extend_rental_procurement('26972000-0000-0000-0000-000000000e03', '26972000-0000-0000-0000-000000000a01', '2026-02-15', '2026-03-15') $$, '22023',
  'PTYPE_EXT_OVERLAP: another extension of this rental already covers part of that period', 'AC-PTR-009 overlapping a sibling extension is refused');
select lives_ok($$ select public.extend_rental_procurement('26972000-0000-0000-0000-000000000e04', '26972000-0000-0000-0000-000000000e01', '2026-03-01', '2026-03-31') $$,
  'AC-PTR-009 an extension can itself be extended from its own end');

-- AC-PTR-010 only a live rental
select throws_ok($$ select public.extend_rental_procurement('26972000-0000-0000-0000-000000000e05', '26972000-0000-0000-0000-000000000a02', '2026-02-01', '2026-02-28') $$, '22023',
  'PTYPE_EXT_NOT_LIVE_RENTAL: only a live rental can be extended', 'AC-PTR-010 a cancelled rental cannot be extended');
select throws_ok($$ select public.extend_rental_procurement('26972000-0000-0000-0000-000000000e06', '26972000-0000-0000-0000-000000000a03', '2026-02-01', '2026-02-28') $$, '22023',
  'PTYPE_EXT_NOT_LIVE_RENTAL: only a live rental can be extended', 'AC-PTR-010 a non-rental purchase cannot be extended');

-- AC-PTR-011 an approved original does not make its extension approved
select lives_ok($$ select public.extend_rental_procurement('26972000-0000-0000-0000-000000000e07', '26972000-0000-0000-0000-000000000a04', '2026-02-01', '2026-02-28', '[{"id":"26972000-0000-0000-0000-000000000b09","name":"Pump","quantity":1,"rate":500}]'::jsonb) $$,
  'AC-PTR-011 an approved rental is extended with its own lines');
select is((select status::text from procurements where id = '26972000-0000-0000-0000-000000000e07'), 'Draft', 'AC-PTR-011 the extension is Draft, never Approved, whatever the original is');

-- AC-PTR-012 another organisation
select pg_temp._as('26972000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.extend_rental_procurement('26972000-0000-0000-0000-000000000e08', '26972000-0000-0000-0000-000000000a01', '2026-06-01', '2026-06-30') $$, '23503',
  'PTYPE_EXT_NOT_FOUND: the rental to extend is not available', 'AC-PTR-012 another organisation cannot extend it');
select is((select count(*)::int from procurements), 0, 'AC-PTR-012 and sees none of the purchases');
select * from finish();
rollback;
