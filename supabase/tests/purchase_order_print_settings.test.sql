-- purchase_order_print_settings.test.sql — #2688 purchase order print settings & client-entered list bounds.
-- Spec docs/specs/purchase-order-print.spec.md. Migration under test: 1444_purchase_order_print.sql.
-- AC-POP-009 Admin sets settings · AC-POP-010 non-Admin refused · AC-POP-011 list bounds enforced (RPC and table
-- constraint) · AC-POP-012 cross-org isolation for reads and writes.
begin;
create extension if not exists pgtap;
select plan(20);

-- ── Fixtures (table owner, bypassing RLS) ──────────────────────────────────────────────────────────
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

-- A pre-existing settings row for Org A, so the defaults are readable before any RPC call.
insert into purchase_order_settings (org_id) values ('26880000-0000-0000-0000-00000000000a');

-- ── Org A: default row values (FR-POP-009) ────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"26880000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is(
  (select print_enabled from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  false,
  'FR-POP-009 print_enabled defaults to false'
);

select is(
  (select signature_blocks from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  array['Prepared by', 'Approved by', 'Vendor acceptance'],
  'FR-POP-009 signature_blocks has the standard three-box default'
);

select is(
  (select authorised_collectors from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  array[]::text[],
  'FR-POP-009 authorised_collectors defaults to an empty list'
);

-- ── AC-POP-010: a non-Admin cannot change the settings ────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"26880000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select public.po_set_print_settings(true, array['Prepared by'], array['Alice Collector']) $$,
  '42501',
  'PO_ADMIN_ONLY: only an Admin can change purchase order print settings',
  'AC-POP-010 a non-Admin cannot change purchase order print settings'
);

-- ── AC-POP-009: an Admin saves the settings, and the audit trail records it ──────────────────────
set local request.jwt.claims = '{"sub":"26880000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select public.po_set_print_settings(true, array['Prepared by', 'Approved by', 'Collector'], array['Alice Collector', 'Bob Collector']) $$,
  'AC-POP-009 Admin A saves purchase order print settings'
);

select is(
  (select print_enabled from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  true,
  'AC-POP-009 print_enabled is updated'
);

select is(
  (select authorised_collectors from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  array['Alice Collector', 'Bob Collector'],
  'AC-POP-009 authorised collectors are saved'
);

select is(
  (select count(*)::int from audit_events
    where org_id = '26880000-0000-0000-0000-00000000000a'
      and action = 'purchase_order.print_settings_set'),
  1,
  'FR-POP-012 a settings change writes one audit entry'
);

-- ── AC-POP-011: the RPC refuses out-of-bounds lists ───────────────────────────────────────────────
select throws_ok(
  $$ select public.po_set_print_settings(true, array['Prepared by'], array[repeat('A', 101)]) $$,
  '22023',
  'PO_INVALID_COLLECTORS: collector names must not exceed 50 entries and each between 1 and 100 characters',
  'AC-POP-011 a collector name longer than 100 characters is refused'
);

select throws_ok(
  $$ select public.po_set_print_settings(true, array['Prepared by'], array['   ']) $$,
  '22023',
  'PO_INVALID_COLLECTORS: collector names must not exceed 50 entries and each between 1 and 100 characters',
  'AC-POP-011 a blank collector name is refused'
);

select throws_ok(
  $$ select public.po_set_print_settings(true, array['Prepared by'], array_fill('Collector'::text, array[51])) $$,
  '22023',
  'PO_INVALID_COLLECTORS: collector names must not exceed 50 entries and each between 1 and 100 characters',
  'AC-POP-011 more than 50 collectors is refused'
);

select throws_ok(
  $$ select public.po_set_print_settings(true, array['Prepared by'], array['Alice Collector', null]::text[]) $$,
  '22023',
  'PO_INVALID_COLLECTORS: collector names must not exceed 50 entries and each between 1 and 100 characters',
  'AC-POP-011 a null collector entry is refused'
);

select throws_ok(
  $$ select public.po_set_print_settings(true, array[repeat('S', 81)], array['Alice Collector']) $$,
  '22023',
  'PO_INVALID_SIGNATURE_BLOCKS: signature blocks must not exceed 10 entries and each between 1 and 80 characters',
  'AC-POP-011 a signature block longer than 80 characters is refused'
);

select throws_ok(
  $$ select public.po_set_print_settings(true, array_fill('Sign'::text, array[11]), array['Alice Collector']) $$,
  '22023',
  'PO_INVALID_SIGNATURE_BLOCKS: signature blocks must not exceed 10 entries and each between 1 and 80 characters',
  'AC-POP-011 more than 10 signature blocks is refused'
);

-- ── AC-POP-011: the TABLE constraint is the enforcement, independent of the RPC ──────────────────
select throws_ok(
  $$ update public.purchase_order_settings
        set authorised_collectors = array_fill('Collector'::text, array[51])
      where org_id = '26880000-0000-0000-0000-00000000000a' $$,
  '23514', null,
  'AC-POP-011 the table constraint refuses more than 50 collectors on a direct write'
);

select throws_ok(
  $$ update public.purchase_order_settings
        set authorised_collectors = array[repeat('A', 101)]
      where org_id = '26880000-0000-0000-0000-00000000000a' $$,
  '23514', null,
  'AC-POP-011 the table constraint refuses a 101-character collector on a direct write'
);

-- ── AC-POP-012: another organisation's Admin sees and touches nothing of Org A ───────────────────
set local request.jwt.claims = '{"sub":"26880000-0000-0000-0000-0000000000b1","role":"authenticated"}';

select is(
  (select count(*)::int from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  0,
  'AC-POP-012 Admin B cannot read Org A purchase order settings'
);

with touched as (
  update public.purchase_order_settings
     set print_enabled = false
   where org_id = '26880000-0000-0000-0000-00000000000a'
   returning 1
)
select is(
  (select count(*)::int from touched),
  0,
  'AC-POP-012 a cross-org update touches no rows'
);

select lives_ok(
  $$ select public.po_set_print_settings(true, array['Dibuat oleh', 'Diterima oleh'], array['Kurir Lapangan']) $$,
  'AC-POP-012 Admin B can save their own organisation settings'
);

reset role;
select is(
  (select print_enabled from purchase_order_settings where org_id = '26880000-0000-0000-0000-00000000000a'),
  true,
  'AC-POP-012 Org A settings are unchanged by Org B'
);

select * from finish();
rollback;
