-- Restrict document attachment writes to the document author or an active Admin.
create policy storage_document_author_insert on storage.objects as restrictive for insert
  with check (
    bucket_id <> 'project-documents'
    or (public.is_active_member() and exists (
      select 1 from public.project_documents pd
      where pd.id::text = split_part(name, '/', 3)
        and pd.org_id = public.auth_org_id()
        and pd.project_id::text = split_part(name, '/', 2)
        and (pd.author_id = auth.uid() or public.auth_role() = 'Admin')
    ))
  );

create policy storage_document_author_update on storage.objects as restrictive for update
  using (
    bucket_id <> 'project-documents'
    or (public.is_active_member() and exists (
      select 1 from public.project_documents pd
      where pd.id::text = split_part(name, '/', 3)
        and pd.org_id = public.auth_org_id()
        and pd.project_id::text = split_part(name, '/', 2)
        and (pd.author_id = auth.uid() or public.auth_role() = 'Admin')
    ))
  )
  with check (
    bucket_id <> 'project-documents'
    or (public.is_active_member() and exists (
      select 1 from public.project_documents pd
      where pd.id::text = split_part(name, '/', 3)
        and pd.org_id = public.auth_org_id()
        and pd.project_id::text = split_part(name, '/', 2)
        and (pd.author_id = auth.uid() or public.auth_role() = 'Admin')
    ))
  );

create policy storage_document_author_delete on storage.objects as restrictive for delete
  using (
    bucket_id <> 'project-documents'
    or (public.is_active_member() and exists (
      select 1 from public.project_documents pd
      where pd.id::text = split_part(name, '/', 3)
        and pd.org_id = public.auth_org_id()
        and pd.project_id::text = split_part(name, '/', 2)
        and (pd.author_id = auth.uid() or public.auth_role() = 'Admin')
    ))
  );
