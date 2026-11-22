-- 1358_equipment_plan_down.sql — reverses 1358 (#2700). Refused while any plan line has created a purchase (export and reclassify first).
do $$ begin
  if exists (select 1 from public.equipment_plan_lines where procurement_id is not null) then
    raise exception 'rollback refused: plans have created purchases — export them first';
  end if;
end $$;
drop function if exists public.reject_equipment_plan(uuid, text);
drop function if exists public.reopen_equipment_plan(uuid);
drop function if exists public.submit_equipment_plan(uuid);
drop function if exists public.save_equipment_plan(uuid, uuid, date, jsonb);
drop function if exists public.equipment_plan_gate();
drop function if exists public.set_equipment_plan_category_active(uuid, boolean);
drop function if exists public.upsert_equipment_plan_category(uuid, text, text, integer);
drop function if exists public.set_equipment_plan_settings(boolean, text, boolean);
drop table if exists public.equipment_plan_lines;
drop table if exists public.equipment_plans;
drop function if exists public.guard_equipment_plan_line();
drop function if exists public.guard_equipment_plan();
drop function if exists public.equipment_plan_approver_ok(uuid);
drop function if exists public.equipment_plan_rental_type(uuid);
drop function if exists public.equipment_plan_enabled(uuid);
drop table if exists public.equipment_plan_categories;
drop table if exists public.org_equipment_plan_settings;
drop function if exists public.equipment_plan_engineer_on_project(uuid);
