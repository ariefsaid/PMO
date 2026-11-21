-- 1179_third_party_inspections_down.sql — reverse 1130 (#2580). Drops the tracker, its files and the bucket row.
drop policy if exists storage_objects_tpi_orphan_delete on storage.objects;
drop policy if exists storage_objects_tpi_file_write on storage.objects;
drop policy if exists storage_objects_tpi_file_read on storage.objects;
delete from storage.objects where bucket_id = 'inspection-reports';
delete from storage.buckets where id = 'inspection-reports';
drop table if exists public.third_party_inspection_files;
drop table if exists public.third_party_inspections;
drop function if exists public.guard_tpi_file();
drop function if exists public.guard_tpi_transition();
drop function if exists public.can_add_inspection_file(uuid);
