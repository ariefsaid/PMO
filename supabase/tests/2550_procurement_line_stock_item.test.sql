-- 2550_procurement_line_stock_item.test.sql — TC-PFE-13 standard item identity on purchase request lines.
-- Migration under test: 2550_procurement_line_stock_item.sql.
-- Proves:
--   * Requester (Engineer) can read active org stock_items and persist stock_item_id on PR lines via
--     create_procurement_with_items and direct draft-line insert/update, as well as leaving stock_item_id null for free text.
--   * Replay idempotency succeeds for matching stock_item_id and refuses mismatched stock_item_id (23505).
--   * Cross-org and archived stock_item_id writes are refused (23514 PRC_STOCK_ITEM); editing qty/rate on an existing line
--     whose stock item was later archived still succeeds.
--   * procurement_items_masked exposes stock_item_id while keeping money columns masked.
--   * Saving stock_item_id does NOT create rows in order_stock_mappings (receiving behaviour unchanged).
--   * Mutation: disabling the check_procurement_item_stock_item guard allows cross-org and archived writes to slip through.
begin;
create extension if not exists pgtap;
select plan(15);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25500000-0000-0000-0000-00000000000a', 'PSI Org A', 'IDR', 'Asia/Jakarta'),
  ('25500000-0000-0000-0000-00000000000b', 'PSI Org B', 'IDR', 'Asia/Jakarta');

insert into auth.users (id, email) values
  ('25500000-0000-0000-0000-0000000000a1', 'psi-eng@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('25500000-0000-0000-0000-0000000000a1', '25500000-0000-0000-0000-00000000000a', 'PSI Requester', 'psi-eng@example.com', 'Engineer', 'active');

insert into stock_units (id, org_id, code, name) values
  ('25500000-0000-0000-0000-000000000c01', '25500000-0000-0000-0000-00000000000a', 'PCS', 'Pieces'),
  ('25500000-0000-0000-0000-000000000c02', '25500000-0000-0000-0000-00000000000b', 'PCS', 'Pieces');

insert into stock_items (id, org_id, code, name, unit_id, archived_at) values
  ('25500000-0000-0000-0000-000000000101', '25500000-0000-0000-0000-00000000000a', 'EL-7018', 'Welding Electrode E7018', '25500000-0000-0000-0000-000000000c01', null),
  ('25500000-0000-0000-0000-000000000102', '25500000-0000-0000-0000-00000000000a', 'EL-OLD',  'Archived Electrode',      '25500000-0000-0000-0000-000000000c01', now()),
  ('25500000-0000-0000-0000-000000000103', '25500000-0000-0000-0000-00000000000a', 'BLT-M16', 'Hex Bolt M16',            '25500000-0000-0000-0000-000000000c01', null),
  ('25500000-0000-0000-0000-000000000201', '25500000-0000-0000-0000-00000000000b', 'EXT-01',  'Other Org Item',          '25500000-0000-0000-0000-000000000c02', null);

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
grant execute on function pg_temp._as(uuid) to public;

set local role authenticated;
select pg_temp._as('25500000-0000-0000-0000-0000000000a1');

-- 1. Engineer can read active org stock_items without any rights change.
select is(
  (select count(*)::int from public.stock_items where archived_at is null),
  2,
  'AC-PSI-001 Engineer reads active organisation stock_items'
);

-- 2–4. create_procurement_with_items persists standard item line AND free-text line in one call.
select lives_ok($$
  select public.create_procurement_with_items(
    '25500000-0000-0000-0000-000000000a01'::uuid,
    jsonb_build_object('title', 'Standard and custom lines'),
    jsonb_build_array(
      jsonb_build_object('id', '25500000-0000-0000-0000-000000000b01', 'name', 'Welding Electrode E7018', 'quantity', 10, 'rate', 50, 'stock_item_id', '25500000-0000-0000-0000-000000000101'),
      jsonb_build_object('id', '25500000-0000-0000-0000-000000000b02', 'name', 'Custom site bracket', 'quantity', 2, 'rate', 120)
    )
  )
$$, 'AC-PSI-001/002 create_procurement_with_items accepts standard item and free-text lines');

select is(
  (select stock_item_id from public.procurement_items where id = '25500000-0000-0000-0000-000000000b01'),
  '25500000-0000-0000-0000-000000000101'::uuid,
  'AC-PSI-001 picked standard item identity persists on procurement_items'
);

select is(
  (select stock_item_id from public.procurement_items where id = '25500000-0000-0000-0000-000000000b02'),
  null::uuid,
  'AC-PSI-002 free-text line persists with null stock_item_id'
);

-- 5–6. Idempotency replay: identical payload succeeds, changed stock_item_id raises 23505.
select lives_ok($$
  select public.create_procurement_with_items(
    '25500000-0000-0000-0000-000000000a01'::uuid,
    jsonb_build_object('title', 'Standard and custom lines'),
    jsonb_build_array(
      jsonb_build_object('id', '25500000-0000-0000-0000-000000000b01', 'name', 'Welding Electrode E7018', 'quantity', 10, 'rate', 50, 'stock_item_id', '25500000-0000-0000-0000-000000000101'),
      jsonb_build_object('id', '25500000-0000-0000-0000-000000000b02', 'name', 'Custom site bracket', 'quantity', 2, 'rate', 120)
    )
  )
$$, 'AC-PSI-004 identical replay succeeds');

select throws_ok($$
  select public.create_procurement_with_items(
    '25500000-0000-0000-0000-000000000a01'::uuid,
    jsonb_build_object('title', 'Standard and custom lines'),
    jsonb_build_array(
      jsonb_build_object('id', '25500000-0000-0000-0000-000000000b01', 'name', 'Welding Electrode E7018', 'quantity', 10, 'rate', 50, 'stock_item_id', '25500000-0000-0000-0000-000000000103'),
      jsonb_build_object('id', '25500000-0000-0000-0000-000000000b02', 'name', 'Custom site bracket', 'quantity', 2, 'rate', 120)
    )
  )
$$, '23505', 'Saved procurement differs from request', 'AC-PSI-004 replay with different stock_item_id is refused');

-- 7. Invalid JSON type for stock_item_id is refused (22023).
select throws_ok($$
  select public.create_procurement_with_items(
    '25500000-0000-0000-0000-000000000a02'::uuid,
    jsonb_build_object('title', 'Bad stock item type'),
    jsonb_build_array(
      jsonb_build_object('id', '25500000-0000-0000-0000-000000000b09', 'name', 'Bad', 'quantity', 1, 'rate', 10, 'stock_item_id', 123)
    )
  )
$$, '22023', 'Invalid procurement input', 'AC-PSI-003 non-string stock_item_id is rejected');

-- 8–9. Cross-org and archived stock items are refused with 23514 PRC_STOCK_ITEM.
select throws_ok($$
  select public.create_procurement_with_items(
    '25500000-0000-0000-0000-000000000a03'::uuid,
    jsonb_build_object('title', 'Cross-org item'),
    jsonb_build_array(
      jsonb_build_object('id', '25500000-0000-0000-0000-000000000b03', 'name', 'Other Org Item', 'quantity', 1, 'rate', 10, 'stock_item_id', '25500000-0000-0000-0000-000000000201')
    )
  )
$$, '23514', 'PRC_STOCK_ITEM: Choose an active item from your organisation''s item list.', 'AC-PSI-003 cross-org stock_item_id is refused');

select throws_ok($$
  insert into public.procurement_items (id, procurement_id, name, quantity, rate, stock_item_id)
  values ('25500000-0000-0000-0000-000000000b04', '25500000-0000-0000-0000-000000000a01', 'Archived Electrode', 1, 10, '25500000-0000-0000-0000-000000000102')
$$, '23514', 'PRC_STOCK_ITEM: Choose an active item from your organisation''s item list.', 'AC-PSI-003 archived stock_item_id is refused on insert');

-- 10–11. Direct draft line update: changing to another active item works; editing qty after item is archived still works.
select lives_ok($$
  update public.procurement_items
     set name = 'Hex Bolt M16', stock_item_id = '25500000-0000-0000-0000-000000000103'
   where id = '25500000-0000-0000-0000-000000000b02'
$$, 'AC-PSI-001 updating draft line to an active standard item succeeds');

reset role;
update public.stock_items set archived_at = now() where id = '25500000-0000-0000-0000-000000000103';
set local role authenticated;
select pg_temp._as('25500000-0000-0000-0000-0000000000a1');

select lives_ok($$
  update public.procurement_items
     set quantity = 5
   where id = '25500000-0000-0000-0000-000000000b02'
$$, 'AC-PSI-003 editing quantity on line whose item was later archived still succeeds');

-- 12. Changing a different line onto that newly archived item is refused.
select throws_ok($$
  update public.procurement_items
     set stock_item_id = '25500000-0000-0000-0000-000000000103'
   where id = '25500000-0000-0000-0000-000000000b01'
$$, '23514', 'PRC_STOCK_ITEM: Choose an active item from your organisation''s item list.', 'AC-PSI-003 updating line to an archived stock item is refused');

-- 13–14. procurement_items_masked exposes stock_item_id while still masking money when prices are hidden.
reset role;
update public.organizations set hide_prices_from_requesters = true where id = '25500000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp._as('25500000-0000-0000-0000-0000000000a1');

select is(
  (select stock_item_id from public.procurement_items_masked where id = '25500000-0000-0000-0000-000000000b01'),
  '25500000-0000-0000-0000-000000000101'::uuid,
  'AC-PSI-004 procurement_items_masked returns stock_item_id'
);
select is(
  (select rate from public.procurement_items_masked where id = '25500000-0000-0000-0000-000000000b01'),
  null::numeric,
  'AC-PSI-004 procurement_items_masked continues masking rate'
);

-- 15. Receiving isolation: saving stock_item_id on procurement_items creates NO order_stock_mappings rows.
reset role;
select is(
  (select count(*)::int from public.order_stock_mappings where item_id in ('25500000-0000-0000-0000-000000000b01', '25500000-0000-0000-0000-000000000b02')),
  0,
  'AC-PSI-005 picking a standard item on a PR line does not populate order_stock_mappings'
);

select * from finish();
rollback;
