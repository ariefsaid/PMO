-- 1033_equipment_availability_reads_down.sql — reverse of 0986 (#2526).
select cron.unschedule('equipment-downtime-escalation');
drop function if exists public.list_equipment_proofs(uuid[], date);
drop function if exists public.list_equipment_downtime_flags();
drop function if exists public.run_equipment_downtime_escalations(date);
drop function if exists public.equipment_downtime_escalations(uuid, date);
drop function if exists public.equipment_metrics(uuid[], date, date, text);
drop function if exists public.equipment_downtime_days(uuid, uuid, date, date);
