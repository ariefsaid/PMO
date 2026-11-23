-- 1701_attendance_second_record_rpcs_down.sql — reverse 1701. Reverse 1702 first.
drop function if exists public.attendance_report_day_hours(uuid);
drop function if exists public.attendance_second_record_decide(uuid, uuid, date, text, text);
drop function if exists public.attendance_second_record(uuid, date, jsonb);
drop function if exists public.attendance_day_undecided(uuid, uuid, date);
