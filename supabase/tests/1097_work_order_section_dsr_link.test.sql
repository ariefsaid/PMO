-- 1097_work_order_section_dsr_link.test.sql — #2576: a daily-report progress line may name a section of its report's work order.
-- Migrations under test: 1097_work_order_section_children.sql (daily-report part), 1098 (work_order_section_progress).
-- AC-WOS-003 (progress-line path) a section of another work order is refused · AC-WOS-006 an archived section takes no new line ·
-- AC-WOS-002 (progress) the validated quantity per section plus the remainder is the work-order total · FR-WOS-016 only the
-- current validated version counts · a correction keeps each line's section.
begin;
create extension if not exists pgtap;
select plan(11);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25770000-0000-0000-0000-0000000000a1', 'WOSD Org', 'USD', 'UTC');
insert into auth.users (id, email) values
  ('25770000-0000-0000-0000-0000000000b1', 'wosd-eng@example.com'),
  ('25770000-0000-0000-0000-0000000000b2', 'wosd-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25770000-0000-0000-0000-0000000000b1', '25770000-0000-0000-0000-0000000000a1', 'WOSD Engineer', 'wosd-eng@example.com', 'Engineer', 'active'),
  ('25770000-0000-0000-0000-0000000000b2', '25770000-0000-0000-0000-0000000000a1', 'WOSD PM', 'wosd-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('25770000-0000-0000-0000-0000000000c1', '25770000-0000-0000-0000-0000000000a1', 'WOSD Contract', 'Ongoing Project', 'USD', '25770000-0000-0000-0000-0000000000b2');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25770000-0000-0000-0000-0000000000e1', '25770000-0000-0000-0000-0000000000a1', '25770000-0000-0000-0000-0000000000c1', 'WO one', 'Issued', 10000, 'exclusive', 0),
  ('25770000-0000-0000-0000-0000000000e2', '25770000-0000-0000-0000-0000000000a1', '25770000-0000-0000-0000-0000000000c1', 'WO two', 'Issued', 10000, 'exclusive', 0);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25770000-0000-0000-0000-0000000000f1', '25770000-0000-0000-0000-0000000000a1', '25770000-0000-0000-0000-0000000000c1', 'L1', 'Weld line', 'm', 100, 5);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('25770000-0000-0000-0000-000000000011', '25770000-0000-0000-0000-0000000000a1', '25770000-0000-0000-0000-0000000000e1', '25770000-0000-0000-0000-0000000000f1', 100);
insert into work_order_sections (id, org_id, project_id, work_order_id, code, name) values
  ('25770000-0000-0000-0000-000000000b01', '25770000-0000-0000-0000-0000000000a1', '25770000-0000-0000-0000-0000000000c1', '25770000-0000-0000-0000-0000000000e1', 'A', 'Section A'),
  ('25770000-0000-0000-0000-000000000b02', '25770000-0000-0000-0000-0000000000a1', '25770000-0000-0000-0000-0000000000c1', '25770000-0000-0000-0000-0000000000e1', 'B', 'Section B'),
  ('25770000-0000-0000-0000-000000000b09', '25770000-0000-0000-0000-0000000000a1', '25770000-0000-0000-0000-0000000000c1', '25770000-0000-0000-0000-0000000000e2', 'X', 'Other WO section'),
  ('25770000-0000-0000-0000-000000000b0a', '25770000-0000-0000-0000-0000000000a1', '25770000-0000-0000-0000-0000000000c1', '25770000-0000-0000-0000-0000000000e1', 'OLD', 'Archived');
update work_order_sections set archived_at = now() where id = '25770000-0000-0000-0000-000000000b0a';

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"25770000-0000-0000-0000-0000000000b1","role":"authenticated"}';

insert into ids select 'r1', public.dsr_save_draft(jsonb_build_object(
  'work_order_id', '25770000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-10',
  'progress', jsonb_build_array(
    jsonb_build_object('work_order_line_id', '25770000-0000-0000-0000-000000000011', 'quantity', 10, 'section_id', '25770000-0000-0000-0000-000000000b01'),
    jsonb_build_object('work_order_line_id', '25770000-0000-0000-0000-000000000011', 'quantity', 5, 'section_id', '25770000-0000-0000-0000-000000000b02'),
    jsonb_build_object('work_order_line_id', '25770000-0000-0000-0000-000000000011', 'quantity', 2.5))));

select is((select count(*)::int from dsr_progress_lines where report_id = (select v from ids where k = 'r1') and section_id is not null), 2,
  'a progress line names a section of its work order; one line stays unsectioned');
select is((select work_order_id from dsr_progress_lines where report_id = (select v from ids where k = 'r1') and position = 1),
  '25770000-0000-0000-0000-0000000000e1'::uuid, 'the line carries its report''s work order (stamped, not sent by the caller)');

-- AC-WOS-003: another work order's section, an archived section and a bad id are all refused.
select throws_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'r1'),
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '25770000-0000-0000-0000-000000000011', 'quantity', 1,
    'section_id', '25770000-0000-0000-0000-000000000b09'))))$$, '23514', 'progress line 1 names a section that is not on this work order',
  'AC-WOS-003 a progress line naming a section of another work order is refused');
select throws_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'r1'),
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '25770000-0000-0000-0000-000000000011', 'quantity', 1,
    'section_id', '25770000-0000-0000-0000-000000000b0a'))))$$, '23514', 'WOS_SECTION_ARCHIVED: an archived section takes no new or moved records',
  'AC-WOS-006 an archived section takes no new progress line');
select throws_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'r1'),
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '25770000-0000-0000-0000-000000000011', 'quantity', 1,
    'section_id', 'not-a-uuid'))))$$, '23514', 'progress line 1 names a section that is not on this work order',
  'a malformed section id is refused, never ignored');
select is((select count(*)::int from dsr_progress_lines where report_id = (select v from ids where k = 'r1')), 3,
  'the refused saves left the draft unchanged');

-- The composite key itself, whichever path writes (the table owner bypasses the RPC checks, not the key).
reset role;
select throws_ok($$update dsr_progress_lines set section_id = '25770000-0000-0000-0000-000000000b09'
  where report_id = (select v from ids where k = 'r1') and position = 1$$, '23503', null,
  'AC-WOS-003 the composite foreign key refuses another work order''s section on any write path');

-- Progress read: draft counts for nothing; validated counts; the remainder is its own row.
select is((select count(*)::int from work_order_section_progress('25770000-0000-0000-0000-0000000000e1')), 0,
  'FR-WOS-016 a draft report contributes nothing (the measure is absent, not zero)');
update daily_site_reports set status = 'validated', validated_at = now(), validated_by = '25770000-0000-0000-0000-0000000000b2', submitted_at = now() where id = (select v from ids where k = 'r1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25770000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select results_eq($$select coalesce(section_id::text, 'none'), quantity::text from work_order_section_progress('25770000-0000-0000-0000-0000000000e1') order by 1$$,
  $$values ('25770000-0000-0000-0000-000000000b01', '10.000'), ('25770000-0000-0000-0000-000000000b02', '5.000'), ('none', '2.500')$$,
  'AC-WOS-002 validated quantity per section and the unsectioned remainder');
select is((select sum(quantity) from work_order_section_progress('25770000-0000-0000-0000-0000000000e1')), 17.5::numeric,
  'AC-WOS-002 sections + remainder equal the work order total (10 + 5 + 2.5)');

-- A correction copies each line's section.
insert into ids select 'c1', public.dsr_correct((select v from ids where k = 'r1'), 'Re-measured');
select is((select count(*)::int from dsr_progress_lines where report_id = (select v from ids where k = 'c1') and section_id is not null), 2,
  'a correction keeps every line''s section');

select * from finish();
rollback;
