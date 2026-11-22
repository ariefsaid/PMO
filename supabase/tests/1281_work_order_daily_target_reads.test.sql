-- 1281_work_order_daily_target_reads.test.sql — #2672 (docs/specs/work-order-daily-target.spec.md).
-- Migrations under test: 1281_work_order_daily_target_reads.sql and 1282_project_daily_target_rollup.sql.
-- AC-WDT-001 off: null · AC-WDT-005 per-day gap and month to date · AC-WDT-006 only validated, non-superseded reports are
-- actual; submitted ones are named apart (+ mutation b) · AC-WDT-007 run-rate projection, null with no elapsed working day ·
-- AC-WDT-009 a role that cannot see revenue is refused · AC-WDT-010 project totals per currency · AC-WDT-011 another
-- organisation is refused · AC-WDT-012 (data side) a target on a listed date is kept and counted.
begin;
create extension if not exists pgtap;
select * from no_plan();

insert into organizations (id, name) values
  ('26729000-0000-0000-0000-00000000000a', 'WDR Org'),
  ('26729000-0000-0000-0000-00000000000b', 'WDR Other Org');
-- this feature is on by default now (with a settings row); this file proves the off state, so setup clears it as an explicit step
delete from org_revenue_plan_settings where org_id in ('26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-00000000000b');
insert into auth.users (id, email) values
  ('26729000-0000-0000-0000-0000000000a1', 'wdr-admin@example.com'),
  ('26729000-0000-0000-0000-0000000000a2', 'wdr-fin@example.com'),
  ('26729000-0000-0000-0000-0000000000a4', 'wdr-eng@example.com'),
  ('26729000-0000-0000-0000-0000000000b1', 'wdr-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26729000-0000-0000-0000-0000000000a1', '26729000-0000-0000-0000-00000000000a', 'WDR Admin', 'wdr-admin@example.com', 'Admin', 'active'),
  ('26729000-0000-0000-0000-0000000000a2', '26729000-0000-0000-0000-00000000000a', 'WDR Fin',   'wdr-fin@example.com',   'Finance', 'active'),
  ('26729000-0000-0000-0000-0000000000a4', '26729000-0000-0000-0000-00000000000a', 'WDR Eng',   'wdr-eng@example.com',   'Engineer', 'active'),
  ('26729000-0000-0000-0000-0000000000b1', '26729000-0000-0000-0000-00000000000b', 'WDR XOrg',  'wdr-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('26729000-0000-0000-0000-0000000000d1', '26729000-0000-0000-0000-00000000000a', 'WDR Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency, start_date) values
  ('26729000-0000-0000-0000-000000000401', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-0000000000d1', 'WO-A', 'WDR WO A', 'Issued', 10000, 'exclusive', 0, 'IDR', null),
  ('26729000-0000-0000-0000-000000000402', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-0000000000d1', 'WO-B', 'WDR WO B (no target)', 'Issued', 10000, 'exclusive', 0, 'IDR', null),
  ('26729000-0000-0000-0000-000000000403', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-0000000000d1', 'WO-C', 'WDR WO C (starts late)', 'Issued', 10000, 'exclusive', 0, 'IDR', '2026-12-20');
-- A work order in another currency than its project cannot be written through the guard trigger; the read is defensive about it.
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('26729000-0000-0000-0000-000000000404', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-0000000000d1', 'WO-D', 'WDR WO D', 'Issued', 10000, 'exclusive', 0, 'USD');
-- Reports and lines are written with triggers off: this file proves the read, not the validation path (dsr_report.test.sql).
-- WO-A: validated 80 on 1 Dec; a superseded validated 40 on 2 Dec; a submitted 50 on 3 Dec.
-- WO-B: validated 200 on each of 1, 2, 3 Dec.
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at, submitted_at, superseded_at, version, supersedes_id, correction_reason) values
  ('26729000-0000-0000-0000-000000000801', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-0000000000d1', '26729000-0000-0000-0000-000000000401', '2026-12-01', 'validated', '26729000-0000-0000-0000-0000000000a4', '26729000-0000-0000-0000-0000000000a2', now(), now(), null, 1, null, null),
  ('26729000-0000-0000-0000-000000000802', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-0000000000d1', '26729000-0000-0000-0000-000000000401', '2026-12-02', 'validated', '26729000-0000-0000-0000-0000000000a4', '26729000-0000-0000-0000-0000000000a2', now(), now(), now(), 1, null, null),
  ('26729000-0000-0000-0000-000000000803', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-0000000000d1', '26729000-0000-0000-0000-000000000401', '2026-12-03', 'submitted', '26729000-0000-0000-0000-0000000000a4', null, null, now(), null, 1, null, null),
  ('26729000-0000-0000-0000-000000000811', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-0000000000d1', '26729000-0000-0000-0000-000000000402', '2026-12-01', 'validated', '26729000-0000-0000-0000-0000000000a4', '26729000-0000-0000-0000-0000000000a2', now(), now(), null, 1, null, null),
  ('26729000-0000-0000-0000-000000000812', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-0000000000d1', '26729000-0000-0000-0000-000000000402', '2026-12-02', 'validated', '26729000-0000-0000-0000-0000000000a4', '26729000-0000-0000-0000-0000000000a2', now(), now(), null, 1, null, null),
  ('26729000-0000-0000-0000-000000000813', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-0000000000d1', '26729000-0000-0000-0000-000000000402', '2026-12-03', 'validated', '26729000-0000-0000-0000-0000000000a4', '26729000-0000-0000-0000-0000000000a2', now(), now(), null, 1, null, null);
-- Each line carries its report's work order (NOT NULL on dsr_progress_lines since 1171).
insert into dsr_progress_lines (id, org_id, report_id, position, work_order_id, work_order_line_id, quantity, unit, frozen_rate, frozen_amount, frozen_at)
select v.id::uuid, v.org_id::uuid, v.report_id::uuid, v.position, d.work_order_id, v.wo_line::uuid, v.quantity, v.unit, v.frozen_rate, v.frozen_amount, v.frozen_at
  from (values
    ('26729000-0000-0000-0000-000000000901', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-000000000801', 1, gen_random_uuid(), 8, 'm', 10, 80.00, now()),
    ('26729000-0000-0000-0000-000000000902', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-000000000802', 1, gen_random_uuid(), 4, 'm', 10, 40.00, now()),
    ('26729000-0000-0000-0000-000000000903', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-000000000803', 1, gen_random_uuid(), 5, 'm', null, null, null),
    ('26729000-0000-0000-0000-000000000911', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-000000000811', 1, gen_random_uuid(), 20, 'm', 10, 200.00, now()),
    ('26729000-0000-0000-0000-000000000912', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-000000000812', 1, gen_random_uuid(), 20, 'm', 10, 200.00, now()),
    ('26729000-0000-0000-0000-000000000913', '26729000-0000-0000-0000-00000000000a', '26729000-0000-0000-0000-000000000813', 1, gen_random_uuid(), 20, 'm', 10, 200.00, now())
  ) as v(id, org_id, report_id, position, wo_line, quantity, unit, frozen_rate, frozen_amount, frozen_at)
  join daily_site_reports d on d.id = v.report_id::uuid;
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- ── AC-WDT-001: off => null ───────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('26729000-0000-0000-0000-0000000000a2');
select is(public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02'), null::jsonb, 'AC-WDT-001 the work-order read returns null while the plan is off');
select is(public.project_daily_target_vs_actual('26729000-0000-0000-0000-0000000000d1', '2026-12-02'), null::jsonb, 'AC-WDT-001 the project read returns null while the plan is off');

select pg_temp.act_as('26729000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.set_revenue_plan_settings(true, '{1,2,3,4,5}') $$, 'Admin switches the plan on');
select lives_ok($$ select public.non_working_date_add('2026-12-25', 'Holiday') $$, 'Admin lists 25 Dec');
select pg_temp.act_as('26729000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.wo_revenue_plan_set_day('26729000-0000-0000-0000-000000000401', '2026-12-01', 100);
                   select public.wo_revenue_plan_set_day('26729000-0000-0000-0000-000000000401', '2026-12-02', 100);
                   select public.wo_revenue_plan_set_day('26729000-0000-0000-0000-000000000401', '2026-12-25', 30);
                   select public.wo_revenue_plan_set_day('26729000-0000-0000-0000-000000000404', '2026-12-02', 50) $$, 'Finance enters the target fixtures');

-- ── AC-WDT-005: per day gap, month to date ────────────────────────────────────────────────────────────
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->>'mtd_target')::numeric, 200.00::numeric, 'AC-WDT-005 month-to-date target is 100 + 100');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->>'mtd_actual')::numeric, 80.00::numeric, 'AC-WDT-005 month-to-date actual is the validated 80 (the superseded 40 is not counted)');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->>'mtd_gap')::numeric, -120.00::numeric, 'AC-WDT-005 month-to-date gap is -120');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->'days'->0->>'gap')::numeric, -20.00::numeric, 'AC-WDT-005 day 1 gap is -20');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->'days'->1->>'actual')::numeric, 0.00::numeric, 'AC-WDT-005 day 2 actual is 0');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->'days'->1->>'gap')::numeric, -100.00::numeric, 'AC-WDT-005 day 2 gap is -100');
select is(jsonb_array_length(public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->'days'), 31, 'the day view has one entry per calendar day of the month');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->>'month_target')::numeric, 230.00::numeric, 'the full month target covers later dates');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->>'month')::date, date '2026-12-01', 'the month is the as-of date''s month');
select is(public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->>'currency', 'IDR', 'the currency is returned');
-- A day with no target says so (not a zero gap).
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->'days'->2->>'has_target')::boolean, false, 'a day with no target is flagged as such');
-- A work order with no target in the month.
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000402', '2026-12-03')->>'has_target')::boolean, false, 'a work order with no target this month says so');

-- ── AC-WDT-006: submitted and superseded reports are not actual ───────────────────────────────────────
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-03')->'days'->2->>'pending_reports')::integer, 1, 'AC-WDT-006 the submitted report is named apart: 1 not yet validated');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-03')->'days'->2->>'actual')::numeric, 0.00::numeric, 'AC-WDT-006 the submitted report is not counted as actual');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-03')->>'mtd_actual')::numeric, 80.00::numeric, 'AC-WDT-006 month-to-date actual still excludes the submitted and the superseded reports');

-- ── AC-WDT-007: run-rate projection ───────────────────────────────────────────────────────────────────
-- WO-B: 600 actual after 3 elapsed working days (1-3 Dec); 23 weekdays in Dec 2026, 22 with 25 Dec listed, so 19 are left.
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000402', '2026-12-03')->>'elapsed_working_days')::integer, 3, 'AC-WDT-007 three elapsed working days');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000402', '2026-12-03')->>'remaining_working_days')::integer, 19, 'AC-WDT-007 19 working days left (25 Dec is not one)');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000402', '2026-12-03')->>'projection')::numeric, 4400.00::numeric, 'AC-WDT-007 projection = 600 + 200 x 19 = 4400.00');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-03')->>'projected_gap')::numeric,
  ((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-03')->>'projection')::numeric - 230.00), 'the projected gap is the projection less the month target');
-- No elapsed working day => null, never 0 (WO-C starts 20 Dec, asked on 10 Dec).
select is(public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000403', '2026-12-10')->>'projection', null, 'AC-WDT-007 with no elapsed working day the projection is null');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000403', '2026-12-10')->>'elapsed_working_days')::integer, 0, 'and the elapsed working days are 0');

-- ── AC-WDT-012 (data side): a target on a listed date is kept, counted and marked ─────────────────────
select is((select (x->>'is_listed')::boolean from jsonb_array_elements(public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->'days') x where x->>'date' = '2026-12-25'), true, 'AC-WDT-012 25 Dec is marked as a listed date');
select is((select x->>'non_working_label' from jsonb_array_elements(public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->'days') x where x->>'date' = '2026-12-25'), 'Holiday', 'AC-WDT-012 with its label');
select is((select (x->>'working')::boolean from jsonb_array_elements(public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->'days') x where x->>'date' = '2026-12-25'), false, 'AC-WDT-012 and not a working day');
select is((select (x->>'target')::numeric from jsonb_array_elements(public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02')->'days') x where x->>'date' = '2026-12-25'), 30.00::numeric, 'AC-WDT-012 its target of 30.00 is still there (and in the month target of 230.00)');

-- ── AC-WDT-010: project roll-up, per currency, never blended ──────────────────────────────────────────
select is(jsonb_array_length(public.project_daily_target_vs_actual('26729000-0000-0000-0000-0000000000d1', '2026-12-03')->'rows'), 4, 'the project read lists every issued work order');
select is(jsonb_array_length(public.project_daily_target_vs_actual('26729000-0000-0000-0000-0000000000d1', '2026-12-03')->'totals'), 2, 'AC-WDT-010 one total per currency, never blended');
select is((select (x->>'mtd_target')::numeric from jsonb_array_elements(public.project_daily_target_vs_actual('26729000-0000-0000-0000-0000000000d1', '2026-12-03')->'totals') x where x->>'currency' = 'IDR'),
  200.00::numeric, 'AC-WDT-010 the IDR total covers the work order with a target only');
select is((select (x->>'mtd_target')::numeric from jsonb_array_elements(public.project_daily_target_vs_actual('26729000-0000-0000-0000-0000000000d1', '2026-12-03')->'totals') x where x->>'currency' = 'USD'),
  50.00::numeric, 'AC-WDT-010 the USD total is separate');
select is((select (x->>'mtd_actual')::numeric from jsonb_array_elements(public.project_daily_target_vs_actual('26729000-0000-0000-0000-0000000000d1', '2026-12-03')->'rows') x where x->>'wo_number' = 'WO-B'),
  600.00::numeric, 'the roll-up row carries the work order''s month-to-date actual');

-- ── AC-WDT-009 / AC-WDT-011: who may read ─────────────────────────────────────────────────────────────
select pg_temp.act_as('26729000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02') $$,
  '42501', 'WDT_ROLE: you cannot see revenue on this project', 'AC-WDT-009 an Engineer is refused, not given a zero');
select throws_ok($$ select public.project_daily_target_vs_actual('26729000-0000-0000-0000-0000000000d1', '2026-12-02') $$,
  '42501', 'WDT_ROLE: you cannot see revenue on this project', 'AC-WDT-009 the project read refuses an Engineer too');
select pg_temp.act_as('26729000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-02') $$,
  'P0002', 'work order not found', 'AC-WDT-011 another organisation cannot read');
select throws_ok($$ select public.project_daily_target_vs_actual('26729000-0000-0000-0000-0000000000d1', '2026-12-02') $$,
  'P0002', 'project not found', 'AC-WDT-011 nor the project roll-up');
reset role;

-- ── Mutation (b): drop the superseded-report filter in the actual => the superseded 40 counts (80 + 40 = 120) ──
do $$
declare original text; mutant text;
begin
  select pg_get_functiondef('public.wdt_month_summary(uuid,date)'::regprocedure) into original;
  mutant := replace(original, 'and d.superseded_at is null and', 'and');
  if mutant = original then raise exception 'mutation (b) did not apply'; end if;
  execute mutant;
end $$;
set local role authenticated;
select pg_temp.act_as('26729000-0000-0000-0000-0000000000a2');
select is((public.wo_daily_target_vs_actual('26729000-0000-0000-0000-000000000401', '2026-12-03')->>'mtd_actual')::numeric, 120.00::numeric,
  'AC-WDT-006 mutation (b): month-to-date actual becomes 120.00 when the superseded filter is removed (the 80.00 proof above guards it)');
reset role;

select * from finish();
rollback;
