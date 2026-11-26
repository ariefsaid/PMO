-- 2702_hide_prices_rewrite_paths.test.sql — #2788: a person who may not see prices re-saves, extends and retries without changing or
-- probing a stored price. Migration under test: 2702.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   mut:plan_keep_rate      store (v_line->>'rate')::numeric unconditionally ......... AC-HPR-003
--   mut:plan_keep_scope     drop "v_shown or" from the missing-key check ............... AC-HPR-007
--   mut:ext_fill_rate       fill the rate with 0 ......................................... AC-HPR-009
--   mut:item_add_retry_rate compare the rate for every caller .......................... AC-HPR-011
begin;
create extension if not exists pgtap;
select plan(16);

insert into organizations (id, name, default_currency, default_timezone, hide_prices_from_requesters) values
  ('27020000-0000-0000-0000-00000000000a', 'HPR Org', 'IDR', 'Asia/Jakarta', true);
insert into org_plans (org_id, plan_id) values ('27020000-0000-0000-0000-00000000000a', 'enterprise');
insert into org_features (org_id, feature_key, enabled) values ('27020000-0000-0000-0000-00000000000a', 'procurement', true)
  on conflict do nothing;
insert into auth.users (id, email) values
  ('27020000-0000-0000-0000-0000000000a1', 'hpr-admin@example.com'),
  ('27020000-0000-0000-0000-0000000000a3', 'hpr-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27020000-0000-0000-0000-0000000000a1', '27020000-0000-0000-0000-00000000000a', 'HPR Admin',    'hpr-admin@example.com', 'Admin',    'active'),
  ('27020000-0000-0000-0000-0000000000a3', '27020000-0000-0000-0000-00000000000a', 'HPR Engineer', 'hpr-eng@example.com',   'Engineer', 'active');
insert into projects (id, org_id, name, status) values
  ('27020000-0000-0000-0000-0000000000c1', '27020000-0000-0000-0000-00000000000a', 'HPR Project', 'Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('27020000-0000-0000-0000-0000000000e1', '27020000-0000-0000-0000-00000000000a', 'HPR Vendor', 'Vendor'),
  ('27020000-0000-0000-0000-0000000000e2', '27020000-0000-0000-0000-00000000000a', 'HPR Vendor Two', 'Vendor');
insert into org_purchase_type_settings (org_id, enabled) values ('27020000-0000-0000-0000-00000000000a', true) on conflict (org_id) do update set enabled = true;
delete from purchase_types where org_id = '27020000-0000-0000-0000-00000000000a';
insert into purchase_types (id, org_id, name, is_rental, position) values
  ('27020000-0000-0000-0000-0000000000f2', '27020000-0000-0000-0000-00000000000a', 'Hire', true, 1);
insert into org_equipment_plan_settings (org_id, enabled) values ('27020000-0000-0000-0000-00000000000a', true);
-- the Engineer is on the project (a purchase there); R is their live rental with one line at 75; D their Draft with one line at 12.50
insert into procurements (id, org_id, title, status, project_id, vendor_id, purchase_type_id, rental_from, rental_to, requested_by_id) values
  ('27020000-0000-0000-0000-000000000a01', '27020000-0000-0000-0000-00000000000a', 'HPR crane hire', 'Draft', '27020000-0000-0000-0000-0000000000c1',
   '27020000-0000-0000-0000-0000000000e1', '27020000-0000-0000-0000-0000000000f2', '2026-01-01', '2026-01-31', '27020000-0000-0000-0000-0000000000a3'),
  ('27020000-0000-0000-0000-000000000a02', '27020000-0000-0000-0000-00000000000a', 'HPR draft', 'Draft', '27020000-0000-0000-0000-0000000000c1',
   null, null, null, null, '27020000-0000-0000-0000-0000000000a3');
insert into procurement_items (id, org_id, procurement_id, name, quantity, rate) values
  ('27020000-0000-0000-0000-000000000b01', '27020000-0000-0000-0000-00000000000a', '27020000-0000-0000-0000-000000000a01', 'Crane', 1, 75),
  ('27020000-0000-0000-0000-000000000b02', '27020000-0000-0000-0000-00000000000a', '27020000-0000-0000-0000-000000000a02', 'Bolts', 2, 12.50);

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create or replace function pg_temp._line(p_id uuid, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'description', 'Excavator', 'quantity', 2, 'rate', 1000,
    'vendor_id', '27020000-0000-0000-0000-0000000000e1', 'date_from', '2026-03-05', 'date_to', '2026-03-20') || p_extra
$$;
grant execute on function pg_temp._line(uuid, jsonb) to authenticated;
create temp table t_ret (k text, v text);
grant all on t_ret to authenticated;
set local role authenticated;

-- A. the equipment plan
select pg_temp._as('27020000-0000-0000-0000-0000000000a3');
select is(public.actor_shown_prices(), false, 'AC-HPR-001 fixture: prices are hidden from the Engineer');
select lives_ok($$ select public.save_equipment_plan('27020000-0000-0000-0000-000000000901', '27020000-0000-0000-0000-0000000000c1', '2026-03-01',
  jsonb_build_array(pg_temp._line('27020000-0000-0000-0000-000000000d01'))) $$, 'AC-HPR-002 the Engineer saves a plan line with its rate and vendor');
select lives_ok($$ select public.save_equipment_plan('27020000-0000-0000-0000-000000000901', '27020000-0000-0000-0000-0000000000c1', '2026-03-01',
  jsonb_build_array(pg_temp._line('27020000-0000-0000-0000-000000000d01', '{"date_to":"2026-03-25"}') - 'rate' - 'vendor_id')) $$,
  'AC-HPR-002 re-saving the same line with a new date and without the hidden rate and vendor is accepted');
reset role;
select is((select rate = 1000 and vendor_id = '27020000-0000-0000-0000-0000000000e1' and date_to = '2026-03-25'
             from equipment_plan_lines where id = '27020000-0000-0000-0000-000000000d01'), true,
  'AC-HPR-003 the date changed; the stored rate and vendor did not');
set local role authenticated;
select pg_temp._as('27020000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.save_equipment_plan('27020000-0000-0000-0000-000000000901', '27020000-0000-0000-0000-0000000000c1', '2026-03-01',
  jsonb_build_array(pg_temp._line('27020000-0000-0000-0000-000000000d01'), pg_temp._line('27020000-0000-0000-0000-000000000d02') - 'rate')) $$,
  '22023', 'EQP_INVALID: check the plan lines', 'AC-HPR-004 a new line still needs its rate');
-- approval copies the real rate: the plan is submitted (as the owner), then an Admin approves it
reset role;
update equipment_plans set status = 'Submitted', submitted_at = now() where id = '27020000-0000-0000-0000-000000000901';
set local role authenticated;
select pg_temp._as('27020000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.approve_equipment_plan('27020000-0000-0000-0000-000000000901') $$, 'AC-HPR-005 an Admin approves the plan');
reset role;
select is((select i.rate = 1000 and p.vendor_id = '27020000-0000-0000-0000-0000000000e1'
             from equipment_plan_lines l join procurements p on p.id = l.procurement_id join procurement_items i on i.procurement_id = p.id
            where l.id = '27020000-0000-0000-0000-000000000d01'), true, 'AC-HPR-005 the rental purchase carries the stored rate and vendor');
-- a person who sees prices (the Admin, on their own plan) still changes the rate, and must send it
set local role authenticated;
select pg_temp._as('27020000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.save_equipment_plan('27020000-0000-0000-0000-000000000902', '27020000-0000-0000-0000-0000000000c1', '2026-04-01',
  jsonb_build_array(pg_temp._line('27020000-0000-0000-0000-000000000d03', '{"date_from":"2026-04-05","date_to":"2026-04-20"}'))) $$, 'AC-HPR-006 the Admin saves a plan');
select lives_ok($$ select public.save_equipment_plan('27020000-0000-0000-0000-000000000902', '27020000-0000-0000-0000-0000000000c1', '2026-04-01',
  jsonb_build_array(pg_temp._line('27020000-0000-0000-0000-000000000d03', '{"date_from":"2026-04-05","date_to":"2026-04-20","rate":1200,"vendor_id":"27020000-0000-0000-0000-0000000000e2"}'))) $$,
  'AC-HPR-006 and changes its rate and vendor');
select throws_ok($$ select public.save_equipment_plan('27020000-0000-0000-0000-000000000902', '27020000-0000-0000-0000-0000000000c1', '2026-04-01',
  jsonb_build_array(pg_temp._line('27020000-0000-0000-0000-000000000d03', '{"date_from":"2026-04-05","date_to":"2026-04-20"}') - 'rate')) $$,
  '22023', 'EQP_INVALID: check the plan lines', 'AC-HPR-007 a person who sees prices cannot leave the rate out');
reset role;
select is((select rate = 1200 and vendor_id = '27020000-0000-0000-0000-0000000000e2' from equipment_plan_lines where id = '27020000-0000-0000-0000-000000000d03'), true,
  'AC-HPR-006 the new rate and vendor are stored');

-- B. a rental extension by the Engineer names the line it continues instead of a rate
set local role authenticated;
select pg_temp._as('27020000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.extend_rental_procurement('27020000-0000-0000-0000-000000000e01', '27020000-0000-0000-0000-000000000a01', '2026-02-01', '2026-02-28',
  jsonb_build_array(jsonb_build_object('id', '27020000-0000-0000-0000-000000000e11', 'name', 'Crane', 'quantity', 1, 'original_line_id', '27020000-0000-0000-0000-000000000b01'))) $$,
  'AC-HPR-008 the Engineer extends their rental without sending a rate');
reset role;
select is((select rate from procurement_items where id = '27020000-0000-0000-0000-000000000e11'), 75.00::numeric, 'AC-HPR-009 the new line carries the original line''s rate');
set local role authenticated;
select pg_temp._as('27020000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.extend_rental_procurement('27020000-0000-0000-0000-000000000e02', '27020000-0000-0000-0000-000000000a01', '2026-03-01', '2026-03-31',
  jsonb_build_array(jsonb_build_object('id', '27020000-0000-0000-0000-000000000e12', 'name', 'Bolts', 'quantity', 1, 'original_line_id', '27020000-0000-0000-0000-000000000b02'))) $$,
  '22023', 'PTYPE_INVALID: each carried-over line needs a rate or the line it continues', 'AC-HPR-010 a line of another purchase is not a source');

-- C. a retry of an existing line answers the same whatever rate the Engineer guesses
insert into t_ret select 'wrong', (public.procurement_item_add('27020000-0000-0000-0000-000000000a02',
  '{"id":"27020000-0000-0000-0000-000000000b02","name":"Bolts","quantity":2,"rate":99}')).id::text;
insert into t_ret select 'right', (public.procurement_item_add('27020000-0000-0000-0000-000000000a02',
  '{"id":"27020000-0000-0000-0000-000000000b02","name":"Bolts","quantity":2,"rate":12.5}')).id::text;
select is((select string_agg(v, ',' order by k) from t_ret), '27020000-0000-0000-0000-000000000b02,27020000-0000-0000-0000-000000000b02',
  'AC-HPR-011 a wrong guessed rate gives the same answer as the right one');
select pg_temp._as('27020000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.procurement_item_add('27020000-0000-0000-0000-000000000a02',
  '{"id":"27020000-0000-0000-0000-000000000b02","name":"Bolts","quantity":2,"rate":99}') $$, '23505', null,
  'AC-HPR-012 a person who sees prices still gets the conflict for a different rate');

select * from finish();
rollback;
