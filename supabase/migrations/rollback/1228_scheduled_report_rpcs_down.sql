drop function if exists public.archive_scheduled_report(uuid);
drop function if exists public.set_scheduled_report_enabled(uuid, boolean);
drop function if exists public.save_scheduled_report(uuid, text, text, text, integer, time, uuid[], text[], boolean);
