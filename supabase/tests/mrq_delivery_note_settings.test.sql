-- mrq_delivery_note_settings.test.sql — #2687 delivery note print settings and terminology check.
-- Spec docs/specs/delivery-note-print.spec.md. Migrations under test: 1420_delivery_note_print.sql.
-- AC-DNP-004 terminology accepts deliveryNote · AC-DNP-006 Admin sets delivery note settings ·
-- AC-DNP-007 non-Admin refused · AC-DNP-010 cross-org isolation.
begin;
create extension if not exists pgtap;
select plan(10);

-- Fixtures
insert into organizations (id, name, default_currency, default_timezone) values
  ('26870000-0000-0000-0000-00000000000a', 'DNP Org A', 'IDR', 'Asia/Jakarta'),
  ('26870000-0000-0000-0000-00000000000b', 'DNP Org B', 'IDR', 'Asia/Jakarta');

insert into auth.users (id, email) values
  ('26870000-0000-0000-0000-0000000000a1', 'dnp-admin-a@example.com'),
  ('26870000-0000-0000-0000-0000000000a2', 'dnp-user-a@example.com'),
  ('26870000-0000-0000-0000-0000000000b1', 'dnp-admin-b@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('26870000-0000-0000-0000-0000000000a1', '26870000-0000-0000-0000-00000000000a', 'DNP Admin A', 'dnp-admin-a@example.com', 'Admin', 'active'),
  ('26870000-0000-0000-0000-0000000000a2', '26870000-0000-0000-0000-00000000000a', 'DNP User A',  'dnp-user-a@example.com',  'Engineer', 'active'),
  ('26870000-0000-0000-0000-0000000000b1', '26870000-0000-0000-0000-00000000000b', 'DNP Admin B', 'dnp-admin-b@example.com', 'Admin', 'active');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;

set local role authenticated;

-- 1. Default row or absence: when inserting default settings row, delivery_note_enabled defaults to false
select pg_temp._as('26870000-0000-0000-0000-0000000000a1');
insert into material_request_settings (org_id) values ('26870000-0000-0000-0000-00000000000a');

select is(
  (select delivery_note_enabled from material_request_settings where org_id = '26870000-0000-0000-0000-00000000000a'),
  false,
  'FR-DNP-009 delivery_note_enabled defaults to false'
);

select is(
  (select delivery_note_signature_blocks from material_request_settings where org_id = '26870000-0000-0000-0000-00000000000a'),
  array['Dispatched by', 'Delivered by', 'Received by'],
  'FR-DNP-009 delivery_note_signature_blocks has standard 3-box default'
);

-- 2. AC-DNP-007: Non-Admin calling mrq_set_delivery_note_settings is refused
select pg_temp._as('26870000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$ select public.mrq_set_delivery_note_settings(true, array['Dispatched by', 'Received by']) $$,
  '42501',
  'MRQ_ADMIN_ONLY: only an Admin can change delivery note settings',
  'AC-DNP-007 a non-Admin cannot change delivery note settings'
);

-- 3. AC-DNP-006: Admin A sets delivery note settings
select pg_temp._as('26870000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ select public.mrq_set_delivery_note_settings(true, array['Prepared by', 'Dispatched by', 'Received by']) $$,
  'AC-DNP-006 Admin A successfully saves delivery note settings'
);

select is(
  (select delivery_note_enabled from material_request_settings where org_id = '26870000-0000-0000-0000-00000000000a'),
  true,
  'AC-DNP-006 delivery_note_enabled updated to true'
);

select is(
  (select delivery_note_signature_blocks from material_request_settings where org_id = '26870000-0000-0000-0000-00000000000a'),
  array['Prepared by', 'Dispatched by', 'Received by'],
  'AC-DNP-006 custom signature blocks saved'
);

-- 4. AC-DNP-010: Org B isolation
select pg_temp._as('26870000-0000-0000-0000-0000000000b1');
select is(
  (select count(*)::int from material_request_settings where org_id = '26870000-0000-0000-0000-00000000000a'),
  0,
  'AC-DNP-010 Admin B cannot see Org A material request settings'
);

select lives_ok(
  $$ select public.mrq_set_delivery_note_settings(true, array['Pemberi', 'Penerima']) $$,
  'AC-DNP-010 Admin B can save own org settings'
);

-- 5. AC-DNP-004: org_terminology accepts 'deliveryNote'
select pg_temp._as('26870000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ insert into public.org_terminology (org_id, term_key, locale, singular, plural)
     values ('26870000-0000-0000-0000-00000000000a', 'deliveryNote', 'en', 'Goods Issue Note', 'Goods Issue Notes') $$,
  'AC-DNP-004 org_terminology accepts deliveryNote term key'
);

select throws_ok(
  $$ insert into public.org_terminology (org_id, term_key, locale, singular, plural)
     values ('26870000-0000-0000-0000-00000000000a', 'invalidTermKey', 'en', 'Invalid', 'Invalids') $$,
  '23514',
  null,
  'AC-DNP-004 org_terminology still enforces allowed term_keys check'
);

finish();
rollback;
