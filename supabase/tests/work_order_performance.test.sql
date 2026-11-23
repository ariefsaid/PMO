-- work_order_performance.test.sql — #2597 (docs/specs/work-order-performance-indices.spec.md).
-- Migration under test: 1286_work_order_performance.sql (setting columns: 1285).
-- AC-CSP-006 only live validated reports count · 007 as-of bound · 008 unrated line · 009 hand calculation and the
-- counted-cost rule · 010 other currency and role refusal · 011 Closed/Draft/Cancelled · 012 organisation-local date ·
-- 013 callers refused · 014 other organisation · 015 row bound · 017 undated cost · off by default.
begin;
create extension if not exists pgtap;
select plan(40);

-- ── fixtures (table owner). Org A is on Pacific/Kiritimati (UTC+14) so its local date differs from UTC. ─────────
insert into organizations (id, name, default_currency, default_timezone) values
  ('25970000-0000-0000-0000-00000000000a', 'CSP Org', 'IDR', 'Pacific/Kiritimati'),
  ('25970000-0000-0000-0000-00000000000b', 'CSP Other Org', 'IDR', 'UTC');
-- this switch is on by default now; this file proves the off state, so setup switches it off as an explicit step
update organizations set performance_indices_enabled = false where id in ('25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-00000000000b');
insert into auth.users (id, email) values
  ('25970000-0000-0000-0000-0000000000a1', 'csp-admin@example.com'), ('25970000-0000-0000-0000-0000000000a2', 'csp-fin@example.com'), ('25970000-0000-0000-0000-0000000000a3', 'csp-pm@example.com'),
  ('25970000-0000-0000-0000-0000000000a4', 'csp-eng@example.com'), ('25970000-0000-0000-0000-0000000000a5', 'csp-pm2@example.com'), ('25970000-0000-0000-0000-0000000000a6', 'csp-viewer@example.com'),
  ('25970000-0000-0000-0000-0000000000a7', 'csp-off@example.com'), ('25970000-0000-0000-0000-0000000000a8', 'csp-exec@example.com'), ('25970000-0000-0000-0000-0000000000b1', 'csp-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25970000-0000-0000-0000-0000000000a1', '25970000-0000-0000-0000-00000000000a', 'CSP Admin', 'csp-admin@example.com', 'Admin', 'active'),
  ('25970000-0000-0000-0000-0000000000a2', '25970000-0000-0000-0000-00000000000a', 'CSP Fin', 'csp-fin@example.com', 'Finance', 'active'),
  ('25970000-0000-0000-0000-0000000000a3', '25970000-0000-0000-0000-00000000000a', 'CSP PM', 'csp-pm@example.com', 'Project Manager', 'active'),
  ('25970000-0000-0000-0000-0000000000a4', '25970000-0000-0000-0000-00000000000a', 'CSP Eng', 'csp-eng@example.com', 'Engineer', 'active'),
  ('25970000-0000-0000-0000-0000000000a5', '25970000-0000-0000-0000-00000000000a', 'CSP PM Two', 'csp-pm2@example.com', 'Project Manager', 'active'),
  ('25970000-0000-0000-0000-0000000000a6', '25970000-0000-0000-0000-00000000000a', 'CSP Eng Two', 'csp-viewer@example.com', 'Engineer', 'active'),
  ('25970000-0000-0000-0000-0000000000a7', '25970000-0000-0000-0000-00000000000a', 'CSP Off', 'csp-off@example.com', 'Finance', 'disabled'),
  ('25970000-0000-0000-0000-0000000000a8', '25970000-0000-0000-0000-00000000000a', 'CSP Exec', 'csp-exec@example.com', 'Executive', 'active'),
  ('25970000-0000-0000-0000-0000000000b1', '25970000-0000-0000-0000-00000000000b', 'CSP XOrg', 'csp-xorg@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id, currency) values
  ('25970000-0000-0000-0000-0000000000c1', '25970000-0000-0000-0000-00000000000a', 'CSP Site', 'Ongoing Project', '25970000-0000-0000-0000-0000000000a3', 'IDR'),
  ('25970000-0000-0000-0000-0000000000c2', '25970000-0000-0000-0000-00000000000a', 'CSP Empty Site', 'Ongoing Project', '25970000-0000-0000-0000-0000000000a5', 'IDR'),
  ('25970000-0000-0000-0000-0000000000c9', '25970000-0000-0000-0000-00000000000b', 'CSP Other Site', 'Ongoing Project', null, 'IDR');

-- Source rows are written with triggers off: this file proves the read, not each record's create path.
set local session_replication_role = replica;
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency, start_date, end_date, closed_at, cancelled_at) values
  ('25970000-0000-0000-0000-0000000000e1', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000c1', 'WO-A', 'Hand calculation', 'Issued', 1000000, 'exclusive', 0, 'IDR', '2026-01-01', '2026-01-10', null, null),
  ('25970000-0000-0000-0000-0000000000e2', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000c1', 'WO-B', 'Unrated line', 'Issued', 50000, 'exclusive', 0, 'IDR', '2026-01-01', '2026-01-10', null, null),
  ('25970000-0000-0000-0000-0000000000e3', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000c1', 'WO-C', 'Closed', 'Closed', 100000, 'exclusive', 0, 'IDR', '2026-01-01', '2026-01-10', '2026-01-05T12:00:00Z', null),
  ('25970000-0000-0000-0000-0000000000e4', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000c1', 'WO-D', 'Draft', 'Draft', 100, 'exclusive', 0, 'IDR', null, null, null, null),
  ('25970000-0000-0000-0000-0000000000e5', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000c1', 'WO-E', 'Cancelled', 'Cancelled', 100, 'exclusive', 0, 'IDR', null, null, null, now()),
  ('25970000-0000-0000-0000-0000000000e6', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000c1', 'WO-F', 'Other currency cost', 'Issued', 10000, 'exclusive', 0, 'IDR', '2026-01-01', '2026-01-10', null, null),
  ('25970000-0000-0000-0000-0000000000e7', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000c1', 'WO-G', 'Undated cost, no dates', 'Issued', 10000, 'exclusive', 0, 'IDR', null, null, null, null),
  ('25970000-0000-0000-0000-0000000000e9', '25970000-0000-0000-0000-00000000000b', '25970000-0000-0000-0000-0000000000c9', 'WO-X', 'Other org', 'Issued', 777, 'exclusive', 0, 'IDR', '2026-01-01', '2026-01-10', null, null);
-- WO-C closing value 80000 (through a confirmed acceptance).
insert into work_order_acceptances (id, org_id, project_id, work_order_id, acceptance_date, is_final, status, prepared_by, confirmed_by, confirmed_at, confirm_basis) values
  ('25970000-0000-0000-0000-0000000000f1', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000c1', '25970000-0000-0000-0000-0000000000e3', '2026-01-05', true, 'Confirmed', '25970000-0000-0000-0000-0000000000a2', '25970000-0000-0000-0000-0000000000a3', now(), 'standard');
update work_orders set closing_value = 80000, closing_acceptance_id = '25970000-0000-0000-0000-0000000000f1' where id = '25970000-0000-0000-0000-0000000000e3';
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25970000-0000-0000-0000-0000000000d1', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000c1', 'L1', 'Line', 'm', 1000, 1);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('25970000-0000-0000-0000-000000000011', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000e1', '25970000-0000-0000-0000-0000000000d1', 1), ('25970000-0000-0000-0000-000000000012', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000e2', '25970000-0000-0000-0000-0000000000d1', 1),
  ('25970000-0000-0000-0000-000000000013', '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000e3', '25970000-0000-0000-0000-0000000000d1', 1);

-- one report + one progress line at a given amount (null = a validated line with no rate)
create or replace function pg_temp.rep(p_n text, p_wo text, p_date date, p_status text, p_amount numeric, p_super boolean default false, p_line text default '11') returns void language plpgsql as $f$
declare v_id uuid := ('25970000-0000-0000-0000-0000000020' || p_n)::uuid;
begin
  insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, version, author_id, validated_by, validated_at, superseded_at)
  values (v_id, '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000c1', ('25970000-0000-0000-0000-0000000000' || p_wo)::uuid, p_date, p_status, 1, '25970000-0000-0000-0000-0000000000a4',
          case when p_status = 'validated' then '25970000-0000-0000-0000-0000000000a2'::uuid end, case when p_status = 'validated' then now() end,
          case when p_super then now() end);
  insert into dsr_progress_lines (org_id, report_id, work_order_id, position, work_order_line_id, quantity, unit, frozen_amount)
  values ('25970000-0000-0000-0000-00000000000a', v_id, ('25970000-0000-0000-0000-0000000000' || p_wo)::uuid, 1, ('25970000-0000-0000-0000-0000000000' || p_line)::uuid, 1, 'm', p_amount);
end $f$;
-- hand calculation (WO-A): 100000 on day 1, 200000 on day 3, 50000 on day 5 (after as-of); status noise on other days
select pg_temp.rep('01', 'e1', '2026-01-01', 'validated', 100000);
select pg_temp.rep('02', 'e1', '2026-01-03', 'validated', 200000);
select pg_temp.rep('03', 'e1', '2026-01-05', 'validated', 50000);
select pg_temp.rep('04', 'e1', '2026-01-07', 'draft', 11111);
select pg_temp.rep('05', 'e1', '2026-01-04', 'submitted', 22222);
select pg_temp.rep('06', 'e1', '2026-01-06', 'returned', 33333);
select pg_temp.rep('07', 'e1', '2026-01-02', 'validated', 44444, true);   -- superseded
-- WO-B: validated line with no rate
select pg_temp.rep('08', 'e2', '2026-01-02', 'validated', null, false, '12');
-- WO-C closed 2026-01-05T12:00Z = 2026-01-06 local: 01-06 counts, 01-08 does not
select pg_temp.rep('09', 'e3', '2026-01-06', 'validated', 20000, false, '13');
select pg_temp.rep('10', 'e3', '2026-01-08', 'validated', 30000, false, '13');

-- direct cost: one paid vendor bill per amount, attributed to the work order
create or replace function pg_temp.cost(p_n text, p_wo text, p_date date, p_amount numeric, p_ccy text default 'IDR') returns void language plpgsql as $f$
declare v_p uuid := ('25970000-0000-0000-0000-0000000030' || p_n)::uuid;
begin
  insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, currency, budget_category)
  values (v_p, '25970000-0000-0000-0000-00000000000a', 'CSP cost ' || p_n, '25970000-0000-0000-0000-0000000000c1', '25970000-0000-0000-0000-0000000000a4', 'Ordered', p_amount, p_amount, p_ccy, 'Materials');
  insert into procurement_invoices (id, org_id, procurement_id, vi_number, invoice_date, status, amount, tax_treatment, tax_amount, currency, work_order_id)
  values (('25970000-0000-0000-0000-0000000040' || p_n)::uuid, '25970000-0000-0000-0000-00000000000a', v_p, 'VI-' || p_n, p_date, 'Received', p_amount, 'exclusive', 0, p_ccy,
          case when p_wo is null then null else ('25970000-0000-0000-0000-0000000000' || p_wo)::uuid end);
  insert into payments (org_id, procurement_id, invoice_id, status, amount, currency)
  values ('25970000-0000-0000-0000-00000000000a', v_p, ('25970000-0000-0000-0000-0000000040' || p_n)::uuid, 'Paid', p_amount, p_ccy);
end $f$;
select pg_temp.cost('01', 'e1', '2026-01-02', 150000);
select pg_temp.cost('02', 'e1', '2026-01-03', 100000);
select pg_temp.cost('03', 'e1', '2026-01-06', 70000);          -- after the as-of date
select pg_temp.cost('04', 'e3', '2026-01-06', 5000);           -- WO-C on its local close date
select pg_temp.cost('05', 'e3', '2026-01-07', 9000);           -- after close
select pg_temp.cost('06', 'e6', '2026-01-02', 1000, 'USD');    -- WO-F counted cost in another currency
select pg_temp.cost('07', 'e7', null, 500);                    -- WO-G undated
select pg_temp.cost('08', null, '2026-01-02', 999);            -- shared (no work order): never direct
-- commitment-only rows (an ordered, unpaid procurement) never enter AC
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value, currency)
values ('25970000-0000-0000-0000-00000000003a', '25970000-0000-0000-0000-00000000000a', 'CSP committed', '25970000-0000-0000-0000-0000000000c1', '25970000-0000-0000-0000-0000000000a4', 'Ordered', 888000, 888000, 'IDR');
set local session_replication_role = origin;

update organizations set performance_indices_enabled = true where id = '25970000-0000-0000-0000-00000000000a';

create or replace function pg_temp.act_as(p_uid text) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid::uuid, 'role', 'authenticated')::text, true);
$f$;
create or replace function pg_temp.wo(p_json jsonb, p_no text) returns jsonb language sql as $f$
  select e from jsonb_array_elements(p_json->'rows') e where e->>'wo_number' = p_no
$f$;
create temp table snap (k text primary key, v jsonb);
grant all on snap to authenticated;
grant execute on function pg_temp.act_as(text) to authenticated;
grant execute on function pg_temp.wo(jsonb, text) to authenticated;

set local role authenticated;
select pg_temp.act_as('25970000-0000-0000-0000-0000000000a2');
insert into snap select 'asof4', public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-04');
insert into snap select 'asof9', public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-09');

-- AC-CSP-009 hand calculation: EV 300000, PV 400000, AC 250000, BAC 1000000
select is(pg_temp.wo((select v from snap where k='asof4'), 'WO-A')->>'ev', '300000.00', 'AC-CSP-009 EV is 300000 (live validated lines to the as-of date)');
select is(pg_temp.wo((select v from snap where k='asof4'), 'WO-A')->>'pv', '400000.00', 'AC-CSP-009 PV is 400000 (4 of 10 calendar days)');
select is(pg_temp.wo((select v from snap where k='asof4'), 'WO-A')->>'ac', '250000.00', 'AC-CSP-009 AC is 250000 (counted direct cost to the as-of date)');
select is(pg_temp.wo((select v from snap where k='asof4'), 'WO-A')->>'bac', '1000000.00', 'AC-CSP-009 BAC is the net order value');
select is(pg_temp.wo((select v from snap where k='asof4'), 'WO-A')->>'ac_status', 'complete', 'AC-CSP-009 AC is complete');
select is((select v->>'as_of' from snap where k='asof4'), '2026-01-04', 'the as-of date is returned');
select is((select v->'bands' from snap where k='asof4'), '{"low": "0.90", "high": "1.10"}'::jsonb, 'AC-CSP-020 the organisation bands are returned (defaults)');
-- AC-CSP-009: counted direct AC equals the plan-versus-actual row; commitments and shared cost do not enter
select is((pg_temp.wo((select v from snap where k='asof9'), 'WO-A')->>'ac')::numeric,
  (select sum(amount::numeric) from public.work_order_cost_amounts('25970000-0000-0000-0000-0000000000c1')
    where work_order_id = '25970000-0000-0000-0000-0000000000e1' and reason = 'counted'),
  'AC-CSP-009 counted direct cost equals the plan-versus-actual rows for the work order');
select is((select sum(amount::numeric) from public.work_order_cost_amounts('25970000-0000-0000-0000-0000000000c1') where work_order_id is null and reason in ('counted','unassigned')), 999::numeric,
  'AC-CSP-009 the shared 999 exists in the cost read (and is not allocated to a work order)');
select is((pg_temp.wo((select v from snap where k='asof9'), 'WO-A')->>'ac')::numeric, 320000::numeric,
  'AC-CSP-009 neither the commitment nor the shared 999 enters a work order AC (150000+100000+70000)');

-- AC-CSP-006 only live validated reports count: draft 11111, submitted 22222, returned 33333, superseded 44444 are out
select is(pg_temp.wo((select v from snap where k='asof9'), 'WO-A')->>'ev', '350000.00', 'AC-CSP-006 draft, submitted, returned and superseded reports add nothing (EV 350000 at 9 Jan)');
-- AC-CSP-007 as-of bound: the 5 Jan line is out at 4 Jan and in at 5 Jan; a line on the as-of day is included
select is(pg_temp.wo(public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-05'), 'WO-A')->>'ev', '350000.00', 'AC-CSP-007 a line dated on the as-of date is included');
select is(pg_temp.wo(public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-02'), 'WO-A')->>'ev', '100000.00', 'AC-CSP-007 a line after the as-of date is excluded');
-- AC-CSP-008 unrated
select is(pg_temp.wo((select v from snap where k='asof4'), 'WO-B')->>'unrated_lines', '1', 'AC-CSP-008 the unrated validated line is counted');
-- PV edges
select is(pg_temp.wo(public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2025-12-20'), 'WO-A')->>'pv', '0.00', 'AC-CSP-003 PV is 0 before the start date');
select is(pg_temp.wo(public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-02-20'), 'WO-A')->>'pv', '1000000.00', 'AC-CSP-003 PV is the whole budget after the end date');
-- AC-CSP-010 other currency
select is(pg_temp.wo((select v from snap where k='asof4'), 'WO-F')->>'ac_status', 'not_comparable', 'AC-CSP-010 a counted direct cost in another currency makes AC not comparable');
select is(pg_temp.wo((select v from snap where k='asof4'), 'WO-F')->'ac', 'null'::jsonb, 'AC-CSP-010 and no AC figure is returned');
-- AC-CSP-017 undated cost
select is(pg_temp.wo((select v from snap where k='asof4'), 'WO-G')->>'ac_status', 'incomplete', 'AC-CSP-017 an undated counted direct cost makes AC incomplete');
select is(pg_temp.wo((select v from snap where k='asof4'), 'WO-G')->>'undated_cost_lines', '1', 'AC-CSP-017 the undated line is counted');
select is(pg_temp.wo((select v from snap where k='asof4'), 'WO-G')->'pv', 'null'::jsonb, 'FR-CSP-006 PV is null when the work order has no dates');
-- AC-CSP-011 Closed: closing value as BAC; actuals stop at the organisation-local close date (6 Jan, not the UTC 5 Jan)
select is(pg_temp.wo((select v from snap where k='asof9'), 'WO-C')->>'bac', '80000.00', 'AC-CSP-011 a Closed work order uses its closing value');
select is(pg_temp.wo((select v from snap where k='asof9'), 'WO-C')->>'as_of', '2026-01-06', 'AC-CSP-011 the effective date is the organisation-local close date');
select is(pg_temp.wo((select v from snap where k='asof9'), 'WO-C')->>'ev', '20000.00', 'AC-CSP-011 EV stops at the local close date (the 8 Jan line is out)');
select is(pg_temp.wo((select v from snap where k='asof9'), 'WO-C')->>'ac', '5000.00', 'AC-CSP-011 AC stops at the local close date (the 7 Jan cost is out)');
select is(pg_temp.wo((select v from snap where k='asof9'), 'WO-C')->>'pv', '72000.00', 'AC-CSP-011 PV follows the planned dates (9 of 10 days of 80000)');
select is(pg_temp.wo((select v from snap where k='asof9'), 'WO-D')->'ev', 'null'::jsonb, 'AC-CSP-011 a Draft work order has no figures');
select is(pg_temp.wo((select v from snap where k='asof9'), 'WO-E')->'ev', 'null'::jsonb, 'AC-CSP-011 a Cancelled work order has no figures');
-- AC-CSP-012 organisation-local date (UTC+14 org)
select is((public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1')->>'as_of')::date, (now() at time zone 'Pacific/Kiritimati')::date,
  'AC-CSP-012 without an as-of date the organisation-local date is used, not the UTC date');
-- AC-CSP-014 other organisation
select is((select count(*)::int from jsonb_array_elements((select v from snap where k='asof4')->'rows') e where e->>'wo_number' = 'WO-X'), 0,
  'AC-CSP-014 another organisation''s work orders never appear');
-- AC-CSP-013 refusals
select pg_temp.act_as('25970000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-04') $$, '42501', null, 'AC-CSP-013 an Engineer is refused');
select pg_temp.act_as('25970000-0000-0000-0000-0000000000a6');
select throws_ok($$ select public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-04') $$, '42501', null, 'AC-CSP-013 a second Engineer (read-only roles do not exist in this schema) is refused');
select pg_temp.act_as('25970000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-04') $$, '42501', null, 'AC-CSP-013 another project''s Project Manager is refused');
select pg_temp.act_as('25970000-0000-0000-0000-0000000000a7');
select throws_ok($$ select public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-04') $$, '42501', null, 'AC-CSP-013 an offboarded account is refused');
select pg_temp.act_as('25970000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-04') $$, 'P0002', null, 'AC-CSP-014 another organisation cannot reach the project');
select pg_temp.act_as('25970000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-04') $$, 'the project''s own Project Manager may read');
select pg_temp.act_as('25970000-0000-0000-0000-0000000000a8');
select lives_ok($$ select public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-04') $$, 'an Executive may read');
-- AC-CSP-015 row bound
reset role;
insert into projects (id, org_id, name, status, project_manager_id, currency) values ('25970000-0000-0000-0000-0000000000c3', '25970000-0000-0000-0000-00000000000a', 'CSP Big', 'Ongoing Project', '25970000-0000-0000-0000-0000000000a3', 'IDR');
set local session_replication_role = replica;
insert into work_orders (org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency)
  select '25970000-0000-0000-0000-00000000000a', '25970000-0000-0000-0000-0000000000c3', 'BIG-' || lpad(g::text, 4, '0'), 'Big ' || g, 'Issued', 10, 'exclusive', 0, 'IDR' from generate_series(1, 503) g;
set local session_replication_role = origin;
update organizations set performance_indices_enabled = true where id = '25970000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp.act_as('25970000-0000-0000-0000-0000000000a2');
select is(jsonb_array_length(public.get_work_order_performance('25970000-0000-0000-0000-0000000000c3', '2026-01-04')->'rows'), 500, 'AC-CSP-015 at most 500 work orders are returned');
select is(public.get_work_order_performance('25970000-0000-0000-0000-0000000000c3', '2026-01-04')->>'omitted', '3', 'AC-CSP-015 the omitted count is returned and truncated is set');
reset role;
update organizations set performance_indices_enabled = false where id = '25970000-0000-0000-0000-00000000000a';
set local role authenticated;
select pg_temp.act_as('25970000-0000-0000-0000-0000000000a2');
select is(public.get_work_order_performance('25970000-0000-0000-0000-0000000000c1', '2026-01-04'), '{"enabled": false}'::jsonb, 'with the setting off the read returns no figures');
select * from finish();
rollback;
