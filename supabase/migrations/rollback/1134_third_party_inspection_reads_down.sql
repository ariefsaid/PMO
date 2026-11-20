-- 1134_third_party_inspection_reads_down.sql — reverse 1134 (#2580).
select cron.unschedule('tpi-overdue');
drop function if exists public.run_tpi_overdue_sweep(date);
drop function if exists public.work_order_inspection_prerequisites(uuid, uuid, text);
drop function if exists public.tpi_costs(uuid);
drop function if exists public.tpi_is_complete(text, text, timestamptz);
