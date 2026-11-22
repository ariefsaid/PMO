-- purchase_types.test.sql — #2697: the purchase-type list is organisation data, switched on by an Admin.
-- AC-PTR-002 starter rows, once · AC-PTR-003 Admin only (mutation-checked) · AC-PTR-007 retired/foreign types · AC-PTR-012 tenancy.
-- Migration under test: 1350_purchase_types.sql (+1351 for the in-use rule). Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(18);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26970000-0000-0000-0000-00000000000a', 'PT Org',       'IDR', 'Asia/Jakarta'),
  ('26970000-0000-0000-0000-00000000000b', 'PT Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('26970000-0000-0000-0000-0000000000a1', 'pt-admin@example.com'),
  ('26970000-0000-0000-0000-0000000000a2', 'pt-pm@example.com'),
  ('26970000-0000-0000-0000-0000000000b1', 'pt-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26970000-0000-0000-0000-0000000000a1', '26970000-0000-0000-0000-00000000000a', 'PT Admin', 'pt-admin@example.com', 'Admin', 'active'),
  ('26970000-0000-0000-0000-0000000000a2', '26970000-0000-0000-0000-00000000000a', 'PT PM',    'pt-pm@example.com',    'Project Manager', 'active'),
  ('26970000-0000-0000-0000-0000000000b1', '26970000-0000-0000-0000-00000000000b', 'PT XAdmin','pt-xadmin@example.com','Admin', 'active');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
set local role authenticated;

-- default off: nothing exists for a fresh organisation
select pg_temp._as('26970000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from purchase_types), 0, 'default-off: a fresh organisation has no purchase types');
select is((select count(*)::int from org_purchase_type_settings), 0, 'default-off: and no settings row');

-- AC-PTR-003 a non-Admin cannot switch it on, add, or retire
select throws_ok($$ select public.set_purchase_types_enabled(true) $$, '42501',
  'PTYPE_ADMIN_ONLY: only an Admin can change purchase types', 'AC-PTR-003 a non-Admin cannot turn purchase types on');
select throws_ok($$ select public.upsert_purchase_type(null, 'X', null, false, 1) $$, '42501',
  'PTYPE_ADMIN_ONLY: only an Admin can change purchase types', 'AC-PTR-003 a non-Admin cannot add a type');

-- AC-PTR-002 the Admin turns it on: three starter rows, one flagged rental
select pg_temp._as('26970000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.set_purchase_types_enabled(true) $$, 'AC-PTR-002 an Admin turns purchase types on');
select is((select count(*)::int from purchase_types), 3, 'AC-PTR-002 three starter rows exist');
select is((select count(*)::int from purchase_types where is_rental), 1, 'AC-PTR-002 exactly one is flagged rental (by data)');
select public.set_purchase_types_enabled(false);
select public.set_purchase_types_enabled(true);
select is((select count(*)::int from purchase_types), 3, 'AC-PTR-002 turning off and on again adds no starter rows (idempotent)');

-- the Admin edits the list: it is data
select lives_ok($$ select public.upsert_purchase_type(null, 'Hire', 'Sewa alat', true, 4) $$, 'FR-PTR-001 the Admin adds a rental-flagged type with any name');
select throws_ok($$ select public.upsert_purchase_type(null, ' goods ', null, false, 5) $$, '23505', null,
  'FR-PTR-004 names are unique per organisation, ignoring case');
select throws_ok($$ select public.upsert_purchase_type(null, '', null, false, 5) $$, '22023',
  'PTYPE_INVALID: a type needs a name of 1 to 60 characters', 'FR-PTR-004 an empty name is refused');
select lives_ok($$ select public.set_purchase_type_active((select id from purchase_types where name = 'Hire'), false) $$, 'FR-PTR-004 a type is retired, not deleted');
select is((select active from purchase_types where name = 'Hire'), false, 'AC-PTR-007 the retired type stays as a row, inactive');

-- AC-PTR-012 another organisation sees and changes nothing
create temp table t_ids as select id from purchase_types where name = 'Hire';
grant all on t_ids to authenticated;
select pg_temp._as('26970000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from purchase_types), 0, 'AC-PTR-012 another organisation reads none of these types');
select throws_ok(format($$ select public.set_purchase_type_active(%L, true) $$, (select id from t_ids)), '23503',
  'PTYPE_UNAVAILABLE: type not available', 'AC-PTR-012 another organisation cannot change them');
select lives_ok($$ select public.set_purchase_types_enabled(true) $$, 'AC-PTR-012 its own Admin turns the feature on in its own organisation');
select is((select count(*)::int from purchase_types), 3, 'AC-PTR-012 and gets its own three rows');

-- no client write grant
select throws_ok($$ insert into purchase_types (name) values ('Direct') $$, '42501', null, 'NFR-PTR-002 no client role writes the table directly');
select * from finish();
rollback;
