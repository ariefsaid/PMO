-- 0460_equipment_costing_down.sql — reverse of 0460 (#1519 S2), reverse dependency order.
drop function if exists public.list_equipment_usage_totals(uuid, uuid, date, date);
drop function if exists public.list_equipment_allocations(uuid, date, date, uuid);
drop function if exists public.preview_equipment_costing(jsonb);
drop function if exists public.list_equipment_costing(boolean);
drop function if exists public.end_equipment_costing(uuid, date, int);
drop function if exists public.save_equipment_costing(jsonb);
drop function if exists public.equipment_costing_write(jsonb, text, boolean);
-- restore S1's stub body before the helper it reads goes away
create or replace function public.equipment_entry_locked_unit(p_org uuid, p_asset uuid, p_date date) returns text
  language sql stable set search_path = public, pg_temp as $$ select null::text $$;
drop function if exists public.equipment_hire_charges(uuid, jsonb, uuid);
drop function if exists public.equipment_usage_by_project(uuid);
drop function if exists public.equipment_costing_assert_no_conflict(uuid, jsonb);
drop function if exists public.equipment_settings_effective(uuid, jsonb);
drop function if exists public.cost_attribution_matches_overlap(uuid, text, text, text, text, text, text, text, text, text, text);
drop function if exists public.equipment_costing_normalize(uuid, jsonb, boolean);
drop function if exists public.equipment_costing_content(uuid);
drop table if exists public.equipment_costing_settings;
