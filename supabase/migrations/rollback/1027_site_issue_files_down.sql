-- 1027_site_issue_files_down.sql — reverse 1027 (#2521). Drops the evidence table and bucket row; issues stay.
drop trigger if exists incident_reports_zz_close_proof on public.incident_reports;
drop function if exists public.guard_incident_close_proof();
drop policy if exists storage_objects_incident_orphan_delete on storage.objects;
drop policy if exists storage_objects_incident_file_write on storage.objects;
drop policy if exists storage_objects_incident_file_read on storage.objects;
delete from storage.buckets where id = 'incident-files';
drop table if exists public.incident_files;
drop function if exists public.guard_incident_file();
drop function if exists public.can_add_incident_evidence(uuid);
