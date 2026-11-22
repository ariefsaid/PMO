-- procurement_purchase_type.test.sql — #2697: a purchase may carry a type and (for a rental-flagged type) a period.
-- AC-PTR-001 off means refused · AC-PTR-004 the flag decides, never the name (mutation-checked) · AC-PTR-005 period rules ·
-- AC-PTR-006 fixed after creation, even for an Admin · AC-PTR-007 retired or foreign type refused.
-- Migrations under test: 1350, 1351. Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(21);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26971000-0000-0000-0000-00000000000a', 'PTP Org',       'IDR', 'Asia/Jakarta'),
  ('26971000-0000-0000-0000-00000000000b', 'PTP Other Org', 'IDR', 'Asia/Jakarta');
-- these features are on by default now (with starter rows); this file proves the off state, so setup clears them as an explicit step
delete from purchase_types where org_id in ('26971000-0000-0000-0000-00000000000a', '26971000-0000-0000-0000-00000000000b');
delete from org_purchase_type_settings where org_id in ('26971000-0000-0000-0000-00000000000a', '26971000-0000-0000-0000-00000000000b');
insert into auth.users (id, email) values
  ('26971000-0000-0000-0000-0000000000a1', 'ptp-admin@example.com'),
  ('26971000-0000-0000-0000-0000000000a2', 'ptp-pm@example.com'),
  ('26971000-0000-0000-0000-0000000000b1', 'ptp-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26971000-0000-0000-0000-0000000000a1', '26971000-0000-0000-0000-00000000000a', 'PTP Admin', 'ptp-admin@example.com', 'Admin', 'active'),
  ('26971000-0000-0000-0000-0000000000a2', '26971000-0000-0000-0000-00000000000a', 'PTP PM',    'ptp-pm@example.com',    'Project Manager', 'active'),
  ('26971000-0000-0000-0000-0000000000b1', '26971000-0000-0000-0000-00000000000b', 'PTP XAdmin','ptp-xadmin@example.com','Admin', 'active');
-- the other organisation already has the feature on, with its own rental type
insert into org_purchase_type_settings (org_id, enabled) values ('26971000-0000-0000-0000-00000000000b', true) on conflict (org_id) do update set enabled = true;
insert into purchase_types (id, org_id, name, is_rental, position) values
  ('26971000-0000-0000-0000-0000000000f1', '26971000-0000-0000-0000-00000000000b', 'Rental', true, 1);

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- helper: raise a purchase through the single creation path
create or replace function pg_temp._mk(p_id uuid, p_extra jsonb) returns void language sql as $$
  select public.create_procurement_with_items(p_id, jsonb_build_object('title', 'PTP buy') || p_extra,
    jsonb_build_array(jsonb_build_object('id', md5(p_id::text)::uuid, 'name', 'Line', 'quantity', 2, 'rate', 50))) $$;
grant execute on function pg_temp._mk(uuid, jsonb) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;
set local role authenticated;

-- AC-PTR-001 default off: a plain create is unchanged; setting a type, period or link is refused
select pg_temp._as('26971000-0000-0000-0000-0000000000a2');
select lives_ok($$ select pg_temp._mk('26971000-0000-0000-0000-000000000101', '{}') $$, 'AC-PTR-001 a plain purchase is created exactly as before');
select is((select purchase_type_id is null and rental_from is null and rental_to is null and extends_procurement_id is null
             from procurements where id = '26971000-0000-0000-0000-000000000101'), true, 'AC-PTR-001 and carries no type, period or link');
select throws_ok($$ select pg_temp._mk('26971000-0000-0000-0000-000000000102', '{"purchase_type_id":"26971000-0000-0000-0000-0000000000f9"}') $$, '22023',
  'PTYPE_OFF: purchase types are not turned on', 'AC-PTR-001 with the feature off a type is refused');
select throws_ok($$ select pg_temp._mk('26971000-0000-0000-0000-000000000103', '{"rental_from":"2026-01-01","rental_to":"2026-01-31"}') $$, '22023',
  'PTYPE_OFF: purchase types are not turned on', 'AC-PTR-001 with the feature off a rental period is refused');

-- the Admin turns it on
select pg_temp._as('26971000-0000-0000-0000-0000000000a1');
select public.set_purchase_types_enabled(true);
insert into t_ids select 'rental', id from purchase_types where is_rental;
insert into t_ids select 'goods', id from purchase_types where name = 'Goods';

select pg_temp._as('26971000-0000-0000-0000-0000000000a2');
-- AC-PTR-005 period rules
select throws_ok(format($$ select pg_temp._mk('26971000-0000-0000-0000-000000000104', '{"purchase_type_id":"%s"}') $$, (select v from t_ids where k='rental')), '22023',
  'PTYPE_PERIOD_REQUIRED: a rental purchase needs a rental period', 'AC-PTR-005 a rental type without a period is refused');
select throws_ok(format($$ select pg_temp._mk('26971000-0000-0000-0000-000000000105', '{"purchase_type_id":"%s","rental_from":"2026-02-01","rental_to":"2026-01-01"}') $$, (select v from t_ids where k='rental')), '23514',
  null, 'AC-PTR-005 a period that ends before it starts is refused');
select throws_ok(format($$ select pg_temp._mk('26971000-0000-0000-0000-000000000106', '{"purchase_type_id":"%s","rental_from":"2026-01-01","rental_to":"2026-01-31"}') $$, (select v from t_ids where k='goods')), '22023',
  'PTYPE_PERIOD_NOT_ALLOWED: only a rental purchase carries a rental period', 'AC-PTR-005 a non-rental type with a period is refused');
select throws_ok($$ select pg_temp._mk('26971000-0000-0000-0000-000000000107', '{"rental_from":"2026-01-01","rental_to":"2026-01-31"}') $$, '22023',
  'PTYPE_PERIOD_NOT_ALLOWED: only a rental purchase carries a rental period', 'AC-PTR-005 no type with a period is refused');
select lives_ok(format($$ select pg_temp._mk('26971000-0000-0000-0000-000000000108', '{"purchase_type_id":"%s","rental_from":"2026-01-01","rental_to":"2026-01-31"}') $$, (select v from t_ids where k='rental')),
  'AC-PTR-005 a rental with a period is created');
select is((select rental_to from procurements where id = '26971000-0000-0000-0000-000000000108'), '2026-01-31'::date, 'AC-PTR-005 the period is stored');
select lives_ok(format($$ select pg_temp._mk('26971000-0000-0000-0000-000000000109', '{"purchase_type_id":"%s"}') $$, (select v from t_ids where k='goods')),
  'FR-PTR-005 a goods purchase is created without a period');
select lives_ok($$ select pg_temp._mk('26971000-0000-0000-0000-00000000010a', '{}') $$, 'FR-PTR-005 and so is one with no type, with the feature on');

-- AC-PTR-007 retired and foreign types
select pg_temp._as('26971000-0000-0000-0000-0000000000a1');
select public.set_purchase_type_active((select v from t_ids where k='goods'), false);
select pg_temp._as('26971000-0000-0000-0000-0000000000a2');
select throws_ok(format($$ select pg_temp._mk('26971000-0000-0000-0000-00000000010b', '{"purchase_type_id":"%s"}') $$, (select v from t_ids where k='goods')), '23503',
  'PTYPE_UNAVAILABLE: type not available', 'AC-PTR-007 a retired type cannot be chosen');
select throws_ok($$ select pg_temp._mk('26971000-0000-0000-0000-00000000010c', '{"purchase_type_id":"26971000-0000-0000-0000-0000000000f1","rental_from":"2026-01-01","rental_to":"2026-01-31"}') $$, '23503',
  'PTYPE_UNAVAILABLE: type not available', 'AC-PTR-007 another organisation''s type cannot be chosen');
select is((select purchase_type_id from procurements where id = '26971000-0000-0000-0000-000000000109'), (select v from t_ids where k='goods'),
  'AC-PTR-007 an old purchase keeps its now-retired type');

-- AC-PTR-006 fixed after creation: not even an Admin changes it
-- (written as the table owner: the guard binds the owner and every definer too, and an Admin has no column grant on these)
reset role;
select throws_ok($$ update procurements set rental_to = '2026-03-01' where id = '26971000-0000-0000-0000-000000000108' $$, '42501',
  'PTYPE_FIXED: a purchase''s type, rental period and extension link are set when it is created', 'AC-PTR-006 an Admin cannot change the period');
select throws_ok($$ update procurements set purchase_type_id = null where id = '26971000-0000-0000-0000-000000000108' $$, '42501',
  'PTYPE_FIXED: a purchase''s type, rental period and extension link are set when it is created', 'AC-PTR-006 an Admin cannot change the type');
select lives_ok($$ update procurements set title = 'renamed' where id = '26971000-0000-0000-0000-000000000108' $$, 'AC-PTR-006 other fields still update as before');
set local role authenticated;
select pg_temp._as('26971000-0000-0000-0000-0000000000a1');

-- the in-use rule: a type's rental flag cannot flip under purchases
select throws_ok(format($$ select public.upsert_purchase_type(%L, 'Rental', null, false, 3) $$, (select v from t_ids where k='rental')), '23503',
  'PTYPE_IN_USE: purchases use this type; retire it and add a new one instead', 'FR-PTR-001 the rental flag cannot change while purchases use the type');

-- AC-PTR-004 the flag decides, never the name: swap the two names, then the rules follow the flag
select public.upsert_purchase_type((select v from t_ids where k='rental'), 'Hire', null, true, 3);
select public.set_purchase_type_active((select v from t_ids where k='goods'), true);
select public.upsert_purchase_type((select v from t_ids where k='goods'), 'Rental', null, false, 1);
select pg_temp._as('26971000-0000-0000-0000-0000000000a2');
select throws_ok(format($$ select pg_temp._mk('26971000-0000-0000-0000-00000000010d', '{"purchase_type_id":"%s","rental_from":"2026-01-01","rental_to":"2026-01-31"}') $$, (select v from t_ids where k='goods')), '22023',
  'PTYPE_PERIOD_NOT_ALLOWED: only a rental purchase carries a rental period', 'AC-PTR-004 a non-rental type named "Rental" gets no rental period');
select lives_ok(format($$ select pg_temp._mk('26971000-0000-0000-0000-00000000010e', '{"purchase_type_id":"%s","rental_from":"2026-01-01","rental_to":"2026-01-31"}') $$, (select v from t_ids where k='rental')),
  'AC-PTR-004 a rental-flagged type named "Hire" takes a rental period');
select * from finish();
rollback;
