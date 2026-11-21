-- Reverses 1436_attendance_target_rate.sql. The setting is dropped with its column; the report function of 1437 must
-- be reversed first (rollback/1437_attendance_rate_by_crew_down.sql).

revoke update (attendance_target_rate) on public.organizations from authenticated;

alter table public.organizations
  drop column if exists attendance_target_rate;
