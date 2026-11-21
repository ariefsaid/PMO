-- mrq_usage_thresholds.test.sql — #2686 two usage thresholds of plan on material requests.
-- Spec docs/specs/material-request-usage-thresholds.spec.md. Migrations under test: 1330-1332.
-- AC-MUT-001..008 and 011. Each assertion names its AC.
begin;
create extension if not exists pgtap;
select plan(34);

insert into organizations (id, name, default_currency, default_timezone) values
  ('26860000-0000-0000-0000-00000000010a', 'MUT Org', 'IDR', 'Asia/Jakarta'),
  ('26860000-0000-0000-0000-00000000010b', 'MUT Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('26860000-0000-0000-0000-0000000001a1', 'mut-admin@example.com'),
  ('26860000-0000-0000-0000-0000000001a2', 'mut-req@example.com'),
  ('26860000-0000-0000-0000-0000000001a3', 'mut-pm@example.com'),
  ('26860000-0000-0000-0000-0000000001a6', 'mut-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26860000-0000-0000-0000-0000000001a1', '26860000-0000-0000-0000-00000000010a', 'MUT Admin', 'mut-admin@example.com', 'Admin', 'active'),
  ('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-00000000010a', 'MUT Req',   'mut-req@example.com',   'Engineer', 'active'),
  ('26860000-0000-0000-0000-0000000001a3', '26860000-0000-0000-0000-00000000010a', 'MUT PM',    'mut-pm@example.com',    'Project Manager', 'active'),
  ('26860000-0000-0000-0000-0000000001a6', '26860000-0000-0000-0000-00000000010b', 'MUT Other', 'mut-other@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26860000-0000-0000-0000-0000000001d1', '26860000-0000-0000-0000-00000000010a', 'MUT Site', 'Ongoing Project', '26860000-0000-0000-0000-0000000001a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-00000000010a', '26860000-0000-0000-0000-0000000001d1', 'MUT WO', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26860000-0000-0000-0000-000000001201', '26860000-0000-0000-0000-00000000010a', '26860000-0000-0000-0000-0000000001d1', 'B1', 'Slab', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('26860000-0000-0000-0000-00000000010a', '26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-000000001201', 10);
insert into stock_units (id, org_id, code, name, whole_only) values
  ('26860000-0000-0000-0000-000000001301', '26860000-0000-0000-0000-00000000010a', 'BAG', 'Bag', true);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('26860000-0000-0000-0000-000000001311', '26860000-0000-0000-0000-00000000010a', 'I1', 'Item one',   '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001312', '26860000-0000-0000-0000-00000000010a', 'I2', 'Item two',   '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001313', '26860000-0000-0000-0000-00000000010a', 'I3', 'Item three', '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001314', '26860000-0000-0000-0000-00000000010a', 'I4', 'Item four',  '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001315', '26860000-0000-0000-0000-00000000010a', 'I5', 'Item five',  '26860000-0000-0000-0000-000000001301'),
  ('26860000-0000-0000-0000-000000001316', '26860000-0000-0000-0000-00000000010a', 'I6', 'Item six',   '26860000-0000-0000-0000-000000001301');
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity)
  select '26860000-0000-0000-0000-00000000010a', '26860000-0000-0000-0000-000000001201', i.id, 100
    from stock_items i where i.org_id = '26860000-0000-0000-0000-00000000010a';

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- Raise and submit a one-line request for item p_item as the user p_by; returns the request id.
create or replace function pg_temp._raise(p_by uuid, p_item text, p_qty numeric, p_reason text default null, p_crid uuid default null) returns uuid
  language plpgsql as $$
declare v uuid;
begin
  perform pg_temp._as(p_by);
  v := public.mrq_save_draft(null,
    jsonb_build_object('work_order_id', '26860000-0000-0000-0000-000000001401', 'needed_by', '2026-12-30'),
    jsonb_build_array(jsonb_build_object('item_id', p_item::uuid, 'quantity', p_qty, 'over_plan_reason', p_reason)), null);
  perform public.mrq_submit(v, p_crid);
  return v;
end $$;
grant execute on function pg_temp._raise(uuid, text, numeric, text, uuid) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Project Manager","label":"Billable change"}]'::jsonb) $$, 'a one-step chain');

-- ── AC-MUT-008 the settings ──────────────────────────────────────────────────────────────────────────
select throws_ok($$ select public.mrq_set_usage_thresholds(0, 100) $$, 'P0001', null, 'AC-MUT-008 zero is refused');
select throws_ok($$ select public.mrq_set_usage_thresholds(80, 1001) $$, 'P0001', null, 'AC-MUT-008 above 1000 is refused');
select throws_ok($$ select public.mrq_set_usage_thresholds(90, 90) $$, 'P0001', null, 'AC-MUT-008 the second must exceed the first');
select pg_temp._as('26860000-0000-0000-0000-0000000001a2');
select throws_ok($$ select public.mrq_set_usage_thresholds(80, 100) $$, '42501', null, 'AC-MUT-007 a non-Admin cannot set thresholds');
select pg_temp._as('26860000-0000-0000-0000-0000000001a1');

-- ── AC-MUT-004 default off: nothing recorded while both are unset ────────────────────────────────────
reset role;
select is((select usage_warn_pct_1 from public.material_request_settings where org_id = '26860000-0000-0000-0000-00000000010a'), null::numeric,
  'AC-MUT-004 the default is unset');
set local role authenticated;
insert into t_ids select 'off', pg_temp._raise('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-000000001311', 90);
reset role;
select is((select count(*)::int from public.material_request_usage_alerts where org_id = '26860000-0000-0000-0000-00000000010a'), 0,
  'AC-MUT-004 with both unset no crossing is recorded');
select is((select count(*)::int from public.notifications where org_id = '26860000-0000-0000-0000-00000000010a' and title = 'Material usage threshold reached'), 0,
  'AC-MUT-004 with both unset no notification is written');

-- ── AC-MUT-001 first crossing ────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_usage_thresholds(80, 100) $$, 'AC-MUT-008 an Admin sets 80 and 100');
-- item 2: 85 of 100 crosses 80 only
insert into t_ids select 'r1', pg_temp._raise('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-000000001312', 85);
reset role;
select is((select array_agg(slot order by slot) from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001312'), array[1::smallint],
  'AC-MUT-001 use at 85 percent records the first threshold only');
select is((select count(*)::int from public.notifications where owner_id = '26860000-0000-0000-0000-0000000001a3' and title = 'Material usage threshold reached'), 1,
  'AC-MUT-001 one notification goes to the project manager');
select ok((select body like '%80%%' from public.notifications where owner_id = '26860000-0000-0000-0000-0000000001a3' and title = 'Material usage threshold reached'),
  'AC-MUT-001 the notification names the threshold crossed');
select is((select status from public.material_requests where id = (select v from t_ids where k = 'r1')), 'pending',
  'AC-MUT-005 a crossing does not block the request');

-- ── AC-MUT-003 no duplicates ─────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a2');
select throws_ok($$ select public.mrq_submit((select v from t_ids where k = 'r1')) $$, 'P0001', null, 'AC-MUT-003 a pending request cannot be submitted again');
select pg_temp._as('26860000-0000-0000-0000-0000000001a3');
select lives_ok($$ select public.mrq_decide_step((select v from t_ids where k = 'r1'), 1, 'return', 'amend') $$, 'the manager returns the request');
select pg_temp._as('26860000-0000-0000-0000-0000000001a2');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'r1')) $$, 'AC-MUT-003 the author resubmits after the return');
reset role;
select is((select count(*)::int from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001312'), 1,
  'AC-MUT-003 a resubmission after a return adds no crossing');
select is((select count(*)::int from public.notifications where owner_id = '26860000-0000-0000-0000-0000000001a3' and title = 'Material usage threshold reached'), 1,
  'AC-MUT-003 a resubmission after a return sends no second notification');
set local role authenticated;
insert into t_ids select 'r2', pg_temp._raise('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-000000001312', 5);
reset role;
select is((select count(*)::int from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001312'), 1,
  'AC-MUT-003 another request for the same item adds nothing below the next threshold');

-- ── AC-MUT-002 second crossing alone, then both at once ──────────────────────────────────────────────
set local role authenticated;
insert into t_ids select 'r3', pg_temp._raise('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-000000001312', 15, 'site over-use');
reset role;
select is((select array_agg(slot order by slot) from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001312'), array[1::smallint, 2::smallint],
  'AC-MUT-002 use reaching 105 adds only the second threshold');
select is((select count(*)::int from public.notifications where owner_id = '26860000-0000-0000-0000-0000000001a3' and title = 'Material usage threshold reached'), 2,
  'AC-MUT-002 the second crossing notifies once more');
set local role authenticated;
insert into t_ids select 'r4', pg_temp._raise('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-000000001313', 105, 'site over-use');
reset role;
select is((select array_agg(slot order by slot) from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001313'), array[1::smallint, 2::smallint],
  'AC-MUT-002 a single jump past both thresholds records both');
select is((select count(*)::int from public.notifications where owner_id = '26860000-0000-0000-0000-0000000001a3' and title = 'Material usage threshold reached'), 4,
  'AC-MUT-002 and notifies for both');

-- ── AC-MUT-011 the slot is the key: a changed percentage does not raise a recorded slot again ────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_usage_thresholds(70, 100) $$, 'AC-MUT-011 an Admin lowers the first threshold');
insert into t_ids select 'r5', pg_temp._raise('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-000000001312', 1, 'still over');
reset role;
select is((select count(*)::int from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001312'), 2,
  'AC-MUT-011 slots already recorded are not raised again after a change');

-- ── AC-MUT-006 submitter is the manager / no manager ─────────────────────────────────────────────────
set local role authenticated;
insert into t_ids select 'r6', pg_temp._raise('26860000-0000-0000-0000-0000000001a3', '26860000-0000-0000-0000-000000001314', 90);
reset role;
select is((select count(*)::int from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001314'), 1,
  'AC-MUT-006 the crossing is recorded when the submitter is the manager');
select is((select notified_user_id from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001314'), null::uuid,
  'AC-MUT-006 and no one is recorded as notified');
select is((select count(*)::int from public.notifications where owner_id = '26860000-0000-0000-0000-0000000001a3' and title = 'Material usage threshold reached'), 4,
  'AC-MUT-006 the manager does not notify themselves');
update projects set project_manager_id = null where id = '26860000-0000-0000-0000-0000000001d1';
set local role authenticated;
insert into t_ids select 'r7', pg_temp._raise('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-000000001315', 90);
reset role;
select is((select count(*)::int from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001315'), 1,
  'AC-MUT-006 the crossing is recorded when the project has no manager');
select is((select count(*)::int from public.notifications where org_id = '26860000-0000-0000-0000-00000000010a' and title = 'Material usage threshold reached'), 4,
  'AC-MUT-006 and nobody is notified');

-- ── AC-MUT-007 access ────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp._as('26860000-0000-0000-0000-0000000001a6');
select is((select count(*)::int from public.material_request_usage_alerts), 0, 'AC-MUT-007 another organisation reads no crossings');
select pg_temp._as('26860000-0000-0000-0000-0000000001a2');
select throws_ok($$ insert into public.material_request_usage_alerts (work_order_id, item_id, slot, pct) values ('26860000-0000-0000-0000-000000001401', '26860000-0000-0000-0000-000000001316', 1, 80) $$,
  '42501', null, 'AC-MUT-007 a client cannot write a crossing');

-- ── AC-MUT-004/008 clearing ──────────────────────────────────────────────────────────────────────────
select pg_temp._as('26860000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_usage_thresholds(null, null) $$, 'AC-MUT-008 null clears both');
insert into t_ids select 'r8', pg_temp._raise('26860000-0000-0000-0000-0000000001a2', '26860000-0000-0000-0000-000000001316', 99);
reset role;
select is((select count(*)::int from public.material_request_usage_alerts where item_id = '26860000-0000-0000-0000-000000001316'), 0,
  'AC-MUT-004 cleared thresholds record nothing again');
select * from finish();
rollback;
