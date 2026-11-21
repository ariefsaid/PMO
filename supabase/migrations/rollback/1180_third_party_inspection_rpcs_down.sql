-- 1180_third_party_inspection_rpcs_down.sql — reverse 1131 (#2580).
drop function if exists public.tpi_cancel(uuid,text);
drop function if exists public.tpi_waive(uuid,text);
drop function if exists public.tpi_record_report(uuid,text);
drop function if exists public.tpi_record_execution(uuid,date);
drop function if exists public.tpi_record_invitation(uuid,date,text,text);
drop function if exists public.tpi_create(uuid,text,text,date,uuid,numeric,text,text,text[],uuid);
drop function if exists public.tpi_load_for_update(uuid);
