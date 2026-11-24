-- cus_plan.test.sql — #2577 consumable usage standards and #1124d approval routing (migrations 1155, 2261).
-- Spec docs/specs/consumable-usage-standards.spec.md. AC-CUS-001 hand-worked generation · AC-CUS-003 longest prefix wins ·
-- AC-CUS-004 closed refused · AC-CUS-005 regeneration keeps adjustments · AC-CUS-006 out of date · AC-CUS-007 reason and actor ·
-- AC-CUS-011 who may plan · AC-CUS-012 other organisation · AC-CUS-014 added line item rules · FR-CUS-010 "no standard".
-- Mutation checks: remove `plan_approve_author` and the author's denial below must fail; remove `approved_plan_first` and the
-- unapproved/stale plan source assertions below must fail.
begin;
create extension if not exists pgtap;
select plan(59);

insert into organizations (id, name, built_in_roles_enabled) values
  ('25770000-0000-0000-0000-00000000020a', 'CUSP Org A', true),
  ('25770000-0000-0000-0000-00000000020b', 'CUSP Org B');
insert into auth.users (id, email) values
  ('25770000-0000-0000-0000-0000000002a1', 'cusp-admin@example.com'),
  ('25770000-0000-0000-0000-0000000002a2', 'cusp-eng@example.com'),
  ('25770000-0000-0000-0000-0000000002a3', 'cusp-pm1@example.com'),
  ('25770000-0000-0000-0000-0000000002a4', 'cusp-pm2@example.com'),
  ('25770000-0000-0000-0000-0000000002a5', 'cusp-fin@example.com'),
  ('25770000-0000-0000-0000-0000000002a6', 'cusp-exec@example.com'),
  ('25770000-0000-0000-0000-0000000002b1', 'cusp-badmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('25770000-0000-0000-0000-0000000002a1', '25770000-0000-0000-0000-00000000020a', 'CUSP Admin', 'cusp-admin@example.com', 'Admin', 'active', null),
  ('25770000-0000-0000-0000-0000000002a2', '25770000-0000-0000-0000-00000000020a', 'CUSP Eng',   'cusp-eng@example.com',   'Engineer', 'active', 'engineer'),
  ('25770000-0000-0000-0000-0000000002a3', '25770000-0000-0000-0000-00000000020a', 'CUSP PCM',   'cusp-pm1@example.com',   'Project Manager', 'active', 'project_control_manager'),
  ('25770000-0000-0000-0000-0000000002a4', '25770000-0000-0000-0000-00000000020a', 'CUSP PM2',   'cusp-pm2@example.com',   'Project Manager', 'active', null),
  ('25770000-0000-0000-0000-0000000002a5', '25770000-0000-0000-0000-00000000020a', 'CUSP Fin',   'cusp-fin@example.com',   'Finance', 'active', null),
  ('25770000-0000-0000-0000-0000000002a6', '25770000-0000-0000-0000-00000000020a', 'CUSP Exec',  'cusp-exec@example.com',  'Executive', 'active', null),
  ('25770000-0000-0000-0000-0000000002b1', '25770000-0000-0000-0000-00000000020b', 'CUSP BAdmin', 'cusp-badmin@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, project_manager_id) values
  ('25770000-0000-0000-0000-0000000002d1', '25770000-0000-0000-0000-00000000020a', 'CUSP Site 1', 'Ongoing Project', '25770000-0000-0000-0000-0000000002a3'),
  ('25770000-0000-0000-0000-0000000002d2', '25770000-0000-0000-0000-00000000020a', 'CUSP Site 2', 'Ongoing Project', '25770000-0000-0000-0000-0000000002a4');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-0000000002d1', 'CUSP WO1', 'Issued', 10000, 'exclusive', 0),
  ('25770000-0000-0000-0000-000000002402', '25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-0000000002d1', 'CUSP WO2', 'Draft',  10000, 'exclusive', 0),
  ('25770000-0000-0000-0000-000000002403', '25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-0000000002d1', 'CUSP WO3', 'Draft',  10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25770000-0000-0000-0000-000000002201', '25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-0000000002d1', 'WLD-01', 'Weld A',    'dia-inch', 200, 10),
  ('25770000-0000-0000-0000-000000002202', '25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-0000000002d1', 'WLD-02', 'Weld B',    'Dia-Inch ', 200, 10),
  ('25770000-0000-0000-0000-000000002203', '25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-0000000002d1', 'CIV-01', 'Concrete',  'm3', 100, 10),
  ('25770000-0000-0000-0000-000000002204', '25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-0000000002d1', 'WLD-01-B', 'Weld C',  'dia-inch', 50, 10);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002201', 120),
  ('25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002202', 40),
  ('25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002203', 10),
  ('25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-000000002402', '25770000-0000-0000-0000-000000002204', 10),
  ('25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-000000002403', '25770000-0000-0000-0000-000000002201', 5);
update work_orders set status = 'Closed' where id = '25770000-0000-0000-0000-000000002403';
insert into stock_units (id, org_id, code, name) values
  ('25770000-0000-0000-0000-000000002301', '25770000-0000-0000-0000-00000000020a', 'KG', 'Kilogram'),
  ('25770000-0000-0000-0000-000000002302', '25770000-0000-0000-0000-00000000020a', 'PC', 'Piece'),
  ('25770000-0000-0000-0000-000000002303', '25770000-0000-0000-0000-00000000020b', 'KG', 'Kilogram');
insert into stock_items (id, org_id, code, name, unit_id, archived_at) values
  ('25770000-0000-0000-0000-000000002311', '25770000-0000-0000-0000-00000000020a', 'ROD',  'Welding rod',  '25770000-0000-0000-0000-000000002301', null),
  ('25770000-0000-0000-0000-000000002312', '25770000-0000-0000-0000-00000000020a', 'DISC', 'Grinding disc', '25770000-0000-0000-0000-000000002302', null),
  ('25770000-0000-0000-0000-000000002313', '25770000-0000-0000-0000-00000000020a', 'GAS',  'Gas',           '25770000-0000-0000-0000-000000002301', null),
  ('25770000-0000-0000-0000-000000002314', '25770000-0000-0000-0000-00000000020a', 'OLD',  'Retired',       '25770000-0000-0000-0000-000000002301', now()),
  ('25770000-0000-0000-0000-000000002315', '25770000-0000-0000-0000-00000000020b', 'BROD', 'Org B rod',     '25770000-0000-0000-0000-000000002303', null);
-- the hand-worked standards: rod 0.05 kg per dia-inch, margin 10%, prefix WLD; disc 0.2 pc per dia-inch, no prefix, no margin
insert into consumable_usage_standards (id, org_id, item_id, work_unit, boq_code_prefix, qty_per_unit, margin_pct) values
  ('25770000-0000-0000-0000-000000002501', '25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-000000002311', 'dia-inch', 'WLD', 0.05, 10),
  ('25770000-0000-0000-0000-000000002502', '25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-000000002312', 'dia-inch', null, 0.2, 0);

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- one line of the plan as 'generated/adjusted/planned/source'
create or replace function pg_temp._ln(p_wo uuid, p_code text) returns text language sql as $$
  select (l->>'generated_qty') || '/' || coalesce(l->>'adjusted_qty', '-') || '/' || (l->>'planned_qty') || '/' || (l->>'source')
    from jsonb_array_elements(public.cus_get_plan(p_wo)->'lines') l where l->>'item_code' = p_code $$;
grant execute on function pg_temp._ln(uuid, text) to authenticated;

set local role authenticated;

-- ── AC-CUS-011: who may generate ───────────────────────────────────────────────────────────────────────────────
select pg_temp._as('25770000-0000-0000-0000-0000000002a2');
select is(public.cus_generate_plan('25770000-0000-0000-0000-000000002401'), 2,
  'AC-CUS-011 an Engineer can generate a plan');
select pg_temp._as('25770000-0000-0000-0000-0000000002a4');
select throws_ok($$ select public.cus_generate_plan('25770000-0000-0000-0000-000000002401') $$, '42501', null,
  'AC-CUS-011 a Project Manager of a different project cannot generate a plan');
select is((select count(*)::int from work_order_consumable_plan_lines), 2, 'AC-CUS-011 the Engineer plan is stored');

-- ── AC-CUS-001: the hand-worked work order ─────────────────────────────────────────────────────────────────────
select pg_temp._as('25770000-0000-0000-0000-0000000002a3');
select is(public.cus_generate_plan('25770000-0000-0000-0000-000000002401'), 2, 'AC-CUS-011 the project''s own Project Manager generates; two items planned');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002401', 'ROD'), '8.800/-/8.800/standard', 'AC-CUS-001 rod = (120 + 40) x 0.05 x 1.10 = 8.800');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002401', 'DISC'), '32.000/-/32.000/standard',
  'AC-CUS-001 disc = 160 x 0.2 = 32.000 (the unit is matched trimmed and case-blind, no prefix needed)');
select is((select jsonb_array_length(l->'basis') from jsonb_array_elements(public.cus_get_plan('25770000-0000-0000-0000-000000002401')->'lines') l where l->>'item_code' = 'ROD'),
  2, 'AC-CUS-001 the rod basis names the two contributing lines');
select is((select sum((b->>'work_qty')::numeric) from jsonb_array_elements(public.cus_get_plan('25770000-0000-0000-0000-000000002401')->'lines') l,
                  jsonb_array_elements(l->'basis') b where l->>'item_code' = 'ROD'),
  160::numeric, 'AC-CUS-001 the basis rows sum to the line quantities');
select is((select jsonb_agg(n->>'item_code') from jsonb_array_elements(public.cus_get_plan('25770000-0000-0000-0000-000000002401')->'no_standard') n),
  '["CIV-01"]'::jsonb, 'FR-CUS-010 the contract line no standard covers is listed');
select is((public.cus_get_plan('25770000-0000-0000-0000-000000002401')->>'out_of_date')::boolean, false, 'AC-CUS-006 a fresh plan is not out of date');
-- FR-CUS-004: how many lines in live work orders each standard's rule matches (WO1 two lines, WO2 one; the Closed WO3 is not counted)
select is((select match_lines from public.cus_standard_match_counts() where standard_id = '25770000-0000-0000-0000-000000002501'), 3,
  'FR-CUS-004 the WLD rod standard matches three lines in live work orders (the Closed one is left out)');
select is((select match_lines from public.cus_standard_match_counts() where standard_id = '25770000-0000-0000-0000-000000002502'), 3,
  'FR-CUS-004 the prefix-free disc standard matches the same three lines, never the m3 line');
select throws_ok($$ insert into work_order_consumable_plan_lines (work_order_id, item_id, generated_qty)
    values ('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002313', 1) $$, '42501', null,
  'FR-CUS-016 plan lines have no direct client write');

-- ── AC-CUS-011: the other roles that may plan ──────────────────────────────────────────────────────────────────
select pg_temp._as('25770000-0000-0000-0000-0000000002a5');
select lives_ok($$ select public.cus_generate_plan('25770000-0000-0000-0000-000000002401') $$, 'AC-CUS-011 Finance may generate on any project');
select pg_temp._as('25770000-0000-0000-0000-0000000002a6');
select lives_ok($$ select public.cus_generate_plan('25770000-0000-0000-0000-000000002401') $$, 'AC-CUS-011 an Executive may generate');
select pg_temp._as('25770000-0000-0000-0000-0000000002a1');
select lives_ok($$ select public.cus_generate_plan('25770000-0000-0000-0000-000000002401') $$, 'AC-CUS-011 an Admin may generate');
select pg_temp._as('25770000-0000-0000-0000-0000000002a2');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002401', 'ROD'), '8.800/-/8.800/standard', 'AC-CUS-011 a same-organisation Engineer can read the plan');
select lives_ok($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002312', 33, 'engineering update') $$,
  'AC-CUS-011 an Engineer can edit a plan line');
select lives_ok($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002312', null, null) $$,
  'AC-CUS-011 an Engineer can revert a plan edit');

-- ── AC-CUS-004: a closed work order ────────────────────────────────────────────────────────────────────────────
select pg_temp._as('25770000-0000-0000-0000-0000000002a1');
select throws_like($$ select public.cus_generate_plan('25770000-0000-0000-0000-000000002403') $$, 'CUS_WORK_ORDER:%',
  'AC-CUS-004 a Closed work order cannot be planned');

-- ── AC-CUS-007: an adjustment needs a reason and records who and when ──────────────────────────────────────────
select pg_temp._as('25770000-0000-0000-0000-0000000002a3');
select throws_ok($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002311', 12, null) $$,
  '23514', null, 'AC-CUS-007 an adjustment without a reason is refused');
select throws_ok($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002311', 12, '   ') $$,
  '23514', null, 'AC-CUS-007 a blank reason is refused');
select throws_ok($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002311', -1, 'negative') $$,
  '23514', null, 'FR-CUS-009 a negative adjusted quantity is refused');
select lives_ok($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002311', 12, 'extra pipe spools') $$,
  'AC-CUS-007 with a reason the adjustment is accepted');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002401', 'ROD'), '8.800/12.000/12.000/adjusted',
  'AC-CUS-007 the adjusted figure is the plan, the generated one is kept beside it');
select is((select qty_per_unit::text || '/' || margin_pct::text from consumable_usage_standards where id = '25770000-0000-0000-0000-000000002501'),
  '0.050000/10.00', 'AC-CUS-007 the standard is unchanged by an adjustment');
select ok((select adjusted_by = '25770000-0000-0000-0000-0000000002a3' and adjusted_at is not null and adjust_reason = 'extra pipe spools'
             from work_order_consumable_plan_lines where work_order_id = '25770000-0000-0000-0000-000000002401'
              and item_id = '25770000-0000-0000-0000-000000002311'), 'AC-CUS-007 the row records the actor, the time and the reason');

-- ── FR-CUS-009 / AC-CUS-014: a line added for an item no standard covers ───────────────────────────────────────
select throws_ok($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002313', 5, null) $$,
  '23514', null, 'AC-CUS-007 an added line without a reason is refused');
select throws_like($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002314', 5, 'archived') $$,
  'CUS_ITEM:%', 'AC-CUS-014 an archived item cannot be added to a plan');
select throws_like($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002315', 5, 'foreign') $$,
  'CUS_ITEM:%', 'AC-CUS-014 another organisation''s item cannot be added to a plan');
select lives_ok($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002313', 5, 'site gas, no standard yet') $$,
  'FR-CUS-009 an item no standard covers is added with its reason');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002401', 'GAS'), '0.000/5.000/5.000/adjusted', 'FR-CUS-009 an added line has generated 0 and its adjusted quantity');

-- ── AC-CUS-006: out of date, from the inputs, not a clock ──────────────────────────────────────────────────────
reset role;
update work_order_lines set quantity = 50 where work_order_id = '25770000-0000-0000-0000-000000002401' and boq_item_id = '25770000-0000-0000-0000-000000002202';
set local role authenticated;
select pg_temp._as('25770000-0000-0000-0000-0000000002a2');
select is((public.cus_get_plan('25770000-0000-0000-0000-000000002401')->>'out_of_date')::boolean, true,
  'AC-CUS-006 a changed work-order line quantity makes the plan out of date');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002401', 'ROD'), '8.800/12.000/12.000/adjusted', 'AC-CUS-006 and the stored plan is not silently regenerated');

-- ── AC-CUS-005: regeneration keeps the adjustment; an unadjusted row with no standard left is removed ───────────
select pg_temp._as('25770000-0000-0000-0000-0000000002a3');
reset role;
update consumable_usage_standards set archived_at = now() where id = '25770000-0000-0000-0000-000000002502';
set local role authenticated;
select pg_temp._as('25770000-0000-0000-0000-0000000002a3');
select is((public.cus_get_plan('25770000-0000-0000-0000-000000002401')->>'out_of_date')::boolean, true, 'AC-CUS-006 archiving a matching standard makes the plan out of date');
select lives_ok($$ select public.cus_generate_plan('25770000-0000-0000-0000-000000002401') $$, 'AC-CUS-005 regenerate');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002401', 'ROD'), '9.350/12.000/12.000/adjusted',
  'AC-CUS-005 generated_qty follows the new quantity (170 x 0.05 x 1.10 = 9.350); the adjustment and its reason are kept');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002401', 'DISC'), null, 'AC-CUS-005 an unadjusted row whose standard was archived is removed');
select is((public.cus_get_plan('25770000-0000-0000-0000-000000002401')->>'out_of_date')::boolean, false, 'AC-CUS-006 regeneration clears the flag');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002401', 'GAS'), '0.000/5.000/5.000/adjusted', 'AC-CUS-005 a hand-added line survives regeneration');

-- an adjusted row whose standard no longer matches keeps its row, generated 0
reset role;
update consumable_usage_standards set archived_at = now() where id = '25770000-0000-0000-0000-000000002501';
set local role authenticated;
select pg_temp._as('25770000-0000-0000-0000-0000000002a3');
select lives_ok($$ select public.cus_generate_plan('25770000-0000-0000-0000-000000002401') $$, 'AC-CUS-005 regenerate with no standard left');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002401', 'ROD'), '0.000/12.000/12.000/adjusted',
  'AC-CUS-005 an adjusted row whose standard no longer matches keeps its row (generated 0)');

-- reverting an adjustment
select lives_ok($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002313', null, null) $$,
  'FR-CUS-009 reverting a hand-added line removes it');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002401', 'GAS'), null, 'FR-CUS-009 the hand-added line is gone');

-- ── AC-CUS-003: the longest prefix wins ────────────────────────────────────────────────────────────────────────
reset role;
update consumable_usage_standards set archived_at = null where id = '25770000-0000-0000-0000-000000002501';
insert into consumable_usage_standards (org_id, item_id, work_unit, boq_code_prefix, qty_per_unit, margin_pct) values
  ('25770000-0000-0000-0000-00000000020a', '25770000-0000-0000-0000-000000002311', 'dia-inch', 'WLD-01', 0.1, 0);
set local role authenticated;
select pg_temp._as('25770000-0000-0000-0000-0000000002a2');
select lives_ok($$ select public.cus_generate_plan('25770000-0000-0000-0000-000000002402') $$, 'AC-CUS-003 generate for the work order with one WLD-01-B line');
select is(pg_temp._ln('25770000-0000-0000-0000-000000002402', 'ROD'), '1.000/-/1.000/standard',
  'AC-CUS-003 the longer prefix wins: 10 x 0.10 = 1.000, not 10 x 0.05 x 1.10');
select throws_ok($$ select public.cus_approve_plan('25770000-0000-0000-0000-000000002402') $$,
  '42501', 'CUS_SOD: the plan author cannot approve it', 'AC-PEO-003 the Engineer who created the plan cannot approve it');
reset role;
select is((select plan_source from public.mrq_plan_figure('25770000-0000-0000-0000-000000002402', '25770000-0000-0000-0000-000000002311')),
  'none', 'AC-PEO-003 material requests ignore a plan until it is approved');
set local role authenticated;
select pg_temp._as('25770000-0000-0000-0000-0000000002a3');
select lives_ok($$ select public.cus_approve_plan('25770000-0000-0000-0000-000000002402') $$,
  'AC-PEO-003 a PCM approves an Engineer-authored plan');
select is((public.cus_get_plan('25770000-0000-0000-0000-000000002402')->>'plan_approved')::boolean, true,
  'AC-PEO-003 the approved plan state is visible');
reset role;
select is((select plan_source from public.mrq_plan_figure('25770000-0000-0000-0000-000000002402', '25770000-0000-0000-0000-000000002311')),
  'standard', 'AC-PEO-003 material requests use the approved plan');
update work_order_lines set quantity = 11 where work_order_id = '25770000-0000-0000-0000-000000002402';
select is((select plan_source from public.mrq_plan_figure('25770000-0000-0000-0000-000000002402', '25770000-0000-0000-0000-000000002311')),
  'none', 'AC-PEO-003 material requests ignore a plan after its inputs change');
set local role authenticated;
select pg_temp._as('25770000-0000-0000-0000-0000000002a3');
select lives_ok($$ select public.cus_generate_plan('25770000-0000-0000-0000-000000002401') $$,
  'AC-PEO-003 the PCM author updates its plan');
select throws_ok($$ select public.cus_approve_plan('25770000-0000-0000-0000-000000002401') $$,
  '42501', 'CUS_SOD: the plan author cannot approve it', 'AC-PEO-003 a PCM cannot approve its own plan');
select pg_temp._as('25770000-0000-0000-0000-0000000002a1');
select lives_ok($$ select public.cus_approve_plan('25770000-0000-0000-0000-000000002401') $$,
  'AC-PEO-003 Admin may approve a PCM-authored plan');

-- ── AC-CUS-012: another organisation ───────────────────────────────────────────────────────────────────────────
select pg_temp._as('25770000-0000-0000-0000-0000000002b1');
select throws_like($$ select public.cus_generate_plan('25770000-0000-0000-0000-000000002401') $$, 'CUS_NOT_FOUND:%', 'AC-CUS-012 another organisation cannot generate');
select throws_like($$ select public.cus_get_plan('25770000-0000-0000-0000-000000002401') $$, 'CUS_NOT_FOUND:%', 'AC-CUS-012 another organisation cannot read a plan');
select throws_like($$ select public.cus_adjust_plan_line('25770000-0000-0000-0000-000000002401', '25770000-0000-0000-0000-000000002315', 5, 'x') $$,
  'CUS_NOT_FOUND:%', 'AC-CUS-012 another organisation cannot adjust a plan');
select is((select count(*)::int from work_order_consumable_plan_lines), 0, 'AC-CUS-012 another organisation reads no plan line');

-- ── index coverage ────────────────────────────────────────────────────────────
select has_index('public', 'work_order_consumable_plan_lines', 'work_order_consumable_plan_lines_adjusted_by_idx',
  array['adjusted_by'], 'work_order_consumable_plan_lines indexes adjusted_by');

select * from finish();
rollback;
