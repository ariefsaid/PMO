-- 1165_document_category_reference.sql — #2579 step 2 of 5: every register document references a category.
-- project_documents.category (text) stays, so every existing writer (the command-line client, the Microsoft 365 folder and link
-- routines, the operator write API) keeps working unchanged: a BEFORE INSERT OR UPDATE trigger resolves the text name to the
-- organisation's live category, else to Other, and keeps the text equal to the category's current name (FR-DCV-007).
-- A revision inherits its parent's category on the insert path, so the form is not what keeps a lineage together (FR-DCV-009).

alter table public.project_documents add column category_id uuid;

-- Categories that exist only as free text in the register become custom categories (all roles), so no document changes audience.
-- A blank text is the fallback category. The system set was seeded by 1164, so 'Reference' is system, not discovered.
insert into public.document_categories (org_id, name, sort_order)
select d.org_id, min(btrim(d.category)), 1000 + (row_number() over (partition by d.org_id order by lower(btrim(d.category))))::int * 10
  from public.project_documents d
 where btrim(d.category) <> ''
   and not exists (select 1 from public.document_categories c
                    where c.org_id = d.org_id and lower(c.name) = lower(btrim(d.category)) and c.archived_at is null)
 group by d.org_id, lower(btrim(d.category));
insert into public.document_category_roles (category_id, org_id, role)
select c.id, c.org_id, r from public.document_categories c cross join unnest(enum_range(null::public.user_role)) r
 where not exists (select 1 from public.document_category_roles x where x.category_id = c.id)
on conflict do nothing;

update public.project_documents d
   set category_id = c.id, category = c.name
  from public.document_categories c
 where c.org_id = d.org_id and c.archived_at is null
   and lower(c.name) = case when btrim(d.category) = '' then 'other' else lower(btrim(d.category)) end;

alter table public.project_documents alter column category_id set not null;
alter table public.project_documents alter column category set default '';
alter table public.project_documents
  add constraint project_documents_category_fkey foreign key (category_id, org_id) references public.document_categories (id, org_id);
create index project_documents_org_category_idx on public.project_documents (org_id, category_id);

grant insert (category_id), update (category_id) on public.project_documents to authenticated;

-- The one resolver. Named zc_ so it fires after stamp_org_id (org_id is the caller's by then) on INSERT.
create or replace function public.resolve_project_document_category() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_id       uuid;
  v_name     text;
  v_archived timestamptz;
  v_found    boolean;
  v_by_text  uuid;
  v_parent   uuid;
begin
  if tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id
     and new.category is not distinct from old.category then
    return new;
  end if;

  -- 1. which category: an explicit reference wins; otherwise the text name resolves in the row's organisation
  v_id := new.category_id;
  if tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id then
    v_id := null;   -- only the text changed: resolve it
  end if;
  if v_id is null then
    select c.id into v_by_text from public.document_categories c
     where c.org_id = new.org_id and c.archived_at is null and lower(c.name) = lower(btrim(coalesce(new.category, '')));
    v_id := v_by_text;
    -- only the text changed and it names the row's own (possibly archived) category, e.g. after a rename: keep it
    if v_id is null and tg_op = 'UPDATE' then
      select c.id into v_by_text from public.document_categories c
       where c.id = old.category_id and c.org_id = new.org_id and lower(c.name) = lower(btrim(coalesce(new.category, '')));
      v_id := v_by_text;
    end if;
  end if;

  -- 2. a revision shares its parent's category (OD-DCV-8): stamp it, refuse a different one, refuse a parent the caller cannot read
  if tg_op = 'INSERT' and new.parent_document_id is not null then
    select d.category_id into v_parent from public.project_documents d
     where d.id = new.parent_document_id and d.org_id = new.org_id;
    if v_parent is null then
      -- no such parent in this organisation, or one the caller cannot read: the same refusal the parent foreign key gives
      raise exception 'insert or update on table "project_documents" violates foreign key constraint "project_documents_parent_org_project_fkey"'
        using errcode = '23503';
    end if;
    if v_id is not null and (new.category_id is not null or btrim(coalesce(new.category, '')) <> '') and v_id is distinct from v_parent then
      raise exception 'A revision keeps the category of the document it revises' using errcode = '23514', detail = 'category-revision-mismatch';
    end if;
    v_id := v_parent;
  end if;

  -- 3. unknown or blank text falls back to Other
  if v_id is null then
    select c.id into v_id from public.document_categories c
     where c.org_id = new.org_id and c.archived_at is null and c.is_system and lower(c.name) = 'other';
  end if;

  select c.name, c.archived_at, true into v_name, v_archived, v_found
    from public.document_categories c where c.id = v_id and c.org_id = new.org_id;
  -- a category of another organisation, or an archived one, cannot be filed into; a revision may inherit an archived parent category
  if v_found is not true or (v_archived is not null
       and not (tg_op = 'INSERT' and new.parent_document_id is not null)
       and not (tg_op = 'UPDATE' and v_id is not distinct from old.category_id)) then
    raise exception 'Choose an available category' using errcode = '23514', detail = 'category-unavailable';
  end if;

  new.category_id := v_id;
  new.category := v_name;
  return new;
end $$;
revoke all on function public.resolve_project_document_category() from public, anon, authenticated;
create trigger project_documents_zc_category before insert or update of category, category_id, org_id on public.project_documents
  for each row execute function public.resolve_project_document_category();

-- The metadata guard (0348) and the audit trigger (0292) compared the text; they now compare the reference too.
create or replace function public.guard_project_document_metadata_author() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if public.actor_bypasses_rls() then return new; end if;
  if (new.title is distinct from old.title
      or new.category is distinct from old.category
      or new.category_id is distinct from old.category_id                                     -- 1165
      or new.code is distinct from old.code
      or new.doc_date is distinct from old.doc_date
      or new.revision is distinct from old.revision
      or new.project_id is distinct from old.project_id
      or new.file_path is distinct from old.file_path                                         -- 0349
      or new.source is distinct from old.source                                               -- 0349
      or new.ms_drive_id is distinct from old.ms_drive_id                                     -- 0349
      or new.ms_item_id is distinct from old.ms_item_id                                       -- 0349
      or new.ms_web_url is distinct from old.ms_web_url                                       -- 0349
      or new.ms_item_name is distinct from old.ms_item_name                                   -- 0349
      or new.ms_item_kind is distinct from old.ms_item_kind)                                  -- 0349
     and old.author_id is distinct from auth.uid()
     and public.auth_role() is distinct from 'Admin' then
    raise exception 'Document metadata edit is not permitted.' using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists project_document_metadata_author_guard on public.project_documents;
create trigger project_document_metadata_author_guard
  before update of title, category, category_id, code, doc_date, revision, project_id, file_path, source, ms_drive_id, ms_item_id, ms_web_url, ms_item_name, ms_item_kind
  on public.project_documents for each row execute function public.guard_project_document_metadata_author();

create or replace function public.audit_project_document_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status,new.author_id,new.title,new.code,new.category,new.category_id,new.revision,new.doc_date,new.file_path,
      new.project_id,new.parent_document_id)
     is not distinct from
     (old.status,old.author_id,old.title,old.code,old.category,old.category_id,old.revision,old.doc_date,old.file_path,
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
