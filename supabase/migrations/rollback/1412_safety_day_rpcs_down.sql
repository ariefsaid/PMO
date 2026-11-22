-- Reverses 1412_safety_day_rpcs.sql.
drop function if exists public.safety_work_order_days(uuid, date, date);
drop function if exists public.correct_safety_day(uuid, text);
drop function if exists public.submit_safety_day(uuid);
drop function if exists public.safety_day_missing(uuid);
drop function if exists public.safety_save_talk(uuid, text, text, timestamptz, jsonb);
