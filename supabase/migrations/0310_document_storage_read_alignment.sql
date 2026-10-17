-- #1101 document-storage read alignment.
alter policy storage_objects_project_doc_read on storage.objects using (
 bucket_id = 'project-documents' and auth.uid() is not null
 and split_part(name, '/', 1) = public.auth_org_id()::text
 and array_length(string_to_array(name, '/'), 1) = 4
 and public.is_active_member());
alter policy storage_objects_proc_file_read on storage.objects using (
 bucket_id = 'procurement-files' and auth.uid() is not null
 and split_part(name, '/', 1) = public.auth_org_id()::text
 and array_length(string_to_array(name, '/'), 1) = 5
 and public.is_active_member());
