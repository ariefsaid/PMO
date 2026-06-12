-- 0025_document_file_upload.sql — Document file upload: parent_document_id lineage column,
-- auto-Superseded RPC logic, storage bucket + RLS.
-- Reversibility (pre-prod): `supabase db reset`. Forward rollback:
--   drop policy if exists storage_objects_project_doc_read on storage.objects;
--   drop policy if exists storage_objects_project_doc_write on storage.objects;
--   delete from storage.buckets where id = 'project-documents';
--   drop index if exists project_documents_parent_idx;
--   alter table project_documents drop column if exists parent_document_id;
--   (enum rollback requires recreating — handled by 0024 separately)

-- ============================================================================
-- §1 — Lineage: parent_document_id self-FK (nullable)
-- ============================================================================
alter table project_documents
  add column parent_document_id uuid references project_documents(id) on delete set null;
create index project_documents_parent_idx on project_documents (parent_document_id);

-- ============================================================================
-- §2 — Update transition_document_status RPC: Superseded terminal + auto-transition
-- Replaces the 0017 version. Adds:
--   - Superseded to the legal map (empty outbound array — terminal)
--   - When p_to = 'Approved' and the target row has a non-null parent_document_id,
--     AND the parent is in ('Issued','Approved'), set the parent's status to
--     'Superseded' in the same transaction (explicit row-lock parent for update).
-- ============================================================================
create or replace function transition_document_status(p_doc_id uuid, p_to doc_status)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from      doc_status;
  v_org       uuid;
  v_author    uuid;
  v_parent_id uuid;
  v_uid       uuid      := auth.uid();
  v_role      user_role := auth_role();
  v_legal jsonb := jsonb_build_object(
    'Draft',      jsonb_build_array('Issued'),
    'Issued',     jsonb_build_array('Approved','Rejected'),
    'Approved',   jsonb_build_array('Closed'),
    'Rejected',   jsonb_build_array('Draft','Closed'),
    'Closed',     jsonb_build_array(),
    'Superseded', jsonb_build_array()
  );
begin
  select status, org_id, author_id, parent_document_id
    into v_from, v_org, v_author, v_parent_id
    from public.project_documents where id = p_doc_id for update;
  if v_from is null then
    raise exception 'document not found' using errcode = 'P0002';
  end if;

  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized to transition this document' using errcode = '42501';
  end if;

  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal document transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  if p_to in ('Approved','Rejected') and v_uid is not distinct from v_author then
    raise exception 'separation of duties: cannot approve or reject your own document'
      using errcode = '42501';
  end if;

  update public.project_documents
    set status = p_to
  where id = p_doc_id;

  -- Auto-Superseded: when a child revision is Approved, mark the parent Superseded.
  -- Condition: parent status must be in ('Issued','Approved') — both are valid
  -- starting states for creating a new revision.
  if p_to = 'Approved' and v_parent_id is not null then
    -- Explicit row-lock the parent to prevent concurrent transitions
    perform 1 from public.project_documents where id = v_parent_id for update;

    update public.project_documents
      set status = 'Superseded'
    where id = v_parent_id
      and status in ('Issued','Approved');
    -- No error if parent was not Issued/Approved (already superseded/closed — idempotent)
  end if;
end; $$;
revoke all     on function transition_document_status(uuid, doc_status) from public;
grant  execute on function transition_document_status(uuid, doc_status) to   authenticated;
revoke execute on function transition_document_status(uuid, doc_status) from anon;

-- ============================================================================
-- §3 — Storage bucket: project-documents (private, 5 MB, MIME allowlist)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'project-documents',
    'project-documents',
    false,
    5242880,  -- 5 MB in bytes
    array[
      'application/pdf',
      'image/png', 'image/jpeg', 'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/vnd.dxf', 'application/dxf', 'application/acad',
      'text/csv', 'text/plain'
    ]
  ) on conflict (id) do nothing;

-- ============================================================================
-- §4 — Storage RLS: org-scoped read + Draft-only write
-- ============================================================================

-- Read: authenticated users can read objects in their own org's path prefix.
-- Enforce 4-segment path shape: {org_id}/{project_id}/{doc_id}/{filename}
create policy storage_objects_project_doc_read on storage.objects
  for select
  using (
    bucket_id = 'project-documents'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth_org_id()::text
    and array_length(string_to_array(name, '/'), 1) = 4
  );

-- Write (insert/update/delete): org-scoped AND project-scoped AND 4-segment path
-- shape AND the object key's document-id segment references a Draft
-- project_documents row AND the actor holds a write role.
-- Path pattern: {org_id}/{project_id}/{doc_id}/{filename}
create policy storage_objects_project_doc_write on storage.objects
  for all
  using (
    bucket_id = 'project-documents'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth_org_id()::text
    and array_length(string_to_array(name, '/'), 1) = 4
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (
      select 1 from public.project_documents pd
        where pd.id::text = split_part(name, '/', 3)
          and pd.org_id = auth_org_id()
          and pd.project_id::text = split_part(name, '/', 2)
          and pd.status = 'Draft'
    )
  )
  with check (
    bucket_id = 'project-documents'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth_org_id()::text
    and array_length(string_to_array(name, '/'), 1) = 4
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (
      select 1 from public.project_documents pd
        where pd.id::text = split_part(name, '/', 3)
          and pd.org_id = auth_org_id()
          and pd.project_id::text = split_part(name, '/', 2)
          and pd.status = 'Draft'
    )
  );
