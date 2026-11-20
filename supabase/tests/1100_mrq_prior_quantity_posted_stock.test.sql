-- 1100_mrq_prior_quantity_posted_stock.test.sql — #2611 prior quantity = posted movements on the work order + pending/approved requests not yet fulfilled.
begin;
create extension if not exists pgtap;
select plan(10);

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
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('25400000-0000-0000-0000-00000000010a', '25400000-0000-0000-0000-000000001801', '25400000-0000-0000-0000-0000000001a5');

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
create or replace function pg_temp._prior(p_n int) returns numeric language sql as $$
  select prior_qty from public.mrq_plan_for(('25400000-0000-0000-0000-00000000140' || p_n)::uuid, array['25400000-0000-0000-0000-000000001311']::uuid[]) $$;
grant execute on function pg_temp._prior(int) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

set local role authenticated;
select pg_temp._as('25400000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Finance","label":"Stock"}]'::jsonb) $$, 'a one-step chain');
select lives_ok($$ select public.create_stock_document('{"kind":"receive","warehouse_id":"25400000-0000-0000-0000-000000001801"}'::jsonb,
  '[{"item_id":"25400000-0000-0000-0000-000000001311","quantity":500,"unit_cost":10}]'::jsonb, true) $$, 'stock is received centrally');

-- ── #2611 prior quantity = posted movements on the work order + pending/approved requests not yet fulfilled ─────────
select is(pg_temp._prior(1), 0::numeric, '#2611 nothing moved and nothing requested: prior is 0');
select lives_ok($$ select public.set_cost_attribution('stock_document', array[
  public.create_stock_document('{"kind":"transfer","warehouse_id":"25400000-0000-0000-0000-000000001801","to_warehouse_id":"25400000-0000-0000-0000-000000001811"}'::jsonb,
    '[{"item_id":"25400000-0000-0000-0000-000000001311","quantity":60}]'::jsonb, true)],
  '25400000-0000-0000-0000-000000001401', null) $$, 'the keeper posts 60 bags straight to the work order');
select is(pg_temp._prior(1), 60::numeric, '#2611 the 60 posted bags count as already on the work order');
select pg_temp._as('25400000-0000-0000-0000-0000000001a2');
insert into t_ids values ('r1', pg_temp._draft(1, 10));
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'r1')) $$, 'a request for 10 more is sent');
select is(pg_temp._prior(1), 70::numeric, '#2611 the pending request adds to the posted movement');
select pg_temp._as('25400000-0000-0000-0000-0000000001a5');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 1, 'approve', null, '25400000-0000-0000-0000-000000001801') $$,
  'Finance approves; the transfer draft is made');
select pg_temp._as('25400000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.post_stock_document((select transfer_document_id from material_requests where id = (select v from t_ids where k = 'r1'))) $$,
  'the keeper posts the request''s transfer');
select is(pg_temp._prior(1), 70::numeric, '#2611 a fulfilled request is counted through its movement once, not twice');

select * from finish();
rollback;
