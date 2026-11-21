-- 1415_equipment_target_settings_down.sql — reverse of 1415 (#2701). Reverse 1416 first.
drop function if exists public.get_equipment_targets();
drop function if exists public.set_equipment_targets(numeric, numeric, int);
alter table public.organizations
  drop column if exists equipment_escalation_down_days,
  drop column if exists equipment_utilisation_target_pct,
  drop column if exists equipment_availability_target_pct;
