-- Reverse of 1092: policies first, then the helper. Visibility returns to "every active member of the organisation".
drop policy if exists storage_project_documents_category_visible on storage.objects;
drop policy if exists project_documents_category_visible on public.project_documents;
drop function if exists public.document_category_visible(uuid, uuid);
