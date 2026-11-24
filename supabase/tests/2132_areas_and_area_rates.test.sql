-- 2132_areas_and_area_rates.test.sql — areas and rates, generic (docs/specs/areas-and-area-rates.spec.md).
-- AC-ARA-001 an area carries an optional description · 002 only the roles that write revenue set an area rate, on a contract-priced line
-- · 003 a report's rate defaults from its work order's area · 004 the report's own area overrides it · 005 an area with no rate (or no area)
-- keeps the contract rate: no change for an organisation with no areas · 006 validation freezes the area rate · 007 area rates are money: others read none.
-- MUTATION NOTES: set_boq_item_area_rate: replace `public.dsr_may_write_revenue(v_b.project_id)` with `true` -> 'AC-ARA-002 an Engineer' red;
-- dsr_line_rate: replace `coalesce(p_area, b.wo_area)` with `p_area` -> 'AC-ARA-003' red; with `b.wo_area` -> 'AC-ARA-004' red;
-- policy boq_item_area_rates_select: drop the dsr_may_see_revenue clause -> 'AC-ARA-007' red.
begin;
create extension if not exists pgtap;
select plan(19);

insert into organizations (id, name, default_currency, default_timezone) values
  ('21320000-0000-0000-0000-0000000000a1', 'ARA Org', 'USD', 'UTC'), ('21320000-0000-0000-0000-0000000000a2', 'ARA Other', 'USD', 'UTC');
insert into auth.users (id, email) values ('21320000-0000-0000-0000-0000000000b1', 'ara-eng@example.com'), ('21320000-0000-0000-0000-0000000000b2', 'ara-admin@example.com'),
  ('21320000-0000-0000-0000-0000000000b3', 'ara-admin2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21320000-0000-0000-0000-0000000000b1', '21320000-0000-0000-0000-0000000000a1', 'ARA Engineer', 'ara-eng@example.com', 'Engineer', 'active'),
  ('21320000-0000-0000-0000-0000000000b2', '21320000-0000-0000-0000-0000000000a1', 'ARA Admin', 'ara-admin@example.com', 'Admin', 'active'),
  ('21320000-0000-0000-0000-0000000000b3', '21320000-0000-0000-0000-0000000000a1', 'ARA Admin Two', 'ara-admin2@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status, currency) values ('21320000-0000-0000-0000-0000000000c1', '21320000-0000-0000-0000-0000000000a1', 'ARA Contract', 'Ongoing Project', 'USD');
insert into work_order_areas (id, org_id, code, name) values
  ('21320000-0000-0000-0000-000000000a01', '21320000-0000-0000-0000-0000000000a1', 'N', 'North'),
  ('21320000-0000-0000-0000-000000000a02', '21320000-0000-0000-0000-0000000000a1', 'S', 'South'),
  ('21320000-0000-0000-0000-000000000a03', '21320000-0000-0000-0000-0000000000a2', 'X', 'Foreign');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('21320000-0000-0000-0000-0000000000f1', '21320000-0000-0000-0000-0000000000a1', '21320000-0000-0000-0000-0000000000c1', 'L1', 'Weld line', 'm', 100, 5);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount, area_id) values
  ('21320000-0000-0000-0000-0000000000e1', '21320000-0000-0000-0000-0000000000a1', '21320000-0000-0000-0000-0000000000c1', 'WO north', 'Issued', 1000, 'exclusive', 0, '21320000-0000-0000-0000-000000000a01'),
  ('21320000-0000-0000-0000-0000000000e2', '21320000-0000-0000-0000-0000000000a1', '21320000-0000-0000-0000-0000000000c1', 'WO none', 'Issued', 1000, 'exclusive', 0, null);
insert into work_order_lines (id, org_id, work_order_id, boq_item_id, quantity) values
  ('21320000-0000-0000-0000-000000000011', '21320000-0000-0000-0000-0000000000a1', '21320000-0000-0000-0000-0000000000e1', '21320000-0000-0000-0000-0000000000f1', 100),
  ('21320000-0000-0000-0000-000000000012', '21320000-0000-0000-0000-0000000000a1', '21320000-0000-0000-0000-0000000000e2', '21320000-0000-0000-0000-0000000000f1', 100);

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21320000-0000-0000-0000-0000000000b2","role":"authenticated"}';

update work_order_areas set description = 'Northern block' where id = '21320000-0000-0000-0000-000000000a01';
select is((select description from work_order_areas where id = '21320000-0000-0000-0000-000000000a01'), 'Northern block', 'AC-ARA-001 an Admin gives an area a description');
select is((select description from work_order_areas where id = '21320000-0000-0000-0000-000000000a02'), null, 'AC-ARA-001 the description is optional');

-- before any area rate: the contract rate (an organisation with no area rates sees no change)
insert into ids select 'north', public.dsr_save_draft(jsonb_build_object('work_order_id', '21320000-0000-0000-0000-0000000000e1', 'work_date', '2026-03-10',
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '21320000-0000-0000-0000-000000000011', 'quantity', 10))));
insert into ids select 'plain', public.dsr_save_draft(jsonb_build_object('work_order_id', '21320000-0000-0000-0000-0000000000e2', 'work_date', '2026-03-10',
  'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '21320000-0000-0000-0000-000000000012', 'quantity', 10))));
select is((select rate from public.dsr_report_revenue((select v from ids where k = 'north'))), 5::numeric, 'AC-ARA-005 no area rate set: the contract rate');

select lives_ok($$select public.set_boq_item_area_rate('21320000-0000-0000-0000-0000000000f1', '21320000-0000-0000-0000-000000000a01', 8)$$, 'AC-ARA-002 an Admin sets the North rate');
select lives_ok($$select public.set_boq_item_area_rate('21320000-0000-0000-0000-0000000000f1', '21320000-0000-0000-0000-000000000a01', 8.5)$$, 'AC-ARA-002 and changes it');
select is((select rate from public.dsr_report_revenue((select v from ids where k = 'north'))), 8.5::numeric, 'AC-ARA-003 a report on a North work order takes the North rate');
select is((select amount from public.dsr_report_revenue((select v from ids where k = 'north'))), 85::numeric, 'AC-ARA-003 and prices the quantity with it');
select is((select rate from public.dsr_report_revenue((select v from ids where k = 'plain'))), 5::numeric, 'AC-ARA-005 a work order with no area keeps the contract rate');

-- the report's own area overrides: South has no rate -> the contract rate; then North's again
select lives_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'north'), 'work_order_id', '21320000-0000-0000-0000-0000000000e1',
  'work_date', '2026-03-10', 'area_id', '21320000-0000-0000-0000-000000000a02', 'progress', jsonb_build_array(jsonb_build_object('work_order_line_id', '21320000-0000-0000-0000-000000000011', 'quantity', 10))))$$,
  'AC-ARA-004 the report names its own area');
select is((select rate from public.dsr_report_revenue((select v from ids where k = 'north'))), 5::numeric, 'AC-ARA-004 the report area (no rate there) overrides the work order area');
select throws_ok($$select public.dsr_save_draft(jsonb_build_object('id', (select v from ids where k = 'north'), 'work_order_id', '21320000-0000-0000-0000-0000000000e1',
  'work_date', '2026-03-10', 'area_id', '21320000-0000-0000-0000-000000000a03'))$$, '23503', null, 'AC-ARA-004 another organisation''s area is refused');

select throws_ok($$select public.set_boq_item_area_rate('21320000-0000-0000-0000-0000000000f1', '21320000-0000-0000-0000-000000000a03', 9)$$, '23503', null, 'AC-ARA-002 another organisation''s area is refused');
select throws_ok($$select public.set_boq_item_area_rate('21320000-0000-0000-0000-0000000000f1', '21320000-0000-0000-0000-000000000a02', 0)$$, '22023', null, 'AC-ARA-002 a rate must be positive');

set local request.jwt.claims = '{"sub":"21320000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.set_boq_item_area_rate('21320000-0000-0000-0000-0000000000f1', '21320000-0000-0000-0000-000000000a02', 9)$$, '42501', null, 'AC-ARA-002 an Engineer cannot set an area rate');
select is((select count(*)::int from boq_item_area_rates), 0, 'AC-ARA-007 an Engineer reads no area rate');

-- validation freezes the area rate on the work date
reset role;
update daily_site_reports set area_id = null, status = 'submitted', submitted_at = now() where id = (select v from ids where k = 'north');
insert into storage.objects (bucket_id, name, owner)
  select 'site-report-photos', '21320000-0000-0000-0000-0000000000a1/' || v || '/21320000-0000-0000-0000-000000000031/form.jpg', '21320000-0000-0000-0000-0000000000b1' from ids where k = 'north';
insert into dsr_photos (org_id, report_id, kind, file_path)
  select '21320000-0000-0000-0000-0000000000a1', v, 'paper_form', '21320000-0000-0000-0000-0000000000a1/' || v || '/21320000-0000-0000-0000-000000000031/form.jpg' from ids where k = 'north';
update daily_site_reports set author_id = '21320000-0000-0000-0000-0000000000b1' where id = (select v from ids where k = 'north');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21320000-0000-0000-0000-0000000000b3","role":"authenticated"}';
-- The report area must also govern the submitted queue, alongside the validator-role rules.
reset role;
update daily_site_reports set area_id = '21320000-0000-0000-0000-000000000a02' where id = (select v from ids where k = 'north');
set local role authenticated;
select is((select total_revenue from public.dsr_validation_queue() where report_id = (select v from ids where k = 'north')), 50::numeric,
  'AC-ARA-004 the validation queue uses the report area instead of its work order area');
reset role;
update daily_site_reports set area_id = null where id = (select v from ids where k = 'north');
set local role authenticated;
select lives_ok($$select public.dsr_validate((select v from ids where k = 'north'))$$, 'AC-ARA-006 an eligible user validates');
reset role;
select is((select frozen_rate::numeric from dsr_progress_lines where report_id = (select v from ids where k = 'north')), 8.5::numeric, 'AC-ARA-006 the line froze the North rate');
select is((select frozen_rate_source from dsr_progress_lines where report_id = (select v from ids where k = 'north')), 'contract', 'AC-ARA-006 and still reads as a contract rate');
select * from finish();
rollback;
