-- purchase_order_print_settings.test.sql — #2688 purchase order print settings & bounds check.
-- Spec docs/specs/purchase-order-print.spec.md. Migrations under test: 1444_purchase_order_print.sql.
-- AC-POP-009 Admin sets settings · AC-POP-010 non-Admin refused · AC-POP-011 bounds enforced ·
-- AC-POP-012 cross-org isolation.
begin;
create extension if not exists pgtap;
select plan(12);

-- Fixtures (written as table owner before switching to authenticated)
insert into organizations (id, name, default_currency, default_timezone) values
  ('26880000-0000-0000-0000-00000000000a', 'POP Org A', 'IDR', 'Asia/Jakarta'),
  ('26880000-0000-0000-0000-00000000000b', 'POP Org B', 'IDR', 'Asia/Jakarta');

insert into auth.users (id, email) values
  ('26880000-0000-0000-0000-0000000000a1', 'pop-admin-a@example.com'),
  ('26880000-0000-0000-0000-0000000000a2', 'pop-user-a@example.com'),
  ('26880000-0000-0000-0000-0000000000b1', 'pop-admin-b@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('26880000-0000-0000-0000-0000000000a1', '26880000-0000-0000-0000-00000000000a', 'POP Admin A', 'pop-admin-a@example.com', 'Admin', 'active'),
  ('26880000-0000-0000-0000-0000000000a2', '26880000-0000-0000-0000-00000000000a', 'POP User A',  'pop-user-a@example.com',  'Engineer', 'active'),
  ('26880000-0000-0000-0000-0000000000b1', '26880000-0000-0000-0000-00000000000b', 'POP Admin B', 'pop-admin-b@example.com', 'Admin', 'active');

insert into purchase_order_settings (org_id) values ('26880000-0000-0000-0000-00000000000a');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;

set local role authenticated;

-- 1. Default row values: print_enabled defaults to false, default signature blocks, empty collectors
select pg_temp._as('26880000-0000-0000-0000-0000000000a1');

select is(
  (select print_enabled from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  false,
  'FR-POP-009 print_enabled defaults to false'
);

select is(
  (select signature_blocks from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  array['Prepared by', 'Approved by', 'Vendor acceptance'],
  'FR-POP-009 signature_blocks has standard 3-box default'
);

select is(
  (select authorised_collectors from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  array[]::text[],
  'FR-POP-009 authorised_collectors defaults to empty array'
);

-- 2. AC-POP-010: Non-Admin calling po_set_print_settings is refused
select pg_temp._as('26880000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$ select public.po_set_print_settings(true, array['Prepared by'], array['Alice Collector']) $$,
  '42501',
  'PO_ADMIN_ONLY: only an Admin can change purchase order print settings',
  'AC-POP-010 a non-Admin cannot change purchase order print settings'
);

-- 3. AC-POP-009: Admin A sets purchase order print settings with collectors
select pg_temp._as('26880000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ select public.po_set_print_settings(true, array['Prepared by', 'Approved by', 'Collector'], array['Alice Collector', 'Bob Collector']) $$,
  'AC-POP-009 Admin A successfully saves purchase order print settings'
);

select is(
  (select print_enabled from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  true,
  'AC-POP-009 print_enabled updated to true'
);

select is(
  (select authorised_collectors from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  array['Alice Collector', 'Bob Collector'],
  'AC-POP-009 authorised collectors saved'
);

-- 4. AC-POP-011: Bounds enforcement on collectors and signature blocks
-- 4a. Collector name too long (>100 characters)
select throws_ok(
  $$ select public.po_set_print_settings(true, array['Prepared by'], array[repeat('A', 101)]) $$,
  '22023',
  'PO_INVALID_COLLECTORS: collector names must not exceed 50 entries and each between 1 and 100 characters',
  'AC-POP-011 collector name longer than 100 characters is refused'
);

-- 4b. Empty/whitespace collector name
select throws_ok(
  $$ select public.po_set_print_settings(true, array['Prepared by'], array['   ']) $$,
  '22023',
  'PO_INVALID_COLLECTORS: collector names must not exceed 50 entries and each between 1 and 100 characters',
  'AC-POP-011 empty collector name is refused'
);

-- 4c. Signature block too long (>80 characters)
select throws_ok(
  $$ select public.po_set_print_settings(true, array[repeat('S', 81)], array['Alice Collector']) $$,
  '22023',
  'PO_INVALID_SIGNATURE_BLOCKS: signature blocks must not exceed 10 entries and each between 1 and 80 characters',
  'AC-POP-011 signature block longer than 80 characters is refused'
);

-- 5. AC-POP-012: Org B isolation
select pg_temp._as('26880000-0000-0000-0000-0000000000b1');
select is(
  (select count(*)::int from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  0,
  'AC-POP-012 Admin B cannot see Org A purchase order settings'
);

select lives_ok(
  $$ select public.po_set_print_settings(true, array['Dibuat oleh', 'Diterima oleh'], array['Kurir Lapangan']) $$,
  'AC-POP-012 Admin B can save own org settings'
);

select * from finish();
rollback;
