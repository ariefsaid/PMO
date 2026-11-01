-- 0447_equipment_usage_down.sql — reverse of 0447 (#1519 S1), reverse dependency order.
drop function if exists public.archive_equipment_usage(uuid);
drop function if exists public.approve_equipment_usage_week(uuid, date);
drop function if exists public.transition_equipment_usage(uuid, text, text);
drop function if exists public.save_equipment_usage(jsonb);
drop function if exists public.equipment_usage_transition_core(uuid, text, text);
drop function if exists public.equipment_can_approve(uuid, public.user_role, uuid, uuid);
drop function if exists public.equipment_entry_locked_unit(uuid, uuid, date);
drop function if exists public.equipment_org_today(uuid);
drop table if exists public.equipment_usage_entries;   -- drops its triggers
drop function if exists public.audit_equipment_usage_delete();
drop table if exists public.equipment_assets;
