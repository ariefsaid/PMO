-- Reverse of 1165 (revert 1166..1168 first). The text column already holds each category's name, so nothing is lost.
drop trigger if exists project_documents_zc_category on public.project_documents;
drop function if exists public.resolve_project_document_category();
revoke insert (category_id), update (category_id) on public.project_documents from authenticated;
drop index if exists public.project_documents_org_category_idx;
alter table public.project_documents drop constraint if exists project_documents_category_fkey;
alter table public.project_documents drop column if exists category_id;
alter table public.project_documents alter column category drop default;

create or replace function public.guard_project_document_metadata_author() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() then return new; end if;
  if (new.title is distinct from old.title
      or new.category is distinct from old.category
      or new.code is distinct from old.code
      or new.doc_date is distinct from old.doc_date
      or new.revision is distinct from old.revision
      or new.project_id is distinct from old.project_id
      or new.file_path is distinct from old.file_path
      or new.source is distinct from old.source
      or new.ms_drive_id is distinct from old.ms_drive_id
      or new.ms_item_id is distinct from old.ms_item_id
      or new.ms_web_url is distinct from old.ms_web_url
      or new.ms_item_name is distinct from old.ms_item_name
      or new.ms_item_kind is distinct from old.ms_item_kind)
     and old.author_id is distinct from auth.uid()
     and public.auth_role() is distinct from 'Admin' then
    raise exception 'Document metadata edit is not permitted.' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists project_document_metadata_author_guard on public.project_documents;
create trigger project_document_metadata_author_guard
  before update of title, category, code, doc_date, revision, project_id, file_path, source, ms_drive_id, ms_item_id, ms_web_url, ms_item_name, ms_item_kind
  on public.project_documents for each row execute function public.guard_project_document_metadata_author();

create or replace function public.audit_project_document_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status,new.author_id,new.title,new.code,new.category,new.revision,new.doc_date,new.file_path,
      new.project_id,new.parent_document_id)
     is not distinct from
     (old.status,old.author_id,old.title,old.code,old.category,old.revision,old.doc_date,old.file_path,
      old.project_id,old.parent_document_id) then
    return new;
  end if;
  perform public.log_audit('project_document.update',new.org_id,auth.uid(),new.id,
    jsonb_build_object('status',new.status::text,'author_id',new.author_id,
      'from_title',old.title,'to_title',new.title,'from_code',old.code,'to_code',new.code,
      'from_category',old.category,'to_category',new.category,'from_revision',old.revision,
      'to_revision',new.revision,'from_doc_date',old.doc_date,'to_doc_date',new.doc_date,
      'from_file_path',old.file_path,'to_file_path',new.file_path));
  return new;
end; $$;
