-- Reverse of 1039. The bucket is removed only when empty (remove objects through the Storage API first).
do $$ begin
  if exists (select 1 from storage.objects where bucket_id = 'expiry-documents') then
    raise exception '1039 rollback refused: expiry-documents holds objects';
  end if;
end $$;
drop policy if exists storage_objects_expiry_doc_delete on storage.objects;
drop policy if exists storage_objects_expiry_doc_update on storage.objects;
drop policy if exists storage_objects_expiry_doc_insert on storage.objects;
drop policy if exists storage_objects_expiry_doc_read on storage.objects;
drop function if exists public.expiry_document_object_readable(text);
drop function if exists public.expiry_document_object_writable(text);
delete from storage.buckets where id = 'expiry-documents';
