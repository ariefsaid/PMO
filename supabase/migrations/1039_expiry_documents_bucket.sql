-- 1039_expiry_documents_bucket.sql — #2542 (map #2516): private bucket for expiring-document attachments.
-- Path: {org}/{kind}/{subject}/{file}/{filename}, kind = person | equipment. Write follows the row rule in 0970
-- (Admin any kind; Project Manager equipment only); read adds a person's manager. Medical documents hold no file (0970 constraint).
-- Helpers are SECURITY INVOKER: people and equipment_assets RLS still apply to the subject lookup.
-- Reverse: rollback/1039_expiry_documents_bucket_down.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('expiry-documents', 'expiry-documents', false, 5242880,
          array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

create function public.expiry_document_object_writable(p_name text) returns boolean
  language sql stable security invoker set search_path = public, pg_temp as $$
  select split_part(p_name, '/', 1) = public.auth_org_id()::text
     and array_length(string_to_array(p_name, '/'), 1) = 5
     and public.is_active_member()
     and case split_part(p_name, '/', 2)
           when 'equipment' then public.auth_role() in ('Admin', 'Project Manager')
             and exists (select 1 from public.equipment_assets a where a.id::text = split_part(p_name, '/', 3) and a.org_id = public.auth_org_id())
           when 'person' then public.auth_role() = 'Admin'
             and exists (select 1 from public.people p where p.id::text = split_part(p_name, '/', 3) and p.org_id = public.auth_org_id())
           else false end;
$$;
create function public.expiry_document_object_readable(p_name text) returns boolean
  language sql stable security invoker set search_path = public, pg_temp as $$
  select public.expiry_document_object_writable(p_name)
      or (split_part(p_name, '/', 1) = public.auth_org_id()::text
          and array_length(string_to_array(p_name, '/'), 1) = 5
          and public.is_active_member()
          and split_part(p_name, '/', 2) = 'person'
          and exists (select 1 from public.people p where p.id::text = split_part(p_name, '/', 3)
                        and p.org_id = public.auth_org_id() and p.manager_id = auth.uid()));
$$;
revoke all on function public.expiry_document_object_writable(text), public.expiry_document_object_readable(text) from public, anon;
grant execute on function public.expiry_document_object_writable(text), public.expiry_document_object_readable(text) to authenticated;

create policy storage_objects_expiry_doc_read on storage.objects for select to authenticated
  using (bucket_id = 'expiry-documents' and public.expiry_document_object_readable(name));
create policy storage_objects_expiry_doc_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'expiry-documents' and public.expiry_document_object_writable(name));
create policy storage_objects_expiry_doc_update on storage.objects for update to authenticated
  using (bucket_id = 'expiry-documents' and public.expiry_document_object_writable(name))
  with check (bucket_id = 'expiry-documents' and public.expiry_document_object_writable(name));
create policy storage_objects_expiry_doc_delete on storage.objects for delete to authenticated
  using (bucket_id = 'expiry-documents' and public.expiry_document_object_writable(name));
