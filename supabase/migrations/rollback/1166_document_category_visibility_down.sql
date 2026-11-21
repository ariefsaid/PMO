-- Reverse of 1166: policies first, then the helper. Visibility returns to "every active member of the organisation".
do $$
declare c text;
begin
  foreach c in array array['select', 'insert', 'update', 'delete'] loop
    execute format('drop policy if exists %I on storage.objects', 'storage_project_documents_category_visible_' || c);
    execute format('drop policy if exists %I on public.project_documents', 'project_documents_category_visible_' || c);
  end loop;
end $$;
drop function if exists public.document_category_visible(uuid, uuid);
