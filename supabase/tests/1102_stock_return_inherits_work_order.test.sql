-- 1102_stock_return_inherits_work_order.test.sql — #2612 a return carries the work order of the issue it cites.
begin;
create extension if not exists pgtap;
select plan(5);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25400000-0000-0000-0000-00000000010a', 'MRQ UAT Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('25400000-0000-0000-0000-0000000001a1', 'mrqu-admin@example.com'),
  ('25400000-0000-0000-0000-0000000001a2', 'mrqu-req@example.com'),
  ('25400000-0000-0000-0000-0000000001a5', 'mrqu-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25400000-0000-0000-0000-0000000001a1', '25400000-0000-0000-0000-00000000010a', 'MRQU Admin', 'mrqu-admin@example.com', 'Admin', 'active'),
  ('25400000-0000-0000-0000-0000000001a2', '25400000-0000-0000-0000-00000000010a', 'MRQU Req',   'mrqu-req@example.com',   'Engineer', 'active'),
  ('25400000-0000-0000-0000-0000000001a5', '25400000-0000-0000-0000-00000000010a', 'MRQU Fin',   'mrqu-fin@example.com',   'Finance', 'active');
-- P1: one site (+ BoQ for issues). P2: a yard only. P3: a site and a staging area. P4: no location at all.
insert into projects (id, org_id, name, status) values
  ('25400000-0000-0000-0000-0000000001d1', '25400000-0000-0000-0000-00000000010a', 'MRQU P1', 'Ongoing Project'),
  ('25400000-0000-0000-0000-0000000001d2', '25400000-0000-0000-0000-00000000010a', 'MRQU P2', 'Ongoing Project'),
  ('25400000-0000-0000-0000-0000000001d3', '25400000-0000-0000-0000-00000000010a', 'MRQU P3', 'Ongoing Project'),
  ('25400000-0000-0000-0000-0000000001d4', '25400000-0000-0000-0000-00000000010a', 'MRQU P4', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount)
select ('25400000-0000-0000-0000-00000000140' || n)::uuid, '25400000-0000-0000-0000-00000000010a', ('25400000-0000-0000-0000-0000000001d' || n)::uuid,
       'MRQU WO ' || n, 'Issued', 10000, 'exclusive', 0
  from generate_series(1, 4) n;
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25400000-0000-0000-0000-000000001201', '25400000-0000-0000-0000-00000000010a', '25400000-0000-0000-0000-0000000001d1', 'B1', 'Slab', 'm3', 10, 1000);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('25400000-0000-0000-0000-000000001301', '25400000-0000-0000-0000-00000000010a', 'BAG', 'Bag', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('25400000-0000-0000-0000-000000001311', '25400000-0000-0000-0000-00000000010a', 'CEM', 'Cement', '25400000-0000-0000-0000-000000001301');
insert into stock_warehouses (id, org_id, code, name, kind, project_id) values
  ('25400000-0000-0000-0000-000000001801', '25400000-0000-0000-0000-00000000010a', 'U-C',  'Central',  'central', null),
  ('25400000-0000-0000-0000-000000001811', '25400000-0000-0000-0000-00000000010a', 'U-S1', 'Site one', 'site',    '25400000-0000-0000-0000-0000000001d1'),
  ('25400000-0000-0000-0000-000000001812', '25400000-0000-0000-0000-00000000010a', 'U-Y2', 'Yard two', 'yard',    '25400000-0000-0000-0000-0000000001d2'),
  ('25400000-0000-0000-0000-000000001813', '25400000-0000-0000-0000-00000000010a', 'U-S3', 'Site three', 'site',  '25400000-0000-0000-0000-0000000001d3'),
  ('25400000-0000-0000-0000-000000001814', '25400000-0000-0000-0000-00000000010a', 'U-G3', 'Staging three', 'staging', '25400000-0000-0000-0000-0000000001d3');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- A draft for work order n (and an optional destination) with a reason, so plan 0 never blocks it.
create or replace function pg_temp._draft(p_n int, p_qty numeric, p_to uuid default null) returns uuid language sql as $$
  select public.mrq_save_draft(null,
    jsonb_build_object('work_order_id', ('25400000-0000-0000-0000-00000000140' || p_n)::uuid, 'needed_by', current_date + 5, 'to_warehouse_id', p_to),
    jsonb_build_array(jsonb_build_object('item_id', '25400000-0000-0000-0000-000000001311', 'quantity', p_qty, 'over_plan_reason', 'uat')),
    gen_random_uuid()) $$;
grant execute on function pg_temp._draft(int, numeric, uuid) to authenticated;
create or replace function pg_temp._prior(p_n int) returns text language sql as $$
  select prior_qty::text from public.mrq_plan_for(('25400000-0000-0000-0000-00000000140' || p_n)::uuid, array['25400000-0000-0000-0000-000000001311']::uuid[]) $$;
grant execute on function pg_temp._prior(int) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

set local role authenticated;
select pg_temp._as('25400000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Finance","label":"Stock"}]'::jsonb) $$, 'a one-step chain');
select lives_ok($$ select public.create_stock_document('{"kind":"receive","warehouse_id":"25400000-0000-0000-0000-000000001801"}'::jsonb,
  '[{"item_id":"25400000-0000-0000-0000-000000001311","quantity":500,"unit_cost":10}]'::jsonb, true) $$, 'stock is received centrally');

select lives_ok($$ select public.create_stock_document('{"kind":"transfer","warehouse_id":"25400000-0000-0000-0000-000000001801","to_warehouse_id":"25400000-0000-0000-0000-000000001811"}'::jsonb,
  '[{"item_id":"25400000-0000-0000-0000-000000001311","quantity":60}]'::jsonb, true) $$, 'the site holds 60 bags');
-- ── #2612 a return carries the work order of the issue it cites ───────────────────────────────────────────────────────
select pg_temp._as('25400000-0000-0000-0000-0000000001a1');
select set_config('mrqu.iss', public.create_stock_document(
  '{"kind":"issue","warehouse_id":"25400000-0000-0000-0000-000000001811","project_id":"25400000-0000-0000-0000-0000000001d1"}'::jsonb,
  '[{"item_id":"25400000-0000-0000-0000-000000001311","quantity":5,"boq_item_id":"25400000-0000-0000-0000-000000001201"}]'::jsonb, true)::text, true);
select public.set_cost_attribution('stock_document', array[current_setting('mrqu.iss')::uuid], '25400000-0000-0000-0000-000000001401', null);
select set_config('mrqu.ret', public.create_stock_document(
  '{"kind":"return","warehouse_id":"25400000-0000-0000-0000-000000001811","project_id":"25400000-0000-0000-0000-0000000001d1"}'::jsonb,
  jsonb_build_array(jsonb_build_object('item_id', '25400000-0000-0000-0000-000000001311', 'quantity', 2,
    'source_line_id', (select id from stock_document_lines where document_id = current_setting('mrqu.iss')::uuid))), true)::text, true);
select is((select work_order_id::text from stock_documents where id = current_setting('mrqu.ret')::uuid), '25400000-0000-0000-0000-000000001401',
  '#2612 the return took the work order of the issue it cites');
select is((select sum((r->>'issued_qty')::numeric) from jsonb_array_elements(public.get_work_order_stock_balance('25400000-0000-0000-0000-000000001401', null)) r
            where r->>'item_id' = '25400000-0000-0000-0000-000000001311'), 3::numeric,
  '#2612 the work order''s issued quantity nets down by the return (5 - 2)');

select * from finish();
rollback;
