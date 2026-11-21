-- 1200_builtin_role_catalogue.test.sql — #2709 the 28 built-in roles, their base levels and capabilities.
-- Migration under test: supabase/migrations/1200_builtin_role_catalogue.sql
-- Expectations are INDEPENDENT literals written here, never derived from the tables under test.
begin;
select plan(48);

select is((select count(*)::int from built_in_roles), 28, 'AC-001 28 built-in roles');
select is((select count(*)::int from built_in_roles where tier = 'manager'), 12, 'AC-001 12 managers');
select is((select count(*)::int from built_in_roles where tier = 'officer'), 14, 'AC-001 14 officers');
select is((select count(*)::int from built_in_roles where tier = 'field'), 2, 'AC-001 2 field roles');
select is((select count(*)::int from built_in_roles where btrim(name_en) <> '' and btrim(name_id) <> ''), 28,
  'AC-001 every role has English and Bahasa names');

-- AC-002 key -> base level, one assertion per key (independent literal list).
select is(built_in_role_base(k)::text, b, 'AC-002 ' || k || ' -> ' || b)
from (values
  ('executive','Executive'),('administrator','Admin'),('project_manager','Project Manager'),
  ('deputy_project_manager','Project Manager'),('project_administrator','Engineer'),
  ('project_control_manager','Project Manager'),('engineer','Engineer'),('planner','Engineer'),
  ('quantity_surveyor','Engineer'),('billing_officer','Finance'),('construction_manager','Project Manager'),
  ('site_supervisor','Engineer'),('foreman','Engineer'),('material_coordinator','Engineer'),('storekeeper','Engineer'),
  ('procurement_manager','Project Manager'),('buyer','Engineer'),('finance_manager','Finance'),
  ('finance_officer','Finance'),('quality_manager','Project Manager'),('quality_inspector','Engineer'),
  ('safety_manager','Project Manager'),('safety_officer','Engineer'),('equipment_manager','Project Manager'),
  ('equipment_officer','Engineer'),('hr_manager','Project Manager'),('hr_officer','Engineer'),('field_user','Engineer')
) as v(k, b);
select is(built_in_role_base(null), null, 'AC-002 NULL key -> NULL');
select is(built_in_role_base('nonsense'), null, 'AC-002 unknown key -> NULL');

-- AC-007 capability holders: exactly the listed keys, no other.
select is((select string_agg(role_key, ',' order by role_key) from built_in_role_capabilities where capability = 'stock_post'),
  'storekeeper', 'AC-007 stock_post = Storekeeper only');
select is((select string_agg(role_key, ',' order by role_key) from built_in_role_capabilities where capability = 'stock_approve'),
  'material_coordinator', 'AC-007 stock_approve = Material Coordinator only');
select is((select string_agg(role_key, ',' order by role_key) from built_in_role_capabilities where capability = 'daily_report_enter'),
  'quantity_surveyor', 'AC-007 daily_report_enter = Quantity Surveyor only');
select is((select string_agg(role_key, ',' order by role_key) from built_in_role_capabilities where capability = 'daily_report_validate'),
  'project_control_manager,site_supervisor', 'AC-007 daily_report_validate = Site Supervisor and Project Control Manager');
select is((select string_agg(role_key, ',' order by role_key) from built_in_role_capabilities where capability = 'crew_time_approve'),
  'construction_manager', 'AC-007 crew_time_approve = Construction Manager only');
select is((select string_agg(role_key, ',' order by role_key) from built_in_role_capabilities where capability = 'billing_stage_run'),
  'billing_officer', 'AC-007 billing_stage_run = Billing Officer only');
select is((select string_agg(role_key, ',' order by role_key) from built_in_role_capabilities where capability = 'invoice_raise'),
  'finance_manager,finance_officer', 'AC-007 invoice_raise = Finance Manager and Finance Officer');
select is((select string_agg(role_key, ',' order by role_key) from built_in_role_capabilities where capability = 'people_documents_view'),
  'administrator,hr_manager,hr_officer', 'AC-007 people_documents_view = HR roles and Administrator');
select is((select string_agg(role_key, ',' order by role_key) from built_in_role_capabilities where capability = 'medical_documents_view'),
  'administrator,hr_manager,hr_officer', 'AC-007 medical_documents_view = HR roles and Administrator (Executive excluded)');
select ok(role_has_capability('storekeeper', 'stock_post') and not role_has_capability('storekeeper', 'stock_approve'),
  'AC-007 helper: Storekeeper posts, does not approve');
select ok(not role_has_capability(null, 'stock_post') and not role_has_capability('nonsense', 'stock_post'),
  'AC-007 helper: NULL and unknown key hold nothing');

-- AC-008 prices: exactly the 12 managers + Buyer + Finance Officer + Billing Officer.
select is((select string_agg(k, ',' order by k) from (select key as k from built_in_roles where built_in_role_sees_prices(key)) s),
  'administrator,billing_officer,buyer,construction_manager,deputy_project_manager,equipment_manager,executive,finance_manager,finance_officer,hr_manager,procurement_manager,project_control_manager,project_manager,quality_manager,safety_manager',
  'AC-008 who sees prices');
select ok(built_in_role_sees_prices(null), 'AC-008 NULL key (existing people) sees prices');
select ok(not built_in_role_sees_prices('nonsense'), 'AC-008 unknown key fails closed');
select ok(not built_in_role_sees_prices('storekeeper') and not built_in_role_sees_prices('field_user')
  and not built_in_role_sees_prices('quantity_surveyor'), 'AC-008 officers and field outside purchasing/finance do not');

-- AC-010 tiers and stand-in.
select ok(built_in_role_may_approve('project_manager') and not built_in_role_may_approve('engineer')
  and not built_in_role_may_approve('foreman') and not built_in_role_may_approve(null), 'AC-010 managers approve, others do not');
select ok(built_in_role_may_prepare('planner') and not built_in_role_may_prepare('project_manager')
  and not built_in_role_may_prepare('field_user'), 'AC-010 officers prepare');
select ok(built_in_role_may_stand_in('deputy_project_manager', 'project_manager'), 'AC-010 Deputy PM stands in for PM');
select ok(built_in_role_may_stand_in('executive', 'project_manager'), 'AC-010 Executive stands in downward');
select ok(not built_in_role_may_stand_in('project_manager', 'executive'), 'AC-010 PM never stands in upward for Executive');
select ok(not built_in_role_may_stand_in('project_manager', 'finance_manager'), 'AC-010 PM does not stand in for Finance Manager (outranked)');
select ok(not built_in_role_may_stand_in('planner', 'project_manager') and not built_in_role_may_stand_in('project_manager', 'planner')
  and not built_in_role_may_stand_in(null, 'project_manager'), 'AC-010 officers and NULL never stand in or are stood in for');

-- AC-011 no client writes on the catalogue.
set local role authenticated;
select ok(true, 'AC-011 switched to authenticated');
select throws_ok($$ insert into built_in_roles (key, base_level, tier, function_key, sort_order, name_en, name_id)
  values ('rogue','Admin','manager','x',999,'Rogue','Rogue') $$, '42501', null, 'AC-011 authenticated cannot insert a role');
select throws_ok($$ update built_in_roles set base_level = 'Admin' where key = 'planner' $$, '42501', null, 'AC-011 authenticated cannot update a role');
select throws_ok($$ delete from built_in_roles where key = 'planner' $$, '42501', null, 'AC-011 authenticated cannot delete a role');
select throws_ok($$ insert into built_in_role_capabilities values ('planner','stock_post') $$, '42501', null, 'AC-011 authenticated cannot grant a capability');
select is((select count(*)::int from built_in_roles), 28, 'AC-011 authenticated can read the catalogue');
reset role;
select is(built_in_role_base('planner')::text, 'Engineer', 'AC-011 catalogue unchanged after the refused writes');

set local role anon;
select throws_ok($$ select count(*) from built_in_roles $$, '42501', null, 'AC-011 anon cannot read the catalogue');
select throws_ok($$ select built_in_role_base('planner') $$, '42501', null, 'AC-011 anon cannot call the mapping helper');
reset role;

select * from finish();
rollback;
