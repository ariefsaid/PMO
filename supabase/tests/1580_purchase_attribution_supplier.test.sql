-- 1580_purchase_attribution_supplier.test.sql — walk-purchasing items 2 and 3. Migration under test: 1580.
-- A purchase says where its cost goes when it is raised, and its request and order records carry that value; an order is
-- never recorded without a supplier. Every denial asserts errcode AND message. Mutation: the supplier rule is removed
-- in-transaction and an order without a supplier goes through.
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name, default_currency, default_timezone) values
  ('15800000-0000-0000-0000-00000000000a', 'PWA Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('15800000-0000-0000-0000-0000000000a1', 'pwa-pm@example.com'),
  ('15800000-0000-0000-0000-0000000000a2', 'pwa-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15800000-0000-0000-0000-0000000000a1', '15800000-0000-0000-0000-00000000000a', 'PWA PM',      'pwa-pm@example.com',  'Project Manager', 'active'),
  ('15800000-0000-0000-0000-0000000000a2', '15800000-0000-0000-0000-00000000000a', 'PWA Finance', 'pwa-fin@example.com', 'Finance',         'active');
insert into projects (id, org_id, name, status) values
  ('15800000-0000-0000-0000-0000000000c1', '15800000-0000-0000-0000-00000000000a', 'PWA Site',  'Ongoing Project'),
  ('15800000-0000-0000-0000-0000000000c2', '15800000-0000-0000-0000-00000000000a', 'PWA Other', 'Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('15800000-0000-0000-0000-0000000000e1', '15800000-0000-0000-0000-00000000000a', 'PWA Supplier', 'Vendor');
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('15800000-0000-0000-0000-0000000000d1', '15800000-0000-0000-0000-00000000000a', '15800000-0000-0000-0000-0000000000c1', 'PWA WO on site',  10, 'exclusive', 0),
  ('15800000-0000-0000-0000-0000000000d2', '15800000-0000-0000-0000-00000000000a', '15800000-0000-0000-0000-0000000000c2', 'PWA WO elsewhere', 10, 'exclusive', 0);
insert into cost_disciplines (id, org_id, code, name) values
  ('15800000-0000-0000-0000-0000000000f1', '15800000-0000-0000-0000-00000000000a', 'CIV', 'Civil');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
grant execute on function pg_temp._as(uuid) to public;

set local role authenticated;
select pg_temp._as('15800000-0000-0000-0000-0000000000a1');

-- AC-PWA-001 the header carries the work order and discipline named at creation.
select lives_ok($$ select public.create_procurement_with_items('15800000-0000-0000-0000-000000000a01'::uuid,
  jsonb_build_object('title', 'Pipe purchase', 'project_id', '15800000-0000-0000-0000-0000000000c1'::uuid,
    'work_order_id', '15800000-0000-0000-0000-0000000000d1'::uuid, 'discipline_id', '15800000-0000-0000-0000-0000000000f1'::uuid),
  jsonb_build_array(jsonb_build_object('id', md5('pwa-pipe')::uuid::text, 'name', 'Pipe', 'quantity', 3, 'rate', 100))) $$,
  'AC-PWA-001 a purchase is raised naming its work order and discipline');
select is((select work_order_id from procurements where id = '15800000-0000-0000-0000-000000000a01'),
  '15800000-0000-0000-0000-0000000000d1'::uuid, 'AC-PWA-001 the work order is on the purchase');
select is((select discipline_id from procurements where id = '15800000-0000-0000-0000-000000000a01'),
  '15800000-0000-0000-0000-0000000000f1'::uuid, 'AC-PWA-001 the discipline is on the purchase');

-- AC-PWA-002 a work order on another project is refused, by the same rule every cost record uses.
select throws_ok($$ select public.create_procurement_with_items('15800000-0000-0000-0000-000000000a02'::uuid,
  jsonb_build_object('title', 'Wrong WO', 'project_id', '15800000-0000-0000-0000-0000000000c1'::uuid,
    'work_order_id', '15800000-0000-0000-0000-0000000000d2'::uuid),
  jsonb_build_array(jsonb_build_object('id', md5('pwa-wrong')::uuid::text, 'name', 'X', 'quantity', 1, 'rate', 1))) $$,
  '23514', 'COST_WO_PROJECT: the work order belongs to another project', 'AC-PWA-002 a work order of another project is refused');

-- AC-PWA-003 the request record carries the attribution when the purchase is submitted.
select lives_ok($$ select public.transition_procurement('15800000-0000-0000-0000-000000000a01'::uuid, 'Requested') $$, 'the purchase is submitted');
select is((select work_order_id from purchase_requests where procurement_id = '15800000-0000-0000-0000-000000000a01'),
  '15800000-0000-0000-0000-0000000000d1'::uuid, 'AC-PWA-003 the request record carries the work order');

select pg_temp._as('15800000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.transition_procurement('15800000-0000-0000-0000-000000000a01'::uuid, 'Approved') $$, 'Finance approves');

-- AC-PWA-004 an order is not recorded without a supplier.
select pg_temp._as('15800000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.transition_procurement('15800000-0000-0000-0000-000000000a01'::uuid, 'Ordered') $$,
  '23514', 'ORDER_NEEDS_SUPPLIER: choose the supplier before the order is recorded', 'AC-PWA-004 no supplier, no order');
select is((select status::text from procurements where id = '15800000-0000-0000-0000-000000000a01'), 'Approved', 'AC-PWA-004 the purchase is still Approved');

-- AC-PWA-005 with a supplier the order is recorded and carries the attribution.
reset role;
update procurements set vendor_id = '15800000-0000-0000-0000-0000000000e1' where id = '15800000-0000-0000-0000-000000000a01';
set local role authenticated;
select pg_temp._as('15800000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.transition_procurement('15800000-0000-0000-0000-000000000a01'::uuid, 'Ordered') $$, 'AC-PWA-005 with a supplier the order is recorded');
select is((select discipline_id from purchase_orders where procurement_id = '15800000-0000-0000-0000-000000000a01'),
  '15800000-0000-0000-0000-0000000000f1'::uuid, 'AC-PWA-005 the order record carries the discipline');

-- Mutation: remove the supplier rule; an order with no supplier then goes through (the test above must go red without it).
reset role;
do $$ begin
  execute replace(pg_get_functiondef('public.transition_procurement(uuid,procurement_status,text)'::regprocedure),
    'if p_to = ''Ordered'' and v_vendor is null', 'if false and v_vendor is null');
end $$;
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status, project_id) values
  ('15800000-0000-0000-0000-000000000a03', '15800000-0000-0000-0000-00000000000a', 'No supplier', '15800000-0000-0000-0000-0000000000a1', 'IDR', 100, 'Approved', '15800000-0000-0000-0000-0000000000c1');
set local role authenticated;
select pg_temp._as('15800000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.transition_procurement('15800000-0000-0000-0000-000000000a03'::uuid, 'Ordered') $$,
  'mutation: with the supplier rule removed an order with no supplier is recorded');
select is((select status::text from procurements where id = '15800000-0000-0000-0000-000000000a03'), 'Ordered', 'mutation: and the purchase is Ordered, so the rule is what held it');

select * from finish();
rollback;
