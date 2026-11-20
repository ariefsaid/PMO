-- 1099_work_order_section_materials.test.sql — #2576 per-section material allocation, the request link, the section check.
-- Migration under test: 1099_work_order_section_materials.sql (needs 1095..1097).
-- AC-WOS-002 cable requested 40 + 10 + 20 = 70 · AC-WOS-003 a request naming a section of another work order is refused ·
-- AC-WOS-006 an archive is blocked by a draft or pending request · AC-WOS-008 allocations never exceed the work order's plan,
-- and a plan that drops later flags the item without rewriting a figure · AC-WOS-009 a line over its SECTION's allocation needs
-- the over-plan reason, and the work-order check still applies on its own · AC-WOS-010 a section with no allocation is checked
-- against the work order's plan only · AC-WOS-011 the section of a request moves only while it is a draft.
-- Every denial asserts the errcode AND the message. Mutation checks are recorded in the build report.
begin;
create extension if not exists pgtap;
select plan(50);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25760000-0000-0000-0000-00000000010a', 'WOSM Org', 'IDR', 'Asia/Jakarta'),
  ('25760000-0000-0000-0000-00000000010b', 'WOSM Other', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('25760000-0000-0000-0000-0000000001a1', 'wosm-admin@example.com'),
  ('25760000-0000-0000-0000-0000000001a2', 'wosm-req@example.com'),
  ('25760000-0000-0000-0000-0000000001a3', 'wosm-pm@example.com'),
  ('25760000-0000-0000-0000-0000000001b1', 'wosm-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25760000-0000-0000-0000-0000000001a1', '25760000-0000-0000-0000-00000000010a', 'WOSM Admin', 'wosm-admin@example.com', 'Admin', 'active'),
  ('25760000-0000-0000-0000-0000000001a2', '25760000-0000-0000-0000-00000000010a', 'WOSM Req',   'wosm-req@example.com',   'Engineer', 'active'),
  ('25760000-0000-0000-0000-0000000001a3', '25760000-0000-0000-0000-00000000010a', 'WOSM PM',    'wosm-pm@example.com',    'Project Manager', 'active'),
  ('25760000-0000-0000-0000-0000000001b1', '25760000-0000-0000-0000-00000000010b', 'WOSM XOrg',  'wosm-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25760000-0000-0000-0000-0000000001d1', '25760000-0000-0000-0000-00000000010a', 'WOSM Site', 'Ongoing Project', '25760000-0000-0000-0000-0000000001a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25760000-0000-0000-0000-000000001401', '25760000-0000-0000-0000-00000000010a', '25760000-0000-0000-0000-0000000001d1', 'WOSM W',  'Issued', 10000, 'exclusive', 0),
  ('25760000-0000-0000-0000-000000001402', '25760000-0000-0000-0000-00000000010a', '25760000-0000-0000-0000-0000000001d1', 'WOSM W2', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25760000-0000-0000-0000-000000001201', '25760000-0000-0000-0000-00000000010a', '25760000-0000-0000-0000-0000000001d1', 'B1', 'Slab', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('25760000-0000-0000-0000-00000000010a', '25760000-0000-0000-0000-000000001401', '25760000-0000-0000-0000-000000001201', 10);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25760000-0000-0000-0000-000000001202', '25760000-0000-0000-0000-00000000010a', '25760000-0000-0000-0000-0000000001d1', 'B2', 'Wall', 'm3', 10, 1000);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('25760000-0000-0000-0000-00000000010a', '25760000-0000-0000-0000-000000001402', '25760000-0000-0000-0000-000000001202', 10);
insert into stock_units (id, org_id, code, name) values
  ('25760000-0000-0000-0000-000000001301', '25760000-0000-0000-0000-00000000010a', 'M', 'Metre');
insert into stock_items (id, org_id, code, name, unit_id) values
  ('25760000-0000-0000-0000-000000001311', '25760000-0000-0000-0000-00000000010a', 'CBL', 'Cable', '25760000-0000-0000-0000-000000001301');
insert into boq_material_allowances (id, org_id, boq_item_id, item_id, planned_quantity) values
  ('25760000-0000-0000-0000-000000001321', '25760000-0000-0000-0000-00000000010a', '25760000-0000-0000-0000-000000001201', '25760000-0000-0000-0000-000000001311', 100),
  ('25760000-0000-0000-0000-000000001322', '25760000-0000-0000-0000-00000000010a', '25760000-0000-0000-0000-000000001202', '25760000-0000-0000-0000-000000001311', 50);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.draft(p_section uuid, p_qty numeric, p_reason text, p_request uuid default null) returns uuid
  language sql as $$
  select public.mrq_save_draft(p_request,
    jsonb_build_object('work_order_id', '25760000-0000-0000-0000-000000001401', 'needed_by', current_date + 5, 'section_id', p_section),
    jsonb_build_array(jsonb_build_object('item_id', '25760000-0000-0000-0000-000000001311', 'quantity', p_qty, 'over_plan_reason', p_reason)), null) $$;
grant execute on function pg_temp.draft(uuid, numeric, text, uuid) to authenticated;
create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to authenticated;

set local role authenticated;
select pg_temp.act_as('25760000-0000-0000-0000-0000000001a1');
select lives_ok($$ select public.mrq_set_chain('[{"role":"Finance","label":"Stock"}]'::jsonb) $$, 'fixture: the approval chain');
select pg_temp.act_as('25760000-0000-0000-0000-0000000001a3');
insert into public.work_order_sections (work_order_id, code, name, sort_order) values
  ('25760000-0000-0000-0000-000000001401', 'A', 'North', 1),
  ('25760000-0000-0000-0000-000000001401', 'B', 'South', 2),
  ('25760000-0000-0000-0000-000000001401', 'C', 'Yard', 3),
  ('25760000-0000-0000-0000-000000001402', 'X', 'Other work order', 1);
insert into t_ids select 'A', id from public.work_order_sections where code = 'A';
insert into t_ids select 'B', id from public.work_order_sections where code = 'B';
insert into t_ids select 'C', id from public.work_order_sections where code = 'C';
insert into t_ids select 'X', id from public.work_order_sections where code = 'X';

-- ── AC-WOS-008: allocations against the work order's plan of 100 ────────────────────────────────────────────
select lives_ok($$ insert into public.work_order_section_material_plan (work_order_id, section_id, item_id, quantity)
  values ('25760000-0000-0000-0000-000000001401', (select v from t_ids where k = 'A'), '25760000-0000-0000-0000-000000001311', 60) $$,
  'FR-WOS-013 a Project Manager allocates 60 of the cable to section A');
select lives_ok($$ insert into public.work_order_section_material_plan (work_order_id, section_id, item_id, quantity)
  values ('25760000-0000-0000-0000-000000001401', (select v from t_ids where k = 'B'), '25760000-0000-0000-0000-000000001311', 30) $$,
  'and 30 to section B');
select throws_ok($$ update public.work_order_section_material_plan set quantity = 50 where section_id = (select v from t_ids where k = 'B') $$,
  '23514', 'WOS_ALLOCATION_CAP: the allocations would be 110.000 against a work-order plan of 100.000',
  'AC-WOS-008 raising B to 50 is refused, naming the plan figure');
select lives_ok($$ update public.work_order_section_material_plan set quantity = 40 where section_id = (select v from t_ids where k = 'B') $$,
  'AC-WOS-008 raising B to 40 (total exactly 100) is accepted');
update public.work_order_section_material_plan set quantity = 30 where section_id = (select v from t_ids where k = 'B');
select throws_ok($$ insert into public.work_order_section_material_plan (work_order_id, section_id, item_id, quantity)
  values ('25760000-0000-0000-0000-000000001402', (select v from t_ids where k = 'C'), '25760000-0000-0000-0000-000000001311', 1) $$,
  '23503', 'insert or update on table "work_order_section_material_plan" violates foreign key constraint "work_order_section_material_plan_section_wo_fk"',
  'AC-WOS-003 an allocation of W2 naming a section of W is refused by the composite key');
select throws_ok($$ insert into public.work_order_section_material_plan (work_order_id, section_id, item_id, quantity)
  values ('25760000-0000-0000-0000-000000001401', (select v from t_ids where k = 'C'), '25760000-0000-0000-0000-000000001311', 0) $$,
  '23514', 'new row for relation "work_order_section_material_plan" violates check constraint "work_order_section_material_plan_quantity_check"',
  'an allocation is above zero');
select pg_temp.act_as('25760000-0000-0000-0000-0000000001a2');
select throws_ok($$ insert into public.work_order_section_material_plan (work_order_id, section_id, item_id, quantity)
  values ('25760000-0000-0000-0000-000000001401', (select v from t_ids where k = 'C'), '25760000-0000-0000-0000-000000001311', 5) $$,
  '42501', 'new row violates row-level security policy for table "work_order_section_material_plan"', 'AC-WOS-016 an Engineer cannot allocate');

-- ── requests: A 40, B 10, none 20 (all pending) ─────────────────────────────────────────────────────────────
insert into t_ids values ('rA', pg_temp.draft((select v from t_ids where k = 'A'), 40, null));
insert into t_ids values ('rB', pg_temp.draft((select v from t_ids where k = 'B'), 10, null));
insert into t_ids values ('rN', pg_temp.draft(null, 20, null));
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'rA')) $$, 'a request of 40 on section A (within its 60) submits with no reason');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'rB')) $$, 'a request of 10 on section B submits');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'rN')) $$, 'a request of 20 on no section submits');
select is((select (section_plan_qty, section_prior_qty)::text from public.material_request_lines where request_id = (select v from t_ids where k = 'rA')),
  '(60.000,0.000)', 'FR-WOS-009 the line snapshots its section''s plan and prior quantity beside the work order''s');

-- ── AC-WOS-002 (material half) and FR-WOS-014: the check read ────────────────────────────────────────────────
create temp table chk as select * from public.work_order_section_material_check('25760000-0000-0000-0000-000000001401');
grant all on chk to authenticated;
select is((select sum(requested_qty) from chk), 70.000::numeric, 'AC-WOS-002 cable requested: 40 + 10 + 20 = 70 (sections plus the unsectioned remainder)');
select is((select array_agg((coalesce(left(section_id::text, 0), '') || plan_qty || '/' || requested_qty || '/' || remaining_qty) order by (section_id is null), section_id = (select v from t_ids where k = 'B'))
             from chk), array['60.000/40.000/20.000', '30.000/10.000/20.000', '10.000/20.000/-10.000'],
  'FR-WOS-014 per section: plan, requested, remaining; the remainder''s plan is what no section took (100 - 90)');
select is((select bool_or(over_allocated) from chk), false, 'allocations of 90 against a plan of 100 are not over-allocated');
select is((select count(*)::int from public.work_order_section_material_check('25760000-0000-0000-0000-000000001402')), 0,
  'a work order whose sections hold no allocation and no request has no material rows');

-- ── AC-WOS-009: a line over its section's allocation ───────────────────────────────────────────────────────
insert into t_ids values ('rA2', pg_temp.draft((select v from t_ids where k = 'A'), 25, null));
select throws_ok($$ select public.mrq_submit((select v from t_ids where k = 'rA2')) $$,
  '23514', 'MRQ_OVER_PLAN_REASON: line 1 is over its section''s plan and needs a reason (1 to 500 characters)',
  'AC-WOS-009 25 more on section A (total 65 against 60) is refused without a reason, though the work order is within its plan (95 of 100)');
select lives_ok($$ select pg_temp.draft((select v from t_ids where k = 'A'), 25, 'extra rebar cable', (select v from t_ids where k = 'rA2')) $$, 'the author adds the reason');
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'rA2')) $$, 'AC-WOS-009 with a reason it is accepted');
select is((select (section_plan_qty, section_prior_qty, plan_qty, prior_qty)::text from public.material_request_lines where request_id = (select v from t_ids where k = 'rA2')),
  '(60.000,40.000,100.000,70.000)', 'the snapshot names the section''s figures and the work order''s');
select is((select count(*)::int from public.material_request_steps where request_id = (select v from t_ids where k = 'rA2')), 1, 'the chain is snapshotted as for any request');

-- ── AC-WOS-010: a section with no allocation is checked against the work order's plan only ───────────────────
insert into t_ids values ('rC', pg_temp.draft((select v from t_ids where k = 'C'), 3, null));
select lives_ok($$ select public.mrq_submit((select v from t_ids where k = 'rC')) $$,
  'AC-WOS-010 section C has no cable allocation: 3 more (98 of 100) needs no reason');
select is((select (section_plan_qty is null and section_prior_qty is null)::text from public.material_request_lines where request_id = (select v from t_ids where k = 'rC')),
  'true', 'AC-WOS-010 and its section snapshot is empty');

-- ── AC-WOS-009: the work-order check still applies independently ─────────────────────────────────────────────
insert into t_ids values ('rB2', pg_temp.draft((select v from t_ids where k = 'B'), 20, null));
select throws_ok($$ select public.mrq_submit((select v from t_ids where k = 'rB2')) $$,
  '23514', 'MRQ_OVER_PLAN_REASON: line 1 is over plan and needs a reason (1 to 500 characters)',
  'AC-WOS-009 20 more on section B fits its allocation (30 of 30) but takes the work order to 118 of 100: the work-order check refuses it');
select lives_ok($$ select public.mrq_cancel((select v from t_ids where k = 'rB2')) $$, 'the author withdraws it');

-- ── AC-WOS-003 / FR-WOS-012: another work order's section ────────────────────────────────────────────────────
select throws_ok($$ select pg_temp.draft((select v from t_ids where k = 'X'), 1, null) $$,
  'P0001', 'MRQ_SECTION: the section is not a live section of this work order', 'AC-WOS-003 a request on W naming a section of W2 is refused by the RPC');
reset role;
select throws_ok($$ insert into material_requests (org_id, number, work_order_id, project_id, section_id, needed_by, created_by)
  values ('25760000-0000-0000-0000-00000000010a', 'MRQ-X', '25760000-0000-0000-0000-000000001401', '25760000-0000-0000-0000-0000000001d1',
          (select v from t_ids where k = 'X'), current_date, '25760000-0000-0000-0000-0000000001a2') $$,
  '23503', 'insert or update on table "material_requests" violates foreign key constraint "material_requests_section_wo_fk"',
  'AC-WOS-003 and by the composite key whichever path writes');

-- ── AC-WOS-011: the section moves only while the request is a draft ─────────────────────────────────────────
select pg_temp.act_as('25760000-0000-0000-0000-0000000001a2');
insert into t_ids values ('rD', pg_temp.draft((select v from t_ids where k = 'B'), 2, null));
select lives_ok($$ select pg_temp.draft((select v from t_ids where k = 'A'), 2, null, (select v from t_ids where k = 'rD')) $$,
  'AC-WOS-011 the section of a draft changes');
select is((select section_id from public.material_requests where id = (select v from t_ids where k = 'rD')), (select v from t_ids where k = 'A'), 'and it took');
reset role;
update material_requests set status = 'approved', decided_at = now() where id = (select v from t_ids where k = 'rA');
select throws_ok($$ update material_requests set section_id = (select v from t_ids where k = 'B') where id = (select v from t_ids where k = 'rA') $$,
  'P0001', 'MRQ_SECTION_LOCKED: the section of a request can change only while it is a draft',
  'AC-WOS-011 an approved request''s section cannot change, not even by the owner');
update material_requests set status = 'pending', decided_at = null where id = (select v from t_ids where k = 'rA');
select throws_ok($$ update material_requests set section_id = (select v from t_ids where k = 'B') where id = (select v from t_ids where k = 'rA') $$,
  'P0001', 'MRQ_SECTION_LOCKED: the section of a request can change only while it is a draft', 'nor a pending one');
set local role authenticated;
select pg_temp.act_as('25760000-0000-0000-0000-0000000001a2');
select throws_ok($$ select pg_temp.draft((select v from t_ids where k = 'B'), 40, null, (select v from t_ids where k = 'rA')) $$,
  'P0001', 'MRQ_NOT_DRAFT: only a draft request can be changed or submitted', 'AC-WOS-011 the RPC refuses a pending request too');

-- ── AC-WOS-006: archive blockers ───────────────────────────────────────────────────────────────────────────
select pg_temp.act_as('25760000-0000-0000-0000-0000000001a3');
select throws_ok($$ update public.work_order_sections set archived_at = now() where id = (select v from t_ids where k = 'C') $$,
  '23514', 'WOS_ARCHIVE_BLOCKED: 1 material request(s) of this section are still draft or pending',
  'AC-WOS-006 a section with a pending request is not archived, and the reason is named');
select pg_temp.act_as('25760000-0000-0000-0000-0000000001a2');
select lives_ok($$ select public.mrq_cancel((select v from t_ids where k = 'rC')) $$, 'the author withdraws the pending request');
select pg_temp.act_as('25760000-0000-0000-0000-0000000001a3');
select lives_ok($$ update public.work_order_sections set archived_at = now() where id = (select v from t_ids where k = 'C') $$,
  'AC-WOS-006 with no open request the section archives');
select pg_temp.act_as('25760000-0000-0000-0000-0000000001a2');
select throws_ok($$ select pg_temp.draft((select v from t_ids where k = 'C'), 1, null) $$,
  'P0001', 'MRQ_SECTION: the section is not a live section of this work order', 'AC-WOS-006 an archived section is not offered on a new request');
select is((select section_id from public.material_requests where id = (select v from t_ids where k = 'rC')), (select v from t_ids where k = 'C'),
  'AC-WOS-006 but its old request still shows it');
select pg_temp.act_as('25760000-0000-0000-0000-0000000001a3');
select throws_ok($$ insert into public.work_order_section_material_plan (work_order_id, section_id, item_id, quantity)
  values ('25760000-0000-0000-0000-000000001401', (select v from t_ids where k = 'C'), '25760000-0000-0000-0000-000000001311', 1) $$,
  '23514', 'WOS_SECTION_ARCHIVED: an archived section takes no allocation', 'an allocation on an archived section is refused');

-- ── AC-WOS-008 second half: the work order's plan drops to 80 ────────────────────────────────────────────────
reset role;
update boq_material_allowances set planned_quantity = 80 where id = '25760000-0000-0000-0000-000000001321';
set local role authenticated;
select pg_temp.act_as('25760000-0000-0000-0000-0000000001a3');
select is((select bool_or(over_allocated) from public.work_order_section_material_check('25760000-0000-0000-0000-000000001401')), true,
  'AC-WOS-008 the item is flagged over-allocated (90 allocated against a plan of 80)');
select is((select array_agg(quantity order by quantity) from public.work_order_section_material_plan where work_order_id = '25760000-0000-0000-0000-000000001401'),
  array[30.000, 60.000]::numeric[], 'AC-WOS-008 and no allocation was rewritten');
select throws_ok($$ update public.work_order_section_material_plan set quantity = 61 where section_id = (select v from t_ids where k = 'A') $$,
  '23514', 'WOS_ALLOCATION_CAP: the allocations would be 91.000 against a work-order plan of 80.000', 'a further rise is refused against the lower plan');
select lives_ok($$ update public.work_order_section_material_plan set quantity = 20 where section_id = (select v from t_ids where k = 'A') $$, 'lowering an allocation is always allowed');
select lives_ok($$ delete from public.work_order_section_material_plan where section_id = (select v from t_ids where k = 'B') $$, 'and so is removing one');
select is((select count(*)::int from public.audit_events where action like 'work_order_section_material_plan.%'), 0,
  'audit rows are not readable by a Project Manager (audit_events is Admin-only)');

-- ── AC-WOS-016: another organisation ───────────────────────────────────────────────────────────────────────
select pg_temp.act_as('25760000-0000-0000-0000-0000000001b1');
select is((select count(*)::int from public.work_order_section_material_plan), 0, 'AC-WOS-016 another organisation reads no allocation');
select is((select count(*)::int from public.work_order_section_material_check('25760000-0000-0000-0000-000000001401')), 0, 'AC-WOS-016 nor the material check');
select is((select count(*)::int from public.mrq_section_plan_for('25760000-0000-0000-0000-000000001401', (select v from t_ids where k = 'A'), array['25760000-0000-0000-0000-000000001311']::uuid[])), 0,
  'AC-WOS-016 nor the form figures');
reset role;
select is((select count(*)::int from information_schema.routine_privileges
            where routine_name in ('work_order_section_material_check', 'mrq_section_plan_for', 'mrq_section_plan_quantity', 'mrq_section_prior_quantity')
              and grantee in ('anon', 'PUBLIC')), 0, 'anon cannot execute any of the section material functions');
select is((select count(*)::int from information_schema.routine_privileges
            where routine_name in ('mrq_section_plan_quantity', 'mrq_section_prior_quantity', 'guard_material_request_section') and grantee = 'authenticated'), 0,
  'the internals are not client-callable');
select is((select count(*)::int from information_schema.role_table_grants
            where table_name = 'work_order_section_material_plan' and grantee = 'anon'), 0, 'anon holds no grant on the allocation table');

select * from finish();
rollback;
