-- cus_mrq_plan.test.sql — #2577 consumable usage standards: the plan figure a material request is checked against (migration 1156).
-- Spec docs/specs/consumable-usage-standards.spec.md. AC-CUS-008 precedence and source (plan line, adjusted, adjusted to 0,
-- allowance fallback, none; mrq_plan_for agrees) · AC-CUS-009 the over-plan reason rule on both figures · AC-CUS-010 a
-- submitted request keeps the figure it snapshotted. Migration 2261 now requires a separate PCM approval before the plan
-- can be used, so the fixture approves each authored plan before testing its precedence. Existing mrq_* files cover the rest unchanged.
begin;
create extension if not exists pgtap;
select plan(32);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25770000-0000-0000-0000-00000000030a', 'CUSM Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('25770000-0000-0000-0000-0000000003a1', 'cusm-admin@example.com'),
  ('25770000-0000-0000-0000-0000000003a2', 'cusm-req@example.com'),
  ('25770000-0000-0000-0000-0000000003a3', 'cusm-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('25770000-0000-0000-0000-0000000003a1', '25770000-0000-0000-0000-00000000030a', 'CUSM Admin', 'cusm-admin@example.com', 'Admin', 'active', null),
  ('25770000-0000-0000-0000-0000000003a2', '25770000-0000-0000-0000-00000000030a', 'CUSM Req',   'cusm-req@example.com',   'Engineer', 'active', null),
  ('25770000-0000-0000-0000-0000000003a3', '25770000-0000-0000-0000-00000000030a', 'CUSM PM',    'cusm-pm@example.com',    'Project Manager', 'active', 'project_control_manager');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25770000-0000-0000-0000-0000000003d1', '25770000-0000-0000-0000-00000000030a', 'CUSM Site', 'Ongoing Project', '25770000-0000-0000-0000-0000000003a3');
-- six work orders, one per scenario, so a request in one never counts as "already requested" in another
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount)
select ('25770000-0000-0000-0000-00000000340' || n)::uuid, '25770000-0000-0000-0000-00000000030a', '25770000-0000-0000-0000-0000000003d1',
       'CUSM WO' || n, 'Issued', 10000, 'exclusive', 0 from generate_series(1, 6) n;
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25770000-0000-0000-0000-000000003201', '25770000-0000-0000-0000-00000000030a', '25770000-0000-0000-0000-0000000003d1', 'WLD-01', 'Weld A', 'dia-inch', 120, 10),
  ('25770000-0000-0000-0000-000000003202', '25770000-0000-0000-0000-00000000030a', '25770000-0000-0000-0000-0000000003d1', 'WLD-02', 'Weld B', 'dia-inch', 40, 10),
  ('25770000-0000-0000-0000-000000003203', '25770000-0000-0000-0000-00000000030a', '25770000-0000-0000-0000-0000000003d1', 'ALW-01', 'Allowance', 'm3', 10, 10);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity)
select '25770000-0000-0000-0000-00000000030a', ('25770000-0000-0000-0000-00000000340' || n)::uuid, b.id,
       case b.item_code when 'WLD-01' then 120 when 'WLD-02' then 40 else 10 end
  from generate_series(1, 6) n cross join boq_items b where b.project_id = '25770000-0000-0000-0000-0000000003d1';
insert into stock_units (id, org_id, code, name) values ('25770000-0000-0000-0000-000000003301', '25770000-0000-0000-0000-00000000030a', 'KG', 'Kilogram');
insert into stock_items (id, org_id, code, name, unit_id) values
  ('25770000-0000-0000-0000-000000003311', '25770000-0000-0000-0000-00000000030a', 'ROD', 'Welding rod', '25770000-0000-0000-0000-000000003301'),
  ('25770000-0000-0000-0000-000000003312', '25770000-0000-0000-0000-00000000030a', 'GAS', 'Gas',         '25770000-0000-0000-0000-000000003301');
insert into consumable_usage_standards (org_id, item_id, work_unit, boq_code_prefix, qty_per_unit, margin_pct) values
  ('25770000-0000-0000-0000-00000000030a', '25770000-0000-0000-0000-000000003311', 'dia-inch', 'WLD', 0.05, 10);
-- allowances: 5.000 of rod on the ALW-01 line (share 1 -> 5.000), used by WO1 and WO4 beside a plan line, and by WO5 alone
insert into boq_material_allowances (org_id, boq_item_id, item_id, planned_quantity) values
  ('25770000-0000-0000-0000-00000000030a', '25770000-0000-0000-0000-000000003203', '25770000-0000-0000-0000-000000003311', 5);

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create or replace function pg_temp._wo(n int) returns uuid language sql as $$ select ('25770000-0000-0000-0000-00000000340' || n)::uuid $$;
grant execute on function pg_temp._wo(int) to authenticated;
create or replace function pg_temp._draft(p_wo uuid, p_item uuid, p_qty numeric, p_reason text) returns uuid language sql as $$
  select public.mrq_save_draft(null, jsonb_build_object('work_order_id', p_wo, 'needed_by', current_date + 5),
    jsonb_build_array(jsonb_build_object('item_id', p_item, 'quantity', p_qty, 'over_plan_reason', p_reason))) $$;
grant execute on function pg_temp._draft(uuid, uuid, numeric, text) to authenticated;
-- the form's view of the figure: 'plan/source'
create or replace function pg_temp._form(p_wo uuid, p_item uuid) returns text language sql as $$
  select plan_qty::text || '/' || coalesce(plan_source, '-') from public.mrq_plan_for(p_wo, array[p_item]) $$;
grant execute on function pg_temp._form(uuid, uuid) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

set local role authenticated;
select pg_temp._as('25770000-0000-0000-0000-0000000003a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Project Manager","label":"Check"}]'::jsonb) $$, 'an approval chain exists');
-- plans: WO1/WO2 standard (rod 8.800); WO3 adjusted to 12; WO4 adjusted to 0; WO5 a plan line for another item only; WO6 nothing
select lives_ok($$ select public.cus_generate_plan(pg_temp._wo(n)) from generate_series(1, 4) n $$, 'plans generated for WO1..WO4');
select lives_ok($$ select public.cus_adjust_plan_line(pg_temp._wo(3), '25770000-0000-0000-0000-000000003311', 12, 'extra spools') $$, 'WO3 rod adjusted to 12');
select lives_ok($$ select public.cus_adjust_plan_line(pg_temp._wo(4), '25770000-0000-0000-0000-000000003311', 0, 'supplied by the client') $$, 'WO4 rod adjusted to 0');
select lives_ok($$ select public.cus_adjust_plan_line(pg_temp._wo(5), '25770000-0000-0000-0000-000000003312', 2, 'gas only') $$, 'WO5 has a plan line for gas but none for rod');
select pg_temp._as('25770000-0000-0000-0000-0000000003a3');
select lives_ok($$ select public.cus_approve_plan(pg_temp._wo(n)) from generate_series(1, 5) n $$,
  'each plan is approved by a separate project control manager before material requests use it');

-- ── AC-CUS-008: the figure and its source, on the form (mrq_plan_for) ───────────────────────────────────────────
select pg_temp._as('25770000-0000-0000-0000-0000000003a2');
select is(pg_temp._form(pg_temp._wo(1), '25770000-0000-0000-0000-000000003311'), '8.800/standard', 'AC-CUS-008 a plan line: 8.800, source standard (the allowance of 5.000 does not win)');
select is(pg_temp._form(pg_temp._wo(3), '25770000-0000-0000-0000-000000003311'), '12.000/adjusted', 'AC-CUS-008 an adjusted line: 12.000, source adjusted');
select is(pg_temp._form(pg_temp._wo(4), '25770000-0000-0000-0000-000000003311'), '0.000/adjusted', 'AC-CUS-008 adjusted to 0: 0.000, source adjusted, no fallback to the allowance');
select is(pg_temp._form(pg_temp._wo(5), '25770000-0000-0000-0000-000000003311'), '5.000/allowance', 'AC-CUS-008 no plan line for the item: the allowance figure, source allowance');
select is(pg_temp._form(pg_temp._wo(6), '25770000-0000-0000-0000-000000003312'), '0.000/none', 'AC-CUS-008 neither: 0.000, source none');

-- ── AC-CUS-009: the over-plan reason rule on the plan figure ───────────────────────────────────────────────────
insert into t_ids values ('o1', pg_temp._draft(pg_temp._wo(1), '25770000-0000-0000-0000-000000003311', 9, null));
select throws_ok($$ select public.mrq_submit((select v from t_ids where k = 'o1')) $$, '23514',
  'MRQ_OVER_PLAN_REASON: line 1 is over plan and needs a reason (1 to 500 characters)', 'AC-CUS-009 9.000 kg against a plan of 8.800 needs a reason');
select lives_ok($$ select public.mrq_save_draft((select v from t_ids where k = 'o1'),
    jsonb_build_object('work_order_id', pg_temp._wo(1), 'needed_by', current_date + 5),
    '[{"item_id":"25770000-0000-0000-0000-000000003311","quantity":9,"over_plan_reason":"extra spools"}]'::jsonb) $$, 'AC-CUS-009 the author adds a reason');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'o1')) $$, 'AC-CUS-009 with a reason it is accepted');
select is((select plan_qty::text || '/' || plan_source from material_request_lines where request_id = (select v from t_ids where k = 'o1')),
  '8.800/standard', 'AC-CUS-008 the submit snapshots the figure and its source');
insert into t_ids values ('o2', pg_temp._draft(pg_temp._wo(2), '25770000-0000-0000-0000-000000003311', 8, null));
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'o2')) $$, 'AC-CUS-009 8.000 kg against 8.800 needs no reason');

-- adjusted figure on the server
insert into t_ids values ('a1', pg_temp._draft(pg_temp._wo(3), '25770000-0000-0000-0000-000000003311', 11, null));
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'a1')) $$, 'AC-CUS-008 11.000 kg is inside the adjusted plan of 12.000');
select is((select plan_qty::text || '/' || plan_source from material_request_lines where request_id = (select v from t_ids where k = 'a1')),
  '12.000/adjusted', 'AC-CUS-008 the snapshot is 12.000, adjusted');
insert into t_ids values ('z1', pg_temp._draft(pg_temp._wo(4), '25770000-0000-0000-0000-000000003311', 1, null));
select throws_ok($$ select public.mrq_submit((select v from t_ids where k = 'z1')) $$, '23514', null,
  'AC-CUS-009 against a plan adjusted to 0, any quantity needs a reason');
select lives_ok($$ select public.mrq_save_draft((select v from t_ids where k = 'z1'),
    jsonb_build_object('work_order_id', pg_temp._wo(4), 'needed_by', current_date + 5),
    '[{"item_id":"25770000-0000-0000-0000-000000003311","quantity":1,"over_plan_reason":"client supply late"}]'::jsonb) $$, 'the author adds a reason');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'z1')) $$, 'AC-CUS-008 with a reason it is accepted');
select is((select plan_qty::text || '/' || plan_source from material_request_lines where request_id = (select v from t_ids where k = 'z1')),
  '0.000/adjusted', 'AC-CUS-008 the snapshot is 0.000, adjusted (no fallback)');

-- the same rule on the fallback figure
insert into t_ids values ('f1', pg_temp._draft(pg_temp._wo(5), '25770000-0000-0000-0000-000000003311', 5.5, null));
select throws_ok($$ select public.mrq_submit((select v from t_ids where k = 'f1')) $$, '23514', null, 'AC-CUS-009 5.500 against the allowance figure 5.000 needs a reason');
select lives_ok($$ select public.mrq_save_draft((select v from t_ids where k = 'f1'),
    jsonb_build_object('work_order_id', pg_temp._wo(5), 'needed_by', current_date + 5),
    '[{"item_id":"25770000-0000-0000-0000-000000003311","quantity":5,"over_plan_reason":null}]'::jsonb) $$, 'the author lowers it to 5.000');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'f1')) $$, 'AC-CUS-009 5.000 is accepted without a reason');
select is((select plan_qty::text || '/' || plan_source from material_request_lines where request_id = (select v from t_ids where k = 'f1')),
  '5.000/allowance', 'AC-CUS-008 the snapshot is 5.000, allowance');
insert into t_ids values ('n1', pg_temp._draft(pg_temp._wo(6), '25770000-0000-0000-0000-000000003312', 1, 'one-off'));
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'n1')) $$, 'a request with neither plan nor allowance submits with its reason');
select is((select plan_qty::text || '/' || plan_source from material_request_lines where request_id = (select v from t_ids where k = 'n1')),
  '0.000/none', 'AC-CUS-008 the snapshot is 0.000, none');

-- ── AC-CUS-010: a submitted request keeps its figure ───────────────────────────────────────────────────────────
select pg_temp._as('25770000-0000-0000-0000-0000000003a1');
select lives_ok($$ select public.cus_adjust_plan_line(pg_temp._wo(1), '25770000-0000-0000-0000-000000003311', 20, 'scope grew') $$, 'AC-CUS-010 the plan of WO1 is adjusted after the request was submitted');
select lives_ok($$ select public.cus_generate_plan(pg_temp._wo(1)) $$, 'AC-CUS-010 and regenerated');
select is((select plan_qty::text || '/' || plan_source from material_request_lines where request_id = (select v from t_ids where k = 'o1')),
  '8.800/standard', 'AC-CUS-010 the request still shows the figure it was judged against');
select pg_temp._as('25770000-0000-0000-0000-0000000003a2');
select is(pg_temp._form(pg_temp._wo(1), '25770000-0000-0000-0000-000000003311'), '20.000/adjusted', 'AC-CUS-010 while a new request on the form sees the new figure');

select * from finish();
rollback;
