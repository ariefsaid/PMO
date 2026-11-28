-- receipts_read_ordering_right.test.sql — a person who holds the ordering right reads the receipts of purchases others raised, in their
-- own organisation (migration 2665). A requester's read is unchanged; another organisation reads nothing.
-- MUTATION (2665): drop the mut:read_receipts branch -> 'a Buyer reads the receipt on a purchase someone else raised' goes red.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, built_in_roles_enabled) values
  ('26650000-0000-0000-0000-00000000000a', 'RCP Org', true),
  ('26650000-0000-0000-0000-00000000000b', 'RCP Other Org', true);
insert into auth.users (id, email) values
  ('26650000-0000-0000-0000-0000000000a1', 'rcp-admin@example.com'),
  ('26650000-0000-0000-0000-0000000000a2', 'rcp-buyer@example.com'),
  ('26650000-0000-0000-0000-0000000000a3', 'rcp-eng-own@example.com'),
  ('26650000-0000-0000-0000-0000000000a4', 'rcp-eng-other@example.com'),
  ('26650000-0000-0000-0000-0000000000b1', 'rcp-off-buyer@example.com'),
  ('26650000-0000-0000-0000-0000000000b2', 'rcp-off-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('26650000-0000-0000-0000-0000000000a1', '26650000-0000-0000-0000-00000000000a', 'RCP Admin', 'rcp-admin@example.com', 'Admin', 'active', null),
  ('26650000-0000-0000-0000-0000000000a2', '26650000-0000-0000-0000-00000000000a', 'RCP Buyer', 'rcp-buyer@example.com', 'Engineer', 'active', 'buyer'),
  ('26650000-0000-0000-0000-0000000000a3', '26650000-0000-0000-0000-00000000000a', 'RCP Own', 'rcp-eng-own@example.com', 'Engineer', 'active', null),
  ('26650000-0000-0000-0000-0000000000a4', '26650000-0000-0000-0000-00000000000a', 'RCP Other', 'rcp-eng-other@example.com', 'Engineer', 'active', null),
  ('26650000-0000-0000-0000-0000000000b1', '26650000-0000-0000-0000-00000000000b', 'RCP Off Buyer', 'rcp-off-buyer@example.com', 'Engineer', 'active', 'buyer'),
  ('26650000-0000-0000-0000-0000000000b2', '26650000-0000-0000-0000-00000000000b', 'RCP Off Admin', 'rcp-off-admin@example.com', 'Admin', 'active', null);
insert into procurements (id, org_id, title, status, currency, requested_by_id) values
  ('26650000-0000-0000-0000-0000000000c1', '26650000-0000-0000-0000-00000000000a', 'Raised by own engineer', 'Received', 'IDR', '26650000-0000-0000-0000-0000000000a3'),
  ('26650000-0000-0000-0000-0000000000c2', '26650000-0000-0000-0000-00000000000b', 'Other organisation purchase', 'Received', 'IDR', '26650000-0000-0000-0000-0000000000b2');
insert into procurement_receipts (id, org_id, procurement_id, gr_number, status) values
  ('26650000-0000-0000-0000-0000000000d1', '26650000-0000-0000-0000-00000000000a', '26650000-0000-0000-0000-0000000000c1', 'GR-RCP-1', 'Complete'),
  ('26650000-0000-0000-0000-0000000000d2', '26650000-0000-0000-0000-00000000000b', '26650000-0000-0000-0000-0000000000c2', 'GR-RCP-2', 'Complete');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
insert into purchase_order_settings (org_id, order_job_roles) values ('26650000-0000-0000-0000-00000000000a', array[]::text[])
  on conflict (org_id) do update set order_job_roles = excluded.order_job_roles;
set local role authenticated;

-- ordering right explicitly empty (an unset list now defaults to Buyer): the Buyer reads nothing
select pg_temp._as('26650000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from procurement_receipts), 0, 'with the ordering right not given a Buyer reads no receipt');

select pg_temp._as('26650000-0000-0000-0000-0000000000a1');
select po_set_order_job_roles(array['buyer']);
select pg_temp._as('26650000-0000-0000-0000-0000000000b2');
select po_set_order_job_roles(array['buyer']);

select pg_temp._as('26650000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from procurement_receipts where gr_number = 'GR-RCP-1'), 1, 'a Buyer reads the receipt on a purchase someone else raised');
select is((select count(*)::int from procurement_receipts where gr_number = 'GR-RCP-2'), 0, 'a Buyer cannot read another organisation receipt');
select pg_temp._as('26650000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from procurement_receipts where gr_number = 'GR-RCP-1'), 1, 'the requester still reads the receipt on their own purchase');
select pg_temp._as('26650000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from procurement_receipts), 0, 'an unrelated requester reads no receipt');
select pg_temp._as('26650000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from procurement_receipts where gr_number = 'GR-RCP-1'), 0, 'a Buyer of another organisation reads no receipt');
select is((select count(*)::int from procurement_receipts where gr_number = 'GR-RCP-2'), 1, 'the other organisation Buyer reads its own receipt');
select pg_temp._as('26650000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from procurement_receipts where gr_number = 'GR-RCP-1'), 0, 'an Admin of another organisation reads no receipt');
select pg_temp._as('26650000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from procurement_receipts where gr_number = 'GR-RCP-1'), 1, 'an Admin still reads the receipt');

select * from finish();
rollback;
