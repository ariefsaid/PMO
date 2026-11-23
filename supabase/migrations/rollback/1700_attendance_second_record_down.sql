-- 1700_attendance_second_record_down.sql — reverse 1700. Reverse 1702 and 1701 first.
drop function if exists public.set_attendance_time_roles(text[], text[]);
drop table if exists public.attendance_second_records;
drop function if exists public.attendance_second_record_may_decide();
drop function if exists public.attendance_second_record_may_enter();
alter table public.organizations
  drop column if exists attendance_decider_roles,
  drop column if exists attendance_second_record_roles;
