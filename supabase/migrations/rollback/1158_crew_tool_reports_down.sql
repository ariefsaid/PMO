-- Reverse of 1158_crew_tool_reports.sql. Reverse 1160 and 1159 first. Loses report history; never touches lines.
drop trigger if exists tasks_zz_crew_tool_guard on public.tasks;
drop function if exists public.guard_crew_tool_task();
update public.record_history_config set captured = captured - 'crew_tool_report_id' where entity_type = 'task';
drop index if exists public.tasks_crew_tool_report_idx;
alter table public.tasks drop column if exists crew_tool_report_id;
drop trigger if exists zz_crew_tool_lines_open_reports on public.crew_tool_lines;
drop function if exists public.guard_crew_tool_line_open_reports();
drop policy if exists storage_objects_crew_tool_file_read on storage.objects;
drop policy if exists storage_objects_crew_tool_file_write on storage.objects;
delete from storage.objects where bucket_id = 'crew-tool-files';
delete from storage.buckets where id = 'crew-tool-files';
drop table if exists public.crew_tool_report_files;
drop table if exists public.crew_tool_reports;
drop table if exists public.org_crew_tool_settings;
drop function if exists public.stamp_crew_tool_file_org();
drop function if exists public.crew_tool_can_report(uuid);
drop function if exists public.crew_tool_is_reporter();
drop function if exists public.crew_tool_photo_stored(text);
