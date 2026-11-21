-- 1219_light_accounts_land_carry.test.sql — migration 1219 (extends 1206/1209 to the tables and read functions of 1148-1187).
-- Every listed table carries a restrictive light_account_deny policy; every overload of every listed function carries the guard;
-- a light account reads no row of work_order_sections / crew_tool_lines while a full Engineer of the same organisation reads them.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   drop policy light_account_deny_select on work_order_sections 'work_order_sections has the restrictive light_account_deny_* per-command policies'
--                                                               and 'a light account reads no work_order_sections row'
--   remove the guard line from tpi_costs ....................... 'tpi_costs: every overload carries assert_not_light'
begin;
create extension if not exists pgtap;
select plan(45);

insert into organizations (id, name, default_currency, built_in_roles_enabled) values
  ('27190000-0000-0000-0000-00000000000a', 'LC Org', 'IDR', true);
insert into auth.users (id, email) values
  ('27190000-0000-0000-0000-0000000000a4', 'lc-eng@example.com'),
  ('27190000-0000-0000-0000-0000000000a6', 'lc-field@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27190000-0000-0000-0000-0000000000a4', '27190000-0000-0000-0000-00000000000a', 'LC Eng',   'lc-eng@example.com',   'Engineer', 'active', null),
  ('27190000-0000-0000-0000-0000000000a6', '27190000-0000-0000-0000-00000000000a', 'LC Field', 'lc-field@example.com', 'Engineer', 'active', 'field_user');
insert into projects (id, org_id, name, status) values
  ('27190000-0000-0000-0000-0000000000d1', '27190000-0000-0000-0000-00000000000a', 'LC Site', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('27190000-0000-0000-0000-000000000401', '27190000-0000-0000-0000-00000000000a', '27190000-0000-0000-0000-0000000000d1', 'LC WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name) values
  ('27190000-0000-0000-0000-000000000c01', '27190000-0000-0000-0000-00000000000a', 'LC-1', 'LC crew');
insert into work_order_sections (id, org_id, project_id, work_order_id, code, name) values
  ('27190000-0000-0000-0000-000000000e01', '27190000-0000-0000-0000-00000000000a', '27190000-0000-0000-0000-0000000000d1', '27190000-0000-0000-0000-000000000401', 'S1', 'LC section');
insert into crew_tool_lines (id, org_id, crew_id, name, held_qty) values
  ('27190000-0000-0000-0000-000000000f01', '27190000-0000-0000-0000-00000000000a', '27190000-0000-0000-0000-000000000c01', 'LC tool', 1);

-- every listed table: restrictive per-command light_account_deny_* policies (select/insert/update; delete only where granted), no `for all`
select is((select string_agg(cmd || ':' || permissive, ',' order by cmd) from pg_policies
            where schemaname = 'public' and tablename = x.t and policyname ~ '^light_account_deny(_|$)'),
  case when has_table_privilege('authenticated', 'public.' || x.t, 'DELETE') then 'DELETE:RESTRICTIVE,' else '' end
    || 'INSERT:RESTRICTIVE,SELECT:RESTRICTIVE,UPDATE:RESTRICTIVE',
  x.t || ' has the restrictive light_account_deny_* per-command policies')
  from unnest(array[
  'boq_quantity_versions',
  'client_requisition_events',
  'client_requisition_lines',
  'client_requisition_pickups',
  'client_requisitions',
  'consumable_usage_standards',
  'crew_tool_lines',
  'crew_tool_report_files',
  'crew_tool_reports',
  'document_categories',
  'document_category_roles',
  'org_crew_tool_settings',
  'quantity_change_request_events',
  'quantity_change_request_files',
  'quantity_change_request_lines',
  'quantity_change_requests',
  'quantity_forecasts',
  'quantity_overrun_notices',
  'subcontract_backcharges',
  'subcontract_certificate_backcharges',
  'subcontract_certificate_claims',
  'subcontract_certificate_deselections',
  'subcontract_certificate_lines',
  'subcontract_certificates',
  'subcontractor_rate_lines',
  'third_party_inspection_files',
  'third_party_inspections',
  'work_order_consumable_plan_lines',
  'work_order_section_material_plan',
  'work_order_section_readiness_events',
  'work_order_sections']) as x(t);

-- every listed function: every overload carries the guard
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = x.f
            and p.prosrc not like '%assert_not_light%'), 0, x.f || ': every overload carries assert_not_light')
  from unnest(array[
  'bill_subcontract_certificate',
  'budget_attributed_year_sums',
  'cus_get_plan',
  'mrq_section_plan_for',
  'qcr_approval_state',
  'qcr_over_contract',
  'qcr_work_order_budget',
  'subcontract_certificate_view',
  'tpi_costs',
  'work_order_section_material_check']) as x(f);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;
set local role authenticated;

select pg_temp.act_as('27190000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from work_order_sections), 1, 'a full engineer reads the work_order_sections row');
select is((select count(*)::int from crew_tool_lines), 1, 'a full engineer reads the crew_tool_lines row');
select pg_temp.act_as('27190000-0000-0000-0000-0000000000a6');
select is(public.actor_is_light(), true, 'the field user is a light account');
select is((select count(*)::int from work_order_sections) + (select count(*)::int from crew_tool_lines), 0,
  'a light account reads no work_order_sections row and no crew_tool_lines row');

select * from finish();
rollback;
