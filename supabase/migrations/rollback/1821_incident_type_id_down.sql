-- 1821_incident_type_id_down.sql — reverse 1821. `incident_reports.type` was never rewritten, so nothing to restore.
drop trigger if exists incident_types_zz_carry_rename on public.incident_types;
drop function if exists public.incident_types_carry_rename();
drop trigger if exists incident_reports_zz_type_list on public.incident_reports;
drop function if exists public.resolve_incident_type();
drop index if exists public.incident_reports_type_id_idx;
alter table public.incident_reports drop column if exists type_id;
