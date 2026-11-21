-- 1265_discipline_profit.test.sql — #2669. AC-DPR-001/003..008/015, see docs/specs/discipline-profit.spec.md.
begin;
create extension if not exists pgtap;
select plan(25);

-- ── fixtures (table owner) ───────────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency, default_timezone) values
  ('26690000-0000-0000-0000-0000000000a1', 'DPR Org A', 'USD', 'UTC'),
  ('26690000-0000-0000-0000-0000000000a2', 'DPR Org B', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('26690000-0000-0000-0000-0000000000b1', 'dpr-eng@example.com'),
  ('26690000-0000-0000-0000-0000000000b2', 'dpr-pm@example.com'),
  ('26690000-0000-0000-0000-0000000000b3', 'dpr-fin@example.com'),
  ('26690000-0000-0000-0000-0000000000b4', 'dpr-admin@example.com'),
  ('26690000-0000-0000-0000-0000000000b5', 'dpr-other-pm@example.com'),
  ('26690000-0000-0000-0000-0000000000b6', 'dpr-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26690000-0000-0000-0000-0000000000b1', '26690000-0000-0000-0000-0000000000a1', 'Eng', 'dpr-eng@example.com', 'Engineer', 'active'),
  ('26690000-0000-0000-0000-0000000000b2', '26690000-0000-0000-0000-0000000000a1', 'PM', 'dpr-pm@example.com', 'Project Manager', 'active'),
  ('26690000-0000-0000-0000-0000000000b3', '26690000-0000-0000-0000-0000000000a1', 'Fin', 'dpr-fin@example.com', 'Finance', 'active'),
  ('26690000-0000-0000-0000-0000000000b4', '26690000-0000-0000-0000-0000000000a1', 'Admin', 'dpr-admin@example.com', 'Admin', 'active'),
  ('26690000-0000-0000-0000-0000000000b5', '26690000-0000-0000-0000-0000000000a1', 'Other PM', 'dpr-other-pm@example.com', 'Project Manager', 'active'),
  ('26690000-0000-0000-0000-0000000000b6', '26690000-0000-0000-0000-0000000000a2', 'Foreign', 'dpr-foreign@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('26690000-0000-0000-0000-0000000000c1', '26690000-0000-0000-0000-0000000000a1', 'DPR Contract', 'Ongoing Project', 'USD', '26690000-0000-0000-0000-0000000000b2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('26690000-0000-0000-0000-0000000000e1', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-0000000000c1', 'WO one', 'Issued', 10000, 'exclusive', 0);
insert into cost_disciplines (id, org_id, code, name, archived_at) values
  ('26690000-0000-0000-0000-0000000000d1', '26690000-0000-0000-0000-0000000000a1', 'CIV', 'Civil', null),
  ('26690000-0000-0000-0000-0000000000d2', '26690000-0000-0000-0000-0000000000a1', 'ELE', 'Electrical', null),
  ('26690000-0000-0000-0000-0000000000d3', '26690000-0000-0000-0000-0000000000a1', 'OLD', 'Old', now()),
  ('26690000-0000-0000-0000-0000000000d4', '26690000-0000-0000-0000-0000000000a2', 'CIV', 'Civil B', null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26690000-0000-0000-0000-0000000000f1', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-0000000000c1', 'L1', 'Civil line', 'm', 100, 10),
  ('26690000-0000-0000-0000-0000000000f2', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-0000000000c1', 'L2', 'Electric line', 'm', 100, 10),
  ('26690000-0000-0000-0000-0000000000f3', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-0000000000c1', 'L3', 'Untagged line', 'm', 100, 10);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('26690000-0000-0000-0000-000000000011', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-0000000000e1', '26690000-0000-0000-0000-0000000000f1', 100),
  ('26690000-0000-0000-0000-000000000012', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-0000000000e1', '26690000-0000-0000-0000-0000000000f2', 100),
  ('26690000-0000-0000-0000-000000000013', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-0000000000e1', '26690000-0000-0000-0000-0000000000f3', 100);
-- Reports: r1 validated (kept), r2 draft, r3 validated and superseded by its correction r4 (validated), r5 validated with an unrated line.
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at, superseded_at, supersedes_id, correction_reason) values
  ('26690000-0000-0000-0000-000000000101', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-0000000000c1', '26690000-0000-0000-0000-0000000000e1', '2026-03-01', 'validated', '26690000-0000-0000-0000-0000000000b1', '26690000-0000-0000-0000-0000000000b3', now(), null, null, null),
  ('26690000-0000-0000-0000-000000000102', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-0000000000c1', '26690000-0000-0000-0000-0000000000e1', '2026-03-02', 'draft', '26690000-0000-0000-0000-0000000000b1', null, null, null, null, null),
  ('26690000-0000-0000-0000-000000000103', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-0000000000c1', '26690000-0000-0000-0000-0000000000e1', '2026-03-03', 'validated', '26690000-0000-0000-0000-0000000000b1', '26690000-0000-0000-0000-0000000000b3', now(), now(), null, null);
insert into daily_site_reports (id, org_id, project_id, work_order_id, work_date, status, author_id, validated_by, validated_at, supersedes_id, correction_reason) values
  ('26690000-0000-0000-0000-000000000104', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-0000000000c1', '26690000-0000-0000-0000-0000000000e1', '2026-03-03', 'validated', '26690000-0000-0000-0000-0000000000b1', '26690000-0000-0000-0000-0000000000b3', now(), '26690000-0000-0000-0000-000000000103', 'fix');
insert into dsr_progress_lines (id, org_id, report_id, position, work_order_line_id, quantity, unit, frozen_rate, frozen_rate_source, frozen_amount, frozen_at) values
  ('26690000-0000-0000-0000-000000000201', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-000000000101', 1, '26690000-0000-0000-0000-000000000011', 10, 'm', 10, 'contract', 100.00, now()),
  ('26690000-0000-0000-0000-000000000202', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-000000000101', 2, '26690000-0000-0000-0000-000000000012', 5, 'm', 10, 'contract', 50.00, now()),
  ('26690000-0000-0000-0000-000000000203', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-000000000101', 3, '26690000-0000-0000-0000-000000000013', 2.5, 'm', 10, 'contract', 25.00, now()),
  ('26690000-0000-0000-0000-000000000204', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-000000000102', 1, '26690000-0000-0000-0000-000000000011', 99.9, 'm', null, null, null, null),
  ('26690000-0000-0000-0000-000000000205', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-000000000103', 1, '26690000-0000-0000-0000-000000000011', 77, 'm', 10, 'contract', 770.00, now()),
  ('26690000-0000-0000-0000-000000000206', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-000000000104', 1, '26690000-0000-0000-0000-000000000011', 1, 'm', 10, 'contract', 10.00, now()),
  ('26690000-0000-0000-0000-000000000207', '26690000-0000-0000-0000-0000000000a1', '26690000-0000-0000-0000-000000000104', 2, '26690000-0000-0000-0000-000000000012', 3, 'm', null, null, null, now());

-- ── AC-DPR-001: off by default; nothing returned ────────────────────────────────────────────────
select is((select discipline_profit_enabled from organizations where id = '26690000-0000-0000-0000-0000000000a1'), false,
  'AC-DPR-001 the setting is off by default');

-- ── AC-DPR-001: setting off → no rows; AC-DPR-015: only an Admin flips it ────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is((select count(*)::int from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1')), 0,
  'AC-DPR-001 with the setting off the revenue read returns nothing');
select is(public.get_org_discipline_profit_enabled(), false, 'AC-DPR-001 the getter reads off');
select throws_ok($$select public.set_org_discipline_profit_enabled(true)$$, '42501', null, 'AC-DPR-015 a Finance user cannot turn the setting on');
select throws_ok($$update organizations set discipline_profit_enabled = true$$, '42501', null, 'AC-DPR-015 nor by writing the column');

-- ── AC-DPR-003 / 004: tagging a contract item ───────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.set_boq_item_discipline('26690000-0000-0000-0000-0000000000f1', '26690000-0000-0000-0000-0000000000d1')$$,
  '42501', null, 'AC-DPR-003 an Engineer cannot tag a contract item');
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($$select public.set_boq_item_discipline('26690000-0000-0000-0000-0000000000f1', '26690000-0000-0000-0000-0000000000d1')$$,
  '42501', null, 'AC-DPR-003 the Project Manager of another project cannot');
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select throws_ok($$select public.set_boq_item_discipline('26690000-0000-0000-0000-0000000000f1', '26690000-0000-0000-0000-0000000000d4')$$,
  'P0002', null, 'AC-DPR-003 another organisation reads the item as absent');
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$select public.set_boq_item_discipline('26690000-0000-0000-0000-0000000000f1', '26690000-0000-0000-0000-0000000000d4')$$,
  '23514', null, 'AC-DPR-004 a discipline of another organisation is refused');
select throws_ok($$select public.set_boq_item_discipline('26690000-0000-0000-0000-0000000000f1', '26690000-0000-0000-0000-0000000000d3')$$,
  '23514', null, 'AC-DPR-004 an archived discipline is refused');
select throws_ok($$update boq_items set discipline_id = '26690000-0000-0000-0000-0000000000d1' where id = '26690000-0000-0000-0000-0000000000f1'$$,
  '42501', null, 'the column is not writable directly');
select is(public.set_boq_item_discipline('26690000-0000-0000-0000-0000000000f1', '26690000-0000-0000-0000-0000000000d1'),
  '26690000-0000-0000-0000-0000000000d1'::uuid, 'AC-DPR-003 the project''s Project Manager tags an item');
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is(public.set_boq_item_discipline('26690000-0000-0000-0000-0000000000f2', '26690000-0000-0000-0000-0000000000d2'),
  '26690000-0000-0000-0000-0000000000d2'::uuid, 'AC-DPR-003 a Finance user tags an item');

-- ── an Admin turns the setting on ──────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select is(public.set_org_discipline_profit_enabled(true), true, 'AC-DPR-015 an Admin turns the setting on');

-- ── revenue read ───────────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select * from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1')$$, '42501', null,
  'AC-DPR-003 an Engineer cannot read revenue');
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($$select * from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1')$$, '42501', null,
  'AC-DPR-003 another project''s Project Manager cannot read revenue');
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b6","role":"authenticated"}';
select throws_ok($$select * from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1')$$, 'P0002', null,
  'another organisation''s project reads as absent');
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is((select count(*)::int from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1')), 3,
  'AC-DPR-005 three groups: civil, electrical, no discipline');
select is((select revenue from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1') where discipline_id = '26690000-0000-0000-0000-0000000000d1'),
  110.00::numeric, 'AC-DPR-005/006 civil is the kept report plus the correction; the draft and the superseded report do not count');
select is((select revenue from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1') where discipline_id = '26690000-0000-0000-0000-0000000000d2'),
  50.00::numeric, 'AC-DPR-005 electrical is 50.00');
select is((select revenue from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1') where discipline_id is null),
  25.00::numeric, 'AC-DPR-005 an untagged item rolls under no discipline');
select is((select unrated_lines from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1') where discipline_id = '26690000-0000-0000-0000-0000000000d2'),
  1, 'AC-DPR-008 a validated line frozen without a rate is counted as unrated');
select is((select sum(revenue) from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1')),
  (select public.work_order_validated_revenue('26690000-0000-0000-0000-0000000000e1')),
  'AC-DPR-007 the groups sum to the work order''s validated revenue');
select is((select distinct basis from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1')), 'validated_progress',
  'the basis is named on every row');

-- ── off again → nothing ────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"26690000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select public.set_org_discipline_profit_enabled(false);
select is((select count(*)::int from public.project_discipline_revenue('26690000-0000-0000-0000-0000000000c1')), 0,
  'AC-DPR-001 turning the setting off returns nothing again');

select * from finish();
rollback;
