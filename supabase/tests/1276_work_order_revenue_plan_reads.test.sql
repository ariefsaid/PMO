-- 1276_work_order_revenue_plan_reads.test.sql — #2671 (docs/specs/work-order-revenue-plan.spec.md).
-- Migration under test: 1277_work_order_revenue_plan_reads.sql.
-- AC-WRP-001 off: the reads return null · AC-WRP-007 only validated, non-superseded reports are actual; submitted ones are
-- named apart (+ mutation check) · AC-WRP-008 gap = actual - plan to date · AC-WRP-009 a role that cannot see revenue is
-- refused · AC-WRP-010 project totals are per currency, never blended · AC-WRP-012 another organisation is refused.
begin;
create extension if not exists pgtap;
select plan(27);

insert into organizations (id, name) values
  ('26720000-0000-0000-0000-00000000000a', 'WRR Org'),
  ('26720000-0000-0000-0000-00000000000b', 'WRR Other Org');
insert into auth.users (id, email) values
  ('26720000-0000-0000-0000-0000000000a1', 'wrr-admin@example.com'),
  ('26720000-0000-0000-0000-0000000000a2', 'wrr-fin@example.com'),
  ('26720000-0000-0000-0000-0000000000a4', 'wrr-eng@example.com'),
  ('26720000-0000-0000-0000-0000000000b1', 'wrr-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26720000-0000-0000-0000-0000000000a1', '26720000-0000-0000-0000-00000000000a', 'WRR Admin', 'wrr-admin@example.com', 'Admin', 'active'),
  ('26720000-0000-0000-0000-0000000000a2', '26720000-0000-0000-0000-00000000000a', 'WRR Fin',   'wrr-fin@example.com',   'Finance', 'active'),
  ('26720000-0000-0000-0000-0000000000a4', '26720000-0000-0000-0000-00000000000a', 'WRR Eng',   'wrr-eng@example.com',   'Engineer', 'active'),
  ('26720000-0000-0000-0000-0000000000b1', '26720000-0000-0000-0000-00000000000b', 'WRR XOrg',  'wrr-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, currency) values
  ('26720000-0000-0000-0000-0000000000d1', '26720000-0000-0000-0000-00000000000a', 'WRR Site',  'Ongoing Project', 'IDR'),
  ('26720000-0000-0000-0000-0000000000d9', '26720000-0000-0000-0000-00000000000b', 'WRR Other', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('26720000-0000-0000-0000-000000000401', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-0000000000d1', 'WO-A', 'WRR WO A', 'Issued', 10000, 'exclusive', 0, 'IDR'),
  ('26720000-0000-0000-0000-000000000406', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-0000000000d1', 'WO-N', 'WRR WO no plan', 'Issued', 10000, 'exclusive', 0, 'IDR');

-- A work order in another currency than its project cannot be written through the guard trigger; the read is defensive about it.
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('26720000-0000-0000-0000-000000000402', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-0000000000d1', 'WO-B', 'WRR WO B', 'Issued', 10000, 'exclusive', 0, 'USD');
set local session_replication_role = origin;
-- Reports and lines are written with triggers off: this file proves the read, not the validation path (dsr_report.test.sql).
set local session_replication_role = replica;
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at, submitted_at, superseded_at, version, supersedes_id, correction_reason) values
  ('26720000-0000-0000-0000-000000000801', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-0000000000d1', '26720000-0000-0000-0000-000000000401', '2026-12-02', 'validated', '26720000-0000-0000-0000-0000000000a4', '26720000-0000-0000-0000-0000000000a2', now(), now(), now(), 1, null, null),
  ('26720000-0000-0000-0000-000000000802', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-0000000000d1', '26720000-0000-0000-0000-000000000401', '2026-12-03', 'validated', '26720000-0000-0000-0000-0000000000a4', '26720000-0000-0000-0000-0000000000a2', now(), now(), null, 1, null, null),
  ('26720000-0000-0000-0000-000000000803', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-0000000000d1', '26720000-0000-0000-0000-000000000401', '2026-12-04', 'submitted', '26720000-0000-0000-0000-0000000000a4', null, null, now(), null, 1, null, null),
  ('26720000-0000-0000-0000-000000000804', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-0000000000d1', '26720000-0000-0000-0000-000000000401', '2026-12-02', 'validated', '26720000-0000-0000-0000-0000000000a4', '26720000-0000-0000-0000-0000000000a2', now(), now(), null, 2, '26720000-0000-0000-0000-000000000801', 'rate corrected'),
  ('26720000-0000-0000-0000-000000000805', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-0000000000d1', '26720000-0000-0000-0000-000000000401', '2026-12-10', 'validated', '26720000-0000-0000-0000-0000000000a4', '26720000-0000-0000-0000-0000000000a2', now(), now(), null, 1, null, null),
  ('26720000-0000-0000-0000-000000000806', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-0000000000d1', '26720000-0000-0000-0000-000000000406', '2026-12-02', 'validated', '26720000-0000-0000-0000-0000000000a4', '26720000-0000-0000-0000-0000000000a2', now(), now(), null, 1, null, null);
insert into dsr_progress_lines (id, org_id, report_id, position, work_order_line_id, quantity, unit, frozen_rate, frozen_amount, frozen_at) values
  ('26720000-0000-0000-0000-000000000901', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-000000000804', 1, gen_random_uuid(), 10, 'm', 10, 100.10, now()),
  ('26720000-0000-0000-0000-000000000902', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-000000000804', 2, gen_random_uuid(), 1, 'm', 99.90, 99.90, now()),
  ('26720000-0000-0000-0000-000000000903', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-000000000802', 1, gen_random_uuid(), 10, 'm', 10, 100.00, now()),
  ('26720000-0000-0000-0000-000000000904', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-000000000803', 1, gen_random_uuid(), 10, 'm', null, null, null),
  ('26720000-0000-0000-0000-000000000905', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-000000000801', 1, gen_random_uuid(), 10, 'm', 10, 7777.00, now()),
  ('26720000-0000-0000-0000-000000000906', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-000000000805', 1, gen_random_uuid(), 10, 'm', 10, 50.00, now()),
  ('26720000-0000-0000-0000-000000000907', '26720000-0000-0000-0000-00000000000a', '26720000-0000-0000-0000-000000000806', 1, gen_random_uuid(), 10, 'm', 10, 40.00, now());
set local session_replication_role = origin;

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- ── AC-WRP-001: off => null ───────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.act_as('26720000-0000-0000-0000-0000000000a2');
select is(public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05'), null::jsonb, 'AC-WRP-001 the work-order read returns null while the plan is off');
select is(public.project_revenue_plan_vs_actual('26720000-0000-0000-0000-0000000000d1', '2026-12-05'), null::jsonb, 'AC-WRP-001 the project read returns null while the plan is off');

select pg_temp.act_as('26720000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.set_revenue_plan_settings(true, '{1,2,3,4,5}') $$, 'Admin switches the plan on');
select pg_temp.act_as('26720000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.wo_revenue_plan_set_day('26720000-0000-0000-0000-000000000401', '2026-12-02', 300);
                   select public.wo_revenue_plan_set_day('26720000-0000-0000-0000-000000000401', '2026-12-03', 300);
                   select public.wo_revenue_plan_set_day('26720000-0000-0000-0000-000000000401', '2026-12-04', 200);
                   select public.wo_revenue_plan_set_day('26720000-0000-0000-0000-000000000401', '2026-12-10', 400);
                   select public.wo_revenue_plan_set_day('26720000-0000-0000-0000-000000000402', '2026-12-02', 50) $$, 'Finance enters the plan fixtures');

-- ── AC-WRP-007 / AC-WRP-008: actual is validated, non-superseded revenue; gap = actual - plan ──────────
select is((public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05')->>'plan_to_date')::numeric, 800.00::numeric, 'plan to date adds the dates on or before the as-of date (300 + 300 + 200)');
select is((public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05')->>'actual_to_date')::numeric, 300.00::numeric,
  'AC-WRP-007 actual to date is the validated 100.10 + 99.90 + 100.00 (not the submitted, not the superseded 7777, not the later date)');
select is((public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05')->>'gap')::numeric, -500.00::numeric, 'AC-WRP-008 the gap is actual less plan: 500.00 behind');
select is((public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05')->>'pending_reports')::integer, 1, 'AC-WRP-007 the submitted report is named apart as not yet validated');
select is((public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05')->>'plan_total')::numeric, 1200.00::numeric, 'the full plan total covers later dates');
select is((public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-31')->>'actual_to_date')::numeric, 350.00::numeric, 'a later as-of date adds the later validated report');
select is(public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05')->>'currency', 'IDR', 'the work order''s currency is returned');
-- Series: cumulative from all history, agrees with the summary.
select is(jsonb_array_length(public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05', '2026-12-01', '2026-12-10')->'series'), 10, 'the series has one point per day of the range');
select is((public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05', '2026-12-04', '2026-12-05')->'series'->1->>'cum_plan')::numeric, 800.00::numeric,
  'a narrowed window still carries the cumulative plan from earlier history');
select is((public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05', '2026-12-04', '2026-12-05')->'series'->1->>'cum_actual')::numeric, 300.00::numeric,
  'and the cumulative actual');
select throws_ok($$ select public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05', '2020-01-01', '2026-12-05') $$,
  '22023', 'WRP_RANGE: choose a range of at most two years', 'a range over two years is refused');

-- A work order with no plan (FR-WRP-014).
select is((public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000406', '2026-12-05')->>'has_plan')::boolean, false, 'a work order with no plan says so');
select is((public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000406', '2026-12-05')->>'actual_to_date')::numeric, 40.00::numeric, 'its validated actual still counts');

-- ── AC-WRP-010: project roll-up, per currency, planned work orders only in the totals ─────────────────
select is(jsonb_array_length(public.project_revenue_plan_vs_actual('26720000-0000-0000-0000-0000000000d1', '2026-12-05')->'rows'), 3, 'the project read lists every issued work order');
select is(jsonb_array_length(public.project_revenue_plan_vs_actual('26720000-0000-0000-0000-0000000000d1', '2026-12-05')->'totals'), 2, 'AC-WRP-010 one total per currency, never blended');
select is((select (x->>'gap')::numeric from jsonb_array_elements(public.project_revenue_plan_vs_actual('26720000-0000-0000-0000-0000000000d1', '2026-12-05')->'totals') x where x->>'currency' = 'IDR'),
  -500.00::numeric, 'AC-WRP-010 the IDR total covers the planned work order only (the plan-less one is not in the gap)');
select is((select (x->>'gap')::numeric from jsonb_array_elements(public.project_revenue_plan_vs_actual('26720000-0000-0000-0000-0000000000d1', '2026-12-05')->'totals') x where x->>'currency' = 'USD'),
  -50.00::numeric, 'AC-WRP-010 the USD total is separate');

-- ── AC-WRP-009 / AC-WRP-012: who may read ─────────────────────────────────────────────────────────────
select pg_temp.act_as('26720000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05') $$,
  '42501', 'WRP_ROLE: you cannot see revenue on this project', 'AC-WRP-009 an Engineer is refused, not given a zero');
select throws_ok($$ select public.project_revenue_plan_vs_actual('26720000-0000-0000-0000-0000000000d1', '2026-12-05') $$,
  '42501', 'WRP_ROLE: you cannot see revenue on this project', 'AC-WRP-009 the project read refuses an Engineer too');
select pg_temp.act_as('26720000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05') $$,
  'P0002', 'work order not found', 'AC-WRP-012 another organisation cannot read');
select throws_ok($$ select public.project_revenue_plan_vs_actual('26720000-0000-0000-0000-0000000000d1', '2026-12-05') $$,
  'P0002', 'project not found', 'AC-WRP-012 nor the project');
reset role;
select is((select count(*) from information_schema.routine_privileges where grantee in ('anon', 'authenticated') and routine_name = 'wrp_figures'), 0::bigint, 'the internal figures function is granted to no client role');

-- ── Mutation check (rolled back with this test): let submitted reports count as actual ────────────────
do $$
declare original text; mutant text;
begin
  select pg_get_functiondef('public.wrp_figures(uuid,date)'::regprocedure) into original;
  mutant := replace(original, $q$d.status = 'validated' and d.superseded_at is null and d.archived_at is null
                 and d.work_date <= p_as_of$q$, $q$d.status in ('validated', 'submitted') and d.superseded_at is null and d.archived_at is null
                 and d.work_date <= p_as_of$q$);
  if mutant = original then raise exception 'actual mutation did not apply'; end if;
  execute mutant;
end $$;
-- The submitted report's line gets an amount so the mutant is visible.
set local session_replication_role = replica;
update dsr_progress_lines set frozen_amount = 25.00 where id = '26720000-0000-0000-0000-000000000904';
set local session_replication_role = origin;
set local role authenticated;
select pg_temp.act_as('26720000-0000-0000-0000-0000000000a2');
select is((public.wo_revenue_plan_vs_actual('26720000-0000-0000-0000-000000000401', '2026-12-05')->>'actual_to_date')::numeric, 325.00::numeric,
  'AC-WRP-007 mutation: counting submitted reports as actual changes the figure (so the real test binds to the rule)');
reset role;

select * from finish();
rollback;
