-- 2160_import_work_orders.test.sql — docs/specs/work-order-import.spec.md. Migration under test: 2160_import_work_orders.sql.
-- AC-WOI-003 a batch lands as Drafts with area and scope lines · AC-WOI-004 one bad row saves nothing and is named ·
-- AC-WOI-005 who may import is the work-order create rule (an Engineer and another org are refused).
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name, default_currency) values
  ('21600000-0000-0000-0000-00000000000a', 'WOI Org',       'IDR'),
  ('21600000-0000-0000-0000-00000000000b', 'WOI Other Org', 'IDR');
insert into auth.users (id, email) values
  ('21600000-0000-0000-0000-0000000000a1', 'woi-admin@example.com'),
  ('21600000-0000-0000-0000-0000000000a3', 'woi-pm@example.com'),
  ('21600000-0000-0000-0000-0000000000a4', 'woi-eng@example.com'),
  ('21600000-0000-0000-0000-0000000000b1', 'woi-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21600000-0000-0000-0000-0000000000a1', '21600000-0000-0000-0000-00000000000a', 'WOI Admin', 'woi-admin@example.com', 'Admin', 'active'),
  ('21600000-0000-0000-0000-0000000000a3', '21600000-0000-0000-0000-00000000000a', 'WOI PM',    'woi-pm@example.com',    'Project Manager', 'active'),
  ('21600000-0000-0000-0000-0000000000a4', '21600000-0000-0000-0000-00000000000a', 'WOI Eng',   'woi-eng@example.com',   'Engineer', 'active'),
  ('21600000-0000-0000-0000-0000000000b1', '21600000-0000-0000-0000-00000000000b', 'WOI XOrg',  'woi-xorg@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('21600000-0000-0000-0000-0000000000d1', '21600000-0000-0000-0000-00000000000a', 'WOI Site', 'Ongoing Project', '21600000-0000-0000-0000-0000000000a3');
insert into boq_items(id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('21600000-0000-0000-0000-000000000701', '21600000-0000-0000-0000-00000000000a', '21600000-0000-0000-0000-0000000000d1', 'B-1', 'Pipe', 'm', 100, 10);
insert into work_order_areas (id, org_id, code, name) values
  ('21600000-0000-0000-0000-000000000501', '21600000-0000-0000-0000-00000000000a', 'N1', 'North');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;

select pg_temp.act_as('21600000-0000-0000-0000-0000000000a3');
select is((public.import_work_orders('21600000-0000-0000-0000-0000000000d1', $j$[
  {"title":"Pump pad","client_po_number":"PO-1","order_value":1000,"tax_treatment":"exclusive","tax_amount":0,"start_date":"2026-12-01","end_date":"2026-12-31",
   "area_id":"21600000-0000-0000-0000-000000000501","lines":[{"boq_item_id":"21600000-0000-0000-0000-000000000701","quantity":40}]},
  {"title":"Tank base","order_value":500,"tax_treatment":"inclusive"}]$j$::jsonb))->>'created', '2', 'AC-WOI-003 a Project Manager imports two work orders');
select is((select count(*)::int from public.work_orders where project_id = '21600000-0000-0000-0000-0000000000d1'), 2, 'AC-WOI-003 both are saved');
select is((select count(*)::int from public.work_orders where project_id = '21600000-0000-0000-0000-0000000000d1' and status = 'Draft' and wo_number is null), 2, 'AC-WOI-003 every imported work order is a Draft with no number');
select is((select area_id from public.work_orders where client_po_number = 'PO-1'), '21600000-0000-0000-0000-000000000501'::uuid, 'AC-WOI-003 the area is set');
select is((select l.quantity from public.work_order_lines l join public.work_orders w on w.id = l.work_order_id where w.client_po_number = 'PO-1'), 40::numeric, 'AC-WOI-003 the scope line is allocated');
select is((select org_id from public.work_orders where client_po_number = 'PO-1'), '21600000-0000-0000-0000-00000000000a'::uuid, 'AC-WOI-003 the org is stamped from the session');

-- AC-WOI-004: row 2 is bad (quantity over the contract line), so row 1 must not be saved either.
select throws_like($$ select public.import_work_orders('21600000-0000-0000-0000-0000000000d1', '[
  {"title":"Good one","order_value":1,"tax_treatment":"exclusive"},
  {"title":"Bad one","order_value":1,"tax_treatment":"exclusive","lines":[{"boq_item_id":"21600000-0000-0000-0000-000000000701","quantity":-5}]}]'::jsonb) $$,
  'IMPORT_ROW: row 2:%', 'AC-WOI-004 the failing row is named');
select is((select count(*)::int from public.work_orders where title in ('Good one','Bad one')), 0, 'AC-WOI-004 nothing is saved when any row fails');
select throws_like($$ select public.import_work_orders('21600000-0000-0000-0000-0000000000d1', '[{"title":"X","order_value":1,"tax_treatment":"sometimes"}]'::jsonb) $$,
  'IMPORT_ROW: row 1:%', 'AC-WOI-004 an unknown tax treatment is refused with its row');
select throws_like($$ select public.import_work_orders('21600000-0000-0000-0000-0000000000d1', '[]'::jsonb) $$, 'IMPORT_EMPTY:%', 'AC-WOI-004 an empty file is refused');

-- AC-WOI-005
select pg_temp.act_as('21600000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.import_work_orders('21600000-0000-0000-0000-0000000000d1', '[{"title":"Eng","order_value":1,"tax_treatment":"exclusive"}]'::jsonb) $$,
  '42501', null, 'AC-WOI-005 an Engineer cannot import work orders');
select pg_temp.act_as('21600000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.import_work_orders('21600000-0000-0000-0000-0000000000d1', '[{"title":"Other","order_value":1,"tax_treatment":"exclusive"}]'::jsonb) $$,
  'P0002', null, 'AC-WOI-005 another organisation cannot reach the project');
select pg_temp.act_as('21600000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.import_work_orders('21600000-0000-0000-0000-0000000000d1', '[{"title":"Admin one","order_value":1,"tax_treatment":"exclusive"}]'::jsonb) $$, 'AC-WOI-005 an Admin may import');
select is((select count(*)::int from public.work_orders where title = 'Admin one'), 1, 'AC-WOI-005 the Admin''s work order is saved');

select * from finish();
rollback;
