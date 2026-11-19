-- 0989_attendance_days_down.sql — reverse 0989. Reverse 0990 first.
drop function if exists public.attendance_record(uuid, date, text, jsonb);
drop policy if exists storage_objects_attendance_photo_write on storage.objects;
drop policy if exists storage_objects_attendance_photo_read on storage.objects;
-- bucket: only once it holds no objects (remove them through the Storage API first):
--   delete from storage.buckets where id = 'attendance-photos';
drop table if exists public.attendance_photos;
drop table if exists public.attendance_days;
drop function if exists public.guard_attendance_day();
drop function if exists public.attendance_can_record(uuid);
drop function if exists public.worker_off_rotation(uuid, date);
drop table if exists public.crew_worker_rotation_off;
alter table public.organizations
  drop column if exists attendance_conflict_tolerance_hours,
  drop column if exists attendance_backdate_days;
