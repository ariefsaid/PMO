-- 1702_attendance_second_record_guard_down.sql — reverse 1702.
drop trigger if exists attendance_days_reopen_second_record on public.attendance_days;
drop trigger if exists attendance_days_undecided_guard on public.attendance_days;
drop function if exists public.reopen_attendance_second_record();
drop function if exists public.guard_attendance_day_undecided();
