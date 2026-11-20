-- dsr_report.test.sql — #1522 daily site report. AC-DSR-001/002/005..012/014/015, see docs/specs/daily-site-report.spec.md.
begin;
create extension if not exists pgtap;
select plan(57);

-- ── fixtures (as the table owner) ────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency, default_timezone) values
  ('15220000-0000-0000-0000-0000000000a1', 'DSR Org A', 'USD', 'UTC'),
  ('15220000-0000-0000-0000-0000000000a2', 'DSR Org B', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('15220000-0000-0000-0000-0000000000b1', 'dsr-eng@example.com'),
  ('15220000-0000-0000-0000-0000000000b2', 'dsr-pm@example.com'),
  ('15220000-0000-0000-0000-0000000000b3', 'dsr-fin@example.com'),
  ('15220000-0000-0000-0000-0000000000b4', 'dsr-exec@example.com'),
  ('15220000-0000-0000-0000-0000000000b5', 'dsr-foreign@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15220000-0000-0000-0000-0000000000b1', '15220000-0000-0000-0000-0000000000a1', 'DSR Engineer', 'dsr-eng@example.com', 'Engineer', 'active'),
  ('15220000-0000-0000-0000-0000000000b2', '15220000-0000-0000-0000-0000000000a1', 'DSR PM', 'dsr-pm@example.com', 'Project Manager', 'active'),
  ('15220000-0000-0000-0000-0000000000b3', '15220000-0000-0000-0000-0000000000a1', 'DSR Finance', 'dsr-fin@example.com', 'Finance', 'active'),
  ('15220000-0000-0000-0000-0000000000b4', '15220000-0000-0000-0000-0000000000a1', 'DSR Exec', 'dsr-exec@example.com', 'Executive', 'active'),
  ('15220000-0000-0000-0000-0000000000b5', '15220000-0000-0000-0000-0000000000a2', 'DSR Foreign', 'dsr-foreign@example.com', 'Finance', 'active');
insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('15220000-0000-0000-0000-0000000000c1', '15220000-0000-0000-0000-0000000000a1', 'DSR Contract', 'Ongoing Project', 'USD', '15220000-0000-0000-0000-0000000000b2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('15220000-0000-0000-0000-0000000000e1', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'WO one', 'Issued', 10000, 'exclusive', 0),
  ('15220000-0000-0000-0000-0000000000e2', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'WO two', 'Issued', 10000, 'exclusive', 0);
insert into rate_catalogue_variants (id, org_id, project_id, name, is_default) values
  ('15220000-0000-0000-0000-0000000000d1', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'Remote', true);
insert into rate_catalogue_items (id, org_id, project_id, item_code, description, unit) values
  ('15220000-0000-0000-0000-0000000000d2', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'W-1', 'Weld', 'm');
insert into rate_catalogue_rates (org_id, item_id, variant_id, rate, effective_from) values
  ('15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000d2', '15220000-0000-0000-0000-0000000000d1', 5, '2026-01-01');
insert into rate_catalogue_stage_weights (org_id, item_id, effective_from, position, stage, weight_pct) values
  ('15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000d2', '2026-01-01', 1, 'Fab', 20),
  ('15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000d2', '2026-01-01', 2, 'Weld', 80);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate, catalogue_item_id, catalogue_variant_id, catalogue_priced_as_of) values
  ('15220000-0000-0000-0000-0000000000f1', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'L1', 'Weld line', 'm', 100, 5,
   '15220000-0000-0000-0000-0000000000d2', '15220000-0000-0000-0000-0000000000d1', '2026-01-01');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15220000-0000-0000-0000-0000000000f2', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'L2', 'Paint line', 'm2', 100, 3),
  ('15220000-0000-0000-0000-0000000000f3', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'L3', 'Other WO line', 'm', 100, 1),
  ('15220000-0000-0000-0000-0000000000f4', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000c1', 'L4', 'Unpriced line', 'ea', 100, 0);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('15220000-0000-0000-0000-000000000011', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000e1', '15220000-0000-0000-0000-0000000000f1', 100),
  ('15220000-0000-0000-0000-000000000012', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000e1', '15220000-0000-0000-0000-0000000000f2', 100),
  ('15220000-0000-0000-0000-000000000013', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000e2', '15220000-0000-0000-0000-0000000000f3', 100),
  ('15220000-0000-0000-0000-000000000014', '15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000e1', '15220000-0000-0000-0000-0000000000f4', 100);
insert into stock_units (id, org_id, code, name) values
  ('15220000-0000-0000-0000-000000000021', '15220000-0000-0000-0000-0000000000a1', 'kg', 'Kilogram');
insert into stock_items (id, org_id, code, name, unit_id) values
  ('15220000-0000-0000-0000-000000000022', '15220000-0000-0000-0000-0000000000a1', 'ROD', 'Welding rod', '15220000-0000-0000-0000-000000000021');

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;
create temp table stock_before on commit drop as select count(*)::int n from stock_documents;
grant all on stock_before to authenticated;

select is((select count(*)::int from dsr_idle_reasons where org_id = '15220000-0000-0000-0000-0000000000a1'), 6,
  'a new organisation gets the neutral default idle reasons');

-- ── AC-DSR-001 / 014 / 002 / 010: capture ─────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b1","role":"authenticated"}';

insert into ids select 'r1', public.dsr_save_draft(jsonb_build_object(
  'client_request_id', '15220000-0000-0000-0000-000000000101',
  'work_order_id', '15220000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-10',
  'start_time', '07:00', 'end_time', '17:30',
  'weather_id', (select id from dsr_weather_conditions where label = 'Rain'), 'weather_note', 'Light rain after lunch',
  'progress', jsonb_build_array(
     jsonb_build_object('work_order_line_id', '15220000-0000-0000-0000-000000000011', 'quantity', 10),
     jsonb_build_object('work_order_line_id', '15220000-0000-0000-0000-000000000012', 'quantity', 0.1),
     jsonb_build_object('work_order_line_id', '15220000-0000-0000-0000-000000000011', 'sub_stage', 'Weld', 'quantity', 1),
     jsonb_build_object('work_order_line_id', '15220000-0000-0000-0000-000000000014', 'quantity', 2)),
  'idle', jsonb_build_array(jsonb_build_object('minutes', 45, 'reason_id', (select id from dsr_idle_reasons where label = 'Weather'))),
  'consumables', jsonb_build_array(jsonb_build_object('stock_item_id', '15220000-0000-0000-0000-000000000022', 'quantity', 3.5))));

select is((select status from daily_site_reports where id = (select v from ids where k = 'r1')), 'draft', 'AC-DSR-001 the report saves as draft');
select is((select count(*)::int from dsr_progress_lines where report_id = (select v from ids where k = 'r1')), 4, 'AC-DSR-001 four progress lines reopen');
select is((select total_minutes from daily_site_reports where id = (select v from ids where k = 'r1')), 630, 'AC-DSR-001 working hours total 10h30');
select is((select unit from dsr_progress_lines where report_id = (select v from ids where k = 'r1') and position = 2), 'm2', 'AC-DSR-001 a line takes its contract item unit');
select is((select minutes from dsr_idle_periods where report_id = (select v from ids where k = 'r1')), 45, 'AC-DSR-001 the idle period reopens');
select is((select quantity from dsr_consumables where report_id = (select v from ids where k = 'r1')), 3.5::numeric, 'AC-DSR-001 the consumable reopens');
select is((select action from dsr_events where report_id = (select v from ids where k = 'r1')), 'created', 'creation is in the history');

select is(public.dsr_save_draft(jsonb_build_object('client_request_id', '15220000-0000-0000-0000-000000000101',
  'work_order_id', '15220000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-10')), (select v from ids where k = 'r1'),
  'AC-DSR-014 a repeated create returns the same report');
select is((select count(*)::int from daily_site_reports where work_order_id = '15220000-0000-0000-0000-0000000000e1'), 1, 'AC-DSR-014 one report exists');

select throws_ok($$select public.dsr_save_draft(jsonb_build_object('client_request_id', '15220000-0000-0000-0000-000000000102',
  'work_order_id', '15220000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-09',
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '15220000-0000-0000-0000-000000000013', 'quantity', 1))))$$,
  '23514', null, 'AC-DSR-002 a contract item of another work order is refused');
select is((select count(*)::int from daily_site_reports where client_request_id = '15220000-0000-0000-0000-000000000102'), 0,
  'AC-DSR-002 and nothing is saved');
select throws_ok($$select public.dsr_save_draft(jsonb_build_object('work_order_id', '15220000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-09',
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '15220000-0000-0000-0000-000000000011', 'quantity', -1))))$$,
  '22023', null, 'a non-positive quantity is refused');
select throws_ok($$select public.dsr_save_draft(jsonb_build_object('client_request_id', '15220000-0000-0000-0000-000000000103',
  'work_order_id', '15220000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-10'))$$,
  '23505', 'A report exists for this date', 'AC-DSR-010 a second report for the same work order and date is refused');

-- Photo of the paper form while still a draft (the bucket row stands in for the upload).
select throws_ok($$insert into dsr_photos (report_id, kind, file_path)
  select v, 'paper_form', 'missing/object' from ids where k = 'r1'$$, '42501', null,
  'AC-DSR-005 a metadata row cannot claim an absent paper form');
delete from dsr_photos where file_path = 'missing/object';
reset role;
insert into storage.objects (bucket_id, name, owner)
  select 'site-report-photos', '15220000-0000-0000-0000-0000000000a1/' || v || '/15220000-0000-0000-0000-000000000031/form.jpg',
    '15220000-0000-0000-0000-0000000000b1' from ids where k = 'r1';
set local role authenticated;
insert into dsr_photos (report_id, kind, file_path)
  select v, 'paper_form', '15220000-0000-0000-0000-0000000000a1/' || v || '/15220000-0000-0000-0000-000000000031/form.jpg' from ids where k = 'r1';
select is((select org_id from dsr_photos limit 1), '15220000-0000-0000-0000-0000000000a1'::uuid, 'the photo row is stamped with the caller org');

-- ── AC-DSR-012: other organisation and roles without the permission ─────────────────────────────────
select throws_ok($$select * from public.dsr_report_revenue((select v from ids where k = 'r1'))$$, '42501', null,
  'AC-DSR-012 a field role cannot read revenue');
select throws_ok($$select frozen_amount from dsr_progress_lines$$, '42501', null, 'AC-DSR-012 a field role cannot read frozen money columns');

set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($$select public.dsr_save_draft(jsonb_build_object('work_order_id', '15220000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-01'))$$,
  '42501', null, 'AC-DSR-012 an Executive cannot enter a report');
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select is((select count(*)::int from daily_site_reports), 0, 'AC-DSR-012 another organisation reads no report');
select is((select count(*)::int from dsr_photos), 0, 'AC-DSR-012 another organisation reads no photo row');
select is((select count(*)::int from storage.objects where bucket_id = 'site-report-photos'), 0, 'AC-DSR-012 another organisation gets no photo object');
select throws_ok($$select public.dsr_submit((select v from ids where k = 'r1'))$$, 'P0002', null, 'AC-DSR-012 another organisation cannot submit it');
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'site-report-photos'), 1, 'a member of the organisation reads the photo object');

-- ── submit, AC-DSR-005 SoD ─────────────────────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select public.dsr_submit((select v from ids where k = 'r1'))$$, 'the author submits');
select throws_ok($$select public.dsr_validate((select v from ids where k = 'r1'))$$, '42501', 'the author of a report cannot validate it',
  'AC-DSR-005 the author cannot validate their own report');
select throws_ok($$insert into dsr_photos (report_id, file_path) select v, 'x/y/z/w.jpg' from ids where k = 'r1'$$, '42501', null,
  'a submitted report takes no more photos');
insert into ids select 'missing_photo', public.dsr_save_draft(jsonb_build_object('work_order_id', '15220000-0000-0000-0000-0000000000e2', 'work_date', '2026-03-09'));
select throws_ok($$insert into dsr_photos (report_id, kind, file_path)
  select (select v from ids where k = 'missing_photo'), 'paper_form', file_path from dsr_photos where report_id = (select v from ids where k = 'r1')$$,
  '42501', null, 'AC-DSR-005 another report cannot claim an existing paper form');
reset role;
delete from dsr_photos where report_id = (select v from ids where k = 'missing_photo');
insert into dsr_photos (org_id, report_id, kind, file_path)
  select '15220000-0000-0000-0000-0000000000a1', v, 'paper_form', 'missing/object' from ids where k = 'missing_photo';
set local role authenticated;
select public.dsr_submit((select v from ids where k = 'missing_photo'));
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($$select public.dsr_validate((select v from ids where k = 'missing_photo'))$$, '23514',
  'a photo of the paper form is required to validate', 'AC-DSR-005 metadata without a stored paper form cannot validate');
select lives_ok($$select id, org_id, report_id, position, work_order_line_id, sub_stage, quantity, unit, frozen_at from public.dsr_progress_lines$$,
  'the isolation probe reads only granted progress columns');
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($$select public.dsr_validate((select v from ids where k = 'r1'))$$, '42501', null, 'an Executive cannot validate');

-- Queue before validation (FR-DSR-017).
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is((select unrated_lines from public.dsr_validation_queue() where report_id = (select v from ids where k = 'r1')), 1,
  'the queue counts the unpriced line as unrated');
select is((select total_revenue from public.dsr_validation_queue() where report_id = (select v from ids where k = 'r1')), 54.30::numeric,
  'the queue shows the live total 50 + 0.30 + 4 = 54.30');
select is((select waiting_for_validator from public.dsr_validation_queue() where report_id = (select v from ids where k = 'r1')), false,
  'eligible validators exist');

select lives_ok($$select public.dsr_validate((select v from ids where k = 'r1'))$$, 'AC-DSR-005 another eligible user validates');
select is((select validated_by from daily_site_reports where id = (select v from ids where k = 'r1')), '15220000-0000-0000-0000-0000000000b3'::uuid,
  'AC-DSR-005 the validator is recorded');
select is((select array_agg(amount order by line_id) filter (where amount is not null) is not null from public.dsr_report_revenue((select v from ids where k = 'r1'))), true,
  'revenue is readable by the validator');
select results_eq($$select amount from public.dsr_report_revenue((select v from ids where k = 'r1'))$$,
  $$values (50.00::numeric), (0.30::numeric), (4.00::numeric), (null::numeric)$$,
  'AC-DSR-003 frozen amounts: 10x5, 0.1x3 exact, a Weld stage at 80% of 5, and no rate for the unpriced line');

-- ── AC-DSR-006 / 007: frozen history, only validated counts ─────────────────────────────────────────
reset role;
insert into rate_catalogue_rates (org_id, item_id, variant_id, rate, effective_from) values
  ('15220000-0000-0000-0000-0000000000a1', '15220000-0000-0000-0000-0000000000d2', '15220000-0000-0000-0000-0000000000d1', 7, '2026-03-01');
set local role authenticated;
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b1","role":"authenticated"}';
insert into ids select 'r2', public.dsr_save_draft(jsonb_build_object('work_order_id', '15220000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-11',
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '15220000-0000-0000-0000-000000000011', 'quantity', 10))));
insert into ids select 'r3', public.dsr_save_draft(jsonb_build_object('work_order_id', '15220000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-12',
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '15220000-0000-0000-0000-000000000011', 'quantity', 100))));
select public.dsr_submit((select v from ids where k = 'r3'));
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is((select sum(amount) from public.dsr_report_revenue((select v from ids where k = 'r1'))), 54.30::numeric,
  'AC-DSR-006 a validated report keeps its frozen revenue after the rate changes');
select is((select amount from public.dsr_report_revenue((select v from ids where k = 'r2'))), 70.00::numeric,
  'AC-DSR-006 a draft shows the new rate');
select is(public.work_order_validated_revenue('15220000-0000-0000-0000-0000000000e1'), 54.30::numeric,
  'AC-DSR-007 only the validated report counts toward work-order revenue');
select results_eq($$select status from daily_site_reports where work_order_id = '15220000-0000-0000-0000-0000000000e1' and status = 'submitted'$$,
  $$values ('submitted'::text)$$, 'AC-DSR-015 a status filter returns only matching reports');

-- ── AC-DSR-008: return with a reason, edit, resubmit ───────────────────────────────────────────────
select throws_ok($$select public.dsr_return((select v from ids where k = 'r3'), '  ')$$, '22023', null, 'AC-DSR-008 a return needs a reason');
select lives_ok($$select public.dsr_return((select v from ids where k = 'r3'), 'Quantity looks too high')$$, 'AC-DSR-008 the validator returns it');
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'r3'),
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '15220000-0000-0000-0000-000000000011', 'quantity', 12))))$$,
  'AC-DSR-008 the author edits the returned report');
select lives_ok($$select public.dsr_submit((select v from ids where k = 'r3'))$$, 'AC-DSR-008 and resubmits');
select results_eq($$select action from dsr_events where report_id = (select v from ids where k = 'r3') order by at, id$$,
  $$values ('created'::text), ('submitted'::text), ('returned'::text), ('submitted'::text)$$, 'AC-DSR-008 history lists the return and resubmit');
select is((select reason from dsr_events where report_id = (select v from ids where k = 'r3') and action = 'returned'), 'Quantity looks too high',
  'AC-DSR-008 the return reason is kept');

-- ── AC-DSR-009: validated is immutable; a correction supersedes ────────────────────────────────────
select throws_ok($$update daily_site_reports set note = 'edit' where id = (select v from ids where k = 'r1')$$, '42501', null,
  'AC-DSR-009 a direct edit of a report is refused');
select throws_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'r1')))$$, '42501', null,
  'AC-DSR-009 a validated report cannot be saved again');
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b3","role":"authenticated"}';
insert into ids select 'c1', public.dsr_correct((select v from ids where k = 'r1'), 'Weld quantity was 20');
select lives_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'c1'),
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '15220000-0000-0000-0000-000000000011', 'quantity', 20))))$$,
  'AC-DSR-009 the corrector edits the new version');
select public.dsr_submit((select v from ids where k = 'c1'));
select throws_ok($$select public.dsr_validate((select v from ids where k = 'c1'))$$, '42501', null, 'AC-DSR-009 the corrector cannot validate their own version');
select is(public.work_order_validated_revenue('15220000-0000-0000-0000-0000000000e1'), 54.30::numeric, 'AC-DSR-009 the original counts until its correction is validated');
set local request.jwt.claims = '{"sub":"15220000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($$select public.dsr_validate((select v from ids where k = 'c1'))$$, 'AC-DSR-009 the project PM validates the correction');
select isnt((select superseded_at from daily_site_reports where id = (select v from ids where k = 'r1')), null, 'AC-DSR-009 the original is superseded but kept');
select is(public.work_order_validated_revenue('15220000-0000-0000-0000-0000000000e1'), 140.00::numeric,
  'AC-DSR-009 revenue uses only the correction (20 x the rate in force, 7)');

-- ── AC-DSR-011: consumables post no stock ──────────────────────────────────────────────────────────
reset role;
select is((select count(*)::int from stock_documents), (select n from stock_before), 'AC-DSR-011 recording consumables posts no stock document');

select * from finish();
rollback;
