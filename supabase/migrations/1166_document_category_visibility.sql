-- 1166_document_category_visibility.sql — #2579 step 3 of 5: the visibility rule, enforced in the database.
-- One predicate: the caller's role (the existing auth_role() seam, ADR-0016) is a viewer role of the document's category, or the
-- caller is an Admin (OD-DCV-3). It is a RESTRICTIVE policy on the register table and on the project-documents bucket, so it ANDs
-- with every existing permissive policy and nothing about who may write changes. Each policy keeps the (select auth_role())
-- InitPlan form and does one primary-key probe of document_category_roles per row (NFR-DCV-001); the helper below is for the
-- callers that are not policies (definers, edge functions) and is never called by a policy.

create or replace function public.document_category_visible(p_category_id uuid, p_org_id uuid) returns boolean
language sql stable set search_path = public as $$
  select (select public.auth_role()) = 'Admin'
      or exists (select 1 from public.document_category_roles r
                  where r.category_id = p_category_id and r.org_id = p_org_id and r.role = (select public.auth_role()));
$$;
revoke all on function public.document_category_visible(uuid, uuid) from public, anon;
grant execute on function public.document_category_visible(uuid, uuid) to authenticated, service_role;

-- The file follows its register row: the object predicate's subquery runs under the caller's own RLS, so the row policy supplies the
-- category rule. The key is {org_id}/{project_id}/{document_id}/{filename}; the org segment is pinned so a key cannot borrow another
-- organisation's document id. A signed link is only created for an object the caller can select, so it needs no second rule.
-- One predicate, restated per command: the repository's policy-shape guard (0825) refuses a new FOR ALL policy.
do $$
declare
  c text;
  pred_row constant text := $p$(select public.auth_role()) = 'Admin'
         or exists (select 1 from public.document_category_roles r
                     where r.category_id = project_documents.category_id and r.org_id = project_documents.org_id
                       and r.role = (select public.auth_role()))$p$;
  pred_obj constant text := $p$bucket_id <> 'project-documents'
         or exists (select 1 from public.project_documents pd
                     where pd.id::text = split_part(objects.name, '/', 3) and pd.org_id::text = split_part(objects.name, '/', 1))$p$;
begin
  foreach c in array array['select', 'delete'] loop
    execute format('create policy %I on public.project_documents as restrictive for %s to authenticated using (%s)',
                   'project_documents_category_visible_' || c, c, pred_row);
    execute format('create policy %I on storage.objects as restrictive for %s to authenticated using (%s)',
                   'storage_project_documents_category_visible_' || c, c, pred_obj);
  end loop;
  execute format('create policy %I on public.project_documents as restrictive for insert to authenticated with check (%s)',
                 'project_documents_category_visible_insert', pred_row);
  execute format('create policy %I on storage.objects as restrictive for insert to authenticated with check (%s)',
                 'storage_project_documents_category_visible_insert', pred_obj);
  execute format('create policy %I on public.project_documents as restrictive for update to authenticated using (%s) with check (%s)',
                 'project_documents_category_visible_update', pred_row, pred_row);
  execute format('create policy %I on storage.objects as restrictive for update to authenticated using (%s) with check (%s)',
                 'storage_project_documents_category_visible_update', pred_obj, pred_obj);
end $$;
